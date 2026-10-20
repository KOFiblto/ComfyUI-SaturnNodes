import os
import json
import torch
import numpy as np
from PIL import Image, ImageOps
import io
import asyncio
import hashlib
import threading
import piexif
import piexif.helper
from aiohttp import web
from server import PromptServer
import folder_paths
from .utils import (
    sanitize_folder_path,
    is_local_request,
    is_safe_path,
    sanitize_image_loader_folder,
    get_saturnnodes_user_dir,
    get_env_setting
)

IMAGE_CATEGORY = "🪐 SaturnNodes/Loaders"
CURRENT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
USER_DIR = get_saturnnodes_user_dir()
CACHE_FILE = os.path.join(USER_DIR, "image_prompts_cache.json")

def decode_bytes_safely(raw_bytes):
    if not isinstance(raw_bytes, bytes):
        return str(raw_bytes or "")
    for enc in ["utf-8", "utf-16le", "utf-16", "shift_jis", "gbk", "latin-1"]:
        try:
            return raw_bytes.decode(enc)
        except (UnicodeDecodeError, LookupError):
            continue
    return raw_bytes.decode("utf-8", errors="ignore")

def parse_positive_from_parameters(parameters):
    if not parameters:
        return ""
    if isinstance(parameters, bytes):
        parameters = decode_bytes_safely(parameters)
    lines = str(parameters).split("\n")
    pos_lines = []
    for line in lines:
        if line.strip().startswith("Negative prompt:") or line.strip().startswith("Steps:"):
            break
        pos_lines.append(line)
    return "\n".join(pos_lines).strip()

def trace_positive_prompt_from_graph(prompt_data):
    if not isinstance(prompt_data, dict):
        return ""

    start_nodes = []
    for nid, ndata in prompt_data.items():
        if not isinstance(ndata, dict):
            continue
        ctype = ndata.get("class_type", "")
        inputs = ndata.get("inputs", {})
        if any(kw in ctype for kw in ["Sampler", "KSampler", "Guider", "CFG"]):
            for link_key in ["positive", "conditioning", "guider"]:
                link = inputs.get(link_key)
                if isinstance(link, list) and len(link) > 0:
                    start_nodes.append(str(link[0]))

    visited = set()
    found_texts = []

    def walk(nid):
        if not nid or nid in visited:
            return
        visited.add(nid)
        ndata = prompt_data.get(nid)
        if not isinstance(ndata, dict):
            return
        inputs = ndata.get("inputs", {})

        for tkey in ["text", "prompt", "text_g", "text_l", "text_positive", "positive_prompt", "value", "string"]:
            val = inputs.get(tkey)
            if isinstance(val, str) and val.strip():
                s = val.strip()
                if s not in found_texts:
                    found_texts.append(s)
            elif isinstance(val, list) and len(val) > 0:
                walk(str(val[0]))

        for in_name, in_val in inputs.items():
            if isinstance(in_val, list) and len(in_val) > 0:
                low = in_name.lower()
                if "negative" in low:
                    continue
                if any(k in low for k in ["conditioning", "positive", "cond", "text", "prompt", "guider"]):
                    walk(str(in_val[0]))

    for sn in start_nodes:
        walk(sn)

    if found_texts:
        return "\n".join(found_texts)

    for nid, ndata in prompt_data.items():
        if not isinstance(ndata, dict):
            continue
        ctype = ndata.get("class_type", "")
        inputs = ndata.get("inputs", {})
        if any(k in ctype for k in ["CLIPTextEncode", "Text", "Prompt"]):
            for tkey in ["text", "prompt", "text_g", "text_l"]:
                val = inputs.get(tkey)
                if isinstance(val, str) and val.strip() and len(val.strip()) > 1:
                    s = val.strip()
                    if s not in found_texts:
                        found_texts.append(s)
    return "\n".join(found_texts) if found_texts else ""

def extract_metadata_from_image(filepath):
    positive_prompt = ""
    width, height = 0, 0
    try:
        with Image.open(filepath) as img:
            width, height = img.size
            info = img.info or {}

            # 1. ComfyUI native format (JSON string in img.info["prompt"])
            prompt_str = info.get("prompt")
            if prompt_str:
                try:
                    prompt_data = json.loads(prompt_str) if isinstance(prompt_str, str) else prompt_str
                    positive_prompt = trace_positive_prompt_from_graph(prompt_data)
                except Exception:
                    pass

            # 2. A1111 / WebUI parameters
            if not positive_prompt and "parameters" in info:
                parameters = info.get("parameters", "")
                if parameters:
                    positive_prompt = parse_positive_from_parameters(parameters)

            # 3. EXIF UserComment
            if not positive_prompt and "exif" in info:
                exif_data = info.get("exif")
                if exif_data:
                    try:
                        exif_dict = piexif.load(exif_data)
                        user_comment = exif_dict.get("Exif", {}).get(piexif.ExifIFD.UserComment)
                        if user_comment:
                            parameters = piexif.helper.UserComment.load(user_comment)
                            if isinstance(parameters, bytes):
                                parameters = parameters.decode('utf-8', errors='ignore')
                            positive_prompt = parse_positive_from_parameters(parameters)
                    except Exception:
                        pass
    except Exception as e:
        print(f"[SaturnNodes] Error extracting metadata: {e}")
    return positive_prompt, width, height

def load_prompts_cache():
    if os.path.exists(CACHE_FILE):
        try:
            with open(CACHE_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass
    return {}

def save_prompts_cache(cache):
    try:
        temp_file = CACHE_FILE + ".tmp"
        with open(temp_file, "w", encoding="utf-8") as f:
            json.dump(cache, f, indent=4, ensure_ascii=False)
        os.replace(temp_file, CACHE_FILE)
    except Exception as e:
        print(f"[SaturnNodes] Failed to save prompts cache: {e}")

_PROMPTS_CACHE_LOCK = threading.RLock()
IMAGE_THUMBNAILS_DIR = os.path.join(USER_DIR, "cache", "image_thumbs")

def get_image_metadata_scan_limit():
    try:
        limit = int(get_env_setting("IMAGE_LOADER_METADATA_LIMIT", "128"))
        return max(0, min(2000, limit))
    except Exception:
        return 128

def scan_image_folder(resolved_folder, metadata_limit=None):
    """Scan an image folder and read prompt metadata off the event-loop thread."""
    if metadata_limit is None:
        metadata_limit = get_image_metadata_scan_limit()

    image_extensions = {".png", ".jpg", ".jpeg", ".webp", ".bmp"}
    raw_files = []
    for root, dirs, files in os.walk(resolved_folder):
        for file in files:
            ext = os.path.splitext(file)[1]
            if ext.lower() in image_extensions:
                full_path = os.path.normpath(os.path.join(root, file))
                # The folder itself was already validated by the endpoint; just
                # enforce that walked files stay inside it.
                if not is_safe_path(full_path, [resolved_folder]):
                    continue
                try:
                    mtime = os.path.getmtime(full_path)
                except Exception:
                    mtime = 0
                rel_path = os.path.relpath(full_path, resolved_folder).replace("\\", "/")
                raw_files.append((rel_path, full_path, mtime))

    # Sort files by newest modified first
    raw_files.sort(key=lambda x: x[2], reverse=True)

    names = []
    mapping = {}
    prompts = {}

    with _PROMPTS_CACHE_LOCK:
        cache = load_prompts_cache()
        cache_modified = False

        for i, (rel_path, full_path, mtime) in enumerate(raw_files):
            names.append(rel_path)
            mapping[rel_path] = rel_path

            if i < metadata_limit:
                try:
                    cached_entry = cache.get(full_path)
                    if cached_entry and cached_entry.get("mtime") == mtime:
                        prompt_text = cached_entry.get("prompt", "")
                        cache[full_path] = cache.pop(full_path)
                    else:
                        prompt_text, _, _ = extract_metadata_from_image(full_path)
                        cache[full_path] = {
                            "mtime": mtime,
                            "prompt": prompt_text
                        }
                        cache_modified = True
                except Exception:
                    prompt_text = ""
                prompts[rel_path] = prompt_text
            else:
                prompts[rel_path] = ""

        # Prune cache to maximum 256 entries
        if len(cache) > 256:
            cache_keys = list(cache.keys())[-256:]
            cache = {k: cache[k] for k in cache_keys}
            cache_modified = True

        if cache_modified:
            save_prompts_cache(cache)

    return names, mapping, prompts

def get_or_create_image_thumbnail(img_path, mtime, max_size=256):
    """Disk-cached WebP thumbnails for the visual image loader."""
    try:
        max_size = max(64, min(1024, int(max_size)))
        cache_key = hashlib.md5(
            f"{os.path.normcase(os.path.abspath(img_path))}_{mtime}_{max_size}".encode("utf-8")
        ).hexdigest()
        thumb_path = os.path.join(IMAGE_THUMBNAILS_DIR, f"thumb_{cache_key}.webp")
        if os.path.exists(thumb_path) and os.path.getsize(thumb_path) > 0:
            return thumb_path

        with Image.open(img_path) as img:
            img = ImageOps.exif_transpose(img)
            if img.width <= max_size and img.height <= max_size:
                return img_path
            img = img.convert("RGB")
            img.thumbnail((max_size, max_size), Image.Resampling.BICUBIC)
            os.makedirs(IMAGE_THUMBNAILS_DIR, exist_ok=True)
            # Unique temp names keep concurrent requests for the same image from
            # overwriting each other's half-written WebP file.
            temp_path = thumb_path + f".{threading.get_ident()}.tmp"
            try:
                img.save(temp_path, format="WEBP", quality=82, method=1)
                os.replace(temp_path, thumb_path)
            finally:
                if os.path.exists(temp_path):
                    try:
                        os.remove(temp_path)
                    except OSError:
                        pass
        return thumb_path
    except Exception:
        return img_path

if hasattr(PromptServer, "instance") and PromptServer.instance is not None:
    routes = PromptServer.instance.routes
else:
    routes = web.RouteTableDef()
    print("[SaturnNodes] Notice: PromptServer instance not available during image_loader import; using standalone route table.")

@routes.get("/saturnnodes/image_loader/get_images")
async def get_images_endpoint(request):
    if not is_local_request(request):
        return web.json_response({"error": "Forbidden: Local access only"}, status=403)

    folder = request.query.get("folder", "")
    if not folder:
        folder = request.query.get("folder_path", "")

    resolved_folder = sanitize_image_loader_folder(folder)

    if not resolved_folder or not is_safe_path(resolved_folder) or not os.path.exists(resolved_folder):
        return web.json_response({"names": [], "mapping": {}, "prompts": {}})

    # Folder walks and metadata parsing are blocking disk I/O; keep them off
    # ComfyUI's asyncio event loop.
    names, mapping, prompts = await asyncio.to_thread(scan_image_folder, resolved_folder)

    return web.json_response({
        "names": names,
        "mapping": mapping,
        "prompts": prompts
    })

@routes.get("/saturnnodes/image_loader/get_thumbnail")
async def get_thumbnail_endpoint(request):
    if not is_local_request(request):
        return web.Response(status=403)

    folder = request.query.get("folder", "")
    if not folder:
        folder = request.query.get("folder_path", "")
    resolved_folder = sanitize_image_loader_folder(folder)

    image_rel = request.query.get("image", "")
    if not image_rel:
        return web.Response(status=400)

    full_path = os.path.normpath(os.path.join(resolved_folder, image_rel))
    if not is_safe_path(full_path, [resolved_folder]) or not os.path.exists(full_path) or not os.path.isfile(full_path):
        return web.Response(status=404)

    image_extensions = {".png", ".jpg", ".jpeg", ".webp", ".bmp"}
    if os.path.splitext(full_path)[1].lower() not in image_extensions:
        return web.Response(status=403)

    try:
        thumb_size = int(request.query.get("size", 256))
    except Exception:
        thumb_size = 256
    thumb_size = max(64, min(1024, thumb_size))

    try:
        mtime = os.path.getmtime(full_path)
        serve_path = await asyncio.to_thread(get_or_create_image_thumbnail, full_path, mtime, thumb_size)
        return web.FileResponse(serve_path)
    except Exception:
        return web.FileResponse(full_path)

@routes.get("/saturnnodes/image_loader/get_full_image")
async def get_full_image_endpoint(request):
    if not is_local_request(request):
        return web.Response(status=403)

    folder = request.query.get("folder", "")
    if not folder:
        folder = request.query.get("folder_path", "")
    resolved_folder = sanitize_image_loader_folder(folder)

    image_rel = request.query.get("image", "")
    if not image_rel:
        return web.Response(status=400)

    full_path = os.path.normpath(os.path.join(resolved_folder, image_rel))
    if not is_safe_path(full_path, [resolved_folder]) or not os.path.exists(full_path) or not os.path.isfile(full_path):
        return web.Response(status=404)

    image_extensions = {".png", ".jpg", ".jpeg", ".webp", ".bmp"}
    if os.path.splitext(full_path)[1].lower() not in image_extensions:
        return web.Response(status=403)

    return web.FileResponse(full_path)

class VisualImageLoader:
    @classmethod
    def INPUT_TYPES(s):
        return {
            "required": {
                "folder": ("STRING", {"default": ""}),
                "display_mode": (["Scrollable", "Show All"], {"default": "Scrollable", "advanced": True}),
                "sort_images_by": (["Name (A-Z)", "Name (Z-A)", "Date Modified (Newest First)", "Date Modified (Oldest First)"], {"default": "Date Modified (Newest First)", "advanced": True}),
            },
            "hidden": {
                "_selected_image": ("STRING", {"default": ""}),
            }
        }

    RETURN_TYPES = ("IMAGE", "STRING", "INT", "INT")
    RETURN_NAMES = ("IMAGE", "positive_prompt", "width", "height")
    FUNCTION = "load_image"
    CATEGORY = IMAGE_CATEGORY
    DESCRIPTION = "Visual image browser with prompt metadata extraction (PNG parameters & EXIF user comments) and resolution outputs."

    @classmethod
    def IS_CHANGED(cls, **kwargs):
        return kwargs.get("_selected_image", "")

    def load_image(self, folder="", display_mode="Scrollable", sort_images_by="Date Modified (Newest First)", folder_path=None, _selected_image="", **kwargs):
        input_dir = folder if folder else (folder_path or "")
        resolved_folder = sanitize_image_loader_folder(input_dir)
        
        if not resolved_folder or not _selected_image:
            empty_image = torch.zeros((1, 512, 512, 3), dtype=torch.float32)
            return (empty_image, "", 0, 0)

        full_path = os.path.normpath(os.path.join(resolved_folder, _selected_image))
        if not is_safe_path(full_path) or not os.path.exists(full_path):
            empty_image = torch.zeros((1, 512, 512, 3), dtype=torch.float32)
            return (empty_image, "", 0, 0)

        with Image.open(full_path) as i:
            i = ImageOps.exif_transpose(i)
            
            positive_prompt, width, height = extract_metadata_from_image(full_path)
            if width == 0 or height == 0:
                width, height = i.size

            image = i.convert("RGB")
            image = np.array(image).astype(np.float32) / 255.0
            image = torch.from_numpy(image)[None,]

        return (image, positive_prompt, width, height)


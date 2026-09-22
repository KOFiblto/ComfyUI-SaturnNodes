import os
import json
import torch
import numpy as np
from PIL import Image, ImageOps
import io
import piexif
import piexif.helper
from aiohttp import web
from server import PromptServer
import folder_paths
from .utils import (
    sanitize_folder_path,
    get_leafflow_user_dir,
    is_local_request,
    is_safe_path,
    sanitize_image_loader_folder,
    get_saturnnodes_user_dir
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
        with open(CACHE_FILE, "w", encoding="utf-8") as f:
            json.dump(cache, f, indent=4, ensure_ascii=False)
    except Exception as e:
        print(f"[SaturnNodes] Failed to save prompts cache: {e}")

routes = PromptServer.instance.routes if hasattr(PromptServer, "instance") and PromptServer.instance is not None else web.RouteTableDef()

@routes.get("/image_loader/get_images")
async def get_images_endpoint(request):
    if not is_local_request(request):
        return web.json_response({"error": "Forbidden: Local access only"}, status=403)

    folder = request.query.get("folder", "")
    if not folder:
        folder = request.query.get("folder_path", "")
        
    resolved_folder = sanitize_image_loader_folder(folder)
    
    if not resolved_folder or not is_safe_path(resolved_folder) or not os.path.exists(resolved_folder):
        return web.json_response({"names": [], "mapping": {}, "prompts": {}})
        
    image_extensions = {".png", ".jpg", ".jpeg", ".webp", ".PNG", ".JPG", ".JPEG", ".WEBP"}
    raw_files = []
    
    for root, dirs, files in os.walk(resolved_folder):
        for file in files:
            ext = os.path.splitext(file)[1]
            if ext in image_extensions:
                full_path = os.path.normpath(os.path.join(root, file))
                if not is_safe_path(full_path):
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
    
    cache = load_prompts_cache()
    cache_modified = False
    
    # Extract prompt metadata for the most recent 128 images to keep cache small and fast
    METADATA_LIMIT = 128
    
    for i, (rel_path, full_path, mtime) in enumerate(raw_files):
        names.append(rel_path)
        mapping[rel_path] = rel_path
        
        if i < METADATA_LIMIT:
            try:
                cached_entry = cache.get(full_path)
                if cached_entry and cached_entry.get("mtime") == mtime:
                    prompt_text = cached_entry.get("prompt", "")
                else:
                    prompt_text, _, _ = extract_metadata_from_image(full_path)
                    cache[full_path] = {
                        "mtime": mtime,
                        "prompt": prompt_text
                    }
                    cache_modified = True
            except Exception as e:
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

    return web.json_response({
        "names": names,
        "mapping": mapping,
        "prompts": prompts
    })

@routes.get("/image_loader/get_thumbnail")
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
    if not is_safe_path(full_path) or not os.path.exists(full_path) or not os.path.isfile(full_path):
        return web.Response(status=404)

    image_extensions = {".png", ".jpg", ".jpeg", ".webp", ".bmp"}
    if os.path.splitext(full_path)[1].lower() not in image_extensions:
        return web.Response(status=403)
        
    try:
        with Image.open(full_path) as img:
            img.thumbnail((256, 256))
            img_byte_arr = io.BytesIO()
            img.convert("RGB").save(img_byte_arr, format='JPEG', quality=80)
            return web.Response(body=img_byte_arr.getvalue(), content_type="image/jpeg")
    except Exception:
        return web.FileResponse(full_path)

@routes.get("/image_loader/get_full_image")
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
    if not is_safe_path(full_path) or not os.path.exists(full_path) or not os.path.isfile(full_path):
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

        i = Image.open(full_path)
        i = ImageOps.exif_transpose(i)
        
        positive_prompt, width, height = extract_metadata_from_image(full_path)
        if width == 0 or height == 0:
            width, height = i.size

        image = i.convert("RGB")
        image = np.array(image).astype(np.float32) / 255.0
        image = torch.from_numpy(image)[None,]

        return (image, positive_prompt, width, height)

# Alias for backward compatibility
ImageLoaderVisualPrettyV2 = VisualImageLoader

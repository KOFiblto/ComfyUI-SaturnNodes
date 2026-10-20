import os
import re
import fnmatch
import json
import time
import hashlib
import asyncio
import atexit
import folder_paths
import urllib.request
import urllib.parse
import threading
from aiohttp import web
from server import PromptServer
from comfy.utils import load_torch_file
import comfy.sd

from .utils import (
    parse_pretty_name,
    parse_pretty_name_with_version,
    format_lora_output_name,
    sanitize_folder_path,
    get_saturnnodes_user_dir,
    is_local_request,
    is_authenticated_local_request,
    is_safe_path,
    get_env_setting
)

LORA_CATEGORY = "🪐 SaturnNodes/Loaders"
LORA_OUTPUT_FORMAT_CHOICES = [
    "Parsed Name",
    "Filename",
    "Filename without extension",
    "Relative Path",
    "Full Path",
    "Custom Regex"
]

CURRENT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
USER_DIR = get_saturnnodes_user_dir()
ENV_FILE = os.path.join(USER_DIR, ".env")
LORA_STATE_FILE = os.path.join(USER_DIR, "lora_loader_state.json")
HASH_CACHE_FILE = os.path.join(USER_DIR, "lora_hash_cache.json")

_LORA_STATE_LOCK = threading.RLock()

def ensure_user_dir():
    os.makedirs(USER_DIR, exist_ok=True)

def _entry_timestamp(entry):
    if isinstance(entry, dict):
        try:
            return int(entry.get("last_updated", 0))
        except (TypeError, ValueError):
            return 0
    return 0

def load_lora_cycle_state():
    ensure_user_dir()
    with _LORA_STATE_LOCK:
        if os.path.exists(LORA_STATE_FILE):
            try:
                with open(LORA_STATE_FILE, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    if isinstance(data, dict):
                        return data
            except Exception:
                pass
        return {}

def save_lora_cycle_state(state):
    ensure_user_dir()
    with _LORA_STATE_LOCK:
        try:
            # Global prune: keep the 100 most recently used node/selection entries.
            if len(state) > 100:
                keep = set(sorted(state.keys(), key=lambda k: _entry_timestamp(state[k]), reverse=True)[:100])
                for k in [k for k in state.keys() if k not in keep]:
                    del state[k]
            temp_file = LORA_STATE_FILE + ".tmp"
            with open(temp_file, "w", encoding="utf-8") as f:
                json.dump(state, f, indent=4, ensure_ascii=False)
            os.replace(temp_file, LORA_STATE_FILE)
        except Exception as e:
            print(f"[SaturnNodes] Error saving lora loader cycle state: {e}")

def get_api_keys():
    civitai_key = os.getenv("CIVITAI_API_KEY", "")
    tmdb_key = os.getenv("TMDB_API_KEY", "")
    if os.path.exists(ENV_FILE):
        try:
            with open(ENV_FILE, "r", encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if line.startswith("CIVITAI_API_KEY=") and not civitai_key:
                        civitai_key = line.split("=", 1)[1].strip()
                    elif line.startswith("TMDB_API_KEY=") and not tmdb_key:
                        tmdb_key = line.split("=", 1)[1].strip()
        except Exception:
            pass
            
    return civitai_key.strip(), tmdb_key.strip()

scraping_thread = None
scraping_lock = threading.Lock()

_USAGE_LOCK = threading.RLock()
_USAGE_CACHE = None
_USAGE_DIRTY = False
_USAGE_TIMER = None
_USAGE_FLUSH_DELAY = 2.0

def _usage_file_path():
    return os.path.join(USER_DIR, "lora_usage.json")

def _read_usage_data_from_disk():
    usage_data = {}
    usage_file = _usage_file_path()
    if os.path.exists(usage_file):
        try:
            with open(usage_file, "r", encoding="utf-8") as f:
                raw_data = json.load(f)
            for k, v in raw_data.items():
                if "\\" in k or "/" in k or k.endswith(".safetensors"):
                    pretty_key = parse_pretty_name(k)
                    usage_data[pretty_key] = usage_data.get(pretty_key, 0) + v
                else:
                    usage_data[k] = usage_data.get(k, 0) + v
        except Exception as e:
            print(f"[SaturnNodes] Error loading usage data: {e}")
    return usage_data

def load_usage_data():
    global _USAGE_CACHE
    with _USAGE_LOCK:
        if _USAGE_CACHE is None:
            _USAGE_CACHE = _read_usage_data_from_disk()
        return dict(_USAGE_CACHE)

def flush_lora_usage():
    """Write pending usage increments to disk (debounced and atomic)."""
    global _USAGE_DIRTY
    with _USAGE_LOCK:
        if not _USAGE_DIRTY or _USAGE_CACHE is None:
            return
        try:
            ensure_user_dir()
            usage_file = _usage_file_path()
            temp_file = usage_file + ".tmp"
            with open(temp_file, "w", encoding="utf-8") as f:
                json.dump(_USAGE_CACHE, f, indent=4, ensure_ascii=False)
            os.replace(temp_file, usage_file)
            _USAGE_DIRTY = False
        except Exception as e:
            print(f"[SaturnNodes] Error updating lora usage: {e}")

def _schedule_usage_flush():
    global _USAGE_TIMER
    if _USAGE_TIMER is None or not _USAGE_TIMER.is_alive():
        _USAGE_TIMER = threading.Timer(_USAGE_FLUSH_DELAY, flush_lora_usage)
        _USAGE_TIMER.daemon = True
        _USAGE_TIMER.start()

atexit.register(flush_lora_usage)

def increment_lora_usage(lora_path):
    if not lora_path or lora_path == "[ NONE ]":
        return
    if get_env_setting("ENABLE_LORA_USAGE", "true").lower() not in ["true", "1", "yes"]:
        return
    global _USAGE_CACHE, _USAGE_DIRTY
    try:
        with _USAGE_LOCK:
            if _USAGE_CACHE is None:
                _USAGE_CACHE = _read_usage_data_from_disk()
            pretty_key = parse_pretty_name(lora_path)
            _USAGE_CACHE[pretty_key] = _USAGE_CACHE.get(pretty_key, 0) + 1
            _USAGE_DIRTY = True
            _schedule_usage_flush()
    except Exception as e:
        print(f"[SaturnNodes] Error updating lora usage: {e}")

def reset_lora_usage_file():
    """Clear usage counters, discarding any pending debounced writes."""
    global _USAGE_CACHE, _USAGE_DIRTY
    with _USAGE_LOCK:
        ensure_user_dir()
        usage_file = _usage_file_path()
        temp_file = usage_file + ".tmp"
        with open(temp_file, "w", encoding="utf-8") as f:
            json.dump({}, f, indent=4)
        os.replace(temp_file, usage_file)
        _USAGE_CACHE = {}
        _USAGE_DIRTY = False

def find_preview_image(lora_relative_path):
    lora_full_path = folder_paths.get_full_path("loras", lora_relative_path)
    if not lora_full_path:
        return None
    
    base_path = os.path.splitext(lora_full_path)[0]
    for ext in [".png", ".jpg", ".jpeg", ".webp", ".PNG", ".JPG", ".JPEG", ".WEBP"]:
        preview_path = base_path + ext
        if os.path.exists(preview_path):
            return preview_path
    return None

def get_file_sha256(filepath):
    h = hashlib.sha256()
    with open(filepath, 'rb') as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b''):
            h.update(chunk)
    return h.hexdigest().upper()

_HASH_CACHE_LOCK = threading.RLock()
_HASH_CACHE = None

def _load_hash_cache():
    global _HASH_CACHE
    if _HASH_CACHE is not None:
        return _HASH_CACHE
    _HASH_CACHE = {}
    try:
        if os.path.exists(HASH_CACHE_FILE):
            with open(HASH_CACHE_FILE, "r", encoding="utf-8") as f:
                data = json.load(f)
                if isinstance(data, dict):
                    _HASH_CACHE = data
    except Exception:
        _HASH_CACHE = {}
    return _HASH_CACHE

def _save_hash_cache():
    try:
        ensure_user_dir()
        temp_file = HASH_CACHE_FILE + ".tmp"
        with open(temp_file, "w", encoding="utf-8") as f:
            json.dump(_HASH_CACHE, f, indent=2, ensure_ascii=False)
        os.replace(temp_file, HASH_CACHE_FILE)
    except Exception:
        pass

def get_file_sha256_cached(filepath):
    """Hash a LoRA once and reuse it while mtime/size stay unchanged."""
    try:
        before = os.stat(filepath)
    except OSError:
        return get_file_sha256(filepath)

    cache_key = os.path.normcase(os.path.abspath(filepath))
    with _HASH_CACHE_LOCK:
        cache = _load_hash_cache()
        entry = cache.get(cache_key)
        if (isinstance(entry, dict)
                and entry.get("mtime_ns") == before.st_mtime_ns
                and entry.get("size") == before.st_size
                and entry.get("sha256")):
            return entry["sha256"]

    digest = get_file_sha256(filepath)

    try:
        after = os.stat(filepath)
        if after.st_mtime_ns == before.st_mtime_ns and after.st_size == before.st_size:
            with _HASH_CACHE_LOCK:
                cache = _load_hash_cache()
                cache[cache_key] = {
                    "mtime_ns": before.st_mtime_ns,
                    "size": before.st_size,
                    "sha256": digest,
                    "last_updated": int(time.time()),
                }
                if len(cache) > 1000:
                    keep = set(sorted(cache.keys(), key=lambda k: int(cache[k].get("last_updated", 0)), reverse=True)[:1000])
                    for k in [k for k in cache.keys() if k not in keep]:
                        del cache[k]
                _save_hash_cache()
    except OSError:
        pass
    return digest

def is_safe_external_image_url(url_str):
    """
    Validates that a scraped image URL uses a safe web scheme (https/http)
    and does not target internal loopback, private networks, or metadata services (SSRF protection).
    """
    if not url_str or not isinstance(url_str, str):
        return False
    try:
        parsed = urllib.parse.urlparse(url_str.strip())
        if parsed.scheme not in ("https", "http"):
            return False
        hostname = (parsed.hostname or "").lower().strip()
        if not hostname:
            return False
        disallowed_prefixes = (
            "127.", "10.", "192.168.", "172.16.", "172.17.", "172.18.", "172.19.",
            "172.20.", "172.21.", "172.22.", "172.23.", "172.24.", "172.25.",
            "172.26.", "172.27.", "172.28.", "172.29.", "172.30.", "172.31.",
            "169.254.", "0.0.0.0", "::1", "localhost"
        )
        if any(hostname == prefix or hostname.startswith(prefix) for prefix in disallowed_prefixes):
            return False
        return True
    except Exception:
        return False

def scrape_missing_images_sync():
    try:
        civitai_enabled = get_env_setting("ENABLE_CIVITAI_SCRAPING", "false").lower() in ["true", "1", "yes"]
        tmdb_enabled = get_env_setting("ENABLE_TMDB_SCRAPING", "false").lower() in ["true", "1", "yes"]
        if not civitai_enabled and not tmdb_enabled:
            return

        civitai_key, tmdb_key = get_api_keys()
        failed_scrapes_file = os.path.join(USER_DIR, "failed_scrapes.json")
        failed_scrapes = {}
        if os.path.exists(failed_scrapes_file):
            try:
                with open(failed_scrapes_file, "r", encoding="utf-8") as f:
                    failed_scrapes = json.load(f)
            except Exception:
                pass

        all_loras = folder_paths.get_filename_list("loras")
        modified = False

        for lora in all_loras:
            preview = find_preview_image(lora)
            if preview:
                continue
            
            pretty_name = parse_pretty_name(lora)
            if not pretty_name or pretty_name in ["[ NONE ]", "[ RANDOM ]"]:
                continue

            if pretty_name in failed_scrapes:
                continue

            lora_path = folder_paths.get_full_path("loras", lora)
            if not lora_path or not os.path.exists(lora_path):
                continue

            success = False

            if civitai_enabled:
                try:
                    file_hash = get_file_sha256_cached(lora_path)
                    civitai_url = f"https://civitai.com/api/v1/model-versions/by-hash/{file_hash}"
                    headers = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'}
                    if civitai_key:
                        headers['Authorization'] = f"Bearer {civitai_key}"
                    
                    req = urllib.request.Request(civitai_url, headers=headers)
                    with urllib.request.urlopen(req, timeout=12) as resp:
                        data = json.loads(resp.read().decode('utf-8'))
                        images = data.get("images", [])
                        if images and len(images) > 0:
                            img_url = images[0].get("url")
                            if img_url and is_safe_external_image_url(img_url):
                                dest_path = os.path.splitext(lora_path)[0] + ".jpg"
                                img_req = urllib.request.Request(img_url, headers=headers)
                                with urllib.request.urlopen(img_req, timeout=15) as img_resp:
                                    img_data = img_resp.read()
                                try:
                                    with open(dest_path, "wb") as f:
                                        f.write(img_data)
                                    print(f"[SaturnNodes] Scraped Civitai preview for {pretty_name}")
                                    success = True
                                except (PermissionError, OSError) as write_err:
                                    print(f"[SaturnNodes] Warning: Could not save preview image to '{dest_path}': {write_err}")
                except urllib.error.HTTPError as http_err:
                    if http_err.code in (401, 403):
                        print(f"[SaturnNodes] Notice: Civitai API authentication failed (HTTP {http_err.code}). Check your CIVITAI_API_KEY in settings.")
                except Exception:
                    pass

            if not success and tmdb_enabled and tmdb_key:
                try:
                    clean_person = parse_pretty_name(lora)
                    search_terms = [clean_person]
                    words = clean_person.split()
                    if len(words) >= 2:
                        search_terms.append(" ".join(words[1:]))

                    tmdb_headers = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'}
                    if tmdb_key.startswith("eyJ"):
                        tmdb_headers['Authorization'] = f"Bearer {tmdb_key}"

                    for term in search_terms:
                        if success:
                            break
                        encoded_term = urllib.parse.quote(term)
                        if tmdb_key.startswith("eyJ"):
                            url = f"https://api.themoviedb.org/3/search/person?query={encoded_term}&include_adult=true"
                        else:
                            tmdb_headers['Authorization'] = f"Bearer {tmdb_key}"
                            url = f"https://api.themoviedb.org/3/search/person?api_key={tmdb_key}&query={encoded_term}&include_adult=true"

                        req = urllib.request.Request(url, headers=tmdb_headers)
                        with urllib.request.urlopen(req, timeout=10) as response:
                            data = json.loads(response.read().decode('utf-8'))
                        results = data.get("results", [])
                        for res in results:
                            profile_path = res.get("profile_path")
                            if profile_path:
                                img_url = f"https://image.tmdb.org/t/p/w500{profile_path}"
                                if is_safe_external_image_url(img_url):
                                    dest_path = os.path.splitext(lora_path)[0] + ".jpg"
                                    img_req = urllib.request.Request(img_url, headers=tmdb_headers)
                                    with urllib.request.urlopen(img_req, timeout=15) as img_resp:
                                        img_data = img_resp.read()
                                    try:
                                        with open(dest_path, "wb") as f:
                                            f.write(img_data)
                                        print(f"[SaturnNodes] Scraped TMDB preview for {pretty_name} (via '{term}')")
                                        success = True
                                        break
                                    except (PermissionError, OSError) as write_err:
                                        print(f"[SaturnNodes] Warning: Could not save preview image to '{dest_path}': {write_err}")
                except urllib.error.HTTPError as http_err:
                    if http_err.code in (401, 403):
                        print(f"[SaturnNodes] Notice: TMDB API authentication failed (HTTP {http_err.code}). Check your TMDB_API_KEY in settings.")
                except Exception:
                    pass

            if not success:
                failed_scrapes[pretty_name] = True
                modified = True

        if modified:
            try:
                temp_file = failed_scrapes_file + ".tmp"
                with open(temp_file, "w", encoding="utf-8") as f:
                    json.dump(failed_scrapes, f, indent=4, ensure_ascii=False)
                os.replace(temp_file, failed_scrapes_file)
            except Exception:
                pass
    except Exception as e:
        print(f"[SaturnNodes] Error in preview scraping thread: {e}")

def start_async_scraping():
    global scraping_thread
    with scraping_lock:
        if scraping_thread is None or not scraping_thread.is_alive():
            scraping_thread = threading.Thread(target=scrape_missing_images_sync, daemon=True)
            scraping_thread.start()

def get_filtered_loras_mapping(folder_filter, pretty=False):
    all_loras = folder_paths.get_filename_list("loras")
    mapping = {"[ NONE ]": "[ NONE ]"}
    
    raw_filter = (folder_filter or "").replace("\\", "/").strip()
    is_wildcard = raw_filter.endswith("*") or raw_filter == ""
    clean_filter = raw_filter.rstrip("*").strip("/")

    for lora in all_loras:
        norm_lora = lora.replace("\\", "/")
        lora_dir = norm_lora.rsplit("/", 1)[0] if "/" in norm_lora else ""
        
        if raw_filter == "":
            display_name = ""
            if lora_dir and pretty:
                display_name += f"{lora_dir.split('/')[-1]} - "
            display_name += parse_pretty_name_with_version(lora) if pretty else lora
            mapping[display_name] = lora
        elif is_wildcard:
            if clean_filter == "" or norm_lora.lower().startswith(clean_filter.lower() + "/") or norm_lora.lower() == clean_filter.lower():
                subfolder_path = lora_dir[len(clean_filter):].strip("/") if clean_filter else lora_dir
                sub_parts = [p for p in subfolder_path.split('/') if p]
                if sub_parts:
                    sub_name = sub_parts[-1]
                else:
                    sub_name = clean_filter.split('/')[-1] if clean_filter else ""
                
                display_name = ""
                if sub_name and pretty:
                    display_name += f"{sub_name} - "
                display_name += parse_pretty_name_with_version(lora) if pretty else lora
                mapping[display_name] = lora
        else:
            if lora_dir.lower() == clean_filter.lower():
                display_name = parse_pretty_name_with_version(lora) if pretty else lora
                mapping[display_name] = lora
            elif fnmatch.fnmatch(lora_dir.lower(), clean_filter.lower() + "*"):
                parent_matched_dir = lora_dir.split('/')[0]
                if fnmatch.fnmatch(parent_matched_dir.lower(), clean_filter.lower() + "*") and lora_dir == parent_matched_dir:
                    display_name = parse_pretty_name_with_version(lora) if pretty else lora
                    mapping[display_name] = lora
    return mapping

server = PromptServer.instance
routes = server.routes

@routes.get("/saturnnodes/folder_lora_loader/get_loras")
async def get_loras_endpoint(request):
    if not is_local_request(request):
        return web.json_response({"error": "Forbidden: Local access only"}, status=403)
    folder = request.query.get("folder", "")
    pretty = request.query.get("pretty", "false").lower() == "true"
    scrape_on_new = request.query.get("scrape_on_new", "false").lower() == "true"
    
    mapping = get_filtered_loras_mapping(folder, pretty=pretty)
    if scrape_on_new:
        start_async_scraping()
    
    usage_enabled = get_env_setting("ENABLE_LORA_USAGE", "true").lower() in ["true", "1", "yes"]
    usage_by_path = {}
    mtime_by_path = {}
    
    all_loras = folder_paths.get_filename_list("loras")
    usage_data = load_usage_data() if usage_enabled else {}
    
    for lora in all_loras:
        pretty_name = parse_pretty_name(lora)
        if usage_enabled:
            usage_by_path[lora] = usage_data.get(pretty_name, 0)
        
        full_path = folder_paths.get_full_path("loras", lora)
        if full_path and os.path.exists(full_path):
            try:
                mtime_by_path[lora] = os.path.getmtime(full_path)
            except OSError:
                mtime_by_path[lora] = 0

    return web.json_response({
        "names": list(mapping.keys()),
        "mapping": mapping,
        "usage": usage_by_path,
        "mtime": mtime_by_path
    })

THUMBNAILS_DIR = os.path.join(USER_DIR, "thumbnails")

def get_or_create_thumbnail(img_path, max_size=256):
    """
    Returns path to a high-speed cached WebP thumbnail of img_path with max dimension max_size.
    Cached on disk and invalidated if source file mtime changes.
    """
    try:
        from PIL import Image
        mtime = os.path.getmtime(img_path)
        hash_src = f"{img_path}_{mtime}_{max_size}".encode("utf-8")
        cache_key = hashlib.md5(hash_src).hexdigest()
        os.makedirs(THUMBNAILS_DIR, exist_ok=True)
        thumb_path = os.path.join(THUMBNAILS_DIR, f"thumb_{cache_key}.webp")

        if os.path.exists(thumb_path) and os.path.getsize(thumb_path) > 0:
            return thumb_path

        with Image.open(img_path) as img:
            w, h = img.size
            if w <= max_size and h <= max_size:
                return img_path

            if img.mode in ("RGBA", "LA") or (img.mode == "P" and "transparency" in img.info):
                img = img.convert("RGBA")
            else:
                img = img.convert("RGB")

            # BICUBIC produces crisp, smooth, high-quality thumbnails from 4K/6MP sources
            # while executing significantly faster than LANCZOS to avoid CPU contention.
            img.thumbnail((max_size, max_size), Image.Resampling.BICUBIC)
            temp_path = thumb_path + ".tmp"
            # method=1 gives high quality WebP at ~10x the speed of method=4, eliminating CPU spikes
            img.save(temp_path, format="WEBP", quality=85, method=1)
            os.replace(temp_path, thumb_path)
            return thumb_path
    except Exception:
        return img_path

@routes.get("/saturnnodes/folder_lora_loader/get_preview")
async def get_preview_endpoint(request):
    if not is_local_request(request):
        return web.Response(status=403)
    system_path = request.query.get("system_path", "")
    lora_name = request.query.get("lora", "")
    folder = request.query.get("folder", "")
    pretty = request.query.get("pretty", "true").lower() == "true"
    full = request.query.get("full", "false").lower() == "true"

    if not system_path and lora_name:
        mapping = get_filtered_loras_mapping(folder, pretty=pretty)
        system_path = mapping.get(lora_name, lora_name)

    if system_path and system_path != "[ NONE ]":
        img_path = find_preview_image(system_path)
        if img_path and os.path.exists(img_path) and os.path.isfile(img_path):
            if full:
                return web.FileResponse(img_path)
            try:
                thumb_size = int(request.query.get("size", 256))
                thumb_size = max(64, min(1024, thumb_size))
            except Exception:
                thumb_size = 256
            serve_path = await asyncio.to_thread(get_or_create_thumbnail, img_path, max_size=thumb_size)
            return web.FileResponse(serve_path)

    return web.Response(status=404)

@routes.post("/saturnnodes/folder_lora_loader/reset_cycle")
async def reset_lora_cycle_endpoint(request):
    """Clears Sequential/Random cycle counters + prompt->LoRA assignments for one node (or all)."""
    if not is_authenticated_local_request(request):
        return web.json_response({"error": "Forbidden: Local authenticated access only"}, status=403)
    try:
        data = await request.json()
    except Exception:
        data = {}
    node_id = str(data.get("node_id", "")).strip()
    try:
        state = load_lora_cycle_state()
        removed = 0
        if node_id and node_id != "all":
            prefixes = (f"seq_{node_id}_", f"rand_{node_id}_", f"noreplace_{node_id}_")
            for k in list(state.keys()):
                if k.startswith(prefixes):
                    del state[k]
                    removed += 1
        else:
            removed = len(state)
            state = {}
        save_lora_cycle_state(state)
        return web.json_response({"status": "ok", "removed": removed})
    except Exception as e:
        return web.json_response({"status": "error", "message": str(e)}, status=500)

@routes.post("/saturnnodes/folder_lora_loader/reset_usage")
async def reset_lora_usage_endpoint(request):
    """Empties lora_usage.json (usage badges + usage-based sortings)."""
    if not is_authenticated_local_request(request):
        return web.json_response({"error": "Forbidden: Local authenticated access only"}, status=403)
    try:
        reset_lora_usage_file()
        return web.json_response({"status": "ok"})
    except Exception as e:
        return web.json_response({"status": "error", "message": str(e)}, status=500)

@routes.post("/saturnnodes/folder_lora_loader/clear_cache")
async def clear_lora_cache_endpoint(request):
    """Deletes cached WebP thumbnails (regenerated on demand)."""
    if not is_authenticated_local_request(request):
        return web.json_response({"error": "Forbidden: Local authenticated access only"}, status=403)
    removed = 0
    try:
        cache_dir = os.path.realpath(THUMBNAILS_DIR)
        canonical_user = os.path.realpath(USER_DIR)
        try:
            if os.path.commonpath([canonical_user, cache_dir]) != canonical_user:
                return web.json_response({"status": "error", "message": "Security: cache path escapes user directory"}, status=403)
        except Exception:
            return web.json_response({"status": "error", "message": "Security path validation error"}, status=403)
        if os.path.isdir(cache_dir):
            for name in os.listdir(cache_dir):
                entry = os.path.join(cache_dir, name)
                if os.path.isfile(entry):
                    try:
                        os.remove(entry)
                        removed += 1
                    except Exception:
                        pass
        return web.json_response({"status": "ok", "removed": removed})
    except Exception as e:
        return web.json_response({"status": "error", "message": str(e)}, status=500)

class FolderLoraLoader:
    @classmethod
    def INPUT_TYPES(s):
        return {
            "required": {
                "model": ("MODEL",),
                "clip": ("CLIP",),
                "folder": ("STRING", {"default": ""}),
                "lora_name": (["[ NONE ]"], {}),
                "strength_model": ("FLOAT", {"default": 1.0, "min": -100.0, "max": 100.0, "step": 0.01}),
                "strength_clip": ("FLOAT", {"default": 1.0, "min": -100.0, "max": 100.0, "step": 0.01}),
                "output_format": (LORA_OUTPUT_FORMAT_CHOICES, {"default": "Filename", "advanced": True}),
                "custom_regex": ("STRING", {"default": "", "advanced": True}),
            },
            "hidden": {
                "_selected_lora": ("STRING", {"default": "[ NONE ]"}),
            }
        }

    RETURN_TYPES = ("MODEL", "CLIP", "STRING")
    RETURN_NAMES = ("MODEL", "CLIP", "lora_name")
    FUNCTION = "load_lora"
    CATEGORY = LORA_CATEGORY
    DESCRIPTION = "LoRA Loader filtered by folder directory."

    @classmethod
    def VALIDATE_INPUTS(cls, **kwargs):
        return True

    def load_lora(self, model, clip, folder, lora_name, strength_model, strength_clip, output_format="Filename", custom_regex="", output_name=None, _selected_lora="[ NONE ]"):
        active_format = output_name if output_name is not None else output_format
        active_lora = _selected_lora if _selected_lora and _selected_lora != "[ NONE ]" else lora_name
        if active_lora == "[ NONE ]" or not active_lora:
            return (model, clip, "")

        mapping = get_filtered_loras_mapping(folder, pretty=False)
        resolved_path = mapping.get(active_lora)
        
        if not resolved_path or resolved_path == "[ NONE ]":
            all_loras = folder_paths.get_filename_list("loras")
            raw_filter = (folder or "").replace("\\", "/").strip().rstrip("/").lower()
            for lora in all_loras:
                norm_lora = lora.replace("\\", "/").lower()
                if raw_filter and not norm_lora.startswith(raw_filter):
                    continue
                if lora == active_lora or parse_pretty_name(lora) == active_lora:
                    resolved_path = lora
                    break

        out_name = format_lora_output_name(resolved_path, active_lora, output_format=active_format, custom_regex=custom_regex)

        if not resolved_path:
            return (model, clip, out_name)

        lora_path = folder_paths.get_full_path("loras", resolved_path)
        if not lora_path or not os.path.exists(lora_path):
            return (model, clip, out_name)

        lora = load_torch_file(lora_path, safe_load=True)
        model_lora, clip_lora = comfy.sd.load_lora_for_models(
            model, clip, lora, strength_model, strength_clip
        )
        return (model_lora, clip_lora, out_name)

class FolderLoraLoaderPretty(FolderLoraLoader):
    @classmethod
    def INPUT_TYPES(s):
        return {
            "required": {
                "model": ("MODEL",),
                "clip": ("CLIP",),
                "folder": ("STRING", {"default": ""}),
                "lora_name": (["[ NONE ]"], {}),
                "strength_model": ("FLOAT", {"default": 1.0, "min": -100.0, "max": 100.0, "step": 0.01}),
                "strength_clip": ("FLOAT", {"default": 1.0, "min": -100.0, "max": 100.0, "step": 0.01}),
                "output_format": (LORA_OUTPUT_FORMAT_CHOICES, {"default": "Filename", "advanced": True}),
                "custom_regex": ("STRING", {"default": "", "advanced": True}),
            },
            "hidden": {
                "_selected_lora": ("STRING", {"default": "[ NONE ]"}),
            }
        }

    RETURN_TYPES = ("MODEL", "CLIP", "STRING")
    RETURN_NAMES = ("MODEL", "CLIP", "lora_name")
    DESCRIPTION = "LoRA Loader filtered by folder directory with formatted pretty names."

    def load_lora(self, model, clip, folder, lora_name, strength_model, strength_clip, output_format="Filename", custom_regex="", output_name=None, _selected_lora="[ NONE ]"):
        active_format = output_name if output_name is not None else output_format
        active_lora = lora_name if lora_name != "[ NONE ]" else _selected_lora
        if active_lora == "[ NONE ]" or not active_lora:
            return (model, clip, "")

        if active_lora == "[ RANDOM ]":
            import random
            mapping = get_filtered_loras_mapping(folder, pretty=True)
            valid_choices = [k for k, v in mapping.items() if k not in ["[ NONE ]", "[ RANDOM ]"] and v and v != "[ NONE ]"]
            if valid_choices:
                active_lora = random.choice(valid_choices)
            else:
                return (model, clip, "")

        display_name = active_lora
        if " - " in active_lora:
            display_name = active_lora.split(" - ", 1)[1]

        mapping = get_filtered_loras_mapping(folder, pretty=True)
        resolved_path = mapping.get(active_lora)
        
        if not resolved_path or resolved_path == "[ NONE ]":
            all_loras = folder_paths.get_filename_list("loras")
            raw_filter = (folder or "").replace("\\", "/").strip().rstrip("/").lower()
            for lora in all_loras:
                norm_lora = lora.replace("\\", "/").lower()
                if raw_filter and not norm_lora.startswith(raw_filter):
                    continue
                if parse_pretty_name(lora) == display_name:
                    resolved_path = lora
                    break

        out_name = format_lora_output_name(resolved_path, display_name, output_format=active_format, custom_regex=custom_regex)

        if strength_model == 0 and strength_clip == 0:
            increment_lora_usage(resolved_path)
            return (model, clip, out_name)

        if not resolved_path:
            return (model, clip, out_name)

        lora_path = folder_paths.get_full_path("loras", resolved_path)
        if not lora_path or not os.path.exists(lora_path):
            return (model, clip, out_name)
            
        lora = load_torch_file(lora_path, safe_load=True)
        model_lora, clip_lora = comfy.sd.load_lora_for_models(
            model, clip, lora, strength_model, strength_clip
        )
        increment_lora_usage(resolved_path)
        return (model_lora, clip_lora, out_name)

def get_current_prompt_id():
    try:
        from server import PromptServer
        server = PromptServer.instance
        if hasattr(server, "prompt_queue"):
            queue = server.prompt_queue
            mutex = getattr(queue, "mutex", None)
            if mutex:
                with mutex:
                    items = list(queue.currently_running.values())
            else:
                items = list(queue.currently_running.values())
            for item in items:
                if isinstance(item, (tuple, list)) and len(item) > 1:
                    return str(item[1])
    except Exception:
        pass
    return None

def _remember_lora_assignment(assigned, prompt_id, item, limit=50):
    """Insert/refresh a prompt→LoRA mapping, keeping the most recent entries."""
    if not prompt_id:
        return
    assigned.pop(prompt_id, None)
    assigned[prompt_id] = item
    while len(assigned) > limit:
        assigned.pop(next(iter(assigned)))

def select_a_lora(mode, unique_id, valid_choices, prompt_id=None):
    """
    Choose one LoRA for Sequential / Random / Random (No Replace), persisting
    cycle position, pools and crash-recovery prompt assignments in one atomic
    state update. Returns None when there is nothing to select.
    """
    valid_choices = [item for item in valid_choices if item and item != "[ NONE ]"]
    if not valid_choices:
        return None

    choices_hash = hashlib.sha256(
        json.dumps(sorted(valid_choices), ensure_ascii=False).encode("utf-8")
    ).hexdigest()[:16]
    prefix = {
        "Random": "rand",
        "Sequential": "seq",
        "Random (No Replace)": "noreplace",
    }.get(mode)
    if not prefix:
        return None

    state_key = f"{prefix}_{unique_id}_{choices_hash}"

    with _LORA_STATE_LOCK:
        state = load_lora_cycle_state()
        node_state = state.get(state_key)
        if isinstance(node_state, dict):
            raw_assigned = node_state.get("assigned", {})
            assigned = dict(raw_assigned) if isinstance(raw_assigned, dict) else {}
            raw_pool = node_state.get("pool", [])
            pool = list(raw_pool) if isinstance(raw_pool, (list, tuple)) else []
            last_selected = node_state.get("last")
            try:
                index = max(0, int(node_state.get("index", 0)))
            except (TypeError, ValueError):
                index = 0
        elif isinstance(node_state, list):
            # Legacy Random (No Replace) format stored a bare pool list.
            assigned = {}
            pool = list(node_state)
            last_selected = None
            index = 0
        else:
            assigned = {}
            pool = []
            last_selected = None
            index = 0

        if prompt_id and prompt_id in assigned:
            # Retry/crash recovery: reproduce the exact same selection without
            # advancing the cycle or consuming another pool entry.
            selected = assigned[prompt_id]
            if selected not in valid_choices:
                selected = None
        else:
            selected = None

        if selected is None:
            if mode == "Sequential":
                selected = valid_choices[index % len(valid_choices)]
                index += 1
            elif mode == "Random":
                import random
                selected = random.choice(valid_choices)
            elif mode == "Random (No Replace)":
                import random
                pool = [x for x in pool if x in valid_choices]
                if not pool:
                    pool = list(valid_choices)
                    # Avoid repeating the last item of the previous cycle
                    # back-to-back while still visiting every item once.
                    if len(pool) > 1 and last_selected in pool:
                        random.shuffle(pool)
                        if pool[0] == last_selected:
                            swap_index = random.randrange(1, len(pool))
                            pool[0], pool[swap_index] = pool[swap_index], pool[0]
                    else:
                        random.shuffle(pool)
                selected = pool.pop(0)
                last_selected = selected

        if prompt_id and selected:
            _remember_lora_assignment(assigned, prompt_id, selected)

        new_entry = {
            "assigned": assigned,
            "last_updated": int(time.time()),
        }
        if mode == "Sequential":
            new_entry["index"] = index
        if mode == "Random (No Replace)":
            new_entry["pool"] = pool
            new_entry["last"] = last_selected
        state[state_key] = new_entry
        save_lora_cycle_state(state)
        return selected

class VisualLoraLoader(FolderLoraLoaderPretty):
    @classmethod
    def INPUT_TYPES(s):
        return {
            "required": {
                "model": ("MODEL",),
                "clip": ("CLIP",),
                "folder": ("STRING", {"default": ""}),
                "strength_model": ("FLOAT", {"default": 1.0, "min": -100.0, "max": 100.0, "step": 0.01}),
                "strength_clip": ("FLOAT", {"default": 1.0, "min": -100.0, "max": 100.0, "step": 0.01}),
                "display_mode": (["Scrollable", "Show All"], {"default": "Scrollable", "advanced": True}),
                "sort_loras_by": (["Name (A-Z)", "Name (Z-A)", "Usage (High to Low)", "Usage (Low to High)", "Date Modified (Newest First)", "Date Modified (Oldest First)"], {"default": "Name (A-Z)", "advanced": True}),
                "sort_folders_by": (["Name (A-Z)", "Name (Z-A)", "Total Usage (High to Low)", "Average Usage (High to Low)", "Total LoRAs (Most First)"], {"default": "Name (A-Z)", "advanced": True}),
                "folder_position": (["Folders First", "Root LoRAs First"], {"default": "Folders First", "advanced": True}),
                "content_alignment": (["Left Aligned", "Right Aligned"], {"default": "Left Aligned", "advanced": True}),
                "output_format": (LORA_OUTPUT_FORMAT_CHOICES, {"default": "Filename", "advanced": True}),
                "custom_regex": ("STRING", {"default": "", "advanced": True}),
            },
            "hidden": {
                "_selected_lora": ("STRING", {"default": "[]"}),
                "_selection_mode": ("STRING", {"default": "Sequential"}),
                "_scrape_on_new": ("STRING", {"default": "true"}),
                "unique_id": "UNIQUE_ID",
            }
        }

    RETURN_TYPES = ("MODEL", "CLIP", "STRING")
    RETURN_NAMES = ("MODEL", "CLIP", "lora_name")
    DESCRIPTION = "Visual thumbnail LoRA browser with search, multi-selection, and ranking badges."

    @classmethod
    def IS_CHANGED(cls, **kwargs):
        mode = kwargs.get("_selection_mode", "All")
        if mode in ["Random", "Sequential", "Random (No Replace)"]:
            return time.time()
        return ""

    def load_lora(self, model, clip, folder, strength_model, strength_clip, display_mode="Scrollable", sort_loras_by="Name (A-Z)", sort_folders_by="Name (A-Z)", folder_position="Folders First", content_alignment="Left Aligned", output_format="Filename", custom_regex="", output_name=None, _selected_lora="[]", _selection_mode="All", _scrape_on_new="true", unique_id="default", **kwargs):
        active_format = output_name if output_name is not None else output_format
        active_lora = _selected_lora if _selected_lora else "[]"
        if active_lora == "[ NONE ]" or active_lora == "[]" or not active_lora:
            return (model, clip, "")

        loras_to_load = []
        if active_lora.startswith("[") and active_lora.endswith("]"):
            try:
                loras_to_load = json.loads(active_lora)
            except Exception:
                loras_to_load = [active_lora]
        else:
            loras_to_load = [active_lora]

        current_pid = get_current_prompt_id()
        if _selection_mode in ["Random", "Sequential", "Random (No Replace)"] and len(loras_to_load) > 0:
            valid_choices = [item for item in loras_to_load if item != "[ NONE ]" and item]
            selected_item = select_a_lora(_selection_mode, unique_id, valid_choices, current_pid)
            loras_to_load = [selected_item] if selected_item else []

        current_model = model
        current_clip = clip
        loaded_names = []
        # Resolve the folder mapping once per run instead of once per selected LoRA.
        lora_mapping = get_filtered_loras_mapping(folder, pretty=True)

        for item in loras_to_load:
            if item == "[ NONE ]" or not item:
                continue

            display_name = item
            if " - " in item:
                display_name = item.split(" - ", 1)[1]

            resolved_path = lora_mapping.get(item)

            if not resolved_path or resolved_path == "[ NONE ]":
                all_loras = folder_paths.get_filename_list("loras")
                raw_filter = (folder or "").replace("\\", "/").strip().rstrip("/").rstrip("*").strip("/").lower()
                for lora in all_loras:
                    norm_lora = lora.replace("\\", "/").lower()
                    if raw_filter and not norm_lora.startswith(raw_filter):
                        continue
                    if lora == item or parse_pretty_name(lora) == display_name or parse_pretty_name_with_version(lora) == display_name:
                        resolved_path = lora
                        break

            if not resolved_path:
                continue

            # Fast-path: If strength is 0 for both model and clip, don't load gigabytes into RAM/VRAM
            if strength_model == 0 and strength_clip == 0:
                increment_lora_usage(resolved_path)
                out_name = format_lora_output_name(resolved_path, display_name, output_format=active_format, custom_regex=custom_regex)
                if out_name:
                    loaded_names.append(out_name)
                continue

            lora_path = folder_paths.get_full_path("loras", resolved_path)
            if not lora_path or not os.path.exists(lora_path):
                continue

            lora = load_torch_file(lora_path, safe_load=True)
            current_model, current_clip = comfy.sd.load_lora_for_models(
                current_model, current_clip, lora, strength_model, strength_clip
            )
            increment_lora_usage(resolved_path)
            
            out_name = format_lora_output_name(resolved_path, display_name, output_format=active_format, custom_regex=custom_regex)
            if out_name:
                loaded_names.append(out_name)

        pretty_name_str = ", ".join(loaded_names) if loaded_names else ""
        return (current_model, current_clip, pretty_name_str)


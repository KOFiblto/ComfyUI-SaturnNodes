import os
import sys
import subprocess
from aiohttp import web
from server import PromptServer

__version__ = "2.4.0"

from .nodes.queue_control import setup_queue_control_routes, tray_manager
from .nodes.lora_loader import (
    FolderLoraLoader,
    FolderLoraLoaderPretty,
    VisualLoraLoader,
    FolderLoraLoaderVisualPrettyV2
)
from .nodes.image_loader import VisualImageLoader, ImageLoaderVisualPrettyV2
from .nodes.auto_watcher import LoadImageFromFolder
from .nodes.load_recent import LoadRecentOutputs
from .nodes.preview_latent import PreviewLatentLiveNode
from .nodes.decision_node import SaturnDecision
from .nodes.aspect_ratio import TextAspectRatioFinder, AspectRatioFinder, PreviewImageSizeAspectRatio
from .nodes.lora_finder import TextLoraFinder, LoraTextFinder
from .nodes.prompt_iterator import PromptQueueIterator
from .nodes.prompt_counter import PromptCounter
from .nodes.text_replacer import MultiTextReplacer
from .nodes.text_split import SaturnTextSplit
from .nodes.local_runner import RunLocalFileNode, setup_local_runner_routes
from .nodes.utils import (
    get_saturnnodes_user_dir,
    get_leafflow_user_dir,
    get_env_setting,
    is_local_request,
    is_safe_path,
    get_csrf_token,
    is_authenticated_local_request
)

NODE_CLASS_MAPPINGS = {
    "FolderLoraLoader": FolderLoraLoader,
    "FolderLoraLoaderPretty": FolderLoraLoaderPretty,
    "VisualLoraLoader": VisualLoraLoader,
    "VisualImageLoader": VisualImageLoader,
    "LoadImageFromFolder": LoadImageFromFolder,
    "LoadRecentOutputs": LoadRecentOutputs,
    "PreviewLatentLive": PreviewLatentLiveNode,
    "SaturnDecision": SaturnDecision,
    "TextAspectRatioFinder": TextAspectRatioFinder,
    "PreviewImageSizeAspectRatio": PreviewImageSizeAspectRatio,
    "TextLoraFinder": TextLoraFinder,
    "PromptQueueIterator": PromptQueueIterator,
    "PromptCounter": PromptCounter,
    "MultiTextReplacer": MultiTextReplacer,
    "SaturnTextSplit": SaturnTextSplit,
    "RunLocalFileNode": RunLocalFileNode,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "FolderLoraLoader": "🪐 📁 LoRA Loader (Folder)",
    "FolderLoraLoaderPretty": "🪐 ✨ LoRA Loader (Pretty)",
    "VisualLoraLoader": "🪐 🖼️ Visual LoRA Loader",
    "VisualImageLoader": "🪐 📷 Visual Image Loader",
    "LoadImageFromFolder": "🪐 📂 Load Image From Folder",
    "LoadRecentOutputs": "🪐 ⏱️ Recent Outputs",
    "PreviewLatentLive": "🪐 👁️ Live Latent Preview",
    "SaturnDecision": "🪐 ⏸️ Saturn Decision",
    "TextAspectRatioFinder": "🪐 📐 Text Aspect Ratio Finder",
    "PreviewImageSizeAspectRatio": "🪐 📐 Preview Image Size & Aspect Ratio",
    "TextLoraFinder": "🪐 🔎 Text LoRA Finder & Loader",
    "PromptQueueIterator": "🪐 🔄 Prompt Queue Iterator",
    "PromptCounter": "🪐 📝 Prompt Counter",
    "MultiTextReplacer": "🪐 🔤 Multi Text Replacer",
    "SaturnTextSplit": "🪐 ✂️ Text Split",
    "RunLocalFileNode": "🪐 ⚡ Run Local File"
}

WEB_DIRECTORY = "./web"
__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS", "WEB_DIRECTORY"]

server = PromptServer.instance
setup_queue_control_routes(server)
setup_local_runner_routes(server)

CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
USER_DIR = get_saturnnodes_user_dir()
ENV_FILE = os.path.join(USER_DIR, ".env")

routes = server.routes

try:
    can_encode_saturn = True
    try:
        "🪐".encode(sys.stdout.encoding or "ascii")
    except Exception:
        can_encode_saturn = False
    saturn_symbol = "🪐 " if can_encode_saturn else ""
    print(f"[ComfyUI-SaturnNodes] {saturn_symbol}Loaded {len(NODE_CLASS_MAPPINGS)} nodes & visual endpoints successfully (v{__version__}).")
except Exception:
    print(f"[ComfyUI-SaturnNodes] Loaded {len(NODE_CLASS_MAPPINGS)} nodes & visual endpoints successfully (v{__version__}).")

@routes.get("/saturnnodes/auth/token")
async def get_csrf_token_endpoint(request):
    if not is_local_request(request):
        return web.json_response({"error": "Forbidden: Local access only"}, status=403)
    return web.json_response({"csrf_token": get_csrf_token()})

@routes.get("/saturnnodes/get_image_prompt")
@routes.get("/saturnnodes/view_image_prompt")
async def get_image_prompt_endpoint(request):
    if not is_local_request(request):
        return web.json_response({"success": False, "error": "Forbidden: Local access only"}, status=403)
    try:
        import folder_paths
        filename = request.query.get("filename")
        subfolder = request.query.get("subfolder", "")
        folder_type = request.query.get("type", "output")

        if not filename:
            return web.json_response({"success": False, "error": "Missing filename"}, status=400)

        if folder_type == "input":
            base_dir = folder_paths.get_input_directory()
        elif folder_type == "temp":
            base_dir = folder_paths.get_temp_directory()
        else:
            base_dir = folder_paths.get_output_directory()

        if subfolder:
            subfolder_clean = str(subfolder).strip().lstrip("/\\")
            filepath = os.path.join(base_dir, subfolder_clean, filename)
        else:
            filepath = os.path.join(base_dir, filename)

        if not is_safe_path(filepath) or not os.path.exists(filepath) or not os.path.isfile(filepath):
            return web.json_response({"success": False, "error": "File not found or forbidden"}, status=404)

        from .nodes.image_loader import extract_metadata_from_image
        prompt, width, height = extract_metadata_from_image(filepath)

        return web.json_response({
            "success": True,
            "prompt": prompt,
            "filename": filename,
            "width": width,
            "height": height
        })
    except Exception as e:
        return web.json_response({"success": False, "error": str(e)}, status=500)

@routes.get("/saturnnodes/settings")
async def get_settings(request):
    if not is_local_request(request):
        return web.json_response({"error": "Forbidden: Local access only"}, status=403)
    civitai_key = os.getenv("CIVITAI_API_KEY", "")
    tmdb_key = os.getenv("TMDB_API_KEY", "")
    enable_tray = os.getenv("ENABLE_TRAY_ICON", "false").lower() in ["true", "1", "yes"]
    enable_assets_restore = os.getenv("ENABLE_ASSETS_RESTORE", "true").lower() in ["true", "1", "yes"]
    restore_assets_count = int(os.getenv("RESTORE_ASSETS_COUNT", "64"))
    enable_process_management = os.getenv("ALLOW_PROCESS_MANAGEMENT", "false").lower() in ["true", "1", "yes"]
    enable_local_file_execution = os.getenv("ENABLE_LOCAL_FILE_EXECUTION", "false").lower() in ["true", "1", "yes"]
    if os.path.exists(ENV_FILE):
        try:
            with open(ENV_FILE, "r", encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if line.startswith("CIVITAI_API_KEY="):
                        civitai_key = line.split("=", 1)[1].strip()
                    elif line.startswith("TMDB_API_KEY="):
                        tmdb_key = line.split("=", 1)[1].strip()
                    elif line.startswith("ENABLE_TRAY_ICON="):
                        enable_tray = line.split("=", 1)[1].strip().lower() in ["true", "1", "yes"]
                    elif line.startswith("ENABLE_ASSETS_RESTORE="):
                        enable_assets_restore = line.split("=", 1)[1].strip().lower() in ["true", "1", "yes"]
                    elif line.startswith("RESTORE_ASSETS_COUNT="):
                        try:
                            restore_assets_count = int(line.split("=", 1)[1].strip())
                        except Exception:
                            pass
                    elif line.startswith("ALLOW_PROCESS_MANAGEMENT="):
                        enable_process_management = line.split("=", 1)[1].strip().lower() in ["true", "1", "yes"]
                    elif line.startswith("ENABLE_LOCAL_FILE_EXECUTION="):
                        enable_local_file_execution = line.split("=", 1)[1].strip().lower() in ["true", "1", "yes"]
        except Exception:
            pass
    return web.json_response({
        "civitai_api_key": civitai_key,
        "tmdb_api_key": tmdb_key,
        "enable_tray_icon": enable_tray,
        "enable_assets_restore": enable_assets_restore,
        "restore_assets_count": restore_assets_count,
        "enable_process_management": enable_process_management,
        "enable_local_file_execution": enable_local_file_execution
    })

def _clean_env_val(v):
    if v is None:
        return None
    return str(v).replace("\n", "").replace("\r", "").strip()

@routes.post("/saturnnodes/settings")
async def save_settings(request):
    if not is_authenticated_local_request(request):
        return web.json_response({"error": "Forbidden: Local authenticated access only"}, status=403)
    try:
        data = await request.json()
        civitai_key = _clean_env_val(data.get("civitai_api_key"))
        tmdb_key = _clean_env_val(data.get("tmdb_api_key"))
        enable_persistent_queue = _clean_env_val(data.get("enable_persistent_queue"))
        default_pause_state = _clean_env_val(data.get("default_pause_state"))
        default_pause_mode = _clean_env_val(data.get("default_pause_mode"))
        enable_civitai = _clean_env_val(data.get("enable_civitai_scraping"))
        enable_tmdb = _clean_env_val(data.get("enable_tmdb_scraping"))
        enable_lora_usage = _clean_env_val(data.get("enable_lora_usage"))
        enable_tray_icon = _clean_env_val(data.get("enable_tray_icon"))
        enable_assets_restore = _clean_env_val(data.get("enable_assets_restore"))
        restore_assets_count = _clean_env_val(data.get("restore_assets_count"))
        clear_prompt_iterator_on_launch = _clean_env_val(data.get("clear_prompt_iterator_on_launch"))
        restored_state = _clean_env_val(data.get("persistent_queue_restored_state"))
        enable_process_management = _clean_env_val(data.get("enable_process_management"))
        enable_local_file_execution = _clean_env_val(data.get("enable_local_file_execution"))

        lines = []
        if os.path.exists(ENV_FILE):
            try:
                with open(ENV_FILE, "r", encoding="utf-8") as f:
                    lines = f.readlines()
            except Exception:
                lines = []

        new_lines = []
        has_civitai = False
        has_tmdb = False
        has_persistent = False
        has_pause_state = False
        has_pause_mode = False
        has_civ_enable = False
        has_tmdb_enable = False
        has_lora_usage = False
        has_tray_enable = False
        has_assets_restore = False
        has_restore_count = False
        has_clear_prompt_iterator = False
        has_restored_state = False
        has_process_mgmt = False
        has_local_file_exec = False

        for line in lines:
            if line.strip().startswith("CIVITAI_API_KEY=") and civitai_key is not None:
                new_lines.append(f"CIVITAI_API_KEY={civitai_key}\n")
                has_civitai = True
            elif line.strip().startswith("TMDB_API_KEY=") and tmdb_key is not None:
                new_lines.append(f"TMDB_API_KEY={tmdb_key}\n")
                has_tmdb = True
            elif line.strip().startswith("ENABLE_PERSISTENT_QUEUE=") and enable_persistent_queue is not None:
                new_lines.append(f"ENABLE_PERSISTENT_QUEUE={enable_persistent_queue}\n")
                has_persistent = True
            elif line.strip().startswith("DEFAULT_PAUSE_STATE=") and default_pause_state is not None:
                new_lines.append(f"DEFAULT_PAUSE_STATE={default_pause_state}\n")
                has_pause_state = True
            elif line.strip().startswith("DEFAULT_PAUSE_MODE=") and default_pause_mode is not None:
                new_lines.append(f"DEFAULT_PAUSE_MODE={default_pause_mode}\n")
                has_pause_mode = True
            elif line.strip().startswith("ENABLE_CIVITAI_SCRAPING=") and enable_civitai is not None:
                new_lines.append(f"ENABLE_CIVITAI_SCRAPING={enable_civitai}\n")
                has_civ_enable = True
            elif line.strip().startswith("ENABLE_TMDB_SCRAPING=") and enable_tmdb is not None:
                new_lines.append(f"ENABLE_TMDB_SCRAPING={enable_tmdb}\n")
                has_tmdb_enable = True
            elif line.strip().startswith("ENABLE_LORA_USAGE=") and enable_lora_usage is not None:
                new_lines.append(f"ENABLE_LORA_USAGE={enable_lora_usage}\n")
                has_lora_usage = True
            elif line.strip().startswith("ENABLE_TRAY_ICON=") and enable_tray_icon is not None:
                new_lines.append(f"ENABLE_TRAY_ICON={enable_tray_icon}\n")
                has_tray_enable = True
            elif line.strip().startswith("ENABLE_ASSETS_RESTORE=") and enable_assets_restore is not None:
                new_lines.append(f"ENABLE_ASSETS_RESTORE={enable_assets_restore}\n")
                has_assets_restore = True
            elif line.strip().startswith("RESTORE_ASSETS_COUNT=") and restore_assets_count is not None:
                new_lines.append(f"RESTORE_ASSETS_COUNT={restore_assets_count}\n")
                has_restore_count = True
            elif line.strip().startswith("CLEAR_PROMPT_ITERATOR_ON_LAUNCH=") and clear_prompt_iterator_on_launch is not None:
                new_lines.append(f"CLEAR_PROMPT_ITERATOR_ON_LAUNCH={clear_prompt_iterator_on_launch}\n")
                has_clear_prompt_iterator = True
            elif line.strip().startswith("PERSISTENT_QUEUE_RESTORED_STATE=") and restored_state is not None:
                new_lines.append(f"PERSISTENT_QUEUE_RESTORED_STATE={restored_state}\n")
                has_restored_state = True
            elif line.strip().startswith("ALLOW_PROCESS_MANAGEMENT=") and enable_process_management is not None:
                new_lines.append(f"ALLOW_PROCESS_MANAGEMENT={enable_process_management}\n")
                has_process_mgmt = True
            elif line.strip().startswith("ENABLE_LOCAL_FILE_EXECUTION=") and enable_local_file_execution is not None:
                new_lines.append(f"ENABLE_LOCAL_FILE_EXECUTION={enable_local_file_execution}\n")
                has_local_file_exec = True
            elif line.strip().startswith("ALLOW_ANY_SCRIPT_PATH="):
                # Deprecated and removed for security; drop from .env
                continue
            else:
                new_lines.append(line)

        if not has_civitai and civitai_key is not None:
            new_lines.append(f"CIVITAI_API_KEY={civitai_key}\n")
        if not has_tmdb and tmdb_key is not None:
            new_lines.append(f"TMDB_API_KEY={tmdb_key}\n")
        if not has_persistent and enable_persistent_queue is not None:
            new_lines.append(f"ENABLE_PERSISTENT_QUEUE={enable_persistent_queue}\n")
        if not has_pause_state and default_pause_state is not None:
            new_lines.append(f"DEFAULT_PAUSE_STATE={default_pause_state}\n")
        if not has_pause_mode and default_pause_mode is not None:
            new_lines.append(f"DEFAULT_PAUSE_MODE={default_pause_mode}\n")
        if not has_civ_enable and enable_civitai is not None:
            new_lines.append(f"ENABLE_CIVITAI_SCRAPING={enable_civitai}\n")
        if not has_tmdb_enable and enable_tmdb is not None:
            new_lines.append(f"ENABLE_TMDB_SCRAPING={enable_tmdb}\n")
        if not has_lora_usage and enable_lora_usage is not None:
            new_lines.append(f"ENABLE_LORA_USAGE={enable_lora_usage}\n")
        if not has_tray_enable and enable_tray_icon is not None:
            new_lines.append(f"ENABLE_TRAY_ICON={enable_tray_icon}\n")
        if not has_assets_restore and enable_assets_restore is not None:
            new_lines.append(f"ENABLE_ASSETS_RESTORE={enable_assets_restore}\n")
        if not has_restore_count and restore_assets_count is not None:
            new_lines.append(f"RESTORE_ASSETS_COUNT={restore_assets_count}\n")
        if not has_clear_prompt_iterator and clear_prompt_iterator_on_launch is not None:
            new_lines.append(f"CLEAR_PROMPT_ITERATOR_ON_LAUNCH={clear_prompt_iterator_on_launch}\n")
        if not has_restored_state and restored_state is not None:
            new_lines.append(f"PERSISTENT_QUEUE_RESTORED_STATE={restored_state}\n")
        if not has_process_mgmt and enable_process_management is not None:
            new_lines.append(f"ALLOW_PROCESS_MANAGEMENT={enable_process_management}\n")
        if not has_local_file_exec and enable_local_file_execution is not None:
            new_lines.append(f"ENABLE_LOCAL_FILE_EXECUTION={enable_local_file_execution}\n")

        with open(ENV_FILE, "w", encoding="utf-8") as f:
            f.writelines(new_lines)

        if civitai_key is not None:
            os.environ["CIVITAI_API_KEY"] = civitai_key
        if tmdb_key is not None:
            os.environ["TMDB_API_KEY"] = tmdb_key
        if enable_lora_usage is not None:
            os.environ["ENABLE_LORA_USAGE"] = enable_lora_usage
        if enable_tray_icon is not None:
            os.environ["ENABLE_TRAY_ICON"] = str(enable_tray_icon)
            tray_enabled_bool = str(enable_tray_icon).lower() in ["true", "1", "yes"]
            tray_manager.set_enabled(tray_enabled_bool)
        if enable_assets_restore is not None:
            os.environ["ENABLE_ASSETS_RESTORE"] = str(enable_assets_restore)
        if enable_process_management is not None:
            os.environ["ALLOW_PROCESS_MANAGEMENT"] = str(enable_process_management)
        if enable_local_file_execution is not None:
            os.environ["ENABLE_LOCAL_FILE_EXECUTION"] = str(enable_local_file_execution)
        if restore_assets_count is not None:
            os.environ["RESTORE_ASSETS_COUNT"] = str(restore_assets_count)
        if clear_prompt_iterator_on_launch is not None:
            os.environ["CLEAR_PROMPT_ITERATOR_ON_LAUNCH"] = str(clear_prompt_iterator_on_launch)

    except Exception as e:
        print(f"[SaturnNodes] 🪐 Error saving settings to .env: {e}")

    return web.json_response({"status": "ok"})

@routes.post("/saturnnodes/scrapes/clear")
async def clear_scrapes_endpoint(request):
    if not is_authenticated_local_request(request):
        return web.json_response({"error": "Forbidden: Local authenticated access only"}, status=403)
    try:
        failed_file = os.path.join(USER_DIR, "failed_scrapes.json")
        with open(failed_file, "w", encoding="utf-8") as f:
            f.write("{}")
        return web.json_response({"status": "ok"})
    except Exception as e:
        print(f"[SaturnNodes] 🪐 Error clearing scrapes cache: {e}")
        return web.json_response({"status": "error", "message": str(e)}, status=500)

@routes.get("/saturnnodes/debug/export")
async def export_debug_profile(request):
    try:
        import platform
        import json
        from datetime import datetime, timezone
        import torch

        # Safe GPU / hardware information
        cuda_avail = torch.cuda.is_available() if hasattr(torch, "cuda") else False
        device_name = torch.cuda.get_device_name(0) if cuda_avail else "CPU"

        # Check API key configuration status without revealing sensitive strings
        civitai_key = os.getenv("CIVITAI_API_KEY", "")
        tmdb_key = os.getenv("TMDB_API_KEY", "")
        if os.path.exists(ENV_FILE):
            try:
                with open(ENV_FILE, "r", encoding="utf-8") as f:
                    for line in f:
                        if line.strip().startswith("CIVITAI_API_KEY=") and not civitai_key:
                            civitai_key = line.split("=", 1)[1].strip()
                        elif line.startswith("TMDB_API_KEY=") and not tmdb_key:
                            tmdb_key = line.split("=", 1)[1].strip()
            except Exception:
                pass

        # Calculate counts of local storage files safely
        def safe_json_count(filename):
            p = os.path.join(USER_DIR, filename)
            if os.path.exists(p):
                try:
                    with open(p, "r", encoding="utf-8") as f:
                        data = json.load(f)
                        return len(data) if isinstance(data, (list, dict)) else 0
                except Exception:
                    pass
            return 0

        debug_profile = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "package": "ComfyUI-SaturnNodes",
            "version": __version__,
            "system": {
                "os": platform.system(),
                "os_release": platform.release(),
                "os_version": platform.version(),
                "architecture": platform.machine(),
                "python_version": sys.version.split()[0],
                "torch_version": getattr(torch, "__version__", "unknown"),
                "cuda_available": cuda_avail,
                "device_name": device_name,
            },
            "registered_nodes_count": len(NODE_CLASS_MAPPINGS),
            "settings": {
                "enable_persistent_queue": get_env_setting("ENABLE_PERSISTENT_QUEUE", "true"),
                "default_pause_state": get_env_setting("DEFAULT_PAUSE_STATE", "Running"),
                "default_pause_mode": get_env_setting("DEFAULT_PAUSE_MODE", "after_finish"),
                "enable_civitai_scraping": get_env_setting("ENABLE_CIVITAI_SCRAPING", "true"),
                "enable_tmdb_scraping": get_env_setting("ENABLE_TMDB_SCRAPING", "true"),
                "enable_lora_usage": get_env_setting("ENABLE_LORA_USAGE", "true"),
                "enable_tray_icon": get_env_setting("ENABLE_TRAY_ICON", "false"),
                "enable_assets_restore": get_env_setting("ENABLE_ASSETS_RESTORE", "true"),
                "restore_assets_count": get_env_setting("RESTORE_ASSETS_COUNT", "64"),
                "clear_prompt_iterator_on_launch": get_env_setting("CLEAR_PROMPT_ITERATOR_ON_LAUNCH", "false"),
                "persistent_queue_restored_state": get_env_setting("PERSISTENT_QUEUE_RESTORED_STATE", "Match Default"),
                "allow_process_management": get_env_setting("ALLOW_PROCESS_MANAGEMENT", "false"),
                "enable_local_file_execution": get_env_setting("ENABLE_LOCAL_FILE_EXECUTION", "false"),
                "civitai_api_key_configured": bool(civitai_key and civitai_key.strip()),
                "tmdb_api_key_configured": bool(tmdb_key and tmdb_key.strip()),
            },
            "local_storage_stats": {
                "tracked_loras": safe_json_count("lora_usage.json"),
                "lora_cycle_states": safe_json_count("lora_loader_state.json"),
                "image_prompts_cached": safe_json_count("image_prompts_cache.json"),
                "failed_scrapes_cached": safe_json_count("failed_scrapes.json"),
                "prompt_iterator_queues": safe_json_count("prompt_iterator_state.json"),
                "persisted_queue_items": safe_json_count("persistent_queue.json"),
            }
        }
        return web.json_response(debug_profile)
    except Exception as e:
        return web.json_response({"error": str(e)}, status=500)



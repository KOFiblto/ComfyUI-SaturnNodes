import os
import re
import json
import random
import time
import hashlib
import platform
import subprocess
from aiohttp import web
from server import PromptServer
import folder_paths
from .utils import get_leafflow_user_dir, is_authenticated_local_request

CURRENT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
USER_DIR = get_leafflow_user_dir()
STATE_FILE = os.path.join(USER_DIR, "prompt_iterator_state.json")
ENV_FILE = os.path.join(USER_DIR, ".env")

def get_env_setting(key, default_val):
    if os.path.exists(ENV_FILE):
        try:
            with open(ENV_FILE, "r", encoding="utf-8") as f:
                for line in f:
                    if line.strip().startswith(f"{key}="):
                        return line.strip().split("=", 1)[1].strip()
        except Exception:
            pass
    return default_val

def is_clear_prompt_iterator_on_launch():
    val = get_env_setting("CLEAR_PROMPT_ITERATOR_ON_LAUNCH", "false").lower()
    return val in ["true", "1", "yes"]

def ensure_user_dir():
    os.makedirs(USER_DIR, exist_ok=True)

def load_state():
    ensure_user_dir()
    if os.path.exists(STATE_FILE):
        try:
            with open(STATE_FILE, "r", encoding="utf-8") as f:
                data = json.load(f)
                if isinstance(data, dict):
                    return data
        except Exception as e:
            print(f"[LeafFlow] 🍃 Warning reading prompt iterator state: {e}")
    return {}

def save_state(state):
    ensure_user_dir()
    try:
        # Auto-prune abandoned state keys if count exceeds 100 entries
        if len(state) > 100:
            excess_keys = list(state.keys())[:-100]
            for k in excess_keys:
                del state[k]
        tmp_file = STATE_FILE + ".tmp"
        with open(tmp_file, "w", encoding="utf-8") as f:
            json.dump(state, f, indent=4, ensure_ascii=False)
        if os.path.exists(STATE_FILE):
            os.replace(tmp_file, STATE_FILE)
        else:
            os.rename(tmp_file, STATE_FILE)
    except Exception as e:
        print(f"[LeafFlow] 🍃 Error saving prompt iterator state: {e}")

def clear_state():
    ensure_user_dir()
    try:
        with open(STATE_FILE, "w", encoding="utf-8") as f:
            json.dump({}, f, indent=4)
        print("[LeafFlow] 🍃 Prompt iterator state cleared.")
        return True
    except Exception as e:
        print(f"[LeafFlow] 🍃 Error clearing prompt iterator state: {e}")
        return False

# Clear state on startup if privacy setting enabled
if is_clear_prompt_iterator_on_launch():
    clear_state()

# Register API endpoints
try:
    routes = PromptServer.instance.routes

    @routes.post("/leafflow/prompt_iterator/reset_node")
    async def reset_prompt_iterator_node(request):
        if not is_authenticated_local_request(request):
            return web.json_response({"error": "Forbidden: Local authenticated access only"}, status=403)
        try:
            data = await request.json()
            node_id = str(data.get("node_id", ""))
            state = load_state()
            matched = False
            for k in list(state.keys()):
                if node_id == "all" or k.startswith(f"node_{node_id}_") or k == f"node_{node_id}":
                    if isinstance(state[k], dict):
                        state[k]["index"] = 0
                    else:
                        state[k] = {"index": 0, "total": 0}
                    matched = True
            save_state(state)
            if node_id and node_id != "all":
                try:
                    PromptServer.instance.send_sync("leafflow_prompt_iterator_progress", {
                        "node_id": node_id,
                        "current_run": 0,
                        "total_runs": 0,
                        "status_text": "Reset (0 / --)"
                    })
                except Exception:
                    pass
            return web.json_response({"status": "ok", "reset": matched})
        except Exception as e:
            return web.json_response({"status": "error", "message": str(e)}, status=500)

    @routes.post("/leafflow/prompt_iterator/clear")
    @routes.post("/flow_control/prompt_iterator/clear")
    async def clear_prompt_iterator_endpoint(request):
        if not is_authenticated_local_request(request):
            return web.json_response({"error": "Forbidden: Local authenticated access only"}, status=403)
        success = clear_state()
        return web.json_response({"status": "ok" if success else "error"})

    @routes.post("/leafflow/prompt_iterator/open_file")
    async def open_prompt_iterator_file(request):
        if not is_authenticated_local_request(request):
            return web.json_response({"error": "Forbidden: Local authenticated access only"}, status=403)
        ensure_user_dir()
        if not os.path.exists(STATE_FILE):
            save_state({})

        # Security: verify canonical state file path is strictly within USER_DIR
        canonical_state = os.path.realpath(STATE_FILE)
        canonical_user = os.path.realpath(USER_DIR)
        try:
            if os.path.commonpath([canonical_user, canonical_state]) != canonical_user:
                return web.json_response({"status": "error", "message": "Security: State file escapes user directory"}, status=403)
        except Exception:
            return web.json_response({"status": "error", "message": "Security path validation error"}, status=403)

        try:
            sys_name = platform.system()
            if sys_name == "Windows":
                os.startfile(canonical_state)
            elif sys_name == "Darwin":
                subprocess.Popen(["open", canonical_state])
            else:
                subprocess.Popen(["xdg-open", canonical_state])
            return web.json_response({"status": "ok", "path": canonical_state})
        except Exception as e:
            print(f"[LeafFlow] 🍃 Error opening state file: {e}")
            return web.json_response({"status": "error", "message": str(e)}, status=500)

except Exception:
    pass

def parse_prompt_blocks(text_str, separator, custom_regex=""):
    if not text_str or not text_str.strip():
        return []
    
    clean_text = text_str.replace('\r\n', '\n').replace('\r', '\n')
    sep_lower = str(separator).lower() if separator else ">1 empty line"

    if "regex" in sep_lower:
        pattern = custom_regex.strip() if (custom_regex and custom_regex.strip()) else r'\n\s*\n+'
        try:
            regex = re.compile(pattern)
            raw_blocks = regex.split(clean_text)
            results = []
            for b in raw_blocks:
                b_str = b.strip()
                if b_str and not regex.fullmatch(b):
                    results.append(b_str)
            return results
        except Exception as e:
            print(f"[LeafFlow Prompt] Invalid custom regex pattern '{pattern}': {e}. Falling back to empty line separator.")
            raw_blocks = re.split(r'\n\s*\n+', clean_text)
            return [b.strip() for b in raw_blocks if b.strip()]
    elif "newline" in sep_lower:
        return [line.strip() for line in clean_text.split('\n') if line.strip()]
    elif ">2" in sep_lower or "2 empty" in sep_lower:
        raw_blocks = re.split(r'(?:\n\s*){3,}', clean_text)
        return [b.strip() for b in raw_blocks if b.strip()]
    else: # ">1 Empty Line", ">1 Emptyline"
        raw_blocks = re.split(r'\n\s*\n+', clean_text)
        return [b.strip() for b in raw_blocks if b.strip()]

def get_current_prompt_id():
    try:
        server = PromptServer.instance
        if hasattr(server, "prompt_queue") and server.prompt_queue.currently_running:
            for item in server.prompt_queue.currently_running.values():
                if isinstance(item, (tuple, list)) and len(item) > 1:
                    return str(item[1])
    except Exception:
        pass
    return None

class PromptQueueIterator:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "pop_mode": ([
                    "Sequential (Loop on End)",
                    "Sequential (Stop on End)",
                    "Random (Keep)",
                    "Random (Cycle)"
                ], {"default": "Sequential (Loop on End)"}),
                "separator": ([
                    ">1 Empty Line",
                    "Newline",
                    ">2 Empty Lines",
                    "Custom Regex"
                ], {"default": ">1 Empty Line"}),
                "text": ("STRING", {"default": "", "multiline": True}),
            },
            "optional": {
                "custom_regex": ("STRING", {"default": "", "placeholder": "Custom regex delimiter (e.g. \\n---\\n)"}),
                "prompt": ("STRING", {"forceInput": True}),
            },
            "hidden": {
                "unique_id": "UNIQUE_ID",
            }
        }

    RETURN_TYPES = ("STRING", "STRING", "INT")
    RETURN_NAMES = ("prompt", "remaining_text", "remaining_count")
    FUNCTION = "process_queue"
    CATEGORY = "🍃 LeafFlow/Utils"
    DESCRIPTION = "Deterministically iterates over multiline prompt text blocks per queue run with live progress display and index controls."

    @classmethod
    def IS_CHANGED(cls, **kwargs):
        # Force re-execution so each queue batch item advances the pointer
        return time.time()

    def process_queue(
        self,
        pop_mode="Sequential (Loop on End)",
        separator=">1 Empty Line",
        text="",
        custom_regex="",
        prompt=None,
        prompt_text=None,
        unique_id="default",
        **kwargs
    ):
        raw_input = text if text else (prompt if prompt is not None else prompt_text)
        text_str = str(raw_input) if raw_input is not None else ""
        if not text_str.strip():
            return ("", "", 0)

        original_blocks = parse_prompt_blocks(text_str, separator, custom_regex)
        total_count = len(original_blocks)
        if total_count == 0:
            return ("", "", 0)

        # Calculate stable hash of the complete input text
        text_hash = hashlib.sha256(text_str.strip().encode('utf-8')).hexdigest()[:16]
        state_key = f"node_{unique_id}_{text_hash}"
        
        current_prompt_id = get_current_prompt_id()

        # Load state fresh from disk (no stale memory cache)
        state = load_state()
        node_state = state.get(state_key)

        current_index = 0
        assigned_prompts = {}
        if isinstance(node_state, dict):
            current_index = int(node_state.get("index", 0))
            raw_assigned = node_state.get("assigned_prompts", {})
            if isinstance(raw_assigned, dict):
                assigned_prompts = dict(raw_assigned)
        elif isinstance(node_state, int):
            current_index = node_state

        # Check if this prompt_id was already assigned an index (e.g. recovered from persistent queue / retry)
        if current_prompt_id and current_prompt_id in assigned_prompts:
            idx = assigned_prompts[current_prompt_id] % total_count
            selected_prompt = original_blocks[idx]
            display_run = idx + 1
            next_index = current_index  # Keep current index without double-advancing
        else:
            # Select prompt based on mode and calculate next index
            if pop_mode in ["Sequential (Loop on End)", "Cycle / Loop", "Pop Top & Delete"]:
                idx = current_index % total_count
                selected_prompt = original_blocks[idx]
                next_index = (current_index + 1) % total_count
                display_run = idx + 1
            elif pop_mode in ["Sequential (Stop on End)"]:
                if current_index >= total_count:
                    idx = total_count - 1
                    selected_prompt = original_blocks[idx]
                    next_index = total_count
                    display_run = total_count
                else:
                    idx = current_index
                    selected_prompt = original_blocks[idx]
                    next_index = current_index + 1
                    display_run = idx + 1
            elif pop_mode in ["Random (Keep)", "Random (Delete)"]:
                idx = random.randint(0, total_count - 1)
                selected_prompt = original_blocks[idx]
                next_index = current_index + 1
                display_run = (current_index % total_count) + 1
            else: # Default fallback
                idx = current_index % total_count
                selected_prompt = original_blocks[idx]
                next_index = (current_index + 1) % total_count
                display_run = idx + 1

            if current_prompt_id:
                assigned_prompts[current_prompt_id] = idx
                if len(assigned_prompts) > 50:
                    for old_k in list(assigned_prompts.keys())[:-50]:
                        del assigned_prompts[old_k]

        # Calculate remaining items
        remaining_count = max(0, total_count - display_run)
        sep_lower = str(separator).lower() if separator else ""
        if "newline" in sep_lower:
            join_delim = "\n"
        elif ">2" in sep_lower or "2 empty" in sep_lower:
            join_delim = "\n\n\n"
        elif "regex" in sep_lower:
            if custom_regex and not any(c in custom_regex for c in r"*+?{}[\]^$|()\\"):
                join_delim = custom_regex
            else:
                join_delim = "\n\n"
        else:
            join_delim = "\n\n"
        remaining_text = join_delim.join(original_blocks[display_run:]) if display_run < total_count else ""

        # Update state dictionary
        state[state_key] = {
            "index": next_index,
            "total": total_count,
            "last_run": display_run,
            "last_updated": int(time.time()),
            "preview": selected_prompt[:60].replace('\n', ' '),
            "assigned_prompts": assigned_prompts
        }

        # Keep at most 3 most recent text hashes per node_id
        node_prefix = f"node_{unique_id}_"
        node_keys = [k for k in state.keys() if k.startswith(node_prefix)]
        if len(node_keys) > 3:
            node_keys.sort(key=lambda k: state[k].get("last_updated", 0) if isinstance(state[k], dict) else 0)
            for old_k in node_keys[:-3]:
                del state[old_k]

        save_state(state)

        # Send live progress update to UI
        try:
            PromptServer.instance.send_sync("leafflow_prompt_iterator_progress", {
                "node_id": str(unique_id),
                "current_run": display_run,
                "total_runs": total_count,
                "status_text": f"Run {display_run} / {total_count}"
            })
        except Exception:
            pass

        return (selected_prompt, remaining_text, remaining_count)

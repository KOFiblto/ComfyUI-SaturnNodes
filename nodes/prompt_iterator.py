import os
import re
import json
import copy
import random
import time
import hashlib
import platform
import subprocess
import threading
from aiohttp import web
from server import PromptServer
import folder_paths
from .utils import get_saturnnodes_user_dir, is_authenticated_local_request, get_env_setting

CURRENT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
USER_DIR = get_saturnnodes_user_dir()
STATE_FILE = os.path.join(USER_DIR, "prompt_iterator_state.json")

_STATE_LOCK = threading.RLock()
_STATE_CACHE = None
_STATE_CACHE_MTIME = None

def is_clear_prompt_iterator_on_launch():
    val = get_env_setting("CLEAR_PROMPT_ITERATOR_ON_LAUNCH", "false").lower()
    return val in ["true", "1", "yes"]

def ensure_user_dir():
    os.makedirs(USER_DIR, exist_ok=True)

def invalidate_state_cache():
    global _STATE_CACHE, _STATE_CACHE_MTIME
    with _STATE_LOCK:
        _STATE_CACHE = None
        _STATE_CACHE_MTIME = None

def load_state():
    global _STATE_CACHE, _STATE_CACHE_MTIME
    ensure_user_dir()
    with _STATE_LOCK:
        mtime = None
        try:
            if os.path.exists(STATE_FILE):
                mtime = os.stat(STATE_FILE).st_mtime_ns
        except OSError:
            mtime = None

        if _STATE_CACHE is not None and mtime == _STATE_CACHE_MTIME:
            return copy.deepcopy(_STATE_CACHE)

        data = {}
        if mtime is not None:
            try:
                with open(STATE_FILE, "r", encoding="utf-8") as f:
                    loaded = json.load(f)
                    if isinstance(loaded, dict):
                        data = loaded
            except Exception as e:
                print(f"[SaturnNodes] Warning reading prompt iterator state: {e}")

        _STATE_CACHE = copy.deepcopy(data)
        _STATE_CACHE_MTIME = mtime
        return copy.deepcopy(data)

def _entry_timestamp(entry):
    if isinstance(entry, dict):
        try:
            return int(entry.get("last_updated", 0))
        except (TypeError, ValueError):
            return 0
    return 0

def save_state(state):
    global _STATE_CACHE, _STATE_CACHE_MTIME
    ensure_user_dir()
    with _STATE_LOCK:
        try:
            # Global prune: keep the 100 most recently touched node/text entries.
            if len(state) > 100:
                keep = set(sorted(state.keys(), key=lambda k: _entry_timestamp(state[k]), reverse=True)[:100])
                for k in [k for k in state.keys() if k not in keep]:
                    del state[k]
            tmp_file = STATE_FILE + ".tmp"
            with open(tmp_file, "w", encoding="utf-8") as f:
                json.dump(state, f, indent=4, ensure_ascii=False)
            os.replace(tmp_file, STATE_FILE)
            _STATE_CACHE = copy.deepcopy(state)
            try:
                _STATE_CACHE_MTIME = os.stat(STATE_FILE).st_mtime_ns
            except OSError:
                _STATE_CACHE_MTIME = None
        except Exception as e:
            print(f"[SaturnNodes] Error saving prompt iterator state: {e}")

def clear_state():
    ensure_user_dir()
    with _STATE_LOCK:
        try:
            tmp_file = STATE_FILE + ".tmp"
            with open(tmp_file, "w", encoding="utf-8") as f:
                json.dump({}, f, indent=4)
            os.replace(tmp_file, STATE_FILE)
            invalidate_state_cache()
            print("[SaturnNodes] Prompt iterator state cleared.")
            return True
        except Exception as e:
            print(f"[SaturnNodes] Error clearing prompt iterator state: {e}")
            return False

# Clear state on startup if privacy setting enabled
if is_clear_prompt_iterator_on_launch():
    clear_state()

# Register API endpoints
try:
    routes = PromptServer.instance.routes

    @routes.post("/saturnnodes/prompt_iterator/reset_node")
    async def reset_prompt_iterator_node(request):
        if not is_authenticated_local_request(request):
            return web.json_response({"error": "Forbidden: Local authenticated access only"}, status=403)
        try:
            data = await request.json()
            node_id = str(data.get("node_id", ""))
            state = load_state()
            matched = reset_node_state(state, node_id)
            save_state(state)
            if node_id and node_id != "all":
                progress_payload = {
                    "node_id": node_id,
                    "current_run": 0,
                    "total_runs": 0,
                    "status_text": "Reset (0 / --)"
                }
                try:
                    PromptServer.instance.send_sync("saturnnodes_prompt_iterator_progress", progress_payload)
                except Exception:
                    pass
            return web.json_response({"status": "ok", "reset": matched})
        except Exception as e:
            return web.json_response({"status": "error", "message": str(e)}, status=500)

    @routes.post("/saturnnodes/prompt_iterator/clear")
    async def clear_prompt_iterator_endpoint(request):
        if not is_authenticated_local_request(request):
            return web.json_response({"error": "Forbidden: Local authenticated access only"}, status=403)
        success = clear_state()
        return web.json_response({"status": "ok" if success else "error"})

    @routes.post("/saturnnodes/prompt_iterator/open_file")
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
            print(f"[SaturnNodes] Error opening state file: {e}")
            return web.json_response({"status": "error", "message": str(e)}, status=500)

except Exception as e:
    print(f"[SaturnNodes] Notice: Skipped registering prompt iterator endpoints: {e}")

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
            print(f"[SaturnNodes Prompt] Invalid custom regex pattern '{pattern}': {e}. Falling back to empty line separator.")
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

def reset_node_state(state, node_id):
    """Reset every pointer belonging to a node (or all nodes when node_id == 'all')."""
    node_id = str(node_id)
    matched = False
    for k in list(state.keys()):
        if node_id == "all" or k.startswith(f"node_{node_id}_") or k == f"node_{node_id}":
            if isinstance(state[k], dict):
                state[k]["index"] = 0
                state[k]["last_run"] = 0
                # A hard reset must not leave stale crash-recovery assignments or
                # shuffle permutations behind, otherwise the next retry can jump
                # to an old prompt or reuse an outdated cycle order.
                state[k]["assigned_prompts"] = {}
                state[k]["shuffled_order"] = []
            else:
                state[k] = {"index": 0, "total": 0}
            matched = True
    return matched

def get_current_prompt_id():
    try:
        server = getattr(PromptServer, "instance", None)
        if server and hasattr(server, "prompt_queue"):
            queue = server.prompt_queue
            if hasattr(queue, "currently_running"):
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

def _remember_assignment(assigned_prompts, prompt_id, index, limit=50):
    """Insert/refresh a crash-recovery mapping, keeping the most recent entries."""
    if not prompt_id:
        return
    assigned_prompts.pop(prompt_id, None)
    assigned_prompts[prompt_id] = index
    while len(assigned_prompts) > limit:
        assigned_prompts.pop(next(iter(assigned_prompts)))

def _sanitize_shuffle_order(raw_order, total_count):
    if not isinstance(raw_order, (list, tuple)):
        return None
    try:
        order = [int(v) for v in raw_order]
    except (TypeError, ValueError):
        return None
    if len(order) != total_count or len(set(order)) != total_count:
        return None
    if any(v < 0 or v >= total_count for v in order):
        return None
    return order

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
                # Appended after the existing widgets so old workflow widget
                # values keep their original positions.
                "track_by": ([
                    "Text & Node",
                    "Node Only"
                ], {"default": "Text & Node"}),
                "prompt": ("STRING", {"forceInput": True}),
            },
            "hidden": {
                "unique_id": "UNIQUE_ID",
            }
        }

    RETURN_TYPES = ("STRING", "STRING", "INT", "BOOLEAN")
    RETURN_NAMES = ("prompt", "remaining_text", "remaining_count", "exhausted")
    FUNCTION = "process_queue"
    CATEGORY = "🪐 SaturnNodes/Utils"
    DESCRIPTION = "Deterministically iterates over multiline prompt text blocks per queue run with live progress display and index controls."

    @classmethod
    def IS_CHANGED(cls, **kwargs):
        # Force re-execution so each queue batch item advances the pointer
        return time.time()

    def process_queue(
        self,
        pop_mode="Sequential (Loop on End)",
        track_by="Text & Node",
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
            return ("", "", 0, False)

        original_blocks = parse_prompt_blocks(text_str, separator, custom_regex)
        total_count = len(original_blocks)
        if total_count == 0:
            return ("", "", 0, False)

        # Calculate stable hashes of the complete input text and of the splitting
        # configuration. Two nodes sharing text but using different separators must
        # never share a run pointer.
        text_hash = hashlib.sha256(text_str.strip().encode('utf-8')).hexdigest()[:16]
        config_signature = json.dumps({
            "mode": str(pop_mode),
            "separator": str(separator),
            "regex": str(custom_regex or ""),
        }, sort_keys=True)
        config_hash = hashlib.sha256(config_signature.encode('utf-8')).hexdigest()[:12]

        track_lower = str(track_by or "").lower()
        if "node only" in track_lower:
            # Optional legacy-style tracking: one pointer per graph node, shared
            # across text edits and splitter changes.
            state_key = f"node_{unique_id}"
        else:
            state_key = f"node_{unique_id}_{config_hash}_{text_hash}"

        current_prompt_id = get_current_prompt_id()

        # Load state fresh from disk (no stale memory cache)
        state = load_state()
        node_state = state.get(state_key)

        current_index = 0
        assigned_prompts = {}
        shuffled_order = []
        if isinstance(node_state, dict):
            try:
                current_index = max(0, int(node_state.get("index", 0)))
            except (TypeError, ValueError):
                current_index = 0
            raw_assigned = node_state.get("assigned_prompts", {})
            if isinstance(raw_assigned, dict):
                assigned_prompts = dict(raw_assigned)
            sanitized = _sanitize_shuffle_order(node_state.get("shuffled_order", []), total_count)
            if sanitized is not None:
                shuffled_order = sanitized
        elif isinstance(node_state, int):
            current_index = max(0, node_state)

        is_stop_mode = pop_mode == "Sequential (Stop on End)"
        is_random_keep = pop_mode in ["Random (Keep)", "Random (Delete)"]
        is_random_cycle = pop_mode in ["Random (Cycle)"]

        if is_random_cycle and not shuffled_order:
            shuffled_order = list(range(total_count))
            random.shuffle(shuffled_order)

        exhausted = False
        remaining_count = 0
        remaining_text = ""

        # Check if this prompt_id was already assigned an index (e.g. recovered from persistent queue / retry)
        retry_assignment = current_prompt_id and current_prompt_id in assigned_prompts
        if retry_assignment:
            try:
                idx = int(assigned_prompts[current_prompt_id]) % total_count
            except (TypeError, ValueError):
                idx = current_index % total_count
            selected_prompt = original_blocks[idx]
            next_index = current_index  # Keep current index without double-advancing
            # Refresh recency so long queues do not evict actively retried prompts.
            _remember_assignment(assigned_prompts, current_prompt_id, idx)
        else:
            # Select prompt based on mode and calculate next index
            if pop_mode in ["Sequential (Loop on End)", "Cycle / Loop", "Pop Top & Delete"]:
                idx = current_index % total_count
                selected_prompt = original_blocks[idx]
                next_index = (current_index + 1) % total_count
            elif is_stop_mode:
                if current_index >= total_count:
                    idx = total_count - 1
                    selected_prompt = original_blocks[idx]
                    next_index = total_count
                else:
                    idx = current_index
                    selected_prompt = original_blocks[idx]
                    next_index = current_index + 1
            elif is_random_keep:
                idx = random.randint(0, total_count - 1)
                selected_prompt = original_blocks[idx]
                next_index = current_index + 1
            elif is_random_cycle:
                cycle_index = current_index % total_count
                if len(shuffled_order) != total_count or (cycle_index == 0 and current_index > 0):
                    shuffled_order = list(range(total_count))
                    random.shuffle(shuffled_order)
                idx = shuffled_order[cycle_index]
                selected_prompt = original_blocks[idx]
                next_index = (current_index + 1) % total_count
            else: # Default fallback
                idx = current_index % total_count
                selected_prompt = original_blocks[idx]
                next_index = (current_index + 1) % total_count

            _remember_assignment(assigned_prompts, current_prompt_id, idx)

        # Calculate progress and the real remaining set for every mode.
        if is_random_cycle:
            try:
                cycle_position = shuffled_order.index(idx)
            except ValueError:
                cycle_position = idx
            display_run = cycle_position + 1
            remaining_blocks = [original_blocks[i] for i in shuffled_order[cycle_position + 1:]]
            remaining_count = len(remaining_blocks)
        elif is_random_keep:
            # Random (Keep) never consumes prompts and has no deterministic order.
            display_run = idx + 1 if retry_assignment else (current_index % total_count) + 1
            remaining_blocks = []
            remaining_count = 0
        else:
            display_run = idx + 1
            remaining_blocks = original_blocks[idx + 1:]
            remaining_count = len(remaining_blocks)

        if is_stop_mode and remaining_count == 0:
            exhausted = True

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
        remaining_text = join_delim.join(remaining_blocks)

        # Update state dictionary
        new_entry = {
            "index": next_index,
            "total": total_count,
            "last_run": display_run,
            "last_updated": int(time.time()),
            "preview": selected_prompt[:60].replace('\n', ' '),
            "assigned_prompts": assigned_prompts
        }
        if is_random_cycle:
            new_entry["shuffled_order"] = shuffled_order
        state[state_key] = new_entry

        # Keep at most 3 most recent text hashes/configs per node_id
        node_prefix = f"node_{unique_id}_"
        node_keys = [k for k in state.keys() if k.startswith(node_prefix)]
        if len(node_keys) > 3:
            node_keys.sort(key=lambda k: _entry_timestamp(state[k]))
            for old_k in node_keys[:-3]:
                del state[old_k]

        save_state(state)

        # Send live progress update to UI
        progress_data = {
            "node_id": str(unique_id),
            "current_run": display_run,
            "total_runs": total_count,
            "status_text": f"Run {display_run} / {total_count}"
        }
        try:
            PromptServer.instance.send_sync("saturnnodes_prompt_iterator_progress", progress_data)
        except Exception:
            pass

        return (selected_prompt, remaining_text, remaining_count, exhausted)

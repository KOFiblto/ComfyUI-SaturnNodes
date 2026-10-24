"""
Generation-time tracking for SaturnNodes asset restoration.

ComfyUI measures prompt execution duration in main.py but only logs it; it is
not persisted in history or PNG metadata. This module wraps PromptQueue.get /
task_done once and records duration + output filenames in a small JSON file so
restored history entries can show a real execution time.
"""

import os
import json
import math
import time
import threading
from .utils import get_saturnnodes_user_dir

USER_DIR = get_saturnnodes_user_dir()
GENERATION_TIMES_FILE = os.path.join(USER_DIR, "generation_times.json")
MAX_ENTRIES = 1000

_LOCK = threading.RLock()
_DATA = None
_DATA_MTIME = None
_START_TIMES = {}
_PATCHED = False


def _entry_timestamp(entry):
    if not isinstance(entry, dict):
        return 0
    try:
        value = int(entry.get("completed", 0))
    except (TypeError, ValueError, OverflowError):
        return 0
    return value if value >= 0 else 0


def _load_data():
    global _DATA, _DATA_MTIME
    with _LOCK:
        mtime = None
        try:
            if os.path.exists(GENERATION_TIMES_FILE):
                mtime = os.stat(GENERATION_TIMES_FILE).st_mtime_ns
        except OSError:
            mtime = None
        if _DATA is not None and mtime == _DATA_MTIME:
            return _DATA

        data = {"version": 1, "entries": {}}
        if mtime is not None:
            try:
                with open(GENERATION_TIMES_FILE, "r", encoding="utf-8") as f:
                    loaded = json.load(f)
                if isinstance(loaded, dict) and isinstance(loaded.get("entries"), dict):
                    data = loaded
                    data.setdefault("version", 1)
            except Exception:
                pass
        _DATA = data
        _DATA_MTIME = mtime
        return _DATA


def _save_data(data):
    global _DATA_MTIME
    temp_file = None
    try:
        os.makedirs(USER_DIR, exist_ok=True)
        # Unique temp names keep a stale temp file from a crashed process (or a
        # second ComfyUI instance) from being clobbered mid-write.
        temp_file = f"{GENERATION_TIMES_FILE}.{os.getpid()}.{threading.get_ident()}.tmp"
        with open(temp_file, "w", encoding="utf-8") as f:
            json.dump(data, f, separators=(",", ":"), ensure_ascii=False, allow_nan=False)
            f.flush()
            try:
                os.fsync(f.fileno())
            except OSError:
                pass
        for attempt in range(3):
            try:
                os.replace(temp_file, GENERATION_TIMES_FILE)
                temp_file = None
                break
            except PermissionError:
                if attempt == 2:
                    raise
                time.sleep(0.05)
        try:
            _DATA_MTIME = os.stat(GENERATION_TIMES_FILE).st_mtime_ns
        except OSError:
            _DATA_MTIME = None
    except Exception as e:
        print(f"[SaturnNodes] Error saving generation times: {e}")
    finally:
        if temp_file and os.path.exists(temp_file):
            try:
                os.remove(temp_file)
            except OSError:
                pass


def _normalize_ref(filename, subfolder=""):
    sub = str(subfolder or "").replace("\\", "/").strip("/")
    name = str(filename or "").replace("\\", "/").strip("/")
    return f"{sub}/{name}" if sub else name


def record_generation_time(prompt_id, duration, files, status="success"):
    """Store one prompt's wall-clock duration keyed by every output file."""
    try:
        duration = round(float(duration), 3)
    except (TypeError, ValueError, OverflowError):
        return
    if not math.isfinite(duration) or duration < 0 or not files:
        return

    completed_ms = int(time.time() * 1000)
    with _LOCK:
        data = _load_data()
        entries = data.setdefault("entries", {})
        for file_info in files:
            if not isinstance(file_info, dict):
                continue
            filename = file_info.get("filename")
            if not filename:
                continue
            key = _normalize_ref(filename, file_info.get("subfolder", ""))
            entries[key] = {
                "duration": duration,
                "completed": completed_ms,
                "prompt_id": str(prompt_id) if prompt_id else "",
                "status": str(status) if status is not None else "success",
            }

        if len(entries) > MAX_ENTRIES:
            keep = set(sorted(entries.keys(), key=lambda k: _entry_timestamp(entries[k]), reverse=True)[:MAX_ENTRIES])
            for key in [k for k in entries.keys() if k not in keep]:
                del entries[key]

        _save_data(data)


def get_generation_time(filename, subfolder="", file_mtime=None):
    """Return the recorded duration in seconds for an output file, or None.

    ``file_mtime`` (seconds since epoch) is optional and only used for the
    moved-file fallback. It prevents two different files that happen to share a
    bare filename from being assigned each other's duration.
    """
    if not filename:
        return None
    key = _normalize_ref(filename, subfolder)
    with _LOCK:
        entries = _load_data().get("entries", {})
        entry = entries.get(key)
        if entry is None:
            bare = str(filename).replace("\\", "/").strip("/")
            matches = [
                (k, v) for k, v in entries.items()
                if k == bare or k.endswith("/" + bare)
            ]
            if file_mtime is not None:
                try:
                    mtime_ms = float(file_mtime) * 1000.0
                    matches = [
                        (k, v) for k, v in matches
                        if abs(_entry_timestamp(v) - mtime_ms) <= 300000
                    ]
                except (TypeError, ValueError):
                    pass
            # Only use the fallback when exactly one record can belong to this
            # file. Guessing between same-named outputs is worse than showing
            # no duration at all.
            if len(matches) == 1:
                entry = matches[0][1]
        if isinstance(entry, dict):
            try:
                duration = float(entry.get("duration"))
            except (TypeError, ValueError, OverflowError):
                return None
            if math.isfinite(duration) and duration >= 0:
                return duration
        return None
    return None


def get_generation_time_debug():
    with _LOCK:
        entries = _load_data().get("entries", {})
        return {"recorded_files": len(entries), "max_entries": MAX_ENTRIES}


def _extract_output_files(history_result):
    files = []
    if not isinstance(history_result, dict):
        return files
    outputs = history_result.get("outputs")
    if not isinstance(outputs, dict):
        return files
    for node_output in outputs.values():
        if not isinstance(node_output, dict):
            continue
        for image in node_output.get("images", []) or []:
            if not isinstance(image, dict) or not image.get("filename"):
                continue
            # Only permanently saved outputs are eligible for restored-asset
            # history entries. Temporary previews can share filenames.
            if image.get("type", "output") != "output":
                continue
            files.append({
                "filename": image.get("filename"),
                "subfolder": image.get("subfolder", ""),
                "type": "output",
            })
    return files


def patch_prompt_queue(server):
    """Wrap PromptQueue.get/task_done once to measure real execution durations."""
    global _PATCHED
    if _PATCHED:
        return
    queue = getattr(server, "prompt_queue", None)
    if queue is None or not hasattr(queue, "get") or not hasattr(queue, "task_done"):
        return
    if getattr(queue, "_saturnnodes_time_patched", False):
        _PATCHED = True
        return

    original_get = queue.get

    def timed_get(*args, **kwargs):
        item = original_get(*args, **kwargs)
        if item is not None:
            try:
                # ComfyUI's PromptQueue.get returns (queue_item, task_id).
                # Support a bare queue item as well for lightweight/legacy
                # queue implementations used by tests or custom servers.
                queue_item = item[0] if (
                    isinstance(item, (tuple, list))
                    and len(item) == 2
                    and isinstance(item[0], (tuple, list))
                ) else item
                prompt_id = str(queue_item[1]) if (
                    isinstance(queue_item, (tuple, list)) and len(queue_item) > 1
                ) else None
                if prompt_id:
                    with _LOCK:
                        _START_TIMES[prompt_id] = time.time()
                        while len(_START_TIMES) > 2000:
                            _START_TIMES.pop(next(iter(_START_TIMES)))
            except Exception:
                pass
        return item

    original_task_done = queue.task_done

    def timed_task_done(item_id, history_result, status=None, process_item=None):
        prompt_id = None
        try:
            mutex = getattr(queue, "mutex", None)
            if mutex:
                with mutex:
                    running = queue.currently_running.get(item_id)
            else:
                running = queue.currently_running.get(item_id)
            if isinstance(running, (tuple, list)) and len(running) > 1:
                prompt_id = str(running[1])
        except Exception:
            prompt_id = None

        started = None
        with _LOCK:
            if prompt_id:
                started = _START_TIMES.pop(prompt_id, None)

        try:
            return original_task_done(item_id, history_result, status, process_item)
        finally:
            if prompt_id and started is not None:
                status_str = getattr(status, "status_str", status)
                record_generation_time(
                    prompt_id,
                    max(0.0, time.time() - started),
                    _extract_output_files(history_result),
                    status=status_str,
                )

    queue.get = timed_get
    queue.task_done = timed_task_done
    try:
        queue._saturnnodes_time_patched = True
    except Exception:
        pass
    _PATCHED = True

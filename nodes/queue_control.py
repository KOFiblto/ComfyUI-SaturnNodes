import os
import json
import secrets
import time
import threading
import asyncio
import atexit
from aiohttp import web
from server import PromptServer
import nodes
from .tray_icon import TrayIconManager, is_tray_icon_enabled
from .assets_restore import assets_restore_manager, is_assets_restore_enabled, get_assets_restore_count
from .generation_times import patch_prompt_queue as patch_generation_times
from .utils import get_saturnnodes_user_dir, is_local_request, is_authenticated_local_request, get_env_setting

QUEUE_CATEGORY = "🪐 SaturnNodes/Queue"

CURRENT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
USER_DIR = get_saturnnodes_user_dir()
PERSISTENT_FILE = os.path.join(USER_DIR, "persistent_queue.json")

# Versioned envelope for persistent_queue.json. Bump this when the persisted
# entry shape changes and add a migration branch in
# PersistentQueueManager._normalize_persisted_payload().
PERSISTENT_QUEUE_SCHEMA_VERSION = 1

def is_persistent_queue_enabled():
    val = get_env_setting("ENABLE_PERSISTENT_QUEUE", "true").lower()
    return val in ["true", "1", "yes"]

def is_process_management_enabled():
    val = get_env_setting("ALLOW_PROCESS_MANAGEMENT", "false").lower()
    return val in ["true", "1", "yes"]

class PauseQueueManager:
    def __init__(self):
        default_state = get_env_setting("DEFAULT_PAUSE_STATE", "Running")
        default_mode = get_env_setting("DEFAULT_PAUSE_MODE", "after_finish")
        self.persist_state = get_env_setting("PERSIST_PAUSE_STATE", "false").lower() in ["true", "1", "yes"]
        self.state_file = os.path.join(USER_DIR, "pause_state.json")

        paused = (default_state.lower() != "running")
        mode = "instantly" if "instant" in default_mode.lower() else "after_finish"

        if self.persist_state and os.path.exists(self.state_file):
            try:
                with open(self.state_file, "r", encoding="utf-8") as f:
                    saved = json.load(f)
                if isinstance(saved, dict):
                    paused = bool(saved.get("paused", paused))
                    saved_mode = str(saved.get("mode", mode))
                    mode = "instantly" if "instant" in saved_mode.lower() else "after_finish"
            except Exception:
                pass

        self.paused = paused
        self.mode = mode
        self.is_waiting = self.paused
        self.event = threading.Event()
        if not self.paused:
            self.event.set()
        else:
            self.event.clear()
        self._patched = False

    def _persist_pause_state(self):
        if not self.persist_state:
            return
        try:
            os.makedirs(USER_DIR, exist_ok=True)
            temp_file = self.state_file + ".tmp"
            with open(temp_file, "w", encoding="utf-8") as f:
                json.dump({"paused": bool(self.paused), "mode": self.mode}, f)
            os.replace(temp_file, self.state_file)
        except Exception:
            pass

    def patch_all(self):
        if self._patched:
            return
        server = getattr(PromptServer, "instance", None)
        if not server:
            print("[SaturnNodes] Queue control: Skipped pause patching (PromptServer instance not ready).")
            return

        if not hasattr(server, "prompt_queue") or not hasattr(server.prompt_queue, "get"):
            print("[SaturnNodes] Queue control: Skipped patching prompt_queue.get (incompatible ComfyUI version).")
            return

        queue = server.prompt_queue
        original_get = queue.get

        def patched_get(*args, **kwargs):
            caller_timeout = args[0] if args else kwargs.get("timeout", None)
            caller_blocks = caller_timeout is None
            while True:
                # 1. If queue is paused, wait BEFORE popping any item from the queue!
                # This guarantees that ComfyUI never sets currently_running, never sends
                # execution_start, and never starts the elapsed timer while waiting.
                if self.paused:
                    if not self.is_waiting:
                        self.is_waiting = True
                        print("[SaturnNodes PauseQueue] Workflow paused: Queue is paused, waiting before next workflow.")
                        self.notify_clients()
                    while self.paused:
                        try:
                            import comfy.model_management as mm
                            if hasattr(mm, "processing_interrupted") and mm.processing_interrupted():
                                break
                        except Exception:
                            pass
                        self.event.wait(0.2)
                    self.is_waiting = False
                    self.notify_clients()

                # 2. Use a short timeout (0.5s) when polling for items so that if the user
                # enables pause while the queue is idle, we don't remain stuck inside
                # a blocking original_get() that would prematurely pop an incoming workflow.
                kwargs_copy = dict(kwargs)
                if "timeout" not in kwargs_copy and len(args) == 0:
                    kwargs_copy["timeout"] = 0.5

                item = original_get(*args, **kwargs_copy)
                if item is not None:
                    return item

                # Honor a finite caller timeout. Returning None lets ComfyUI's main
                # loop run its scheduled GC pass and avoids a busy spin when a
                # timeout of 0.0 is requested.
                if self.paused:
                    continue
                if not caller_blocks:
                    return None

        queue.get = patched_get

        if hasattr(server, "send_sync") and callable(server.send_sync):
            original_send_sync = server.send_sync

            def patched_send_sync(event, data, sid=None):
                result = original_send_sync(event, data, sid)
                if event == "executing" and isinstance(data, dict) and data.get("node") is not None:
                    if self.paused and self.mode == "instantly":
                        if not self.is_waiting:
                            self.is_waiting = True
                            print(f"[SaturnNodes PauseQueue] Workflow Paused Instant: Paused before executing node '{data.get('node')}'.")
                            self.notify_clients()
                        while self.paused and self.mode == "instantly":
                            # Check for user cancellation or interrupt while paused
                            try:
                                import comfy.model_management as mm
                                if hasattr(mm, "processing_interrupted") and mm.processing_interrupted():
                                    self.paused = False
                                    self.is_waiting = False
                                    self.event.set()
                                    self._persist_pause_state()
                                    self.notify_clients()
                                    if hasattr(mm, "throw_exception_if_processing_interrupted"):
                                        mm.throw_exception_if_processing_interrupted()
                                    break
                            except Exception as err:
                                if "InterruptProcessingException" in type(err).__name__:
                                    raise

                            if not self.is_currently_executing():
                                self.is_waiting = False
                                self.notify_clients()
                                break

                            self.event.wait(0.2)
                        self.is_waiting = False
                        self.notify_clients()
                return result

            server.send_sync = patched_send_sync
        else:
            print("[SaturnNodes] Queue control: Skipped patching send_sync (not found on server).")

        self._patched = True

    def is_currently_executing(self):
        try:
            server = PromptServer.instance
            if hasattr(server, "prompt_queue"):
                return bool(server.prompt_queue.currently_running)
        except Exception:
            pass
        return False

    def set_pause(self, paused, mode=None):
        self.paused = paused
        if mode:
            self.mode = mode

        if self.paused:
            if not self.is_currently_executing():
                self.is_waiting = True
                if self.mode == "instantly":
                    print("[SaturnNodes PauseQueue] Workflow Paused Instant: Queue is empty/idle, pause active.")
                else:
                    print("[SaturnNodes PauseQueue] Workflow paused after this run: Queue is empty/idle, pause active.")
            else:
                self.is_waiting = False
                if self.mode == "instantly":
                    print("[SaturnNodes PauseQueue] Workflow Paused Instant requested. Waiting for current node to complete...")
                else:
                    print("[SaturnNodes PauseQueue] Workflow paused after this run requested. Will pause when current workflow completes...")
            self.event.clear()
        else:
            self.is_waiting = False
            self.event.set()
            print("[SaturnNodes PauseQueue] Continue pressed: Resuming execution.")

        self.notify_clients()
        self._persist_pause_state()

        try:
            server = getattr(PromptServer, "instance", None)
            if server and hasattr(server, "prompt_queue"):
                pq = server.prompt_queue
                if hasattr(pq, "not_empty") and hasattr(pq, "mutex"):
                    # Use non-blocking acquire to avoid deadlock if worker thread is locked
                    acquired = pq.mutex.acquire(blocking=False)
                    if acquired:
                        try:
                            pq.not_empty.notify_all()
                        finally:
                            pq.mutex.release()
                    else:
                        def _notify_async():
                            try:
                                with pq.mutex:
                                    pq.not_empty.notify_all()
                            except Exception:
                                pass
                        threading.Thread(target=_notify_async, daemon=True).start()
        except Exception:
            pass

    def set_mode(self, mode):
        self.mode = mode
        print(f"[SaturnNodes PauseQueue] Selected pause mode: '{self.mode}'")
        self._persist_pause_state()
        self.notify_clients()

    def notify_clients(self):
        try:
            PromptServer.instance.send_sync("pause_queue_status", {
                "paused": self.paused,
                "mode": self.mode,
                "waiting": self.is_waiting
            })
        except Exception:
            pass

        try:
            if 'tray_manager' in globals() and tray_manager:
                tray_manager.update_status()
        except Exception:
            pass

class PersistentQueueManager:
    MAX_BATCH_META = 500
    MAX_RECENTLY_FINISHED = 500
    SAVE_DEBOUNCE_SECONDS = 0.25

    def __init__(self):
        self.lock = threading.RLock()
        self.persistent_items = []
        self.batch_meta = {}
        self.batch_meta_updated = {}
        self.recently_finished = {}
        self.is_restoring = False
        self._patched = False
        self.has_claimed_once = False
        self._save_timer = None
        self._save_dirty = False
        # Set when persistent_queue.json was written by a newer SaturnNodes.
        # In that case the file is read-only for this process so a downgrade
        # cannot destroy a queue whose entry shape we do not understand.
        self._read_only_newer_schema = False
        self.load_from_file()

    @staticmethod
    def _normalize_entry(raw):
        """Return one repaired persistence entry, or ``None`` if unusable.

        The top-level ``prompt_id`` is authoritative because it is the
        persistence key used by add/remove. The queued item is only a fallback
        for legacy or hand-edited entries that lack it. The restore path
        re-syncs ``item[1]`` before queueing so task completion removes the
        matching persistence entry.
        """
        if not isinstance(raw, dict):
            return None
        item = raw.get("item")
        if not isinstance(item, (list, tuple)) or len(item) < 2:
            return None

        item_list = list(item)
        item_pid = item_list[1]
        entry_pid = raw.get("prompt_id")

        # The top-level prompt_id is the persistence key. Fall back to the
        # queued item only for legacy/hand-edited entries that lack it. The
        # restore path re-syncs item[1] before queueing so task_done can always
        # find and remove the matching persistence entry.
        if entry_pid is None or entry_pid == "":
            if item_pid is None or item_pid == "":
                return None
            entry_pid = str(item_pid)
        else:
            entry_pid = str(entry_pid)

        entry = dict(raw)
        entry["prompt_id"] = entry_pid
        entry["item"] = item_list
        return entry

    @classmethod
    def _normalize_items(cls, items):
        """Repair entries and drop duplicate prompt ids, keeping the last one."""
        normalized = {}
        changed = False
        for raw in items:
            entry = cls._normalize_entry(raw)
            if entry is None:
                changed = True
                continue
            pid = entry["prompt_id"]
            if pid in normalized:
                # add_item() replaces the old entry and appends the new one;
                # mirror that "last occurrence wins" rule on load.
                normalized.pop(pid, None)
                changed = True
            normalized[pid] = entry
            if entry != raw:
                changed = True
        return list(normalized.values()), changed

    @classmethod
    def _normalize_persisted_payload(cls, data):
        """Return ``(items, needs_rewrite, is_foreign)`` for persisted payloads.

        - v1 files (pre-2.6.2) are a bare list and are migrated on load.
        - Current files are ``{"schema_version": 1, "items": [...]}``.
        - A file written by a newer SaturnNodes is reported as foreign so the
          caller can keep it read-only instead of destroying a queue it cannot
          understand.
        """
        if isinstance(data, dict):
            version = data.get("schema_version")
            items = data.get("items")
            if not isinstance(items, list):
                return [], False, False
            if isinstance(version, int) and version > PERSISTENT_QUEUE_SCHEMA_VERSION:
                print(
                    "[SaturnNodes PersistentQueue] persistent_queue.json was written by a newer "
                    f"SaturnNodes (schema {version} > {PERSISTENT_QUEUE_SCHEMA_VERSION}); "
                    "leaving it untouched."
                )
                return [], False, True
            normalized, changed = cls._normalize_items(items)
            return (
                normalized,
                version != PERSISTENT_QUEUE_SCHEMA_VERSION or changed,
                False,
            )

        if isinstance(data, list):
            # Legacy bare-list format.
            normalized, _ = cls._normalize_items(data)
            return normalized, True, False

        return [], False, False

    def load_from_file(self):
        with self.lock:
            self._read_only_newer_schema = False
            self.batch_meta = {}
            self.batch_meta_updated = {}
            if not os.path.exists(PERSISTENT_FILE):
                self.persistent_items = []
                self._prune_batch_meta_locked()
                return
            try:
                with open(PERSISTENT_FILE, "r", encoding="utf-8") as f:
                    data = json.load(f)
                items, needs_rewrite, is_foreign = self._normalize_persisted_payload(data)
                self._read_only_newer_schema = is_foreign
                self.persistent_items = items
                for x in self.persistent_items:
                    batch_info = x.get("batch_info")
                    if isinstance(batch_info, dict) and "prompt_id" in x:
                        pid = str(x["prompt_id"])
                        self.batch_meta[pid] = batch_info
                        self.batch_meta_updated[pid] = time.time()
                if needs_rewrite:
                    # Rewrite once so the legacy bare-list shape is not read
                    # forever. _write_locked() is a no-op while persistence is
                    # disabled, in which case the migration is retried later.
                    self._save_dirty = True
                    self._write_locked()
            except Exception as e:
                print(f"[SaturnNodes PersistentQueue] Error loading persistent queue file: {e}")
                self.persistent_items = []
            self._prune_batch_meta_locked()

    def _prune_batch_meta_locked(self):
        if len(self.batch_meta) <= self.MAX_BATCH_META:
            return
        active_ids = {str(x.get("prompt_id")) for x in self.persistent_items}
        removable = sorted(
            (pid for pid in self.batch_meta if pid not in active_ids),
            key=lambda pid: self.batch_meta_updated.get(pid, 0),
        )
        for pid in removable:
            if len(self.batch_meta) <= self.MAX_BATCH_META:
                break
            self.batch_meta.pop(pid, None)
            self.batch_meta_updated.pop(pid, None)

    def _mark_finished_locked(self, pid_str):
        self.recently_finished.pop(pid_str, None)
        self.recently_finished[pid_str] = time.time()
        while len(self.recently_finished) > self.MAX_RECENTLY_FINISHED:
            self.recently_finished.pop(next(iter(self.recently_finished)))

    def set_batch_info(self, prompt_id, batch_info):
        if prompt_id is None or prompt_id == "" or not isinstance(batch_info, dict):
            return
        pid_str = str(prompt_id)
        with self.lock:
            # Late syncs from another client must not resurrect metadata for a
            # prompt that already finished (the id is single-use).
            if pid_str in self.recently_finished:
                return
            self.batch_meta[pid_str] = batch_info
            self.batch_meta_updated[pid_str] = time.time()
            for item in self.persistent_items:
                if str(item.get("prompt_id")) == pid_str:
                    item["batch_info"] = batch_info
                    break
            self._prune_batch_meta_locked()
        if is_persistent_queue_enabled():
            self.save_to_file()

    def save_to_file(self, immediate=False):
        if not is_persistent_queue_enabled():
            return
        with self.lock:
            self._save_dirty = True
            if immediate:
                self._write_locked()
            else:
                self._schedule_save_locked()

    def _schedule_save_locked(self):
        if self._save_timer is not None and self._save_timer.is_alive():
            return
        self._save_timer = threading.Timer(self.SAVE_DEBOUNCE_SECONDS, self._flush_timer)
        self._save_timer.daemon = True
        self._save_timer.start()

    def _flush_timer(self):
        with self.lock:
            self._write_locked()

    def _write_locked(self):
        if not self._save_dirty:
            return
        if self._read_only_newer_schema:
            # Never overwrite a queue file produced by a newer SaturnNodes.
            self._save_dirty = False
            return
        if not is_persistent_queue_enabled():
            self._save_dirty = False
            return
        try:
            os.makedirs(USER_DIR, exist_ok=True)
            temp_file = PERSISTENT_FILE + ".tmp"
            payload = {
                "schema_version": PERSISTENT_QUEUE_SCHEMA_VERSION,
                "items": self.persistent_items,
            }
            with open(temp_file, "w", encoding="utf-8") as f:
                json.dump(payload, f, separators=(",", ":"), default=str)
                f.flush()
                try:
                    os.fsync(f.fileno())
                except OSError:
                    pass
            # Windows can transiently lock the destination (antivirus, indexer,
            # backup). Retry briefly instead of dropping the save.
            for attempt in range(3):
                try:
                    os.replace(temp_file, PERSISTENT_FILE)
                    break
                except PermissionError:
                    if attempt == 2:
                        raise
                    time.sleep(0.05)
            self._save_dirty = False
        except Exception as e:
            print(f"[SaturnNodes PersistentQueue] Error saving persistent queue file: {e}")

    def flush(self):
        """Force any pending debounced write (used on shutdown)."""
        with self.lock:
            self._write_locked()

    def add_item(self, item_tuple):
        if self.is_restoring or not is_persistent_queue_enabled():
            return
        try:
            if isinstance(item_tuple, (tuple, list)):
                item_list = list(item_tuple)
                prompt_id = item_list[1] if len(item_list) > 1 else None
                if prompt_id is None or prompt_id == "":
                    return
                pid_str = str(prompt_id)
                entry = {
                    "prompt_id": pid_str,
                    "item": item_list
                }
                if pid_str in self.batch_meta:
                    entry["batch_info"] = self.batch_meta[pid_str]
                with self.lock:
                    self.recently_finished.pop(pid_str, None)
                    self.persistent_items = [x for x in self.persistent_items if str(x.get("prompt_id")) != pid_str]
                    self.persistent_items.append(entry)
                self.save_to_file()
                if self._read_only_newer_schema:
                    print(
                        f"[SaturnNodes PersistentQueue] Queue file uses a newer schema; "
                        f"prompt {pid_str} kept in memory only."
                    )
                else:
                    print(f"[SaturnNodes PersistentQueue] Persisted prompt {pid_str} to disk.")
        except Exception as e:
            print(f"[SaturnNodes PersistentQueue] Error formatting queue item for persistence: {e}")

    def remove_item(self, prompt_id):
        if prompt_id is None or prompt_id == "":
            return
        pid_str = str(prompt_id)
        with self.lock:
            initial_count = len(self.persistent_items)
            self.persistent_items = [x for x in self.persistent_items if str(x.get("prompt_id")) != pid_str]
            self.batch_meta.pop(pid_str, None)
            self.batch_meta_updated.pop(pid_str, None)
            self._mark_finished_locked(pid_str)
            changed = len(self.persistent_items) != initial_count
        if changed and is_persistent_queue_enabled():
            self.save_to_file()
            print(f"[SaturnNodes PersistentQueue] Removed prompt {pid_str} from disk.")

    def wipe_all(self):
        with self.lock:
            self.persistent_items = []
            self.batch_meta = {}
            self.batch_meta_updated = {}
        if is_persistent_queue_enabled():
            self.save_to_file(immediate=True)
        print("[SaturnNodes PersistentQueue] Cleared all saved queue items.")

    def patch_server(self):
        if self._patched:
            return
        if not is_persistent_queue_enabled():
            print("[SaturnNodes] Persistent queue disabled in settings; core prompt_queue patching skipped.")
            return
        server = getattr(PromptServer, "instance", None)
        if not server or not hasattr(server, "prompt_queue"):
            print("[SaturnNodes] Queue control: Skipped persistent queue patching (prompt_queue not found on server).")
            return

        queue = server.prompt_queue
        if not hasattr(queue, "put") or not hasattr(queue, "task_done"):
            print("[SaturnNodes] Queue control: Skipped persistent queue patching (incompatible queue interface).")
            return

        # 1. Patch queue.put
        original_put = queue.put
        def patched_put(item, *args, **kwargs):
            res = original_put(item, *args, **kwargs)
            self.add_item(item)
            return res
        queue.put = patched_put

        # 2. Patch queue.task_done (Guaranteed cleanup on task completion / error / interrupt)
        if hasattr(queue, "task_done"):
            original_task_done = queue.task_done
            def patched_task_done(item_id, history_result, status, process_item=None):
                prompt_id = None
                try:
                    with queue.mutex:
                        if item_id in queue.currently_running:
                            running_item = queue.currently_running[item_id]
                            if isinstance(running_item, (tuple, list)) and len(running_item) > 1:
                                prompt_id = running_item[1]
                except Exception:
                    pass

                res = original_task_done(item_id, history_result, status, process_item)

                if prompt_id:
                    self.remove_item(prompt_id)
                return res
            queue.task_done = patched_task_done

        # 3. Patch queue.delete_queue_item
        if hasattr(queue, "delete_queue_item"):
            original_delete = queue.delete_queue_item
            def patched_delete(fn, *args, **kwargs):
                to_delete = []
                try:
                    with queue.mutex:
                        to_delete = [item[1] for item in queue.queue if fn(item) and len(item) > 1]
                except Exception:
                    to_delete = []
                res = original_delete(fn, *args, **kwargs)
                # Only forget persistence after the in-memory delete succeeded;
                # otherwise a failed cancel would silently lose crash recovery.
                for pid in to_delete:
                    self.remove_item(pid)
                return res
            queue.delete_queue_item = patched_delete

        # 4. Patch queue.wipe_queue
        if hasattr(queue, "wipe_queue"):
            original_wipe = queue.wipe_queue
            def patched_wipe(*args, **kwargs):
                res = original_wipe(*args, **kwargs)
                # Clear persistence only after ComfyUI accepted the wipe.
                self.wipe_all()
                return res
            queue.wipe_queue = patched_wipe

        # 5. Redundant websocket event hooks
        original_send_sync = server.send_sync
        def patched_send_sync(event, data, sid=None):
            try:
                if isinstance(data, dict):
                    prompt_id = data.get("prompt_id")
                    if prompt_id:
                        if event == "executing" and data.get("node") is None:
                            self.remove_item(prompt_id)
                        elif event in ("execution_interrupted", "execution_error"):
                            self.remove_item(prompt_id)
            except Exception:
                pass
            return original_send_sync(event, data, sid)
        server.send_sync = patched_send_sync

        self._patched = True

    def restore_queue(self, active_client_id=None):
        if self.has_claimed_once:
            return

        if not is_persistent_queue_enabled():
            print("[SaturnNodes PersistentQueue] Auto-recovery is disabled in settings.")
            self.has_claimed_once = True
            return

        server = PromptServer.instance
        if not hasattr(server, "prompt_queue") or not self.persistent_items:
            self.has_claimed_once = True
            return

        restored_state_setting = str(
            get_env_setting("PERSISTENT_QUEUE_RESTORED_STATE", "Match Default")
        ).strip().lower()
        if restored_state_setting == "force paused":
            pause_manager.set_pause(True)
        elif restored_state_setting == "force running":
            pause_manager.set_pause(False)

        # Repair duplicates/mismatched prompt ids before restoring. A
        # hand-edited file must never queue the same prompt twice or leave an
        # entry that task_done cannot remove.
        with self.lock:
            normalized, repaired = self._normalize_items(list(self.persistent_items))
            if repaired:
                self.persistent_items = normalized
                self._save_dirty = True
        if repaired:
            self.save_to_file(immediate=True)

        snapshot = list(self.persistent_items)
        if not snapshot:
            self.has_claimed_once = True
            return

        print(f"[SaturnNodes PersistentQueue] Restoring {len(snapshot)} saved queue item(s) to client '{active_client_id}'...")
        try:
            max_retries = int(get_env_setting("PERSISTENT_QUEUE_MAX_RETRIES", "0"))
        except (TypeError, ValueError, OverflowError):
            max_retries = 0
        max_retries = max(0, min(10, max_retries))
        self.is_restoring = True
        max_number = 0
        restored_count = 0
        state_changed = repaired
        # Restored jobs all used to receive the exact same create_time, which
        # left their history order dependent on dict iteration. Keep them
        # strictly increasing and just before "now" so newly queued prompts
        # still sort after every restored one.
        create_time_cursor = int(time.time() * 1000) - len(snapshot)
        try:
            try:
                history = server.prompt_queue.get_history() if hasattr(server.prompt_queue, "get_history") else {}
            except Exception as e:
                print(f"[SaturnNodes PersistentQueue] Could not read history before restore: {e}")
                history = {}
            if not isinstance(history, dict):
                history = {}

            for entry in snapshot:
                if not isinstance(entry, dict):
                    continue
                item_list = entry.get("item")
                if not isinstance(item_list, (list, tuple)):
                    continue
                item_list = list(item_list)
                pid = entry.get("prompt_id")
                if pid is None or pid == "":
                    pid = item_list[1] if len(item_list) > 1 else None
                pid_str = str(pid) if pid is not None and pid != "" else ""

                try:
                    # If this prompt is already in history, it finished previously - drop it
                    if pid_str and pid_str in history:
                        self.remove_item(pid_str)
                        state_changed = True
                        continue

                    if len(item_list) < 3 or not pid_str or not isinstance(item_list[2], dict):
                        # Malformed entry, drop from disk
                        if pid_str:
                            self.remove_item(pid_str)
                            state_changed = True
                        continue

                    # Keep the queued item and the persistence key in lockstep.
                    if item_list[1] != pid_str:
                        item_list[1] = pid_str
                        entry["item"] = item_list
                        state_changed = True

                    if len(item_list) > 3 and isinstance(item_list[3], dict):
                        if active_client_id:
                            item_list[3]["client_id"] = active_client_id
                        # Update create_time so resumed jobs sort as newest in
                        # history & assets, while preserving their queue order.
                        create_time_cursor += 1
                        item_list[3]["create_time"] = create_time_cursor

                    if isinstance(item_list[0], (int, float)):
                        max_number = max(max_number, int(item_list[0]))

                    server.prompt_queue.put(tuple(item_list))
                    if entry.get("retries", 0) != 0:
                        entry["retries"] = 0
                        state_changed = True
                    restored_count += 1
                except Exception as e:
                    try:
                        retries = int(entry.get("retries", 0)) + 1
                    except (TypeError, ValueError, OverflowError):
                        retries = 1
                    if retries > max_retries:
                        print(f"[SaturnNodes PersistentQueue] Error restoring prompt {pid_str}: {e}. Dropping after {retries} attempt(s).")
                        if pid_str:
                            self.remove_item(pid_str)
                    else:
                        print(f"[SaturnNodes PersistentQueue] Error restoring prompt {pid_str}: {e}. Retry {retries}/{max_retries} on next launch.")
                        entry["retries"] = retries
                        state_changed = True
                        self.save_to_file(immediate=True)
        finally:
            self.is_restoring = False
            self.has_claimed_once = True

            # Keep server sequence counter above restored items to avoid priority collisions
            if hasattr(server, "number") and isinstance(server.number, (int, float)):
                server.number = max(server.number, max_number + 1)

        # Sync the updated client_id to the persistent file
        if active_client_id:
            with self.lock:
                for entry in self.persistent_items:
                    item = entry.get("item") if isinstance(entry, dict) else None
                    if isinstance(item, (list, tuple)) and len(item) > 3:
                        if isinstance(item[3], dict):
                            item[3]["client_id"] = active_client_id
                            state_changed = True
        if state_changed:
            self.save_to_file(immediate=True)

        # Broadcast updated queue state to client UI
        try:
            if hasattr(server, "queue_updated"):
                server.queue_updated()
            if hasattr(server, "get_queue_status"):
                server.send_sync("status", {"status": server.get_queue_status()})
        except Exception:
            pass

class PowerControlManager:
    def __init__(self, pause_manager):
        self.pause_manager = pause_manager
        self.pending_action = None  # None | "restart" | "shutdown"
        self.armed_at = None
        self.lock = threading.Lock()
        self._executing = False
        self._loop_thread = None

    def start_watcher(self):
        if self._loop_thread is None:
            self._loop_thread = threading.Thread(target=self._watch_loop, daemon=True)
            self._loop_thread.start()

    def _watch_loop(self):
        import time
        while True:
            time.sleep(1.0)
            if self.pending_action:
                self.check_and_execute()

    def arm(self, action):
        with self.lock:
            if action in ["restart", "shutdown"]:
                if not is_process_management_enabled():
                    print(f"[SaturnNodes Power] Arm rejected: Process Management is disabled in SaturnNodes settings.")
                    return False
                self.pending_action = action
                import time
                self.armed_at = time.time()
                print(f"[SaturnNodes Power] Armed action '{action}' after queue completion.")
            else:
                self.pending_action = None
                self.armed_at = None
                print("[SaturnNodes Power] Cancelled armed queue power action.")
        self.notify_clients()
        return True

    def get_status(self):
        with self.lock:
            return {
                "pending_action": self.pending_action,
                "armed_at": self.armed_at,
                "is_paused": getattr(self.pause_manager, "paused", False) or getattr(self.pause_manager, "is_waiting", False),
                "enabled": is_process_management_enabled()
            }

    def notify_clients(self):
        try:
            status = self.get_status()
            PromptServer.instance.send_sync("saturnnodes_power_status", status)
        except Exception:
            pass

    def check_and_execute(self):
        with self.lock:
            if not self.pending_action or self._executing:
                return

            # CRITICAL: If process management is disabled, cancel and abort
            if not is_process_management_enabled():
                self.pending_action = None
                return

            # CRITICAL: If pause mode is active or waiting, DO NOT execute!
            is_paused = getattr(self.pause_manager, "paused", False) or getattr(self.pause_manager, "is_waiting", False)
            if is_paused:
                return

            server = PromptServer.instance
            if not hasattr(server, "prompt_queue"):
                return

            queue = server.prompt_queue
            tasks_remaining = queue.get_tasks_remaining()
            currently_running = len(getattr(queue, "currently_running", {}))

            if tasks_remaining == 0 and currently_running == 0:
                action = self.pending_action
                self._executing = True
                self.pending_action = None
                print(f"[SaturnNodes Power] Queue is empty and idle. Executing '{action}' now...")

                if action == "restart":
                    self.execute_restart()
                elif action == "shutdown":
                    self.execute_shutdown()

    def execute_restart(self):
        if not is_process_management_enabled():
            print("[SaturnNodes Power] Rejected restart: Process Management is disabled in SaturnNodes settings.")
            return False

        def _run():
            import subprocess, sys, os, time
            print("[SaturnNodes Power] Restarting ComfyUI server process...")
            time.sleep(0.6)
            cmd = [sys.executable]
            if getattr(sys.flags, "no_user_site", 0):
                cmd.append("-s")
            cmd.extend(sys.argv)
            cwd = os.getcwd()
            env = os.environ.copy()
            proc = None
            try:
                if sys.platform.startswith("win"):
                    creationflags = subprocess.CREATE_NEW_CONSOLE if hasattr(subprocess, "CREATE_NEW_CONSOLE") else 0
                    proc = subprocess.Popen(cmd, cwd=cwd, env=env, creationflags=creationflags)
                else:
                    proc = subprocess.Popen(cmd, cwd=cwd, env=env, start_new_session=True)
            except Exception as e:
                print(f"[SaturnNodes Power] Error spawning restart process: {e}")
                self._executing = False
                return

            time.sleep(0.5)
            if proc is not None and proc.poll() is not None:
                print(f"[SaturnNodes Power] Child process exited prematurely with code {proc.returncode}. Aborting restart.")
                self._executing = False
                return

            try:
                sys.stdout.flush()
                sys.stderr.flush()
            except Exception:
                pass
            os._exit(0)
        threading.Thread(target=_run, daemon=True).start()
        return True

    def execute_shutdown(self):
        if not is_process_management_enabled():
            print("[SaturnNodes Power] Rejected shutdown: Process Management is disabled in SaturnNodes settings.")
            return False

        def _run():
            import sys, os, time
            print("[SaturnNodes Power] Shutting down ComfyUI server...")
            time.sleep(0.6)
            try:
                sys.stdout.flush()
                sys.stderr.flush()
            except Exception:
                pass
            os._exit(0)
        threading.Thread(target=_run, daemon=True).start()
        return True

_POWER_TICKETS = {}
_POWER_TICKET_LOCK = threading.Lock()

def _issue_power_ticket(action):
    with _POWER_TICKET_LOCK:
        now = time.time()
        expired = [t for t, (exp, _) in _POWER_TICKETS.items() if exp < now]
        for t in expired:
            _POWER_TICKETS.pop(t, None)
        ticket = secrets.token_urlsafe(24)
        _POWER_TICKETS[ticket] = (now + 30.0, action)
        return ticket

def _consume_power_ticket(ticket, expected_action=None):
    if not ticket or not isinstance(ticket, str):
        return False
    with _POWER_TICKET_LOCK:
        now = time.time()
        if ticket not in _POWER_TICKETS:
            return False
        exp, act = _POWER_TICKETS[ticket]
        if exp < now:
            _POWER_TICKETS.pop(ticket, None)
            return False
        if expected_action and act != expected_action:
            return False
        _POWER_TICKETS.pop(ticket, None)
        return True

pause_manager = PauseQueueManager()
persistent_manager = PersistentQueueManager()
persistent_queue_manager = persistent_manager
atexit.register(persistent_manager.flush)
tray_manager = TrayIconManager(pause_manager)
power_manager = PowerControlManager(pause_manager)

def setup_queue_control_routes(server):
    pause_manager.patch_all()
    persistent_manager.patch_server()
    patch_generation_times(server)
    power_manager.start_watcher()

    if is_tray_icon_enabled():
        tray_manager.start()

    if is_assets_restore_enabled():
        assets_restore_manager.restore_on_launch(server)

    routes = server.routes

    @routes.get("/saturnnodes/power/status")
    async def get_power_status(request):
        if not is_local_request(request):
            return web.json_response({"error": "Forbidden: Local access only"}, status=403)
        return web.json_response(power_manager.get_status())

    @routes.post("/saturnnodes/power/arm")
    async def arm_power_action(request):
        if not is_authenticated_local_request(request):
            return web.json_response({"error": "Forbidden: Local authenticated access only"}, status=403)
        if not is_process_management_enabled():
            return web.json_response({
                "error": "Process Management is disabled. Enable 'Allow Process Management' in SaturnNodes settings to use restart or shutdown.",
                "enabled": False
            }, status=403)
        try:
            data = await request.json()
        except Exception:
            data = {}
        action = data.get("action")
        power_manager.arm(action)
        return web.json_response(power_manager.get_status())

    @routes.post("/saturnnodes/power/request_token")
    async def request_power_token(request):
        if not is_authenticated_local_request(request):
            return web.json_response({"error": "Forbidden: Local authenticated access only"}, status=403)
        if not is_process_management_enabled():
            return web.json_response({
                "error": "Process Management is disabled. Enable 'Allow Process Management' in SaturnNodes settings.",
                "enabled": False
            }, status=403)
        try:
            data = await request.json()
        except Exception:
            data = {}
        action = data.get("action")
        if action not in ["restart", "shutdown"]:
            return web.json_response({"error": "Invalid action. Must be 'restart' or 'shutdown'."}, status=400)
        ticket = _issue_power_ticket(action)
        return web.json_response({
            "success": True,
            "ticket": ticket,
            "action": action,
            "expires_in": 30
        })

    @routes.post("/saturnnodes/power/confirm_action")
    async def confirm_power_action(request):
        if not is_authenticated_local_request(request):
            return web.json_response({"error": "Forbidden: Local authenticated access only"}, status=403)
        if not is_process_management_enabled():
            return web.json_response({
                "error": "Process Management is disabled. Enable 'Allow Process Management' in SaturnNodes settings.",
                "enabled": False
            }, status=403)
        try:
            data = await request.json()
        except Exception:
            data = {}
        ticket = data.get("ticket")
        action = data.get("action")
        if not _consume_power_ticket(ticket, action):
            return web.json_response({"error": "Invalid or expired confirmation ticket. Operator confirmation required."}, status=403)
        if action == "restart":
            power_manager.execute_restart()
            return web.json_response({"status": "restarting", "success": True})
        elif action == "shutdown":
            power_manager.execute_shutdown()
            return web.json_response({"status": "shutting_down", "success": True})
        return web.json_response({"error": "Unknown action"}, status=400)

    @routes.post("/saturnnodes/power/restart")
    async def trigger_restart(request):
        if not is_authenticated_local_request(request):
            return web.json_response({"error": "Forbidden: Local authenticated access only"}, status=403)
        if not is_process_management_enabled():
            return web.json_response({
                "error": "Process Management is disabled. Enable 'Allow Process Management' in SaturnNodes settings to use restart.",
                "enabled": False
            }, status=403)
        try:
            data = await request.json()
        except Exception:
            data = {}
        ticket = data.get("ticket")
        if not _consume_power_ticket(ticket, "restart"):
            return web.json_response({"error": "Confirmation ticket required. Use /saturnnodes/power/request_token first."}, status=403)
        power_manager.execute_restart()
        return web.json_response({"status": "restarting"})

    @routes.post("/saturnnodes/power/shutdown")
    async def trigger_shutdown(request):
        if not is_authenticated_local_request(request):
            return web.json_response({"error": "Forbidden: Local authenticated access only"}, status=403)
        if not is_process_management_enabled():
            return web.json_response({
                "error": "Process Management is disabled. Enable 'Allow Process Management' in SaturnNodes settings to use shutdown.",
                "enabled": False
            }, status=403)
        try:
            data = await request.json()
        except Exception:
            data = {}
        ticket = data.get("ticket")
        if not _consume_power_ticket(ticket, "shutdown"):
            return web.json_response({"error": "Confirmation ticket required. Use /saturnnodes/power/request_token first."}, status=403)
        power_manager.execute_shutdown()
        return web.json_response({"status": "shutting_down"})

    @routes.post("/saturnnodes/assets/restore")
    async def restore_assets_endpoint(request):
        if not is_authenticated_local_request(request):
            return web.json_response({"error": "Forbidden: Local authenticated access only"}, status=403)
        try:
            data = await request.json()
        except Exception:
            data = {}
        limit = data.get("limit")
        if limit is not None:
            try:
                limit = max(1, min(1000, int(limit)))
            except (TypeError, ValueError):
                limit = None
        force = bool(data.get("force", False))
        # Scanning the output tree and parsing metadata is blocking disk I/O;
        # keep the aiohttp event loop responsive for the Restore Now button.
        count = await asyncio.to_thread(
            assets_restore_manager.restore_on_launch, server, limit=limit, force=force
        )
        return web.json_response({"success": True, "restored": count, "debug": assets_restore_manager.last_debug_report})

    @routes.get("/saturnnodes/assets/debug")
    async def get_assets_debug(request):
        if not is_local_request(request):
            return web.json_response({"error": "Forbidden: Local access only"}, status=403)
        return web.json_response(assets_restore_manager.last_debug_report)

    @routes.get("/saturnnodes/batch_queue/data")
    async def get_batch_queue_data(request):
        if not is_local_request(request):
            return web.json_response({"error": "Forbidden: Local access only"}, status=403)
        return web.json_response(persistent_manager.batch_meta)

    @routes.post("/saturnnodes/batch_queue/sync")
    async def sync_batch_queue_data(request):
        if not is_authenticated_local_request(request):
            return web.json_response({"error": "Forbidden: Local authenticated access only"}, status=403)
        try:
            data = await request.json()
            pid = data.get("prompt_id")
            info = data.get("batch_info")
            if pid and isinstance(info, dict):
                persistent_manager.set_batch_info(pid, info)
                return web.json_response({"success": True})
        except Exception as e:
            return web.json_response({"error": str(e)}, status=400)
        return web.json_response({"success": False}, status=400)

    @routes.get("/saturnnodes/pause_queue/status")
    async def get_status(request):
        if not is_local_request(request):
            return web.json_response({"error": "Forbidden: Local access only"}, status=403)
        pause_manager.patch_all()
        return web.json_response({
            "paused": pause_manager.paused,
            "mode": pause_manager.mode,
            "waiting": pause_manager.is_waiting
        })

    @routes.post("/saturnnodes/pause_queue/toggle")
    async def toggle_pause(request):
        if not is_authenticated_local_request(request):
            return web.json_response({"error": "Forbidden: Local authenticated access only"}, status=403)
        try:
            data = await request.json()
        except Exception:
            data = {}
        paused = data.get("paused", not pause_manager.paused)
        mode = data.get("mode", pause_manager.mode)
        pause_manager.set_pause(paused, mode)
        return web.json_response({
            "paused": pause_manager.paused,
            "mode": pause_manager.mode,
            "waiting": pause_manager.is_waiting
        })

    @routes.post("/saturnnodes/pause_queue/mode")
    async def set_mode_route(request):
        if not is_authenticated_local_request(request):
            return web.json_response({"error": "Forbidden: Local authenticated access only"}, status=403)
        try:
            data = await request.json()
        except Exception:
            data = {}
        mode = data.get("mode", pause_manager.mode)
        pause_manager.set_mode(mode)
        return web.json_response({
            "paused": pause_manager.paused,
            "mode": pause_manager.mode,
            "waiting": pause_manager.is_waiting
        })

    @routes.post("/saturnnodes/pause_queue/continue")
    async def continue_queue(request):
        if not is_authenticated_local_request(request):
            return web.json_response({"error": "Forbidden: Local authenticated access only"}, status=403)
        pause_manager.set_pause(False)
        return web.json_response({
            "paused": pause_manager.paused,
            "mode": pause_manager.mode,
            "waiting": pause_manager.is_waiting
        })

    @routes.post("/saturnnodes/persistent_queue/claim")
    async def claim_queue(request):
        if not is_authenticated_local_request(request):
            return web.json_response({"error": "Forbidden: Local authenticated access only"}, status=403)
        try:
            data = await request.json()
            client_id = data.get("client_id")
            if client_id and not persistent_manager.has_claimed_once:
                persistent_manager.restore_queue(client_id)
        except Exception as e:
            print(f"[SaturnNodes PersistentQueue] Error in claim endpoint: {e}")
        return web.json_response({"status": "ok"})

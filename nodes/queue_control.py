import os
import json
import secrets
import time
import threading
import asyncio
from aiohttp import web
from server import PromptServer
import nodes
from .tray_icon import TrayIconManager, is_tray_icon_enabled
from .assets_restore import assets_restore_manager, is_assets_restore_enabled, get_assets_restore_count
from .utils import get_saturnnodes_user_dir, get_leafflow_user_dir, is_local_request, is_authenticated_local_request

QUEUE_CATEGORY = "🪐 SaturnNodes/Queue"

CURRENT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
USER_DIR = get_saturnnodes_user_dir()
PERSISTENT_FILE = os.path.join(USER_DIR, "persistent_queue.json")
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

def is_persistent_queue_enabled():
    val = get_env_setting("ENABLE_PERSISTENT_QUEUE", "true").lower()
    return val in ["true", "1", "yes"]

def is_process_management_enabled():
    val = get_env_setting("ALLOW_PROCESS_MANAGEMENT", "false").lower()
    return val in ["true", "1", "yes"]

class PauseQueueManager:
    def __init__(self):
        default_state = get_env_setting("DEFAULT_PAUSE_STATE", "Paused")
        default_mode = get_env_setting("DEFAULT_PAUSE_MODE", "after_finish")
        
        self.paused = (default_state.lower() != "running")
        self.mode = "instantly" if "instant" in default_mode.lower() else "after_finish"
        self.is_waiting = self.paused
        self.event = threading.Event()
        if not self.paused:
            self.event.set()
        else:
            self.event.clear()
        self._patched = False

    def patch_all(self):
        if self._patched:
            return
        server = getattr(PromptServer, "instance", None)
        if not server:
            print("[LeafFlow] Queue control: Skipped pause patching (PromptServer instance not ready).")
            return

        if not hasattr(server, "prompt_queue") or not hasattr(server.prompt_queue, "get"):
            print("[LeafFlow] Queue control: Skipped patching prompt_queue.get (incompatible ComfyUI version).")
            return

        queue = server.prompt_queue
        original_get = queue.get

        def patched_get(*args, **kwargs):
            while True:
                if self.paused:
                    if not self.is_waiting:
                        self.is_waiting = True
                        print("[PauseQueue] Workflow paused after this run: Current workflow finished, queue paused.")
                        self.notify_clients()
                    while self.paused:
                        self.event.wait(0.2)
                    self.is_waiting = False
                    self.notify_clients()

                item = original_get(*args, **kwargs)

                if self.paused:
                    if not self.is_waiting:
                        self.is_waiting = True
                        print("[PauseQueue] Workflow paused after this run: Current workflow finished, queue paused.")
                        self.notify_clients()
                    while self.paused:
                        self.event.wait(0.2)
                    self.is_waiting = False
                    self.notify_clients()

                return item

        queue.get = patched_get

        if hasattr(server, "send_sync") and callable(server.send_sync):
            original_send_sync = server.send_sync

            def patched_send_sync(event, data, sid=None):
                if event == "executing" and isinstance(data, dict) and data.get("node") is not None:
                    if self.paused and self.mode == "instantly":
                        if not self.is_waiting:
                            self.is_waiting = True
                            print(f"[PauseQueue] Workflow Paused Instant: Paused before executing node '{data.get('node')}'.")
                            self.notify_clients()
                        while self.paused and self.mode == "instantly":
                            self.event.wait(0.2)
                        self.is_waiting = False
                        self.notify_clients()
                return original_send_sync(event, data, sid)

            server.send_sync = patched_send_sync
        else:
            print("[LeafFlow] Queue control: Skipped patching send_sync (not found on server).")

        self._patched = True
        print("[LeafFlow] Queue control: Pause manager initialized successfully.")

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
                    print("[PauseQueue] Workflow Paused Instant: Queue is empty/idle, pause active.")
                else:
                    print("[PauseQueue] Workflow paused after this run: Queue is empty/idle, pause active.")
            else:
                self.is_waiting = False
                if self.mode == "instantly":
                    print("[PauseQueue] Workflow Paused Instant requested. Waiting for current node to complete...")
                else:
                    print("[PauseQueue] Workflow paused after this run requested. Will pause when current workflow completes...")
            self.event.clear()
        else:
            self.is_waiting = False
            self.event.set()
            print("[PauseQueue] Continue pressed: Resuming execution.")

        self.notify_clients()

    def set_mode(self, mode):
        self.mode = mode
        print(f"[PauseQueue] Selected pause mode: '{self.mode}'")
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
    def __init__(self):
        self.lock = threading.RLock()
        self.persistent_items = []
        self.batch_meta = {}
        self.is_restoring = False
        self._patched = False
        self.has_claimed_once = False
        self.load_from_file()

    def load_from_file(self):
        with self.lock:
            if os.path.exists(PERSISTENT_FILE):
                try:
                    with open(PERSISTENT_FILE, "r", encoding="utf-8") as f:
                        data = json.load(f)
                        if isinstance(data, list):
                            self.persistent_items = [
                                x for x in data
                                if isinstance(x, dict) and "prompt_id" in x and isinstance(x.get("item"), (list, tuple))
                            ]
                            for x in self.persistent_items:
                                if "batch_info" in x and "prompt_id" in x:
                                    self.batch_meta[str(x["prompt_id"])] = x["batch_info"]
                            print(f"[PersistentQueue] Loaded {len(self.persistent_items)} saved queue item(s).")
                        else:
                            self.persistent_items = []
                except Exception as e:
                    print(f"[PersistentQueue] Error loading persistent queue file: {e}")
                    self.persistent_items = []
            else:
                self.persistent_items = []

    def set_batch_info(self, prompt_id, batch_info):
        if not prompt_id:
            return
        pid_str = str(prompt_id)
        with self.lock:
            self.batch_meta[pid_str] = batch_info
            for item in self.persistent_items:
                if str(item.get("prompt_id")) == pid_str:
                    item["batch_info"] = batch_info
                    break
        if is_persistent_queue_enabled():
            self.save_to_file()

    def save_to_file(self):
        if not is_persistent_queue_enabled():
            return
        with self.lock:
            try:
                temp_file = PERSISTENT_FILE + ".tmp"
                with open(temp_file, "w", encoding="utf-8") as f:
                    json.dump(self.persistent_items, f, indent=2, default=str)
                os.replace(temp_file, PERSISTENT_FILE)
            except Exception as e:
                print(f"[PersistentQueue] Error saving persistent queue file: {e}")

    def add_item(self, item_tuple):
        if self.is_restoring or not is_persistent_queue_enabled():
            return
        try:
            if isinstance(item_tuple, (tuple, list)):
                item_list = list(item_tuple)
                prompt_id = item_list[1] if len(item_list) > 1 else None
                if not prompt_id:
                    return
                pid_str = str(prompt_id)
                entry = {
                    "prompt_id": pid_str,
                    "item": item_list
                }
                if pid_str in self.batch_meta:
                    entry["batch_info"] = self.batch_meta[pid_str]
                with self.lock:
                    self.persistent_items = [x for x in self.persistent_items if str(x.get("prompt_id")) != pid_str]
                    self.persistent_items.append(entry)
                self.save_to_file()
                print(f"[PersistentQueue] Persisted prompt {pid_str} to disk.")
        except Exception as e:
            print(f"[PersistentQueue] Error formatting queue item for persistence: {e}")

    def remove_item(self, prompt_id):
        if not prompt_id:
            return
        pid_str = str(prompt_id)
        with self.lock:
            initial_count = len(self.persistent_items)
            self.persistent_items = [x for x in self.persistent_items if str(x.get("prompt_id")) != pid_str]
            self.batch_meta.pop(pid_str, None)
            changed = len(self.persistent_items) != initial_count
        if changed and is_persistent_queue_enabled():
            self.save_to_file()
            print(f"[PersistentQueue] Removed prompt {pid_str} from disk.")

    def wipe_all(self):
        with self.lock:
            self.persistent_items = []
            self.batch_meta = {}
        if is_persistent_queue_enabled():
            self.save_to_file()
        print("[PersistentQueue] Cleared all saved queue items.")

    def patch_server(self):
        if self._patched:
            return
        if not is_persistent_queue_enabled():
            print("[LeafFlow] Persistent queue disabled in settings; core prompt_queue patching skipped.")
            return
        server = getattr(PromptServer, "instance", None)
        if not server or not hasattr(server, "prompt_queue"):
            print("[LeafFlow] Queue control: Skipped persistent queue patching (prompt_queue not found on server).")
            return

        queue = server.prompt_queue
        if not hasattr(queue, "put") or not hasattr(queue, "task_done"):
            print("[LeafFlow] Queue control: Skipped persistent queue patching (incompatible queue interface).")
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
                try:
                    with queue.mutex:
                        to_delete = [item[1] for item in queue.queue if fn(item) and len(item) > 1]
                        for pid in to_delete:
                            self.remove_item(pid)
                except Exception:
                    pass
                return original_delete(fn, *args, **kwargs)
            queue.delete_queue_item = patched_delete

        # 4. Patch queue.wipe_queue
        if hasattr(queue, "wipe_queue"):
            original_wipe = queue.wipe_queue
            def patched_wipe(*args, **kwargs):
                self.wipe_all()
                return original_wipe(*args, **kwargs)
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
        print("[LeafFlow] Queue control: Persistent queue manager initialized successfully.")

    def restore_queue(self, active_client_id=None):
        if self.has_claimed_once:
            return

        if not is_persistent_queue_enabled():
            print("[PersistentQueue] Auto-recovery is disabled in settings.")
            self.has_claimed_once = True
            return

        server = PromptServer.instance
        if not hasattr(server, "prompt_queue") or not self.persistent_items:
            self.has_claimed_once = True
            return

        restored_state_setting = get_env_setting("PERSISTENT_QUEUE_RESTORED_STATE", "Match Default")
        if restored_state_setting == "Force Paused":
            pause_manager.set_pause(True)
        elif restored_state_setting == "Force Running":
            pause_manager.set_pause(False)

        print(f"[PersistentQueue] Restoring {len(self.persistent_items)} saved queue item(s) to client '{active_client_id}'...")
        self.is_restoring = True
        max_number = 0
        restored_count = 0
        try:
            history = server.prompt_queue.get_history() if hasattr(server.prompt_queue, "get_history") else {}
            for entry in list(self.persistent_items):
                try:
                    pid = entry.get("prompt_id")
                    # If this prompt is already in history, it finished previously - drop it
                    if pid and pid in history:
                        self.remove_item(pid)
                        continue

                    item_list = list(entry.get("item", []))
                    if len(item_list) < 3 or not item_list[1] or not isinstance(item_list[2], dict):
                        # Malformed entry, drop from disk
                        if pid:
                            self.remove_item(pid)
                        continue

                    if active_client_id and len(item_list) > 3 and isinstance(item_list[3], dict):
                        item_list[3]["client_id"] = active_client_id

                    if isinstance(item_list[0], (int, float)):
                        max_number = max(max_number, int(item_list[0]))

                    server.prompt_queue.put(tuple(item_list))
                    restored_count += 1
                except Exception as e:
                    print(f"[PersistentQueue] Error restoring prompt {entry.get('prompt_id')}: {e}")
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
                    if isinstance(entry.get("item"), list) and len(entry["item"]) > 3:
                        if isinstance(entry["item"][3], dict):
                            entry["item"][3]["client_id"] = active_client_id
                self.save_to_file()

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
                    print(f"[LeafFlow Power] Arm rejected: Process Management is disabled in LeafFlow settings.")
                    return False
                self.pending_action = action
                import time
                self.armed_at = time.time()
                print(f"[LeafFlow Power] Armed action '{action}' after queue completion.")
            else:
                self.pending_action = None
                self.armed_at = None
                print("[LeafFlow Power] Cancelled armed queue power action.")
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
                print(f"[LeafFlow Power] Queue is empty and idle. Executing '{action}' now...")

                if action == "restart":
                    self.execute_restart()
                elif action == "shutdown":
                    self.execute_shutdown()

    def execute_restart(self):
        if not is_process_management_enabled():
            print("[LeafFlow Power] Rejected restart: Process Management is disabled in LeafFlow settings.")
            return False

        def _run():
            import subprocess, sys, os, time
            print("[LeafFlow Power] Restarting ComfyUI server process...")
            time.sleep(0.6)
            cmd = [sys.executable]
            if getattr(sys.flags, "no_user_site", 0):
                cmd.append("-s")
            cmd.extend(sys.argv)
            cwd = os.getcwd()
            env = os.environ.copy()
            if sys.platform.startswith("win"):
                creationflags = subprocess.CREATE_NEW_CONSOLE if hasattr(subprocess, "CREATE_NEW_CONSOLE") else 0
                subprocess.Popen(cmd, cwd=cwd, env=env, creationflags=creationflags)
            else:
                subprocess.Popen(cmd, cwd=cwd, env=env, start_new_session=True)
            time.sleep(0.4)
            os._exit(0)
        threading.Thread(target=_run, daemon=True).start()
        return True

    def execute_shutdown(self):
        if not is_process_management_enabled():
            print("[LeafFlow Power] Rejected shutdown: Process Management is disabled in LeafFlow settings.")
            return False

        def _run():
            import os, time
            print("[LeafFlow Power] Shutting down ComfyUI server...")
            time.sleep(0.6)
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
tray_manager = TrayIconManager(pause_manager)
power_manager = PowerControlManager(pause_manager)

def setup_queue_control_routes(server):
    pause_manager.patch_all()
    persistent_manager.patch_server()
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
        force = bool(data.get("force", False))
        count = assets_restore_manager.restore_on_launch(server, limit=limit, force=force)
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
            if pid and info:
                persistent_manager.set_batch_info(pid, info)
                return web.json_response({"success": True})
        except Exception as e:
            return web.json_response({"error": str(e)}, status=400)
        return web.json_response({"success": False}, status=400)

    @routes.get("/pause_queue/status")
    async def get_status(request):
        if not is_local_request(request):
            return web.json_response({"error": "Forbidden: Local access only"}, status=403)
        pause_manager.patch_all()
        return web.json_response({
            "paused": pause_manager.paused,
            "mode": pause_manager.mode,
            "waiting": pause_manager.is_waiting
        })

    @routes.post("/pause_queue/toggle")
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

    @routes.post("/pause_queue/mode")
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

    @routes.post("/pause_queue/continue")
    async def continue_queue(request):
        if not is_authenticated_local_request(request):
            return web.json_response({"error": "Forbidden: Local authenticated access only"}, status=403)
        pause_manager.set_pause(False)
        return web.json_response({
            "paused": pause_manager.paused,
            "mode": pause_manager.mode,
            "waiting": pause_manager.is_waiting
        })

    @routes.post("/persistent_queue/claim")
    async def claim_queue(request):
        if not is_authenticated_local_request(request):
            return web.json_response({"error": "Forbidden: Local authenticated access only"}, status=403)
        try:
            data = await request.json()
            client_id = data.get("client_id")
            if client_id and not persistent_manager.has_claimed_once:
                persistent_manager.restore_queue(client_id)
        except Exception as e:
            print(f"[PersistentQueue] Error in claim endpoint: {e}")
        return web.json_response({"status": "ok"})

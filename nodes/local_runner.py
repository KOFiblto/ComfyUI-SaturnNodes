import os
import sys
import time
import shlex
import subprocess
import threading
from aiohttp import web
import folder_paths
import comfy.model_management
from .utils import get_env_setting, is_local_request, is_authenticated_local_request

AUTOMATION_CATEGORY = "🍃 LeafFlow/Automation"

def _safe_print(msg):
    try:
        print(msg)
    except UnicodeEncodeError:
        print(msg.encode("ascii", "replace").decode("ascii"))

def is_local_file_execution_enabled():
    """Checks whether local file execution is explicitly enabled in LeafFlow settings (default False)."""
    val = get_env_setting("ENABLE_LOCAL_FILE_EXECUTION", "false").lower()
    return val in ["true", "1", "yes"]

def get_allowed_scripts_directory():
    """
    Returns the strict, non-bypassable scripts directory: ComfyUI/scripts/
    """
    base = folder_paths.base_path if hasattr(folder_paths, "base_path") and folder_paths.base_path else os.getcwd()
    scripts_dir = os.path.abspath(os.path.realpath(os.path.join(base, "scripts")))
    try:
        os.makedirs(scripts_dir, exist_ok=True)
    except Exception:
        pass
    return scripts_dir

def is_script_path_permitted(target_path):
    """
    Confines target scripts strictly to ComfyUI/scripts/ using canonical realpath and commonpath.
    No setting or configuration can bypass this confinement.
    """
    if not target_path:
        return False, "Target path is empty."

    scripts_dir = get_allowed_scripts_directory()
    try:
        abs_target = os.path.abspath(os.path.realpath(target_path))
        if os.path.commonpath([scripts_dir, abs_target]) == scripts_dir:
            if not os.path.exists(abs_target):
                return False, f"Script does not exist: '{os.path.basename(target_path)}'"
            if not os.path.isfile(abs_target):
                return False, f"Target is not a regular file: '{os.path.basename(target_path)}'"
            return True, "Path verified within ComfyUI/scripts/."
        return False, f"Security Restriction: Script '{os.path.basename(target_path)}' must reside within ComfyUI/scripts/."
    except Exception as e:
        return False, f"Path validation error: {e}"

def resolve_target_path(file_path_input):
    """
    Resolves and verifies a script path strictly within ComfyUI/scripts/.
    Rejects absolute paths, path traversal ('..'), and any outside references.
    """
    clean = str(file_path_input or "").strip()
    if not clean:
        return None, "Script file path is empty."

    # 1. Strictly reject absolute paths (Windows drive letters C:\, UNC \\server, or POSIX /root)
    if os.path.isabs(clean) or clean.startswith(("\\\\", "//")):
        return None, f"Security Restriction: Absolute paths are forbidden ('{clean}'). Place your script in ComfyUI/scripts/ and specify a relative name."

    # 2. Strictly reject directory traversal
    norm = os.path.normpath(clean)
    parts = norm.replace("\\", "/").split("/")
    if ".." in parts or norm.startswith(".."):
        return None, f"Security Restriction: Directory traversal ('..') is forbidden ('{clean}')."

    # 3. If operator wrote "scripts/run.bat" or "scripts\run.bat", normalize to relative subpath
    if parts and parts[0].lower() == "scripts":
        clean_sub = os.path.join(*parts[1:]) if len(parts) > 1 else ""
    else:
        clean_sub = norm

    if not clean_sub:
        return None, "Invalid script path."

    scripts_base = get_allowed_scripts_directory()
    full_target = os.path.abspath(os.path.realpath(os.path.join(scripts_base, clean_sub)))

    # 4. Canonical commonpath confinement
    try:
        if os.path.commonpath([scripts_base, full_target]) != scripts_base:
            return None, f"Security Restriction: Script path escapes ComfyUI/scripts/ ('{clean}')."
    except Exception as e:
        return None, f"Security Restriction: Path validation error: {e}"

    if not os.path.exists(full_target):
        return None, f"Script not found in ComfyUI/scripts/: '{clean_sub}'"

    if not os.path.isfile(full_target):
        return None, f"Target path is not a file: '{clean_sub}'"

    return full_target, "OK"


# =========================================================================
# In-Memory Operator Authorization Registry
# =========================================================================
# Does NOT travel in workflow JSON or prompt requests.
# Stored solely in memory and consumed upon execution.
_AUTHORIZED_RUNS = {}
_AUTH_LOCK = threading.Lock()

def authorize_node_run(node_id, file_path="", ttl_seconds=300):
    with _AUTH_LOCK:
        now = time.time()
        expired = [k for k, v in _AUTHORIZED_RUNS.items() if v.get("expires_at", 0) < now]
        for k in expired:
            _AUTHORIZED_RUNS.pop(k, None)

        filename = os.path.basename(str(file_path).strip()) if file_path else ""
        _AUTHORIZED_RUNS[str(node_id)] = {
            "expires_at": now + ttl_seconds,
            "filename": filename
        }

def consume_node_authorization(node_id, resolved_path):
    if node_id is None:
        return False, "Missing node identifier. Workflow execution cannot be authorized."
    with _AUTH_LOCK:
        now = time.time()
        auth = _AUTHORIZED_RUNS.pop(str(node_id), None)
        if not auth:
            return False, "Node has not been authorized. Operator must click 'Authorize Run' on this node in the canvas before queueing."
        if auth.get("expires_at", 0) < now:
            return False, "Authorization has expired (5-minute timeout). Please click 'Authorize Run' again."
        target_base = os.path.basename(resolved_path) if resolved_path else ""
        expected_base = auth.get("filename")
        if expected_base and target_base and target_base.lower() != expected_base.lower():
            return False, f"Authorized script '{expected_base}' does not match configured script '{target_base}'. Please re-authorize."
        return True, "Authorized"

def is_node_authorized(node_id):
    if not node_id:
        return False, 0
    with _AUTH_LOCK:
        now = time.time()
        auth = _AUTHORIZED_RUNS.get(str(node_id))
        if auth and auth.get("expires_at", 0) >= now:
            return True, int(auth.get("expires_at", 0) - now)
        return False, 0

def clear_all_authorizations():
    with _AUTH_LOCK:
        _AUTHORIZED_RUNS.clear()

def setup_local_runner_routes(server):
    routes = server.routes

    @routes.post("/leafflow/local_runner/authorize")
    async def authorize_endpoint(request):
        if not is_authenticated_local_request(request):
            return web.json_response({"error": "Forbidden: Local authenticated access only"}, status=403)
        if not is_local_file_execution_enabled():
            return web.json_response({
                "error": "Local file execution is disabled. Enable 'Allow Local File Execution' in LeafFlow settings first.",
                "enabled": False
            }, status=403)
        try:
            data = await request.json()
        except Exception:
            data = {}
        node_id = data.get("node_id")
        file_path = data.get("file_path", "")
        if node_id is None:
            return web.json_response({"error": "Missing node_id"}, status=400)
        authorize_node_run(node_id, file_path, ttl_seconds=300)
        return web.json_response({
            "success": True,
            "node_id": str(node_id),
            "expires_in": 300
        })

    @routes.get("/leafflow/local_runner/status")
    async def status_endpoint(request):
        if not is_local_request(request):
            return web.json_response({"error": "Forbidden: Local access only"}, status=403)
        node_id = request.query.get("node_id")
        is_auth, remaining = is_node_authorized(node_id)
        return web.json_response({
            "enabled": is_local_file_execution_enabled(),
            "authorized": is_auth,
            "remaining_seconds": remaining
        })


class AnyType(str):
    """Wildcard type for input and output passthrough wires."""
    def __ne__(self, __value: object) -> bool:
        return False

any_type = AnyType("*")


class RunLocalFileNode:
    """
    Safely executes a local file (.exe, .bat, .cmd, .ps1 on Windows; .sh or binary on Linux/macOS)
    with custom parameters and configurable working directory.
    Includes strict path confinement and in-memory operator authorization.
    """

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "file_path": ("STRING", {
                    "default": "",
                    "multiline": False,
                    "placeholder": "Relative script path inside ComfyUI/scripts/ (e.g. run.bat or convert.sh)"
                }),
            },
            "optional": {
                "parameters": ("STRING", {
                    "default": "",
                    "multiline": True,
                    "placeholder": "Command-line arguments (e.g. --input file.png --quality 95)"
                }),
                "working_directory": ("STRING", {
                    "default": "",
                    "multiline": False,
                    "placeholder": "Working directory inside ComfyUI/scripts/. Leave empty to use script directory."
                }),
                "run_mode": (
                    ["Synchronous (Wait for Output)", "Asynchronous (Background)"],
                    {"default": "Synchronous (Wait for Output)"}
                ),
                "timeout": ("INT", {
                    "default": 60,
                    "min": 0,
                    "max": 3600,
                    "step": 5,
                    "tooltip": "Max execution time in seconds (0 = unlimited). Ignored in asynchronous mode."
                }),
                "trigger": (any_type, {"tooltip": "Optional passthrough wire to sequence execution in your workflow."}),
            },
            "hidden": {
                "unique_id": "UNIQUE_ID",
                "extra_pnginfo": "EXTRA_PNGINFO"
            }
        }

    RETURN_TYPES = ("STRING", "STRING", "INT", "BOOLEAN", any_type)
    RETURN_NAMES = ("stdout", "stderr", "exit_code", "success", "passthrough")
    FUNCTION = "run_local_file"
    CATEGORY = AUTOMATION_CATEGORY
    DESCRIPTION = (
        "Executes a local script or executable (.bat, .ps1, .exe on Windows; .sh or binary on Linux/macOS) "
        "with parameter arguments and working directory control.\n\n"
        "Security Safeguards:\n"
        "- Strictly confined to ComfyUI/scripts/ (absolute paths and directory traversal are forbidden).\n"
        "- Requires explicit in-memory operator authorization via the '⚡ Authorize Run' button.\n"
        "- Consent cannot travel in workflow JSON or image metadata.\n"
        "- Execution is single-use: each authorization expires upon run or after 5 minutes.\n"
        "- Never uses shell=True to prevent command chaining injection.\n"
        "- Disabled globally by default for operator security."
    )

    def resolve_target_path(self, file_path_input):
        return resolve_target_path(file_path_input)[0]

    def build_command_args(self, target_path, params_str):
        """Builds a safe, non-shell command list suitable for subprocess.Popen(shell=False)."""
        parsed_args = []
        if params_str and params_str.strip():
            try:
                parsed_args = shlex.split(params_str.strip(), posix=(sys.platform != "win32"))
            except Exception:
                parsed_args = params_str.strip().split()

        norm_path = os.path.normpath(target_path)
        lower_path = norm_path.lower()

        if sys.platform.startswith("win"):
            if lower_path.endswith((".bat", ".cmd")):
                comspec = os.environ.get("COMSPEC", "cmd.exe")
                return [comspec, "/c", norm_path, *parsed_args]
            elif lower_path.endswith(".ps1"):
                return ["powershell.exe", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", norm_path, *parsed_args]
            else:
                return [norm_path, *parsed_args]
        else:
            if lower_path.endswith(".sh"):
                return ["/bin/bash", norm_path, *parsed_args]
            else:
                return [norm_path, *parsed_args]

    def run_local_file(
        self,
        file_path,
        parameters="",
        working_directory="",
        run_mode="Synchronous (Wait for Output)",
        timeout=60,
        trigger=None,
        unique_id=None,
        **kwargs
    ):
        passthrough_out = trigger if trigger is not None else ""

        # Check 1: Global Security Setting (Defaults to Disabled)
        if not is_local_file_execution_enabled():
            err = (
                "Execution Blocked: Local file execution is disabled by default for security. "
                "To run local files, enable 'Allow Local File Execution' in ComfyUI Settings -> LeafFlow -> Security."
            )
            _safe_print(f"[LeafFlow LocalRunner] {err}")
            return ("", err, -1, False, passthrough_out)

        # Check 2: Path Resolution & Strict Confinement to ComfyUI/scripts/
        resolved_path, path_msg = resolve_target_path(file_path)
        if not resolved_path:
            err = f"Execution Error: {path_msg}"
            _safe_print(f"[LeafFlow LocalRunner] {err}")
            return ("", err, -1, False, passthrough_out)

        # Check 3: Mandatory In-Memory Operator Authorization Gate
        node_id = unique_id if unique_id is not None else kwargs.get("node_id")
        authorized, auth_msg = consume_node_authorization(node_id, resolved_path)
        if not authorized:
            err = f"Execution Blocked: {auth_msg}"
            _safe_print(f"[LeafFlow LocalRunner] {err}")
            return ("", err, -1, False, passthrough_out)

        # Determine working directory (confined to ComfyUI/scripts/ or script directory)
        scripts_base = get_allowed_scripts_directory()
        cwd = os.path.dirname(resolved_path)
        if working_directory and working_directory.strip():
            cand_cwd = os.path.abspath(os.path.realpath(os.path.join(scripts_base, working_directory.strip())))
            try:
                if os.path.commonpath([scripts_base, cand_cwd]) == scripts_base and os.path.isdir(cand_cwd):
                    cwd = cand_cwd
                else:
                    _safe_print(f"[LeafFlow LocalRunner] Warning: working_directory '{working_directory}' outside scripts folder. Defaulting to script folder.")
            except Exception:
                pass

        cmd_list = self.build_command_args(resolved_path, parameters)
        _safe_print(f"[LeafFlow LocalRunner] Executing '{os.path.basename(resolved_path)}' (mode: {run_mode}, cwd: '{cwd}')...")

        # Mode: Asynchronous (Background Detached)
        if "Asynchronous" in run_mode:
            try:
                creationflags = 0
                if sys.platform.startswith("win"):
                    creationflags = subprocess.CREATE_NEW_CONSOLE if hasattr(subprocess, "CREATE_NEW_CONSOLE") else 0
                    subprocess.Popen(cmd_list, cwd=cwd, creationflags=creationflags)
                else:
                    subprocess.Popen(cmd_list, cwd=cwd, start_new_session=True)

                msg = f"Started in background: '{os.path.basename(resolved_path)}' (PID assigned)"
                _safe_print(f"[LeafFlow LocalRunner] {msg}")
                return (msg, "", 0, True, passthrough_out)
            except Exception as e:
                err_msg = f"Failed to launch background process: {str(e)}"
                _safe_print(f"[LeafFlow LocalRunner] Error: {err_msg}")
                return ("", err_msg, -1, False, passthrough_out)

        # Mode: Synchronous (Wait for Process with Output & Interrupt Polling)
        try:
            creationflags = 0
            if sys.platform.startswith("win"):
                creationflags = subprocess.CREATE_NO_WINDOW if hasattr(subprocess, "CREATE_NO_WINDOW") else 0

            proc = subprocess.Popen(
                cmd_list,
                cwd=cwd,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                creationflags=creationflags
            )

            start_time = time.time()
            def _kill_tree():
                try:
                    if sys.platform.startswith("win"):
                        subprocess.run(["taskkill", "/F", "/T", "/PID", str(proc.pid)], capture_output=True)
                    else:
                        proc.kill()
                except Exception:
                    try:
                        proc.kill()
                    except Exception:
                        pass
                try:
                    proc.communicate(timeout=1)
                except Exception:
                    pass

            effective_timeout = timeout if timeout > 0 else None

            # Poll for completion while honoring ComfyUI cancellation
            while proc.poll() is None:
                try:
                    comfy.model_management.throw_exception_if_processing_interrupted()
                except Exception:
                    _kill_tree()
                    _safe_print(f"[LeafFlow LocalRunner] Execution of '{os.path.basename(resolved_path)}' interrupted by user.")
                    raise

                if effective_timeout and (time.time() - start_time) > effective_timeout:
                    _kill_tree()
                    err = f"Execution timed out after {timeout} seconds."
                    _safe_print(f"[LeafFlow LocalRunner] {err}")
                    return ("", err, -1, False, passthrough_out)

                time.sleep(0.1)

            stdout_data, stderr_data = proc.communicate()
            exit_code = proc.returncode
            success = (exit_code == 0)

            _safe_print(f"[LeafFlow LocalRunner] Completed with exit code {exit_code} (success: {success}).")
            return (stdout_data or "", stderr_data or "", exit_code, success, passthrough_out)

        except Exception as e:
            err_msg = f"Process execution error: {str(e)}"
            _safe_print(f"[LeafFlow LocalRunner] {err_msg}")
            return ("", err_msg, -1, False, passthrough_out)

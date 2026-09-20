import os
import sys
import time
import shlex
import subprocess
import threading
import folder_paths
import comfy.model_management
from .utils import get_leafflow_user_dir, get_env_setting, is_safe_path

AUTOMATION_CATEGORY = "🍃 LeafFlow/Automation"

def get_allowed_script_directories():
    """
    Returns approved base directories for local file execution.
    By default confined strictly to ComfyUI/scripts and user/default/LeafFlow/scripts.
    """
    allowed = []
    # 1. ComfyUI/scripts directory
    try:
        base_scripts = os.path.join(folder_paths.base_path, "scripts")
        os.makedirs(base_scripts, exist_ok=True)
        allowed.append(os.path.abspath(os.path.realpath(base_scripts)))
    except Exception:
        pass

    # 2. Centralized LeafFlow user scripts directory
    try:
        user_scripts = os.path.join(get_leafflow_user_dir(), "scripts")
        os.makedirs(user_scripts, exist_ok=True)
        allowed.append(os.path.abspath(os.path.realpath(user_scripts)))
    except Exception:
        pass

    return allowed


def is_script_path_permitted(target_path, allow_any_path=False):
    """
    Validates if a target script path is allowed to execute.
    Unless allow_any_path is explicitly True in settings, execution is confined to allowed directories.
    """
    if not target_path or not os.path.exists(target_path):
        return False, f"File does not exist: '{target_path}'"

    if not os.path.isfile(target_path):
        return False, f"Path is not a regular file: '{target_path}'"

    if allow_any_path:
        return True, "Allowed by explicit allow_any_path setting."

    allowed_bases = get_allowed_script_directories()
    try:
        abs_target = os.path.abspath(os.path.realpath(target_path))
        for base in allowed_bases:
            abs_base = os.path.abspath(os.path.realpath(base))
            if os.path.commonpath([abs_base, abs_target]) == abs_base:
                return True, "Path verified within approved scripts directory."
    except Exception as e:
        return False, f"Path validation error: {e}"

    allowed_str = ", ".join(allowed_bases)
    return False, (
        f"Security Restriction: Script '{os.path.basename(target_path)}' must reside within "
        f"an approved scripts directory ({allowed_str}). Enable 'Allow Any Path' in LeafFlow settings if needed."
    )


class AnyType(str):
    """Wildcard type for input and output passthrough wires."""
    def __ne__(self, __value: object) -> bool:
        return False


any_type = AnyType("*")


class RunLocalFileNode:
    """
    Safely executes a local file (.exe, .bat, .cmd, .ps1 on Windows; .sh or binary on Linux/macOS)
    with custom parameters and configurable working directory.
    Includes multi-layered security protections against remote/distributed workflow injection.
    """

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "file_path": ("STRING", {
                    "default": "",
                    "multiline": False,
                    "placeholder": "Path to script or exe (e.g. scripts/run.bat or /usr/local/bin/convert.sh)"
                }),
                "security_consent": ("BOOLEAN", {
                    "default": False,
                    "tooltip": "Mandatory safety verification. Must be explicitly checked to authorize execution. Automatically disarmed whenever an external workflow is loaded."
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
                    "placeholder": "Working directory (cwd). Leave empty to use the script's directory."
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
        "- Requires explicit 'security_consent' checkbox activation.\n"
        "- Confined to approved 'ComfyUI/scripts/' directory by default.\n"
        "- Never uses shell=True to prevent command chaining injection.\n"
        "- Automatically disarmed when opening shared workflows."
    )

    def resolve_target_path(self, file_path_input):
        """Resolves absolute or relative script paths against approved script directories."""
        clean = str(file_path_input or "").strip()
        if not clean:
            return None

        # Check direct absolute path
        if os.path.isabs(clean) and os.path.exists(clean):
            return os.path.normpath(clean)

        # Check relative to approved scripts directories
        for base in get_allowed_script_directories():
            candidate = os.path.normpath(os.path.join(base, clean))
            if os.path.exists(candidate):
                return candidate

        # Check relative to ComfyUI base path
        if hasattr(folder_paths, "base_path") and folder_paths.base_path:
            candidate = os.path.normpath(os.path.join(folder_paths.base_path, clean))
            if os.path.exists(candidate):
                return candidate

        return clean

    def build_command_args(self, target_path, params_str):
        """Builds a safe, non-shell command list suitable for subprocess.Popen(shell=False)."""
        parsed_args = []
        if params_str and params_str.strip():
            try:
                parsed_args = shlex.split(params_str.strip(), posix=(sys.platform != "win32"))
            except Exception as e:
                # Fallback to simple whitespace splitting if shlex encounters unclosed quotes
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
        security_consent=False,
        parameters="",
        working_directory="",
        run_mode="Synchronous (Wait for Output)",
        timeout=60,
        trigger=None,
        **kwargs
    ):
        passthrough_out = trigger if trigger is not None else ""

        # Check 1: Mandatory Security Consent Checkbox
        if not security_consent:
            err = (
                "Execution Blocked: 'security_consent' is unchecked. "
                "You must explicitly verify and check the consent box on this node before running local scripts."
            )
            print(f"[LeafFlow LocalRunner] {err}")
            return ("", err, -1, False, passthrough_out)

        # Check 2: Global Security Setting
        global_enabled = get_env_setting("ENABLE_LOCAL_FILE_EXECUTION", "true").lower() in ["true", "1", "yes"]
        if not global_enabled:
            err = "Execution Blocked: Local file execution is disabled in LeafFlow global settings."
            print(f"[LeafFlow LocalRunner] {err}")
            return ("", err, -1, False, passthrough_out)

        # Check 3: Path Resolution & Validation
        resolved_path = self.resolve_target_path(file_path)
        if not resolved_path:
            err = "Execution Error: 'file_path' is empty."
            return ("", err, -1, False, passthrough_out)

        allow_any_path = get_env_setting("ALLOW_ANY_SCRIPT_PATH", "false").lower() in ["true", "1", "yes"]
        permitted, perm_msg = is_script_path_permitted(resolved_path, allow_any_path=allow_any_path)
        if not permitted:
            print(f"[LeafFlow LocalRunner] {perm_msg}")
            return ("", perm_msg, -1, False, passthrough_out)

        # Determine working directory
        cwd = None
        if working_directory and working_directory.strip():
            cand_cwd = os.path.abspath(working_directory.strip())
            if os.path.isdir(cand_cwd):
                cwd = cand_cwd
            else:
                print(f"[LeafFlow LocalRunner] Warning: working_directory '{working_directory}' not found. Defaulting to script folder.")
                cwd = os.path.dirname(resolved_path)
        else:
            cwd = os.path.dirname(resolved_path)

        cmd_list = self.build_command_args(resolved_path, parameters)
        print(f"[LeafFlow LocalRunner] Executing '{os.path.basename(resolved_path)}' (mode: {run_mode}, cwd: '{cwd}')...")

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
                print(f"[LeafFlow LocalRunner] {msg}")
                return (msg, "", 0, True, passthrough_out)
            except Exception as e:
                err_msg = f"Failed to launch background process: {str(e)}"
                print(f"[LeafFlow LocalRunner] Error: {err_msg}")
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
                    print(f"[LeafFlow LocalRunner] Execution of '{os.path.basename(resolved_path)}' interrupted by user.")
                    raise

                if effective_timeout and (time.time() - start_time) > effective_timeout:
                    _kill_tree()
                    err = f"Execution timed out after {timeout} seconds."
                    print(f"[LeafFlow LocalRunner] {err}")
                    return ("", err, -1, False, passthrough_out)

                time.sleep(0.1)

            stdout_data, stderr_data = proc.communicate()
            exit_code = proc.returncode
            success = (exit_code == 0)

            print(f"[LeafFlow LocalRunner] Completed with exit code {exit_code} (success: {success}).")
            return (stdout_data or "", stderr_data or "", exit_code, success, passthrough_out)

        except Exception as e:
            err_msg = f"Process execution error: {str(e)}"
            print(f"[LeafFlow LocalRunner] {err_msg}")
            return ("", err_msg, -1, False, passthrough_out)

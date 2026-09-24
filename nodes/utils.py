import os
import re
import secrets
from urllib.parse import urlparse
import folder_paths

def get_saturnnodes_user_dir():
    """
    Returns the centralized user data directory: ComfyUI/user/default/SaturnNodes/
    Automatically migrates any legacy LeafFlow directory contents if present.
    """
    base_user = None
    try:
        if hasattr(folder_paths, "get_user_directory"):
            user_base = folder_paths.get_user_directory()
            if user_base:
                norm_base = os.path.normpath(user_base)
                if os.path.basename(norm_base).lower() == "user":
                    base_user = os.path.join(norm_base, "default")
                else:
                    base_user = norm_base
    except Exception:
        base_user = None

    if not base_user:
        root_dir = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
        base_user = os.path.join(root_dir, "user", "default")

    saturn_dir = os.path.join(base_user, "SaturnNodes")
    os.makedirs(saturn_dir, exist_ok=True)

    # Seamless automatic migration from legacy LeafFlow folder if needed
    legacy_dir = os.path.join(base_user, "LeafFlow")
    if os.path.isdir(legacy_dir):
        for f in [".env", "prompt_iterator_state.json"]:
            src = os.path.join(legacy_dir, f)
            dst = os.path.join(saturn_dir, f)
            if os.path.isfile(src) and not os.path.exists(dst):
                try:
                    import shutil
                    shutil.copy2(src, dst)
                except Exception:
                    pass

    return saturn_dir

get_leafflow_user_dir = get_saturnnodes_user_dir

_SESSION_CSRF_TOKEN = secrets.token_hex(32)

def get_csrf_token():
    """Returns the ephemeral cryptographically random session CSRF token generated on server boot."""
    return _SESSION_CSRF_TOKEN

def is_same_origin_or_direct(request):
    """
    Validates that a request originates from the local ComfyUI interface and not from a visited web page (CSRF defense).
    """
    if request is None:
        return True

    # 1. Reject cross-site requests via Fetch Metadata (modern browsers always send this; cannot be spoofed by JS)
    sec_fetch_site = getattr(request, "headers", {}).get("Sec-Fetch-Site")
    if sec_fetch_site and sec_fetch_site.lower() == "cross-site":
        return False

    # 2. Check Origin header if present
    origin = getattr(request, "headers", {}).get("Origin")
    if origin:
        try:
            parsed = urlparse(origin)
            host = parsed.hostname
            if host not in ["127.0.0.1", "localhost", "::1", "0.0.0.0", "testclient"]:
                return False
        except Exception:
            return False

    # 3. Check Referer header if present
    referer = getattr(request, "headers", {}).get("Referer")
    if referer:
        try:
            parsed_ref = urlparse(referer)
            ref_host = parsed_ref.hostname
            if ref_host not in ["127.0.0.1", "localhost", "::1", "0.0.0.0", "testclient"]:
                return False
        except Exception:
            return False

    return True

def is_authenticated_local_request(request):
    """
    Guarantees user-initiated actions and protects against CSRF / drive-by requests from open browser tabs:
    1. Originates strictly from loopback IP (is_local_request)
    2. Not a cross-site drive-by request (is_same_origin_or_direct)
    3. Contains a valid X-LeafFlow-CSRF-Token header matching the session secret.
    """
    if not is_local_request(request):
        return False
    if not is_same_origin_or_direct(request):
        return False

    headers = getattr(request, "headers", {})
    token = headers.get("X-SaturnNodes-CSRF-Token") or headers.get("X-LeafFlow-CSRF-Token")
    if not token or not secrets.compare_digest(token, _SESSION_CSRF_TOKEN):
        return False

    return True

def is_local_request(request):
    """
    Returns True if the HTTP request originates strictly from loopback (localhost / 127.0.0.1 / ::1).
    Used to protect sensitive endpoints (power control, system settings, file browsing).
    """
    if request is None:
        return True
    remote = getattr(request, "remote", None)
    if not remote:
        transport = getattr(request, "transport", None)
        if transport:
            peername = transport.get_extra_info("peername")
            if peername and isinstance(peername, tuple):
                remote = peername[0]
    if not remote:
        return False
    local_hosts = {"127.0.0.1", "::1", "localhost", "0.0.0.0", "testclient"}
    if remote in local_hosts:
        return True
    try:
        import ipaddress
        ip = ipaddress.ip_address(remote)
        return ip.is_loopback
    except Exception:
        return False

def get_allowed_image_directories():
    """
    Returns approved base directories for image loader operations: strictly ComfyUI input, output, and temp dirs.
    """
    allowed = []
    try:
        inp = folder_paths.get_input_directory()
        if inp:
            allowed.append(os.path.abspath(os.path.realpath(inp)))
    except Exception:
        pass
    try:
        out = folder_paths.get_output_directory()
        if out:
            allowed.append(os.path.abspath(os.path.realpath(out)))
    except Exception:
        pass
    try:
        tmp = folder_paths.get_temp_directory()
        if tmp:
            allowed.append(os.path.abspath(os.path.realpath(tmp)))
    except Exception:
        pass
    return allowed

def is_safe_path(target_path, allowed_bases=None):
    """
    Confines file access strictly within approved base directories.
    Prevents path traversal, directory escape, and arbitrary system file reads.
    """
    if not target_path:
        return False
    if allowed_bases is None:
        allowed_bases = get_allowed_image_directories()
    try:
        abs_target = os.path.abspath(os.path.realpath(target_path))
        for base in allowed_bases:
            abs_base = os.path.abspath(os.path.realpath(base))
            if os.path.commonpath([abs_base, abs_target]) == abs_base:
                return True
    except Exception:
        return False
    return False

def sanitize_image_loader_folder(folder_input, default_to_output=True):
    """
    Resolves folder input strictly within ComfyUI input/output/temp directories.
    Rejects directory traversal ('..') and unapproved absolute paths, strictly verifying confinement via commonpath.
    """
    allowed_bases = get_allowed_image_directories()
    input_dir = folder_paths.get_input_directory() if hasattr(folder_paths, "get_input_directory") else "."
    output_dir = folder_paths.get_output_directory() if hasattr(folder_paths, "get_output_directory") else "."
    default_dir = os.path.abspath(os.path.realpath(output_dir if default_to_output else input_dir))

    if not folder_input or not str(folder_input).strip():
        return default_dir

    clean = str(folder_input).strip().rstrip("\\/")

    # 1. Reject directory traversal sequences ('..')
    norm_slashes = clean.replace("\\", "/")
    if any(p == ".." for p in norm_slashes.split("/")):
        print(f"[SaturnNodes Security] Blocked directory traversal in image folder path '{clean}'. Confining to ComfyUI directories.")
        return default_dir

    # 2. Reject absolute paths (drive letters C:\, POSIX root /, UNC \\server)
    is_absolute = (
        os.path.isabs(clean)
        or bool(re.match(r'^[A-Za-z]:', clean))
        or clean.startswith(("//", "\\\\"))
    )
    if is_absolute:
        if not is_safe_path(clean, allowed_bases):
            print(f"[SaturnNodes Security] Blocked absolute image folder path '{clean}'. Confining to ComfyUI directories.")
            return default_dir
        return os.path.abspath(os.path.realpath(clean))

    # 3. Handle relative 'input' or 'output' prefixes
    if clean.lower() == "input" or clean.lower().startswith("input/") or clean.lower().startswith("input\\"):
        sub = clean[5:].lstrip("\\/")
        resolved = os.path.join(input_dir, sub) if sub else input_dir
    elif clean.lower() == "output" or clean.lower().startswith("output/") or clean.lower().startswith("output\\"):
        sub = clean[6:].lstrip("\\/")
        resolved = os.path.join(output_dir, sub) if sub else output_dir
    else:
        cand_out = os.path.join(output_dir, clean)
        cand_inp = os.path.join(input_dir, clean)
        if os.path.exists(cand_inp) and not os.path.exists(cand_out):
            resolved = cand_inp
        else:
            resolved = cand_out

    if is_safe_path(resolved, allowed_bases):
        return os.path.abspath(os.path.realpath(resolved))

    return default_dir

def get_env_setting(key, default_val):
    """
    Reads a key setting from ComfyUI/user/default/LeafFlow/.env safely.
    """
    user_dir = get_saturnnodes_user_dir()
    env_file = os.path.join(user_dir, ".env")
    if os.path.exists(env_file):
        try:
            with open(env_file, "r", encoding="utf-8") as f:
                for line in f:
                    if line.strip().startswith(f"{key}="):
                        return line.strip().split("=", 1)[1].strip()
        except Exception:
            pass
    return default_val

def parse_pretty_name(filepath):
    if not filepath or filepath in ["[ NONE ]", "[ RANDOM ]"]:
        return ""
    base = os.path.splitext(os.path.basename(filepath))[0]
    parts = base.split('_')
    if len(parts) >= 2:
        name_part = parts[1]
        name_part = re.sub(r'(?<=[a-z])(?=[A-Z])', ' ', name_part)
        name_part = name_part.replace('-', ' ')
        
        words = name_part.split()
        formatted_words = []
        for word in words:
            if word.upper() in ["NSFW", "LORA", "V1", "V2", "V3", "V4", "FP16", "HM"]:
                formatted_words.append(word.upper())
            else:
                formatted_words.append(word.capitalize())
        return " ".join(formatted_words)
    return base.replace('-', ' ')

def parse_pretty_name_with_version(filepath):
    if not filepath or filepath in ["[ NONE ]", "[ RANDOM ]"]:
        return ""
    base = os.path.splitext(os.path.basename(filepath))[0]
    parts = base.split('_')
    pretty_name = parse_pretty_name(filepath)
    
    if len(parts) >= 3:
        version_candidate = parts[2].strip()
        if re.match(r'^v[0-9]+(\.[0-9]+)?$', version_candidate, re.IGNORECASE):
            return f"{pretty_name} {version_candidate.upper()}"
    return pretty_name

def get_allowed_folder_watch_directories():
    """
    Returns approved base directories for folder watching and recent output scanning:
    strictly ComfyUI input and output directories.
    """
    allowed = []
    try:
        inp = folder_paths.get_input_directory()
        if inp:
            allowed.append(os.path.abspath(os.path.realpath(inp)))
    except Exception:
        pass
    try:
        out = folder_paths.get_output_directory()
        if out:
            allowed.append(os.path.abspath(os.path.realpath(out)))
    except Exception:
        pass
    return allowed

def sanitize_folder_path(folder_input, default_dir=None):
    """
    Confines folder paths strictly within ComfyUI's input and output directories.
    Rejects absolute paths and '..' directory traversal sequences.
    Resolves canonical realpath and verifies commonpath containment.
    """
    allowed_bases = get_allowed_folder_watch_directories()
    input_dir = folder_paths.get_input_directory() if hasattr(folder_paths, "get_input_directory") else None
    safe_fallback = os.path.join(input_dir, "watch") if input_dir else "watch"
    if default_dir:
        if os.path.isabs(default_dir):
            try:
                real_def = os.path.abspath(os.path.realpath(default_dir))
                for base in allowed_bases:
                    if os.path.commonpath([base, real_def]) == base:
                        safe_fallback = real_def
                        break
            except Exception:
                pass
        else:
            safe_fallback = default_dir

    if folder_input is None:
        folder_input = ""
    clean_folder = str(folder_input).strip()
    
    # Strip any trailing wildcards (e.g. "krea2\*" -> "krea2", "krea2/*" -> "krea2")
    clean_folder = re.sub(r'[\*\?]+$', '', clean_folder).rstrip("\\/")
    
    if not clean_folder:
        clean_folder = safe_fallback

    # 1. Reject absolute paths (drive letters C:\, POSIX root /, UNC \\server)
    is_absolute = (
        os.path.isabs(clean_folder)
        or bool(re.match(r'^[A-Za-z]:', clean_folder))
        or clean_folder.startswith(("//", "\\\\"))
    )

    # 2. Reject directory traversal sequences ('..')
    normalized_slashes = clean_folder.replace("\\", "/")
    parts = normalized_slashes.split("/")
    has_traversal = any(p == ".." for p in parts)

    if is_absolute or has_traversal:
        is_safe_default = False
        if is_absolute and safe_fallback and clean_folder == safe_fallback:
            try:
                real_clean = os.path.abspath(os.path.realpath(clean_folder))
                for base in allowed_bases:
                    if os.path.commonpath([base, real_clean]) == base:
                        is_safe_default = True
                        break
            except Exception:
                pass

        if not is_safe_default:
            print(f"[SaturnNodes Security] Blocked unsafe folder path '{clean_folder}' (absolute={is_absolute}, traversal={has_traversal}). Confining to ComfyUI input/output directories.")
            clean_folder = safe_fallback

    # 3. If clean_folder is an already-confined absolute path (e.g. from internal safe_fallback)
    if os.path.isabs(clean_folder):
        try:
            real_cand = os.path.abspath(os.path.realpath(clean_folder))
            for base in allowed_bases:
                if os.path.commonpath([base, real_cand]) == base:
                    return real_cand
        except Exception:
            pass
        return os.path.abspath(os.path.realpath(safe_fallback))

    # 4. For relative paths, evaluate candidates strictly within allowed_bases
    candidates = []
    for base in allowed_bases:
        target = os.path.abspath(os.path.realpath(os.path.join(base, clean_folder)))
        try:
            if os.path.commonpath([base, target]) == base:
                candidates.append((target, os.path.exists(target)))
        except Exception:
            continue

    # Return existing candidate if present on disk
    for target, exists in candidates:
        if exists:
            return target

    # Case-insensitive resolution within candidate parent folders
    for target, _ in candidates:
        parent_dir = os.path.dirname(target)
        base_name = os.path.basename(target)
        if os.path.exists(parent_dir):
            try:
                for entry in os.listdir(parent_dir):
                    if entry.lower() == base_name.lower():
                        match_path = os.path.join(parent_dir, entry)
                        real_match = os.path.abspath(os.path.realpath(match_path))
                        for base in allowed_bases:
                            if os.path.commonpath([base, real_match]) == base:
                                return real_match
            except Exception:
                pass

    if candidates:
        return candidates[0][0]

    default_input = folder_paths.get_input_directory() if hasattr(folder_paths, "get_input_directory") else "."
    return os.path.abspath(os.path.realpath(os.path.join(default_input, "watch")))

def format_lora_output_name(resolved_path, display_name, output_format="Parsed Name", custom_regex=""):
    if not resolved_path or resolved_path in ["[ NONE ]", "[ RANDOM ]"]:
        return ""

    if output_format == "Filename":
        return os.path.basename(resolved_path)
    elif output_format == "Filename without extension":
        return os.path.splitext(os.path.basename(resolved_path))[0]
    elif output_format == "Relative Path":
        return resolved_path.replace("\\", "/")
    elif output_format == "Full Path":
        full_p = folder_paths.get_full_path("loras", resolved_path)
        return full_p.replace("\\", "/") if full_p else resolved_path
    elif output_format == "Custom Regex" and custom_regex and custom_regex.strip():
        try:
            m = re.search(custom_regex, resolved_path)
            if m:
                return m.group(0)
        except Exception:
            pass
        return os.path.splitext(os.path.basename(resolved_path))[0]
    else: # "Parsed Name" (default)
        clean_name = display_name
        if " - " in display_name:
            clean_name = display_name.split(" - ", 1)[1]
        return re.sub(r'\s+V\d+(\.\d+)?$', '', clean_name, flags=re.IGNORECASE).strip()

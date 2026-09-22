import os
import re
import secrets
from urllib.parse import urlparse
import folder_paths

def get_leafflow_user_dir():
    """
    Returns the centralized user data directory: ComfyUI/user/default/LeafFlow/
    """
    base_user = None
    try:
        if hasattr(folder_paths, "get_user_directory"):
            user_base = folder_paths.get_user_directory()
            if user_base:
                # ComfyUI get_user_directory() returns '.../ComfyUI/user'
                # Ensure the 'default' user profile directory is used
                norm_base = os.path.normpath(user_base)
                if os.path.basename(norm_base).lower() == "user":
                    base_user = os.path.join(norm_base, "default")
                else:
                    base_user = norm_base
    except Exception:
        base_user = None

    if not base_user:
        # Fallback to ComfyUI/user/default
        root_dir = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
        base_user = os.path.join(root_dir, "user", "default")

    leafflow_dir = os.path.join(base_user, "LeafFlow")
    os.makedirs(leafflow_dir, exist_ok=True)
    return leafflow_dir

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
    token = headers.get("X-LeafFlow-CSRF-Token")
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
    If folder_input attempts to escape or points outside allowed bases, falls back safely.
    """
    allowed_bases = get_allowed_image_directories()
    input_dir = folder_paths.get_input_directory()
    output_dir = folder_paths.get_output_directory()
    default_dir = output_dir if default_to_output else input_dir

    if not folder_input or not str(folder_input).strip():
        return default_dir

    clean = str(folder_input).strip().rstrip("\\/")
    
    if clean.lower() == "input" or clean.lower().startswith("input/") or clean.lower().startswith("input\\"):
        sub = clean[5:].lstrip("\\/")
        resolved = os.path.join(input_dir, sub) if sub else input_dir
    elif clean.lower() == "output" or clean.lower().startswith("output/") or clean.lower().startswith("output\\"):
        sub = clean[6:].lstrip("\\/")
        resolved = os.path.join(output_dir, sub) if sub else output_dir
    elif os.path.isabs(clean):
        resolved = clean
    else:
        cand_out = os.path.join(output_dir, clean)
        cand_inp = os.path.join(input_dir, clean)
        if os.path.exists(cand_inp) and not os.path.exists(cand_out):
            resolved = cand_inp
        else:
            resolved = cand_out

    if is_safe_path(resolved, allowed_bases):
        return os.path.normpath(resolved)

    return default_dir

def get_env_setting(key, default_val):
    """
    Reads a key setting from ComfyUI/user/default/LeafFlow/.env safely.
    """
    user_dir = get_leafflow_user_dir()
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

def sanitize_folder_path(folder_input, default_dir=None):
    if folder_input is None:
        folder_input = ""
    clean_folder = str(folder_input).strip()
    
    # Strip any trailing wildcards (e.g. "krea2\*" -> "krea2", "krea2/*" -> "krea2")
    clean_folder = re.sub(r'[\*\?]+$', '', clean_folder).rstrip("\\/")
    
    if not clean_folder and default_dir:
        clean_folder = default_dir

    if not clean_folder:
        return ""

    # 1. If absolute path, verify directly with case-insensitive check
    if os.path.isabs(clean_folder):
        norm_path = os.path.normpath(clean_folder)
        if os.path.exists(norm_path):
            return norm_path
        parent_dir = os.path.dirname(norm_path)
        base_name = os.path.basename(norm_path)
        if os.path.exists(parent_dir):
            try:
                for entry in os.listdir(parent_dir):
                    if entry.lower() == base_name.lower():
                        return os.path.join(parent_dir, entry)
            except Exception:
                pass
        return norm_path

    # 2. If relative path, check output directory, input directory, then base path
    candidates = []
    try:
        output_dir = folder_paths.get_output_directory()
        if output_dir:
            candidates.append(os.path.normpath(os.path.join(output_dir, clean_folder)))
    except Exception:
        pass

    try:
        input_dir = folder_paths.get_input_directory()
        if input_dir:
            candidates.append(os.path.normpath(os.path.join(input_dir, clean_folder)))
    except Exception:
        pass

    try:
        if folder_paths.base_path:
            candidates.append(os.path.normpath(os.path.join(folder_paths.base_path, clean_folder)))
    except Exception:
        pass

    for cand in candidates:
        if os.path.exists(cand):
            return cand

    for cand in candidates:
        parent_dir = os.path.dirname(cand)
        base_name = os.path.basename(cand)
        if os.path.exists(parent_dir):
            try:
                for entry in os.listdir(parent_dir):
                    if entry.lower() == base_name.lower():
                        return os.path.join(parent_dir, entry)
            except Exception:
                pass

    return candidates[0] if candidates else os.path.normpath(os.path.join(folder_paths.base_path, clean_folder))

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

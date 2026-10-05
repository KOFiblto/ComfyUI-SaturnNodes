# 🛡️ ComfyUI Custom Node Security, Compliance & Architecture Rulebook
*The Authoritative Engineering Standard & Audit Playbook Derived from ComfyUI-Manager PR #3200 Review Precedents*

---

## 📑 Table of Contents
1. [Core Threat Model & The Golden Rule](#1-core-threat-model--the-golden-rule)
2. [Case Study: ComfyUI-Manager PR #3200 Review Precedents](#2-case-study-comfyui-manager-pr-3200-review-precedents)
3. [The 8 Core Security Rules (With Code Examples)](#3-the-8-core-security-rules)
   - [Rule 1: Filesystem Confinement & Traversal Prevention](#rule-1-filesystem-confinement--traversal-prevention)
   - [Rule 2: Destructive File Actions & Deletion Guards](#rule-2-destructive-file-actions--deletion-guards)
   - [Rule 3: Process Execution & The Workflow Serialization Trap](#rule-3-process-execution--the-workflow-serialization-trap)
   - [Rule 4: Dynamic Code Evaluation & Deserialization](#rule-4-dynamic-code-evaluation--deserialization)
   - [Rule 5: Web Endpoints & The Same-Machine Browser Fallacy (CSRF)](#rule-5-web-endpoints--the-same-machine-browser-fallacy-csrf)
   - [Rule 6: Two-Step Ephemeral Ticket Handshakes for Power Actions](#rule-6-two-step-ephemeral-ticket-handshakes-for-power-actions)
   - [Rule 7: Outbound Network Requests & SSRF Prevention](#rule-7-outbound-network-requests--ssrf-prevention)
   - [Rule 8: Configuration Storage, Isolation & Injection Defense](#rule-8-configuration-storage-isolation--injection-defense)
4. [Ecosystem & Registry Packaging Compliance](#4-ecosystem--registry-packaging-compliance)
   - [Rule 9: Zero Runtime Package Installations (`install.py` Prohibition)](#rule-9-zero-runtime-package-installations-installpy-prohibition)
   - [Rule 10: PyTorch Exclusion from Dependencies](#rule-10-pytorch-exclusion-from-dependencies)
   - [Rule 11: Headless & Cloud Container Resilience](#rule-11-headless--cloud-container-resilience)
   - [Rule 12: Core Monkey-Patching Isolation](#rule-12-core-monkey-patching-isolation)
5. [Frontend Hygiene & Canvas Safety](#5-frontend-hygiene--canvas-safety)
   - [Rule 13: Dual Frontend Architecture (V1 LiteGraph & V2 Vue UI)](#rule-13-dual-frontend-architecture-v1-litegraph--v2-vue-ui)
   - [Rule 14: Canvas Resize Loops (`computeSize` & `node.size`)](#rule-14-canvas-resize-loops-computesize--nodesize)
   - [Rule 15: Non-Serialized UI Widgets (`{ serialize: false }`)](#rule-15-non-serialized-ui-widgets--serialize-false-)
6. [Auditor & Maintainer Quick Conformance Matrix](#6-auditor--maintainer-quick-conformance-matrix)

---

## 1. Core Threat Model & The Golden Rule

### 1.1 The Golden Rule
> **"Treat every input, widget values included, as attacker-controlled, because it can come from a shared workflow or a direct `/prompt` call."**  
> — *ltdrdata (ComfyUI-Manager Lead Maintainer, Comfy-Org)*

### 1.2 The 4 Attack Vectors Unique to ComfyUI
1. **Shared Workflow Vectors (.json & PNG Metadata):**
   ComfyUI workflows are freely shared across community hubs (Civitai, Reddit, Discord, GitHub) as raw JSON files or embedded inside PNG image generation metadata. Loading a poisoned image instantly sets all node widgets on the canvas.
2. **The Same-Machine Browser Exploit (Drive-by Localhost CSRF):**
   Any website an operator visits in their regular browser can execute background JavaScript (`fetch('http://localhost:8188/...')`). Because this request originates from the operator's local computer, primitive IP loopback checks (`127.0.0.1`) pass automatically unless strict fetch metadata and CSRF headers are validated.
3. **Direct Headless API Injection (`POST /prompt`):**
   Attackers or automated scripts can bypass the graphical interface completely by sending malicious graph specifications directly to the server's `/prompt` endpoint.
4. **Host User Privileges:**
   ComfyUI processes run with the full security privileges of the logged-in operating system user. Any sandbox breakout, unchecked script runner, or arbitrary file deletion results in immediate compromise of personal files or host systems.

---

## 2. Case Study: ComfyUI-Manager PR #3200 Review Precedents

During the official registration of **`ComfyUI-SaturnNodes`** in [Comfy-Org/ComfyUI-Manager#3200](https://github.com/Comfy-Org/ComfyUI-Manager/pull/3200), lead maintainer `@ltdrdata` conducted a three-phase security review. This exchange set definitive precedents for all modern custom nodes:

### Round 1: Unauthenticated Power Routes & Arbitrary File Reads
* **Maintainer Finding:** Exposing network routes that restart/shutdown the server, stream files by absolute path, or write to `.env` without access controls is strictly forbidden.
* **Precedent:** File reads must be confined to fixed base directories. Power management and settings routes must be local-only and strictly constrained.

### Round 2: The Same-Machine Fallacy & The Workflow Serialization Trap
* **Maintainer Finding:**
  1. *Same-Machine Check Failure:* A basic IP loopback check (`request.remote == "127.0.0.1"`) is insufficient. Any open browser tab makes requests from `localhost`, allowing malicious web pages to trigger restarts, shutdowns, or settings changes.
  2. *Escape Hatches Forbidden:* Settings toggles such as `ALLOW_ANY_SCRIPT_PATH` that bypass folder confinement must be completely removed.
  3. *In-Workflow Consent Fallacy:* A `security_consent` boolean widget in `INPUT_TYPES` defaults to `False` in code, but a shared malicious workflow arrives with `security_consent: True` already serialized. Execution consent must never travel with the graph.
* **Precedent:** 
  - Routes must validate `Sec-Fetch-Site` (blocking `cross-site`) and verify cryptographic CSRF tokens.
  - Process execution must require interactive, in-memory human authorization on the canvas node via an ephemeral RAM token.

### Round 3: Folder Deletion Sandbox Bypass
* **Maintainer Finding:** `sanitize_folder_path` allowed relative paths (`..`) and absolute paths. In a folder watcher node with an optional `delete_image` flag, an attacker could supply `folder: "C:/Windows"` or `../../` and delete arbitrary user files.
* **Precedent:** All path-handling functions must reject absolute paths, reject `..`, and verify canonical containment against approved ComfyUI directories using `os.path.commonpath`.

---

## 3. The 8 Core Security Rules

### Rule 1: Filesystem Confinement & Traversal Prevention

Nodes must never read, write, or list files outside designated ComfyUI directories (`input/`, `output/`, `temp/`, and `models/`).

#### ❌ Non-Compliant Patterns
```python
# VULNERABLE: Accepts arbitrary absolute paths or directory traversal
def load_image(self, folder, filename):
    filepath = os.path.join(folder, filename)
    with open(filepath, "rb") as f: # Attacker loads C:\Users\user\.ssh\id_rsa
        return f.read()
```

#### ✅ Compliant Pattern
```python
import os
import re

def sanitize_folder_path(folder_input: str, allowed_base_dir: str) -> str:
    """
    Strictly confines a folder to an allowed base directory.
    Rejects absolute paths, drive letters, UNC shares, and parent traversal.
    """
    if not folder_input or not folder_input.strip():
        return allowed_base_dir

    raw_path = folder_input.strip()

    # Reject Windows drive letters (C:) and UNC network paths (// or \\)
    if re.match(r'^[A-Za-z]:', raw_path) or raw_path.startswith(("\\\\", "//")):
        raise ValueError(f"Absolute or network paths are forbidden: {raw_path}")

    # Reject root slashes and directory traversal
    if raw_path.startswith(("/", "\\")) or ".." in raw_path.replace("\\", "/").split("/"):
        raise ValueError(f"Directory traversal sequences are forbidden: {raw_path}")

    # Canonicalize and verify commonpath boundary
    canonical_base = os.path.realpath(allowed_base_dir)
    target_path = os.path.realpath(os.path.join(canonical_base, raw_path))

    if os.path.commonpath([canonical_base, target_path]) != canonical_base:
        raise ValueError(f"Path escapes allowed sandbox: {target_path}")

    return target_path
```

---

### Rule 2: Destructive File Actions & Deletion Guards

Any node that deletes or overwrites files (`os.remove`, `os.unlink`, `shutil.rmtree`) must verify containment immediately prior to invocation.

#### ❌ Non-Compliant Patterns
```python
# VULNERABLE: Trusting earlier sanitization or allowing unverified deletion
def cleanup_cache(self, user_supplied_path):
    if os.path.exists(user_supplied_path):
        os.remove(user_supplied_path) # Arbitrary file deletion
```

#### ✅ Compliant Pattern
```python
def safe_delete_image(target_file_path: str, allowed_folders: list[str]) -> bool:
    """
    Verifies target file is strictly inside input/output before deletion.
    """
    real_target = os.path.realpath(target_file_path)
    if not os.path.isfile(real_target):
        return False

    is_confined = any(
        os.path.commonpath([os.path.realpath(base), real_target]) == os.path.realpath(base)
        for base in allowed_folders
    )

    if not is_confined:
        raise PermissionError(f"Security Violation: Refusing to delete file outside sandbox: {real_target}")

    os.remove(real_target)
    return True
```

---

### Rule 3: Process Execution & The Workflow Serialization Trap

Executing external binaries or scripts is high risk. You must adhere to the following principles:

1. **The Workflow Serialization Trap:** Never include an authorization checkbox (e.g. `"security_consent": ("BOOLEAN", {"default": False})`) in `INPUT_TYPES`. Attackers distribute workflows with `"security_consent": True` already serialized.
2. **Ephemeral RAM Authorization:** Authorization must occur via an in-memory session token generated when the user physically clicks a canvas UI button (e.g. `[⚡ Authorize Run]`).
3. **Execution Confinement:** Scripts must reside strictly within a dedicated directory (e.g., `ComfyUI/scripts/`).
4. **Never Use `shell=True`:** Always tokenize arguments (`shlex.split` or list) and execute with `shell=False`.

#### ❌ Non-Compliant Patterns
```python
# VULNERABLE: shell=True, arbitrary paths, and consent stored in workflow JSON
class VulnerableRunner:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "command": ("STRING", {"default": "python script.py"}),
                "user_consent": ("BOOLEAN", {"default": False}), # Poisoned via JSON!
            }
        }
    def run(self, command, user_consent):
        if user_consent:
            subprocess.Popen(command, shell=True) # Remote Code Execution
```

#### ✅ Compliant Pattern
```python
import subprocess
import shlex
import time
import os

# Stored strictly in volatile Python memory (RAM), never serialized to disk
ACTIVE_RUN_AUTHORIZATIONS: dict[str, float] = {}

def authorize_node_execution(node_id: str, ttl_seconds: int = 300) -> str:
    """Invoked only by interactive UI button via authenticated CSRF route."""
    token = os.urandom(16).hex()
    ACTIVE_RUN_AUTHORIZATIONS[node_id] = time.time() + ttl_seconds
    return token

def execute_confined_script(script_name: str, args_list: list[str], node_id: str, scripts_dir: str):
    # 1. Verify in-memory authorization
    expiry = ACTIVE_RUN_AUTHORIZATIONS.pop(node_id, 0)
    if time.time() > expiry:
        raise PermissionError("Execution denied: Interactive operator authorization required on canvas.")

    # 2. Confine target executable to scripts/ directory
    real_scripts_base = os.path.realpath(scripts_dir)
    target_script = os.path.realpath(os.path.join(real_scripts_base, script_name))

    if os.path.commonpath([real_scripts_base, target_script]) != real_scripts_base:
        raise ValueError("Script escape detected.")

    if not os.path.isfile(target_script):
        raise FileNotFoundError(f"Script not found: {script_name}")

    # 3. Safe execution with shell=False
    cmd = ["python", target_script] + args_list
    proc = subprocess.Popen(
        cmd,
        shell=False,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True
    )
    return proc.communicate(timeout=60)
```

---

### Rule 4: Dynamic Code Evaluation & Deserialization

Never pass widget string inputs into `eval()`, `exec()`, or dynamic `importlib` calls.

#### ❌ Non-Compliant Patterns
```python
# VULNERABLE: Direct eval allows __import__('os').system('...')
def calculate_aspect(self, formula_string):
    return eval(formula_string)
```

#### ✅ Compliant Pattern
```python
import ast
import operator

SAFE_OPERATORS = {
    ast.Add: operator.add,
    ast.Sub: operator.sub,
    ast.Mult: operator.mul,
    ast.Div: operator.truediv,
}

def safe_eval_math(expression: str) -> float:
    """Parses mathematical expression using an Abstract Syntax Tree (AST)."""
    node = ast.parse(expression, mode='eval').body
    def _eval(node):
        if isinstance(node, ast.Constant) and isinstance(node.value, (int, float)):
            return node.value
        if isinstance(node, ast.BinOp) and type(node.op) in SAFE_OPERATORS:
            return SAFE_OPERATORS[type(node.op)](_eval(node.left), _eval(node.right))
        raise ValueError(f"Unsafe expression: {expression}")
    return float(_eval(node))
```

---

### Rule 5: Web Endpoints & The Same-Machine Browser Fallacy (CSRF)

Because any malicious web page the operator visits in another tab can target `http://127.0.0.1:8188`, endpoints that mutate state or trigger actions must defend against cross-site requests.

#### Required Multi-Layer Defense:
1. **Loopback IP Verification:** Peer address must be `127.0.0.1`, `::1`, or `localhost`.
2. **Fetch Metadata Inspection:** `Sec-Fetch-Site` header must **not** be `cross-site`.
3. **Cryptographic CSRF Header:** Require a per-session secret token in a custom header (e.g. `X-SaturnNodes-CSRF-Token`). Browsers forbid cross-origin pages from sending custom headers without CORS preflight approval.

#### ✅ Compliant Pattern
```python
import secrets
from aiohttp import web

SESSION_CSRF_TOKEN = secrets.token_hex(32)

def is_authenticated_local_request(request: web.Request) -> bool:
    """
    Blocks remote network callers AND malicious cross-site browser requests.
    """
    # 1. IP Loopback Check
    peername = request.transport.get_extra_info('peername')
    client_ip = peername[0] if peername else ""
    if client_ip not in ("127.0.0.1", "::1", "localhost"):
        return False

    # 2. Browser Fetch Metadata Defense (blocks drive-by background fetches)
    sec_fetch_site = request.headers.get("Sec-Fetch-Site", "")
    if sec_fetch_site in ("cross-site",):
        return False

    # 3. Custom Header & Secret Verification (triggers CORS preflight rejection)
    token = request.headers.get("X-SaturnNodes-CSRF-Token", "")
    if not token or not secrets.compare_digest(token, SESSION_CSRF_TOKEN):
        return False

    return True
```

---

### Rule 6: Two-Step Ephemeral Ticket Handshakes for Power Actions

High-impact administrative actions (restarting ComfyUI, shutting down the host, mass cache purges) must **never** trigger from a single `POST` endpoint.

#### Handshake Protocol:
1. **Disabled by Default:** Master setting `ALLOW_PROCESS_MANAGEMENT = False`.
2. **Step 1 (`POST /power/request_token`):** Server validates local CSRF session, generates a single-use token in RAM with a 30-second TTL, and returns it to the client.
3. **Step 2 (`POST /power/confirm_action`):** Client provides the single-use token. Server validates, burns the token, and schedules the action.

---

### Rule 7: Outbound Network Requests & SSRF Prevention

If your custom node scrapes images, models, or metadata from the internet (Civitai, HuggingFace, TMDB):

1. **Opt-In Only:** Background scraping must be disabled by default in settings.
2. **Protocol Confinement:** Allow only `http://` and `https://`. Reject `file://`, `ftp://`, and `gopher://`.
3. **Private IP & Cloud Metadata Blocking (SSRF):** Reject requests resolving to:
   - Loopback: `127.0.0.0/8`, `::1`
   - Private LAN: `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`
   - Link-Local / Cloud Metadata: `169.254.169.254`

#### ✅ Compliant Pattern
```python
import ipaddress
import socket
from urllib.parse import urlparse

def is_safe_external_url(url: str) -> bool:
    try:
        parsed = urlparse(url)
        if parsed.scheme not in ("http", "https"):
            return False

        hostname = parsed.hostname
        if not hostname:
            return False

        # Resolve IP and check for private / loopback / metadata ranges
        ip_addr = socket.gethostbyname(hostname)
        ip = ipaddress.ip_address(ip_addr)

        if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved:
            return False

        return True
    except Exception:
        return False
```

---

### Rule 8: Configuration Storage, Isolation & Injection Defense

All user runtime state, custom settings, and caches must be stored cleanly inside ComfyUI's user directory:
`ComfyUI/user/default/<YourCustomNodeName>/`

- **Newline Injection Defense:** When writing to `.env` or config files, strip `\r` and `\n` from both keys and values to prevent setting forgery.
- **Atomic Disk Writes:** Write data to a temporary file (`.tmp`) first, then commit via `os.replace` to prevent corrupted files on unexpected shutdowns.
- **Log Masking:** Strip or mask API keys (`sk-***`, token hashes) in console output.

---

## 4. Ecosystem & Registry Packaging Compliance

To pass automated and manual review in the official ComfyUI Registry and ComfyUI-Manager:

### Rule 9: Zero Runtime Package Installations (`install.py` Prohibition)
- **Prohibited:** Creating an `install.py` script that invokes `subprocess.run(["pip", "install", ...])` during ComfyUI startup.
- **Mandated:** Declare all dependencies cleanly in `requirements.txt` and `pyproject.toml`.

### Rule 10: PyTorch Exclusion from Dependencies
- **Prohibited:** Listing `torch` or `torchvision` in your custom node's `requirements.txt` or `pyproject.toml`.
- **Reason:** ComfyUI manages its own PyTorch/CUDA environment. Specifying `torch` causes pip to downgrade or corrupt the user's CUDA acceleration binaries.

### Rule 11: Headless & Cloud Container Resilience
- If using desktop GUI dependencies (e.g. `pystray` system tray icons, Tkinter windows), wrap imports in `try/except ImportError` and provide silent headless fallbacks so cloud instances (RunPod, Colab, Docker) do not crash on launch.

### Rule 12: Core Monkey-Patching Isolation
- If overriding core ComfyUI objects (such as `PromptQueue`), the monkey-patch must be conditionally executed **only** if the corresponding feature flag is enabled in settings. If the user disables the feature, core classes must remain untouched.

---

## 5. Frontend Hygiene & Canvas Safety

### Rule 13: Dual Frontend Architecture (V1 LiteGraph & V2 Vue UI)
- All custom UI extensions must verify compatibility with both the classic LiteGraph canvas and the modern ComfyUI Vue V2 interface.
- In hooks (`nodeCreated`, `beforeRegisterNodeDef`), verify both `node.comfyClass` and `node.type`.

### Rule 14: Canvas Resize Loops (`computeSize` & `node.size`)
- Never compute widget heights dynamically based on `this.size[1]` inside `computeSize()`. In LiteGraph, this creates an infinite resize loop where the node expands downwards continuously on every draw frame.

### Rule 15: Non-Serialized UI Widgets (`{ serialize: false }`)
- Dynamic preview widgets, action buttons, ranking badges, and status labels must be configured with:
  ```javascript
  widget.serialize = false;
  // or widget.options = { serialize: false };
  ```
  This prevents transient UI states from cluttering the user's saved workflow JSON.

---

## 6. Auditor & Maintainer Quick Conformance Matrix

Use this matrix when auditing your own or third-party ComfyUI custom nodes:

| Domain | Mandatory Security Requirement | Verification Method |
| :--- | :--- | :--- |
| **Filesystem** | Absolute paths (`C:`, `/`, `\\`) rejected | Test with `C:\Windows\System32` & `/etc/passwd` |
| **Filesystem** | Directory traversal (`..`) rejected | Test with `../../` |
| **Filesystem** | Canonical path confinement via `commonpath` | Verify `commonpath([base, target]) == base` |
| **Deletion** | Deletions strictly confined to `input/` and `output/` | Verify boundary check immediately before `os.remove` |
| **Execution** | `shell=False` enforced on all subprocesses | Inspect all `subprocess.Popen` / `subprocess.run` calls |
| **Execution** | Scripts confined strictly to `ComfyUI/scripts/` | Verify realpath check against scripts directory |
| **Execution** | Execution consent **absent** from `INPUT_TYPES` | Verify no authorization widgets in workflow JSON |
| **Execution** | In-memory interactive operator authorization | Confirm single-use RAM token generated via UI button |
| **Network** | Loopback checks on administrative routes | Test request from non-local IP (expects 403) |
| **Network** | CSRF defense: `Sec-Fetch-Site` + custom token header | Test request with `Sec-Fetch-Site: cross-site` |
| **Network** | Two-step ephemeral ticket for restart/shutdown | Verify token generation + confirmation handshake |
| **Network** | SSRF: Private IPs & cloud metadata blocked | Test with `127.0.0.1`, `192.168.1.1`, `169.254.169.254` |
| **Network** | Scraping features opt-in (disabled by default) | Verify settings default to `false` |
| **Packaging** | No `install.py` / dynamic pip execution | Verify absence of `install.py` |
| **Packaging** | `torch` excluded from `requirements.txt` | Verify dependencies list |
| **Data** | Data stored in `user/default/<pack>/` | Inspect state and cache file paths |
| **Frontend** | UI widgets marked `{ serialize: false }` | Inspect exported workflow JSON for UI clutter |

---
*Maintained under the ComfyUI-SaturnNodes security framework. Conforms strictly to Comfy-Org registry audit policies.*

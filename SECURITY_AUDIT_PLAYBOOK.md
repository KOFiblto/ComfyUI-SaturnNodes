# 🛡️ ComfyUI Node Security Audit Playbook
*A Repeatable, Step-by-Step Security Review & Conformance Framework for ComfyUI Custom Node Developers and Auditors.*

---

## 🎯 The Core Philosophy & Threat Model

> **The Golden Rule (by @ltdrdata, ComfyUI-Manager maintainer):**  
> *"Treat every input, widget values included, as attacker-controlled, because it can come from a shared workflow or a direct `/prompt` call."*

### Why ComfyUI Nodes Require a Hostile Threat Model
1. **Shared Workflow Vectors:** ComfyUI workflows are routinely shared across the internet as `.json` files or embedded inside `.png` image metadata (on Civitai, Reddit, Discord, GitHub).
2. **Zero-Interaction Poisoning:** When a user drags and drops a contaminated image or loads a workflow JSON, widget values are immediately populated with whatever data the author specified.
3. **Headless & API Execution:** Malicious payloads can be sent directly to the local server via `POST /prompt` without any UI interaction.
4. **Local Host Privileges:** ComfyUI runs with the full local privileges of the host user account. Any vulnerability can lead to Remote Code Execution (RCE), arbitrary file deletion, or sensitive data theft.

---

## 📋 The 4-Phase Security Audit Checklist

When auditing a new or existing custom node pack, execute the following four phases step by step.

---

### Phase 1: Node-by-Node Audit Matrix (The 7 Vector Checklist)

Repeat this checklist for **every single custom node** in `NODE_CLASS_MAPPINGS`.

#### 1.1 Filesystem Paths & Directory Traversal
* [ ] **No Unchecked Absolute Paths:** Does the node accept file or folder paths as input strings?
  - Absolute paths (e.g. `C:\`, `/etc/`, `\\server\share`) must be strictly rejected unless explicitly intended and approved.
  - Windows drive letter patterns (`^[A-Za-z]:`) and UNC paths (`^//`, `^\\\\`) must be blocked.
* [ ] **No Directory Traversal (`..`):** Does the node reject any path segment containing `..`?
* [ ] **Canonical Path Confinement via `commonpath`:**
  - Are paths resolved to canonical real paths using `os.path.realpath`?
  - Are resolved paths checked against an authorized base directory using `os.path.commonpath`?
    ```python
    real_base = os.path.realpath(allowed_base)
    real_target = os.path.realpath(target_path)
    if os.path.commonpath([real_base, real_target]) != real_base:
        raise ValueError("Directory traversal attempt detected.")
    ```
* [ ] **Confined Base Directories:** Are file reads and writes confined strictly to approved ComfyUI folders (`input/`, `output/`, `temp/`, or `models/`)?

#### 1.2 Destructive Actions (Deletions, Writes, Overwrites)
* [ ] **Safe Deletion Guards:** If the node contains `os.remove`, `os.unlink`, or `shutil.rmtree`:
  - Is file deletion strictly confined to `input/` or `output/`?
  - Does the node refuse to delete files outside the confined sandbox, even if a manipulated path is provided?
  - Does the deletion toggle default to `False`?
* [ ] **Atomic File Writes:** When writing JSON, cache, or state files, are writes executed atomically via temporary files (`.tmp` + `os.replace`) to prevent corruption during unexpected shutdowns?
* [ ] **Read-Only Filesystem Defense:** Are disk writes wrapped in `try / except (PermissionError, OSError)` with graceful logging to prevent server crashes on read-only Docker/network mounts?

#### 1.3 Command & Process Execution
* [ ] **Never Use `shell=True`:** Are all subprocess calls executed with `shell=False` and tokenized argument lists (`shlex.split` or list of strings)?
* [ ] **Strict Executable Confinement:** Are scripts or binaries restricted strictly to a dedicated directory (e.g., `ComfyUI/scripts/`)?
* [ ] **In-Memory Operator Authorization Gate:**
  - Can script execution consent travel inside workflow JSON or image metadata? (Answer must be **NO**).
  - Does execution require an interactive, in-memory user action on the canvas node (e.g. `[⚡ Authorize Run]` with an ephemeral RAM token) before queueing?
* [ ] **Master Safety Switch:** Is local script/process execution disabled by default in settings (`ENABLE_LOCAL_FILE_EXECUTION = False`)?
* [ ] **Process Tree Termination & Timeouts:** Do subprocesses enforce strict execution timeouts and clean process-tree termination on user cancellation?

#### 1.4 Dynamic Code Evaluation
* [ ] **Zero `eval()` or `exec()` on Inputs:** Does the node evaluate mathematical expressions, conditions, or strings using Python's `eval()` or `exec()`?
  - `eval()` and `exec()` on widget inputs represent instantaneous Remote Code Execution (RCE).
  - Use safe AST parsers (such as `ast.literal_eval` or custom math parsers) instead.
* [ ] **No Dynamic Imports from Input Strings:** Does the node invoke `__import__` or `importlib.import_module` using user-supplied module names?

#### 1.5 Outbound Network Requests & SSRF
* [ ] **Strict Protocol Validation:** Do web requests (e.g. preview scrapers, API fetchers) strictly require `https://` or `http://`? (`file://`, `ftp://`, `gopher://` must be rejected).
* [ ] **Internal Network & Loopback Blocking:**
  - Are requests to `127.0.0.1`, `localhost`, `::1`, and `0.0.0.0` blocked?
  - Are private IPv4/IPv6 ranges blocked (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`)?
  - Are cloud metadata services blocked (`169.254.169.254` on AWS/GCP/Azure)?
* [ ] **Opt-In Network Activity:** Are external web scraping or API features disabled by default, requiring explicit user activation?

#### 1.6 Regular Expression DoS (ReDoS) & Input Validation
* [ ] **Regex Error Handling:** Are user-provided regular expressions wrapped in `try / except re.error` with a safe fallback to prevent unhandled crashes?
* [ ] **Catastrophic Backtracking Defense:** Are regex patterns inspected for exponential backtracking vulnerability (e.g. `(a+)+$`)?
* [ ] **String Splitting Delimiters:** When parsing delimited inputs (e.g. CSV find/replace targets), does the parser handle quoted strings containing delimiters without fragmentation?

#### 1.7 Resource Exhaustion & Memory Allocation
* [ ] **Bounded Iteration:** Do loop nodes (e.g. batch iterators, queue steppers) enforce sane upper bounds to prevent infinite loops?
* [ ] **Image Dimension Clamping:** Are image dimensions, aspect ratio scalers, and tensor buffers validated to prevent out-of-memory (OOM) allocation bombs?

---

### Phase 2: Administrative Endpoints & Web Routes Review

Examine all routes registered via `PromptServer.instance.app.routes` in `__init__.py` or route handlers.

#### 2.1 Loopback Origin Enforcement (`is_local_request`)
* [ ] **Local-Only Verification:** Do sensitive endpoints check the client's peer IP address and reject non-loopback connections (`127.0.0.1` / `::1`) with `403 Forbidden`?

#### 2.2 Cross-Site Request Forgery (CSRF) & Fetch Metadata
* [ ] **Same-Machine Browser Exploit Defense:** A local-only IP check is insufficient on its own because any malicious website visited by the user in another browser tab makes requests from `localhost`!
* [ ] **`Sec-Fetch-Site` Validation:** Does the route inspect the browser-enforced `Sec-Fetch-Site` header and reject `cross-site` calls?
* [ ] **Origin / Referer Validation:** Does the route verify that `Origin` or `Referer` matches the ComfyUI host?
* [ ] **Cryptographic Session CSRF Token:** Do state-mutating `POST` endpoints require a session token header (e.g. `X-CSRF-Token`) generated on server startup?

#### 2.3 Two-Step Ephemeral Ticket Handshakes for High-Impact Actions
* [ ] **Destructive Action Isolation:** Are high-impact administrative actions (server restart, shutdown, mass cache wipe) separated into a two-step handshake?
  1. `POST /request_token`: Client requests a single-use token stored in server RAM with a short TTL (30 seconds).
  2. `POST /confirm_action`: Client presents the single-use token to execute the action.
* [ ] **Default Disabled:** Are server management features disabled by default in settings (`ALLOW_PROCESS_MANAGEMENT = False`)?

---

### Phase 3: Settings & Persistent Configuration Review

Inspect how preferences, credentials, and states are stored.

#### 3.1 Safe Directory Isolation
* [ ] **Centralized Data Directory:** Are user data and settings stored in `ComfyUI/user/default/<PackName>/` rather than cluttering root or writing to random system paths?
* [ ] **No Secret Tracking in Git:** Are `.env` files, API keys, and local state files strictly added to `.gitignore`?
* [ ] **Log Masking:** Are secret keys (e.g. Civitai API keys, TMDB tokens) masked (`***` or truncated) when output to server logs?

#### 3.2 Configuration File Injection Defense
* [ ] **Newline Injection Defense:** When writing `.env` or configuration key-value pairs, are keys and values sanitized against `\r` and `\n` to prevent config poisoning?

---

### Phase 4: ComfyUI Ecosystem & Registry Compliance

Review package structure against the official Comfy-Org registry and ComfyUI-Manager requirements.

#### 4.1 Packaging & Dependency Standards
* [ ] **No `install.py`:** Is `install.py` completely eliminated? (Comfy-Org prohibits `install.py` executing `pip install` subprocesses on startup).
* [ ] **Transparent `requirements.txt` & `pyproject.toml`:** Are dependencies clearly declared with standard version constraints?
* [ ] **No PyTorch in Dependencies:** Is `"torch"` omitted from `requirements.txt` / `pyproject.toml` dependencies? (ComfyUI manages its own PyTorch/CUDA environment).
* [ ] **Optional Headless Dependencies:** Are GUI-dependent packages (like system tray `pystray`) made optional or headless-tolerant so cloud containers (Docker, RunPod, Colab) boot cleanly?

#### 4.2 Frontend Compatibility & Widget Serialization
* [ ] **Dual Frontend Support:** Does the node suite function cleanly on both **Frontend V1 (LiteGraph)** and **Frontend V2 (Vue UI)**?
* [ ] **No Canvas Runaway Loops:** Do custom DOM widgets avoid overriding `computeSize()` with formulas tied to `node.size[1]`, which triggers infinite downward expansion in LiteGraph?
* [ ] **Serialization Hygiene:** Are UI-only preview badges and widgets explicitly marked `{ serialize: false }` to avoid polluting saved workflow JSON?

#### 4.3 Core Monkey-Patching Isolation
* [ ] **Conditional Patching:** If the node pack overrides any core ComfyUI server or queue functions (e.g. `PromptQueue`), is the patch completely bypassed when the feature toggle is disabled?

---

## 🔍 Rapid Audit Checklist Matrix

Use this quick scorecard when reviewing a custom node pack:

| Category | Check | Status |
| :--- | :--- | :---: |
| **Inputs** | Absolute paths rejected | [ ] |
| **Inputs** | Directory traversal (`..`) rejected | [ ] |
| **Inputs** | Path confinement verified with `commonpath` | [ ] |
| **Inputs** | Regex errors caught and handled | [ ] |
| **Execution** | `shell=False` enforced on all subprocesses | [ ] |
| **Execution** | Scripts confined to dedicated directory | [ ] |
| **Execution** | Consent cannot travel in workflow JSON | [ ] |
| **Execution** | In-memory interactive operator authorization | [ ] |
| **Network** | SSRF protection: loopback & private LAN blocked | [ ] |
| **Network** | Protocol restricted to HTTP/HTTPS | [ ] |
| **Network** | Scrapers & network features opt-in | [ ] |
| **Endpoints** | Loopback origin checks on admin routes | [ ] |
| **Endpoints** | `Sec-Fetch-Site` CSRF defense | [ ] |
| **Endpoints** | Ephemeral ticket handshake for power actions | [ ] |
| **Settings** | Dangerous features default to `False` | [ ] |
| **Settings** | Data stored in `user/default/<pack>/` | [ ] |
| **Packaging** | No `install.py` / import-time `pip` | [ ] |
| **Packaging** | Dependencies in `requirements.txt` | [ ] |
| **Frontend** | Clean V1 and V2 compatibility without resize loops | [ ] |

---
*Created for ComfyUI-SaturnNodes to maintain institutional security compliance.*

# Security Policy

## Reporting Security Issues

We take the security of ComfyUI-LeafFlow seriously. If you discover a security vulnerability or sensitive key exposure, please **DO NOT** open a public issue.

Instead, please report security vulnerabilities directly to the maintainer via GitHub private vulnerability reporting.

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 2.x     | :white_check_mark: |
| 1.x     | :white_check_mark: |

## Security Architecture & Best Practices

- **CSRF Defense & Fetch Metadata Validation**: All administrative endpoints (`/leafflow/settings`, `/leafflow/power/*`, `/leafflow/local_runner/*`, `/leafflow/scrapes/clear`) enforce multi-layer CSRF protection via `is_authenticated_local_request(request)`.
  - Enforces loopback origin checks (`127.0.0.1` / `::1`), rejecting remote calls with `403 Forbidden`.
  - Rejects `cross-site` requests via `Sec-Fetch-Site` header checks, preventing external malicious web pages visited by the operator from triggering actions.
  - Verifies `Origin` and `Referer` headers against loopback hostnames.
  - Requires cryptographically random session tokens in the `X-LeafFlow-CSRF-Token` header (`secrets.compare_digest`), prompting CORS preflight rejection if an external origin attempts unauthorized requests.
- **Two-Step Ephemeral Ticket Handshake for Power Actions**:
  - Server restart and shutdown endpoints require `ALLOW_PROCESS_MANAGEMENT=true` in settings.
  - Execution requires a two-step handshake: the client requests a single-use ephemeral ticket (`POST /leafflow/power/request_token`) valid for 30 seconds.
  - The confirmation endpoint (`POST /leafflow/power/confirm_action`) consumes the single-use ticket in server memory before executing restart or shutdown, preventing arbitrary or cross-site triggers.
- **Strict Local Script Confinement**:
  - `RunLocalFileNode` strictly confines executable scripts and binaries to `ComfyUI/scripts/`.
  - Absolute paths (e.g. `C:\`, `/etc/`, `\\server`) and directory traversal sequences (`..`) are strictly rejected.
  - Paths are verified via canonical `os.path.realpath` and `os.path.commonpath` checks against the scripts directory. Unsafe path bypasses have been completely removed.
- **In-Memory Operator Authorization Gate**:
  - Local file execution defaults to disabled (`ENABLE_LOCAL_FILE_EXECUTION = false`).
  - `security_consent` input widget was removed from `INPUT_TYPES` to ensure authorization parameters NEVER travel within workflow JSON or embedded PNG metadata.
  - Workflows loaded from the internet or images dropped onto the canvas cannot execute local scripts without explicit manual authorization.
  - Execution requires an interactive user action on the canvas node via `[⚡ Authorize Run]`, which registers single-use authorization exclusively in server RAM with a 5-minute TTL.
- **Filesystem Path Confinement**: Image loading (`VisualImageLoader`) and thumbnail file streaming endpoints are strictly confined to standard ComfyUI `input`, `output`, and `temp` directories with path canonicalization and directory traversal guards.
- **Opt-In Network Requests**: External metadata and preview scraping (Civitai / TMDB) are completely opt-in and disabled by default.
- **No Dynamic Package Installation**: Runtime `pip` execution (`install.py` / `subprocess`) is eliminated; all dependencies are transparently listed in `requirements.txt`.
- **Local Environment**: All API keys (Civitai / TMDB) are stored locally in `.env` and are strictly excluded from git tracking via `.gitignore`. Sensitive keys are masked in server log outputs.
- **Atomic File Writes**: Atomic file operations (`.tmp` + `os.replace`) prevent JSON file corruption on sudden system shutdown or crash.


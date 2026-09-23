# Changelog

All notable changes to `ComfyUI-SaturnNodes` will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.4.0] - 2026-09-24 [Stable]

### Fixed
- **Frontend V1 Sizing & Layout Stability**:
  - Eliminated rapid runaway downward expansion loop in `VisualLoraLoader` and `ImageLoader` on LiteGraph classic (Frontend V1).
  - Cleaned duplicate function stubs and unified `computeSize()` and `computeLayoutSize()`.
- **Core Stability & Logic**:
  - Implemented true cycle permutation for `Random (Cycle)` in `PromptQueueIterator`.
  - Upgraded comma parsing in `MultiTextReplacer` with `csv.reader` to preserve quoted phrases.
  - Removed legacy node mappings (`LeafFlowDecision`, `LeafFlowTextSplit`).
  - Added robust exception handling for unterminated regex in text splitting.
  - Optimized 60fps canvas draw loops by decoupling badge geometry enforcement from `onDrawForeground`.

---

## [2.3.2] - 2026-09-22

### Changed & Rebranded
- **Full Suite Rebrand to SaturnNodes (`🪐`)**:
  - Rebranded the entire suite from `ComfyUI-LeafFlow` to **`ComfyUI-SaturnNodes`** with signature emoji `🪐`.
  - Node display names updated with the `🪐` prefix across all 16 custom nodes.
  - Node category updated to `🪐 SaturnNodes/*` (`Loaders`, `Utils`, `Previews`, `Queue`, `Automation`).
  - Full backward compatibility: all legacy class names (`LeafFlowDecision`, `LeafFlowTextSplit`) preserved and aliased alongside new class names in `NODE_CLASS_MAPPINGS`.
  - Dual HTTP route registration: both `/saturnnodes/*` and `/leafflow/*` routes are active, guaranteeing compatibility with existing scripts, extensions, and bookmarks.
  - Dual WebSocket event emission: both `saturnnodes_*` and `leafflow_*` events are broadcast to the frontend.
  - Seamless settings migration: frontend settings and local storage automatically migrate from `LeafFlow.*` to `SaturnNodes.*` with instant fallback.
  - Automatic user directory migration: `.env` and `prompt_iterator_state.json` migrate smoothly from `user/default/LeafFlow/` to `user/default/SaturnNodes/`.
  - Removed third-party PromptBookmarks coupling: cleaned UI bookmarks button from copy prompt node for modularity.

---

## [2.3.1] - 2026-09-22

### Security & Hardening
- **Universal CSRF Protection Across All Mutation Routes**:
  - Protected `POST /leafflow/prompt_iterator/reset_node`, `POST /leafflow/prompt_iterator/clear`, and `POST /leafflow/prompt_iterator/open_file` with `is_authenticated_local_request`.
  - Protected `POST /leafflow/decision` with `is_authenticated_local_request`.
  - Protected queue-mutating endpoints (`POST /pause_queue/toggle`, `POST /pause_queue/mode`, `POST /pause_queue/continue`, `POST /persistent_queue/claim`, `POST /leafflow/batch_queue/sync`, `POST /leafflow/assets/restore`) with `is_authenticated_local_request`.
  - Updated all frontend callers in `web/` to send the `X-LeafFlow-CSRF-Token` session header via `authenticatedFetch`.
- **SSRF Protection & Scheme Filtering for Preview Scrapers**:
  - Added `is_safe_external_image_url` validating that downloaded image URLs use standard `https` or `http` schemes.
  - Strictly blocked internal loopback (`127.0.0.1`, `localhost`), private networks (`10.*`, `172.16.*`, `192.168.*`), and link-local cloud metadata endpoints (`169.254.*`).
- **Safe Write & Permission Error Handling**:
  - Wrapped downloaded preview image disk writes in `try / except (PermissionError, OSError)` with clear logging to prevent crashes on read-only directories or shared network mounts.
- **Canonical Confinement for OS Application Launches**:
  - Verified that `open_prompt_iterator_file` can only open files strictly confined within the authorized ComfyUI user directory (`USER_DIR`) via `os.path.commonpath`.
- **Conditional Core Queue Monkey-Patching**:
  - Guarded `PersistentQueueManager.patch_server()` so core ComfyUI `prompt_queue` methods are not touched when `ENABLE_PERSISTENT_QUEUE=false`.
- **Explicit Scripts Confinement Documentation & UI Canvas Indicators**:
  - Added explicit italic indicator `📂 Script Location: ComfyUI/scripts/` to `RunLocalFileNode` canvas foreground.
  - Added widget tooltips and settings descriptions clarifying that scripts and working directories must reside exclusively in `ComfyUI/scripts/`.

---

## [2.3.0] - 2026-09-20

### Added
- **🍃 ⚡ "Run Local File" Node (`RunLocalFileNode`)**:
  - Executes local scripts and binaries (`.bat`, `.cmd`, `.ps1`, `.exe` on Windows; `.sh` and executables on Linux/macOS) directly within ComfyUI workflows.
  - Parameter arguments supporting multi-line or standard quotes (`shlex` tokenized, safe non-shell execution).
  - Configurable working directory (`cwd`), defaulting to the script's directory if unspecified.
  - **Synchronous Mode**: Captures `stdout`, `stderr`, `exit_code`, and `success` boolean outputs, with real-time ComfyUI cancel button interrupt handling and configurable execution timeout.
  - **Asynchronous Mode**: Detaches process to run in the background without blocking the ComfyUI generation queue.
  - Optional `trigger` wildcard input and `passthrough` wildcard output for sequencing file execution in any pipeline.
  - **Multi-Layered Security Sandbox**:
    - Confined strictly to `ComfyUI/scripts/` via canonical `realpath` and `commonpath` validation.
    - Strict rejection of absolute paths (`C:\`, `/etc/`, `\\server`) and directory traversal sequences (`..`).
    - Never invokes `shell=True` (eliminating command chaining and command injection vulnerabilities).
    - Recursive process tree termination on timeout or cancellation (uses `taskkill /F /T` on Windows to prevent orphaned background processes).
    - **In-Memory Operator Authorization Gate**: Removed `security_consent` from `INPUT_TYPES` so consent never serializes into workflow JSON or dropped image metadata. Requires active canvas button click `[⚡ Authorize Run]` with 5-minute single-use memory token.
    - Visual node status indicator (`[ARMED]` in emerald green vs `[DISARMED]` in red).
    - Global toggle setting (`LeafFlow.9 - 🛡️ Security.01_AllowLocalFileExecution`, default `false`).
- **🛡️ CSRF Defense & Request Authentication**:
  - Added `is_authenticated_local_request` validating loopback origin, `Sec-Fetch-Site` header (blocking `cross-site` calls from visited web pages), and `Origin`/`Referer` headers.
  - Cryptographically secure per-session CSRF token (`X-LeafFlow-CSRF-Token`) generated via `secrets.token_hex(32)` and validated with `secrets.compare_digest`.
  - Added frontend auth helper (`web/js/auth_helper.js`) automatically fetching and attaching CSRF tokens to administrative fetch requests.
- **⚡ Two-Step Power Action Handshake**:
  - Server restart and shutdown endpoints require `ALLOW_PROCESS_MANAGEMENT=true` plus a two-step confirmation handshake (`POST /leafflow/power/request_token` to issue a 30s single-use ticket, followed by `POST /leafflow/power/confirm_action` to consume and execute).

### Fixed & Compliance
- **Complete Removal of `ALLOW_ANY_SCRIPT_PATH`**: Eliminated all path escape settings to guarantee execution confinement to `ComfyUI/scripts/`.
- **Dynamic Node Count**: Replaced hardcoded node count in startup banner with dynamic `len(NODE_CLASS_MAPPINGS)` (now reporting all 16 registered nodes).
- **Universal Synchronized Versioning**: Version `2.3.0` synchronized across `__init__.py`, `pyproject.toml`, `/leafflow/debug/export`, `README.md`, and `CHANGELOG.md`.
- **Process Management Security Toggle**: Server restart and shutdown controls are disabled by default (`ALLOW_PROCESS_MANAGEMENT=false`). If disabled, attempts to trigger restart/shutdown via the UI or API return HTTP 403 with clear instructions.
- **Optional `pystray` Dependency**: Made `pystray` an optional extra (`[project.optional-dependencies] tray = ["pystray"]`) and removed all runtime `pip install` subprocess calls, ensuring zero crashes on headless cloud servers, Docker, or Google Colab.
- **Universal Loopback Protection**: Added `is_local_request(request)` validation to all legacy queue endpoints (`/pause_queue/*` and `/persistent_queue/claim`).
- **Windows Console Unicode Safety**: Added `UnicodeEncodeError` guard around startup emoji printing for legacy Windows terminals.
- **Clean Dynamic Imports**: Replaced static imports of desktop private `app.*` in `assets_restore.py` with dynamic `importlib.import_module` calls.
- **Cleaned Dead Code**: Removed orphaned canvas classes from `queue_control.py`.

### Testing
- Comprehensive automated test coverage expanded to **105 unit tests** covering all nodes, CSRF authentication, power action tickets, in-memory runner authorization, and path confinement.

---

## [2.2.0] - 2026-09-08

> ⚠️ **Important Frontend Compatibility Notice**:
> The previous release (**v2.1.0**) does **not** support the new ComfyUI frontend package (`@comfyorg/comfyui-frontend` / modern Vue virtual grid).
> **v2.2.0 introduces complete support for the new frontend package**, restoring action buttons (Copy Prompt, Save to Prompt Bookmarks, Inspect Asset zoom) directly on modern virtual grid cards, alongside the 1D Git-Graph batch queue visualizer and per-node zoom settings!

### Added
- **🌐 Full Modern ComfyUI Frontend Package Support**:
  - Full compatibility with `@comfyorg/comfyui-frontend` modern virtual grid and card DOM structures.
  - Seamless overlay action bar button groups for modern asset cards with dynamic rounded pill styling (`rounded-l-lg`, `rounded-r-lg`, `rounded-none`, `border-r`).
- **🔍 Toggleable "Inspect Asset" Button (`04_EnableInspectAssetButton`)**:
  - Restores the direct "Inspect asset" (zoom in) button directly onto image cards in the Assets pane hover action bar, placed seamlessly alongside Download, Copy Prompt, and Bookmarks (restoring access since newer ComfyUI versions tucked it away behind the 3-dots submenu). Default is `false` (opt-in).
- **🔖 Robust Inline SVG Icons for "Save to Prompt Bookmarks"**:
  - Replaced runtime Tailwind icon class references with crisp inline SVG ribbons, fixing an issue in modern `comfyui_frontend_package` where the bookmark icon rendered with 0 dimensions (empty space).
- **🎨 1D Git-Graph Batch Queue Visualizer (`ComfyUI.LeafFlow.BatchQueue`)**:
  - Automatically identifies workflows queued together as batches in both ComfyUI Frontend V2 (`JobAssetsList`) and Classic V1 queue list.
  - Purely graphical 1D colored line along the left edge of queue items without any text or number clutter.
  - **36 Curated Cycling Colors**: Sequential assignment ensures adjacent batches have distinct, high-contrast colors.
  - **Start / Middle / End / Single Segments**:
    - First item in batch segment curves inward at the top (`┌`) and continues straight down.
    - Middle items connect with a continuous straight line (`│`).
    - Last item in batch segment comes straight from the top and curves inward at the bottom (`└`).
    - Single-item batches curve inward at both top and bottom (`(`).
  - **In-between Infiltration Handling**: When another prompt or batch is queued in-between items of an existing batch, the interrupted batch retains its open straight ends (no false start/end curves), while the inserted item is cleanly enclosed in its own bracket.
  - **PersistentQueue Interoperability**: Operates client-side via `localStorage` when standalone, and synchronizes with `PersistentQueueManager` so batch relationships restore automatically upon server restart.
  - **Settings Toggle**: Added `LeafFlow.BatchQueue.Enabled` setting in ComfyUI Settings menu.

### Fixed
- **📐 Independent Per-Node `tile_size` in Visual Loaders**:
  - Decoupled `tile_size` zoom levels from global browser `localStorage` in `VisualLoraLoader` (V1 & V2) and `VisualImageLoader`.
  - Tile zoom values are now persisted directly in `node.properties["tile_size"]` within the workflow JSON, allowing multiple loader nodes on the canvas to maintain independent, custom tile sizes across browser reloads.
- **🛡️ Queue Container Conflict Prevention**:
  - Hardened image card button injection guards to avoid injecting into queue item elements or small icon previews in modern virtual grids.

### Security & Registry Compliance
- **Local-Only Route Enforcement**: All server control endpoints (`/leafflow/power/*`), settings updates (`/leafflow/settings`), and queue sync routes now strictly verify loopback origin (`127.0.0.1` / `::1`), rejecting remote calls with `403 Forbidden`.
- **Directory Traversal Protection**: Image loading (`VisualImageLoader`) and thumbnail endpoints are strictly confined to ComfyUI `input`, `output`, and `temp` directories.
- **Packaging & Installation Standards**: Removed runtime `install.py` in favor of standard `requirements.txt` (`Pillow`, `piexif`, `numpy`, `pystray`), and removed `"torch"` from `pyproject.toml` to prevent host CUDA environment corruption.
- **Opt-In Preview Scraping**: Civitai and TMDB network scraping defaulted to disabled (`ENABLE_CIVITAI_SCRAPING=false`, `ENABLE_TMDB_SCRAPING=false`).

### Changed
- **Text Aspect Ratio Finder Whitelist / Open Mode**:
  - When `aspect_ratios` is populated (e.g. `16:9, 9:16, 1:1`), strictly matches only those configured ratios in prompt text, falling back to default if prompt contains non-whitelisted ratios.
  - When `aspect_ratios` is left empty (`""`), enters open mode and accepts any valid aspect ratio found in text.

---

## [2.1.0] - 2026-08-24

### Added
- **Centralized ComfyUI User Directory (`ComfyUI/user/default/LeafFlow/`)**:
  - All runtime JSON state (`lora_usage.json`, `lora_loader_state.json`, `image_prompts_cache.json`, `failed_scrapes.json`, `prompt_iterator_state.json`, `persistent_queue.json`, `.env`) now strictly lives inside the ComfyUI user folder rather than polluting the node directory.
- **Structured ComfyUI V2 Settings Menu**:
  - Restructured settings into 6 explicit subcategories with clear titles, info tooltips, and real styled action buttons (`🗑️ Reset Scrapes Cache`, `🔄 Reset All Queues`).
- **Prompt Queue Iterator Live Sync**:
  - Added interactive Reset widget button directly onto the canvas node and WebSocket live synchronization for multiline prompt text as items are popped.
- **Cross-Platform Matrix CI**:
  - Automated GitHub Actions unit testing across Python 3.10, 3.11, 3.12 on both Ubuntu and Windows with 56 automated unit tests.

### Fixed
- Fixed empty folder matching edge case in `BackToPlaceholder` (`undo_placeholder.py`).
- Fixed XML entity escaping for native Windows Toast Notifications in `LeafFlowDecision`.
- Removed accidental scrape cache reset during minor settings updates in `__init__.py`.
- Removed obsolete `playwright` dependency from `pyproject.toml` and `install.py`.

---

## [2.0.0] - 2026-08-20

### Added
- **🍃 ⭐ Favorite Prompts**: Preview and loader system for saved favorite prompts and generation presets with subfolder categorizing.
- **🍃 📐 Text Aspect Ratio Finder & Preview**: Dynamic aspect ratio parser (e.g. `16:9`, `2:3`) with resolution calculation and visual aspect box preview.
- **🍃 🔎 Text LoRA Finder & Loader**: Automatic text prompt scanning for LoRA names with model/clip loading and pretty name formatting.
- **🍃 🔄 Prompt Queue Iterator**: Multiline batch prompt queue iterator with Pop, Cycle, and Random modes.
- **🍃 🔤 Multi Text Replacer**: High-performance multi-target find & replace node with protection against recursive replacement loops.
- **🍃 ✂️ Text Split**: Split strings into two outputs using literal delimiters or regex patterns (forward/backward).
- **🍃 ⏸️ LeafFlow Decision**: Interactive mid-workflow pause node with UI buttons (Continue / Cancel / Stop) and desktop notifications.
- **🍃 🔔 System Tray Integration**: OS notification area tray icon with real-time queue status colors and outside-browser queue controls.
- **🍃 🖼️ Assets & History Restore**: Automatic restoration of recent generations into the ComfyUI Assets / History pane on startup.

---

## [1.0.0] - 2026-07-24

### Added
- **Pause Queue**: Added V2 top action bar Pause (Finish) & Pause (Instant) toolbar controls.
- **Persistent Queue**: Real-time queue persistence to disk (`persistent_queue.json`) with auto-restore on startup in paused state and client session ownership claiming.
- **Visual LoRA Loader**: Folder-filtered LoRA selector with formatted pretty names, usage tracking, and Civitai SHA256 API preview thumbnail downloading.
- **Visual Image Loader**: Folder image picker with PNG parameters & EXIF user comments metadata parsing.
- **Auto Watcher**: Folder watcher with non-blocking check (`wait_for_image = False`) and blocking poll (`wait_for_image = True`).
- **Undo Placeholder**: Prompt placeholder restoration tool for LoRA/celebrity names.
- **Recent Outputs**: Output image loader by recent step index for assets/sidebar integration.
- **Live Latent Preview**: Real-time sampler latent preview canvas node renderer.
- **Settings Panel**: Native ComfyUI Settings menu controls for API keys and UI toggles.

# Changelog

All notable changes to `ComfyUI-SaturnNodes` will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.6.3] - In Development

### Added
- **Restore Regression Test Matrix**: 64 new deterministic Python tests and 3 new Node fake-DOM tests covering DOM injection, cross-day timestamps, equal-mtime ordering, restore limits, corrupt images, batches, cancellation, retries, corrupt state, and recovery. The existing `test_batch_queue_dom.mjs` is now run by the suite as well.

### Changed
- **Deterministic Restore Ordering**: Output scanning and the Visual Image Loader now tie-break equal modification times by relative path, so bulk-copied or archive-extracted files always restore in the same order and receive stable history numbering.
- **Restored Queue Identity Repair**: `persistent_queue.json` entries are normalized on load and before restore. The top-level `prompt_id` is authoritative, `item[1]` is re-synced before queueing, duplicates collapse to the last occurrence, and malformed entries are dropped instead of crashing recovery.
- **Synthetic Restored Queue Timestamps**: Restored items receive strictly increasing `create_time` values ending just before "now", preserving their saved queue order instead of sharing one timestamp.
- **Best-Effort Asset DB Ingestion**: A failing `app.assets` registration no longer aborts a successful history restore.
- **Serialized Restores**: Startup restore and manual "Restore Now" requests are serialized by a restore lock so overlapping calls cannot interleave history writes or asset ingestion.

### Fixed
- **Restored Duration Validation**: `NaN`, infinite, negative, and non-numeric durations are rejected when recorded and when read, so they can no longer poison restored timestamps or produce invalid JSON.
- **Generation Times Persistence**: `generation_times.json` saves now sanitize corrupt entries, use unique temp files, retry transient Windows `os.replace` locks, serialize with `allow_nan=False`, and clean up leftover temp files.
- **Cancel/Wipe Recovery Loss**: Persistent queue entries are removed only after ComfyUI confirms the cancel or wipe; a failed operation keeps the crash-recovery copy intact.
- **Restore Robustness**: Missing queue mutexes, non-dict histories, history-read failures, malformed retry counters, and invalid restore limits are handled without aborting recovery.
- **EXIF / A1111 Metadata**: EXIF UserComments with BOM/NUL padding and byte-valued A1111 `parameters` now decode to clean prompt text.
- **Batch Color Injection**: Batch colors from `localStorage`/the server are restricted to plain hex values before entering SVG markup; invalid colors fall back to the palette.
- **Batch Counter & Metadata Corruption**: Negative persisted batch counters clamp into the palette range, metadata pruning uses `queuedAt` recency, unknown segment types normalize safely, out-of-range item indexes clamp to the batch bounds, and older server snapshots can no longer overwrite newer local batch metadata.
- **Concurrent Batch Item Indexes**: Concurrent submissions reserve unique `itemIndex` values through a captured batch context and `inFlight` counter, so two prompts can no longer claim the same index or clear the batch early.
- **Recent Output Loading**: `Load Recent Outputs` clamps invalid `amount`/`index` values, tie-breaks equal mtimes by path, and closes image handles after loading.

---

## [2.6.2] - 2026-10-24 [Stable]

### Added
- **Per-Resolution Dock Memory & Drag Resize Handles**: The Floating Latent Dock and the queue overlay now remember their size per resolution/monitor and expose on-screen drag resize handles.
- **Visual LoRA Loader Maintenance Controls**: New `↺ Counter`, `🧹 Usage` and `🗑 Cache` reset buttons on the Visual LoRA Loader node (each with a confirmation prompt) to reset the per-node Sequential/Random LoRA cycle and prompt→LoRA assignments, clear usage badges, or delete cached thumbnails.
- **ComfyUI Registry Packaging**: Complete registry metadata (`pyproject.toml` with `requires-comfyui`, classifiers and optional extras), a Saturn icon (`web/logo.png`), a `.comfyignore` manifest, and an automated `publish_action.yml` workflow.
- **Curated GitHub Releases**: `release.yml` now publishes the matching `CHANGELOG.md` section as the GitHub Release body instead of raw auto-generated compare links.
- **Real Generation Times on Restored Assets**: SaturnNodes now records prompt execution duration and output filenames in `generation_times.json`; restored history entries expose real start/success timestamps and the stock duration display when available. Older images keep their file mtime for sorting but show no fabricated `0.00s` duration.
- **Prompt Iterator Tracking Modes & Exhaustion Output**: New `track_by` choice (`Text & Node` / `Node Only`) and `exhausted` boolean output for `Sequential (Stop on End)`.
- **Persistent Pause State**: Optional `PERSIST_PAUSE_STATE` setting restores the last manual Pause/Continue state and pause mode after a restart.
- **Queue Restore Retry Limit**: Optional `PERSISTENT_QUEUE_MAX_RETRIES` setting controls how many later launches may retry failed queue items (default `0`).
- **Assets Restore Controls**: New recursive-folder scan toggle, generation-time display toggle, and a **Restore Now** settings button.
- **Visual Image Loader Metadata Limit**: New `IMAGE_LOADER_METADATA_LIMIT` setting (default `128`) controls how many newest images are scanned for prompts.

### Changed
- **Free-Form Dock Resize**: Dragging the Floating Latent Dock's corner now resizes width and height independently (no longer locked to the latent's aspect ratio) within sane 100–2000px bounds. The drag starts from the dock's current on-screen size (no jump to the larger saved settings box), shows the free-form box live, writes the dragged dimensions back into the `Floating Dock Max Width/Height` settings (now 1px-stepped sliders), and snaps the dock to the exact latent fit on release.
- **Route Namespacing**: All HTTP routes live exclusively under `/saturnnodes/*`; the transitional pre-2.6 route aliases (`/pause_queue/*`, `/persistent_queue/*`, `/image_loader/*`, `/folder_lora_loader/*`) were removed entirely.
- **Compatibility Surface Reduction**: All remaining pre-rename compatibility layers were purged — duplicate legacy route handlers, frontend settings migration and legacy settings-ID lookups, legacy localStorage/storage keys, the legacy CSRF header fallback, the legacy user-directory auto-migration, and all superseded node class-name aliases. No backward-compatibility surface remains.
- **Persistent Queue Schema Versioning**: `persistent_queue.json` now uses a top-level `{"schema_version": 1, "items": [...]}` envelope. Legacy bare-list files are migrated atomically on first load, files written by a newer SaturnNodes are kept read-only when downgrading, and transient Windows sharing violations during the atomic replace are retried.
- **Naming Consistency**: Unified `ComfyUI.SaturnNodes.*` frontend extension names, `saturnnodes-*` CSS prefixes, and `[SaturnNodes ...]` console log tags.
- **Documentation Rebrand**: `WALKTHROUGH.md`, the README settings reference, `.env.example`, `AGENTS.md` and `SECURITY.md` were fully rebranded and reconciled with the real setting labels, widget names and environment variables.
- **Registry Identity**: Package name set to `saturnnodes` (per registry naming best practices); version bumped to `2.6.2`.

### Fixed
- **Publishing Compliance**: Removed `install.py` (no runtime `pip` execution, matching the documented "Zero Runtime Package Installs" claim) and corrected a stale README claim about legacy route aliases.
- **Test Isolation**: The test suite now redirects every module-level SaturnNodes state path (persistent queue, LoRA usage/cycle state, caches, iterator state, generation times) to a disposable temporary user directory. Running tests while ComfyUI is active can no longer overwrite live user data.
- **Audit Remediation Hardening**: Full audit remediation pass - pause queue stall/deadlock fixes, restart verification hardening, atomic `.env` writes with proper error responses, debug endpoint guards, subgraph-safe lookups, runner pipe streaming, IPv4-mapped loopback handling and more (160 unit tests passing).
- **DOM Reuse & Recycled Widget Hardening**: Fixed all eight stale-DOM audit findings. Power-popup document listeners now die with their popup and a detached popup can no longer swallow a reopen. Copy Prompt revalidates the interacted card by asset identity, rejects detached/recycled cards, re-resolves the image at click time, and rebinds legacy hover-overlay buttons. The floating latent dock observes deep minimap/toolbar/sidebar layout changes. Remounted node widgets (live preview image, prompt counter badge, LoRA count badge) re-resolve their live DOM element instead of writing to detached nodes. Batch lines are painted when a legacy v1 queue table mounts with its rows already built, duplicate `data-job-id` rows no longer skew batch grouping, and the saved queue height is re-applied to `.comfy-list` elements mounted after setup.
- **Restored Queue Batch-Line Repaint**: Queue cards reused by ComfyUI's virtualized Vue list could keep the previous batch's colored line when the next batch started, making the running item appear to jump from the pending color to the previous batch color. Batch lines now repaint on `data-job-id` attribute changes and during a short post-event refresh window; unchanged SVG lines are skipped to avoid unnecessary DOM churn.
- **Floating Latent Dock Resize Crash**: Fixed a `this.renderImage is not a function` error thrown while dragging the dock's resize handles or when the screen profile changed; the resize paths now invoke the dock's actual render routine.
- **Queue Overlay Resize Lag**: Resizing the queue overlay no longer rewrites a stylesheet on every pointermove (which forced a full-document style recalculation, layout and paint churn on every frame); heights are now applied as scoped, rAF-throttled inline styles.
- **Dock Drag Performance & Stuck Drags**: Dragging the dock no longer rebuilds the full-resolution canvas backing store (GPU texture/layer churn, ~74% GPU load during drags) on every pointermove — only CSS sizes change while dragging, with one full-quality redraw on release. Pointer capture plus `pointercancel`/window-blur guards fix drags that "never stopped" when the pointer was released outside the window.
- **Prompt Iterator Reset Clarity**: The Prompt Queue Iterator's `Reset Counter (0)` button now confirms before resetting and explains that it resets the run pointer to the first prompt without wiping the queue state file (use Settings → `Reset All Queues` for a full wipe).
- **Prompt Iterator Correctness & Concurrency**: Hard resets now clear crash-recovery assignments and shuffle permutations; state keys include splitter/mode configuration; `Random (Cycle)` remaining text follows the real shuffle order; `Random (Keep)` no longer reports a fake remaining ordered list; state reads use an mtime cache behind a lock; global state pruning keeps the most recently used entries.
- **LoRA Loader State Growth & Performance**: Prompt→LoRA assignment maps and global cycle state are now bounded by recency; selection mapping is resolved once per run; usage counters are batched in memory and flushed atomically; No-Replace cycles avoid an immediate repeat while still visiting every LoRA; Civitai SHA256 hashes are cached by mtime/size; `TextLoraFinder` scans the prompt once instead of once per installed LoRA.
- **Persistent Queue I/O Storm**: `persistent_queue.json` writes are debounced, compact and fsynced instead of rewriting the full file for every queued/removed item; batch metadata and recently-finished prompt IDs are capped to prevent unbounded growth; late batch syncs can no longer resurrect finished prompts.
- **Assets Restore Blocking & Coverage**: Output scanning, image metadata parsing and asset DB registration now happen outside `prompt_queue.mutex`; restore uses a bounded top-N scan and a single DB session; JPEG/WebP EXIF metadata and A1111/Forge `parameters` prompts are supported; debug reports include elapsed time, scanned count, metadata hits and generation-time matches.
- **Visual Image Loader Responsiveness**: Folder scans and thumbnail generation run off the asyncio event loop; thumbnails are cached on disk by path/mtime/size.
- **Settings/.env Divergence**: `/saturnnodes/settings` now returns the complete effective settings surface, the UI seeds from backend values before registering defaults, and parsed `.env` values are cached with mtime invalidation and explicitly invalidated after saves.

### Removed
- `install.py` — dependencies are declared in `pyproject.toml` / `requirements.txt` only, and ComfyUI Manager handles installation.

---

## [2.5.0] - 2026-10-10 [Stable]

### Added
- **Floating Latent Live Preview Dock & Core Lightbox Live Inspection**:
  - Floating live latent preview dock with dynamic aspect ratio preservation and contain-scaling, eliminating letterbox bars and layout jitter.
  - Minimap tracking and alignment alongside canvas navigation controls.
  - **Native Core Lightbox Live Inspecting View**: Clicking the floating latent dock opens the live generation directly in ComfyUI's native inspecting lightbox view, updating live in real time as each diffusion sampling step arrives.
  - Minimalist design: removed redundant "Sampling..." badge overlays for distraction-free monitoring.
- **High-Performance LoRA Loader Engine & Viewport WebP Lazy-Loading**:
  - **Disk-Cached WebP Generation**: High-resolution preview images are downscaled via bicubic fast-WebP encoding and cached in `ComfyUI/user/default/SaturnNodes/cache/lora_thumbs/` (~35KB per card).
  - **Non-Blocking Background Worker**: Thumbnail processing runs asynchronously on worker threads with `threading.Event`, eliminating canvas UI thread lockups during heavy directory indexing.
  - **Viewport IntersectionObserver**: Implemented native `IntersectionObserver` on visual LoRA cards so thumbnails only load as they scroll into view.
  - Added an explicit settings toggle to bypass thumbnail generation if desired.
- **Stereoscopic 3D / Cross-Eye Generator (`SaturnStereo3D`)**:
  - Transform 2D images into stereoscopic 3D pairs for cross-eye viewing, parallel 3D viewers, VR displays, and red-cyan anaglyphs.
  - Hybrid depth execution: accepts any input `depth_map` (zero downloads, 1ms execution) or automatically falls back to built-in Depth Anything V2 Small ONNX model cached locally, with mathematical gradient fallback when ONNX is absent.
  - Stereonix-inspired controls: `depth_intensity`, `depth_gamma`, `invert_depth`, `convergence_plane`, `image_zoom`, `pan_horizontal`, `pan_vertical`.
  - Framing and focus controls: adjustable `gap_spacing`, `outer_border` padding, and high-contrast `alignment_dots`.
- **Stereoscopic 3D Live Viewer (`SaturnStereo3DLive`)**:
  - Interactive live viewer node featuring a real-time **1s countdown timer** on parameter adjustment.
  - **Mid-Render Interruption**: Modifying sliders during generation immediately sends `/interrupt` to abort obsolete rendering and restarts the 1s countdown.
  - **In-Memory Depth Map Caching**: Cached depth predictions allow near-instant (~5ms) re-rendering when tweaking intensity, gamma, zoom, pan, and spacing on the same input image.
- **Queue Execution Controls & Mid-Generation Pause**:
  - Added execution interception hook allowing the queue to pause before popping the next item from the queue.
  - Restored queue prompt `create_time` timestamps are refreshed upon restart to prevent deprioritization in history.
- **Modernized Continuous Sliders Settings UI**:
  - Converted `Visible Queue Items (Height)` and `Live Latent Dock Size` from rigid dropdowns into smooth continuous sliders.
  - Cleaned settings categories and isolated context menus to prevent bleeding into top PrimeVue application menubars.
- **CLI Terminal Branding & Clean Telemetry**:
  - Clean unified startup banner styled in Saturn amber theme.
  - Cleaned noisy internal debug logging, displaying concise status lines for node count, persistence status, and storage paths.

### Fixed
- **Persistent Queue Restored Creation Timestamp**:
  - Fixed an issue where unfinished prompts resumed after a server restart sorted to the bottom of the history and assets list by updating `create_time` to the current timestamp on recovery.
- **Live Viewer Widget Value Corruption**:
  - Fixed an issue where sliding widgets on `SaturnStereo3DLive` set them to `NaN` or `0` due to arrow-function callback scoping, preventing "wrong type" and "missing connection" validation errors.
- **Top Application Menubar Injection**:
  - Fixed an issue where "Copy prompt" appeared in the main application menu (between File and Edit) on PrimeVue Frontend V2 by strictly excluding `.comfy-command-menu`, `.comfy-menu`, `.p-menubar`, and top-level menuitems.
- **CI & Environment Resilience**:
  - Replaced OpenCV dependency with PIL and ensured graceful fallback when `onnxruntime` is not installed.
- **Security & Path Confinement**:
  - Hardened directory traversal guards against UNC paths and relative escapes, passing 119 unit tests.

---

## [2.4.0] - 2026-09-24 [Stable]

### Fixed
- **Frontend V1 Sizing & Layout Stability**:
  - Eliminated rapid runaway downward expansion loop in `VisualLoraLoader` and `ImageLoader` on LiteGraph classic (Frontend V1).
  - Cleaned duplicate function stubs and unified `computeSize()` and `computeLayoutSize()`.
- **Core Stability & Logic**:
  - Implemented true cycle permutation for `Random (Cycle)` in `PromptQueueIterator`.
  - Upgraded comma parsing in `MultiTextReplacer` with `csv.reader` to preserve quoted phrases.
  - Removed legacy pre-rebrand node class mappings.
  - Added robust exception handling for unterminated regex in text splitting.
  - Optimized 60fps canvas draw loops by decoupling badge geometry enforcement from `onDrawForeground`.

---

## [2.3.2] - 2026-09-22

### Changed & Rebranded
- **Full Suite Rebrand to SaturnNodes (`🪐`)**:
  - Renamed the entire suite to **`ComfyUI-SaturnNodes`** with signature emoji `🪐`.
  - Node display names updated with the `🪐` prefix across all 16 custom nodes.
  - Node category updated to `🪐 SaturnNodes/*` (`Loaders`, `Utils`, `Previews`, `Queue`, `Automation`).
  - Full backward compatibility: all legacy pre-rebrand class names preserved and aliased alongside the new class names in `NODE_CLASS_MAPPINGS`.
  - Dual HTTP route registration for full compatibility with existing scripts, extensions, and bookmarks.
  - Dual WebSocket event emission for full frontend compatibility.
  - Seamless settings migration: frontend settings and local storage automatically migrated to `SaturnNodes.*` keys with instant fallback.
  - Automatic user directory migration: `.env` and `prompt_iterator_state.json` migrated smoothly into `user/default/SaturnNodes/`.
  - Removed third-party PromptBookmarks coupling: cleaned UI bookmarks button from copy prompt node for modularity.

---

## [2.3.1] - 2026-09-22

### Security & Hardening
- **Universal CSRF Protection Across All Mutation Routes**:
  - Protected the prompt iterator reset, clear, and open-file endpoints with `is_authenticated_local_request`.
  - Protected the decision node endpoint with `is_authenticated_local_request`.
  - Protected all queue-mutating endpoints (pause controls, persistent queue claim, batch queue sync, assets restore) with `is_authenticated_local_request`.
  - Updated all frontend callers in `web/` to send the session CSRF header via `authenticatedFetch`.
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
    - Global `Allow Local File Execution` toggle setting (default `false`).
- **🛡️ CSRF Defense & Request Authentication**:
  - Added `is_authenticated_local_request` validating loopback origin, `Sec-Fetch-Site` header (blocking `cross-site` calls from visited web pages), and `Origin`/`Referer` headers.
  - Cryptographically secure per-session CSRF token generated via `secrets.token_hex(32)` and validated with `secrets.compare_digest`.
  - Added frontend auth helper (`web/js/auth_helper.js`) automatically fetching and attaching CSRF tokens to administrative fetch requests.
- **⚡ Two-Step Power Action Handshake**:
  - Server restart and shutdown endpoints require `ALLOW_PROCESS_MANAGEMENT=true` plus a two-step confirmation handshake (requesting a 30-second single-use ticket, then confirming the action to consume and execute it).

### Fixed & Compliance
- **Complete Removal of `ALLOW_ANY_SCRIPT_PATH`**: Eliminated all path escape settings to guarantee execution confinement to `ComfyUI/scripts/`.
- **Dynamic Node Count**: Replaced hardcoded node count in startup banner with dynamic `len(NODE_CLASS_MAPPINGS)` (now reporting all 16 registered nodes).
- **Universal Synchronized Versioning**: Version `2.3.0` synchronized across `__init__.py`, `pyproject.toml`, the debug export endpoint, `README.md`, and `CHANGELOG.md`.
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
- **🎨 1D Git-Graph Batch Queue Visualizer**:
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
  - **Settings Toggle**: Added an enable/disable batch queue setting in the ComfyUI Settings menu.

### Fixed
- **📐 Independent Per-Node `tile_size` in Visual Loaders**:
  - Decoupled `tile_size` zoom levels from global browser `localStorage` in `VisualLoraLoader` (V1 & V2) and `VisualImageLoader`.
  - Tile zoom values are now persisted directly in `node.properties["tile_size"]` within the workflow JSON, allowing multiple loader nodes on the canvas to maintain independent, custom tile sizes across browser reloads.
- **🛡️ Queue Container Conflict Prevention**:
  - Hardened image card button injection guards to avoid injecting into queue item elements or small icon previews in modern virtual grids.

### Security & Registry Compliance
- **Local-Only Route Enforcement**: All server control endpoints (power actions, settings updates, queue sync) now strictly verify loopback origin (`127.0.0.1` / `::1`), rejecting remote calls with `403 Forbidden`.
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
- **Centralized ComfyUI User Directory (`ComfyUI/user/default/SaturnNodes/`)**:
  - All runtime JSON state (`lora_usage.json`, `lora_loader_state.json`, `image_prompts_cache.json`, `failed_scrapes.json`, `prompt_iterator_state.json`, `persistent_queue.json`, `.env`) now strictly lives inside the ComfyUI user folder rather than polluting the node directory.
- **Structured ComfyUI V2 Settings Menu**:
  - Restructured settings into 6 explicit subcategories with clear titles, info tooltips, and real styled action buttons (`🗑️ Reset Scrapes Cache`, `🔄 Reset All Queues`).
- **Prompt Queue Iterator Live Sync**:
  - Added interactive Reset widget button directly onto the canvas node and WebSocket live synchronization for multiline prompt text as items are popped.
- **Cross-Platform Matrix CI**:
  - Automated GitHub Actions unit testing across Python 3.10, 3.11, 3.12 on both Ubuntu and Windows with 56 automated unit tests.

### Fixed
- Fixed empty folder matching edge case in `BackToPlaceholder` (`undo_placeholder.py`).
- Fixed XML entity escaping for native Windows Toast Notifications in the decision node.
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
- **🍃 ⏸️ Decision**: Interactive mid-workflow pause node with UI buttons (Continue / Cancel / Stop) and desktop notifications.
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
- **Undo Placeholder**: Prompt placeholder restoration tool for LoRA/subject names.
- **Recent Outputs**: Output image loader by recent step index for assets/sidebar integration.
- **Live Latent Preview**: Real-time sampler latent preview canvas node renderer.
- **Settings Panel**: Native ComfyUI Settings menu controls for API keys and UI toggles.

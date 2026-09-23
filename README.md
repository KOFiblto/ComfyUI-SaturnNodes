# 🪐 ComfyUI-SaturnNodes

A unified workflow control and productivity suite for **ComfyUI**. Built for **ComfyUI Frontend V2 (Nodes 2.0 / Vue UI)** (fully supported and actively tested) with backwards compatibility for the **Classic ComfyUI Frontend (Nodes 1.0 / LiteGraph)** (supported as-is, but untested—no guarantees).

---

## 🚀 Key Capabilities & Overview

- **Live Latent Preview**: Watch generations materialize step-by-step directly inside your graph canvas nodes in real time.
- **Batch Prompting & Iteration**: Queue multiple prompts automatically with delimiter splits, regex blocks, and persistent queue state tracking.
- **Visual Thumbnail Browsing**: Browse LoRAs and image folders with auto-scraped Civitai & TMDB previews, ranking badges, and multi-selection.
- **Real-Time Queue & Pause Controls**: Pause, resume, or cleanly cancel execution mid-generation, with automatic crash recovery for interrupted queues.
- **Aspect Ratio & Resolution Utilities**: Find exact matching aspect ratios, crop dimensions, and visual sizing helpers.
- **Safe Local Script Execution**: Run local scripts and executables strictly confined to `ComfyUI/scripts/` with interactive operator authorization.

---

## 📦 Individual Nodes Reference

Expand any node below to view its description, inputs, outputs, and usage documentation.

<details>
<summary><b>🪐 📁 LoRA Loader (Folder)</b> (<code>FolderLoraLoader</code>)</summary>

#### Overview
Loads a LoRA by folder path using raw filename matching or formatted names with customizable output formatting options.

#### Inputs & Widgets
- **`model`** (`MODEL`): Input model.
- **`clip`** (`CLIP`): Input CLIP.
- **`folder`** (`STRING`): Subfolder filter (e.g. `Celebrities`, `PonyV6`, `*`).
- **`lora_name`** (`COMBO`): Dropdown listing available LoRA files in the target folder.
- **`strength_model`** (`FLOAT`): Model weight strength (default `1.0`).
- **`strength_clip`** (`FLOAT`): CLIP weight strength (default `1.0`).
- **`output_format`** (`COMBO`, *Advanced*): Choose output format (`Parsed Name`, `Filename`, `Filename without extension`, `Relative Path`, `Full Path`, `Custom Regex`).
- **`custom_regex`** (`STRING`, *Advanced*): Pattern used when `output_format` is `Custom Regex`.

#### Outputs
- **`MODEL`**: Patched model.
- **`CLIP`**: Patched CLIP.
- **`lora_name`** (`STRING`): Formatted name or filename of the loaded LoRA.
</details>

<details>
<summary><b>🪐 ✨ LoRA Loader (Pretty)</b> (<code>FolderLoraLoaderPretty</code>)</summary>

#### Overview
Loads a LoRA using formatted pretty names (e.g. `Ana De Armas V1` instead of `krea2_Ana-De-Armas_v1.safetensors`).

#### Inputs & Widgets
- **`model`** (`MODEL`): Input model.
- **`clip`** (`CLIP`): Input CLIP.
- **`folder`** (`STRING`): Subfolder filter.
- **`lora_name`** (`COMBO`): Dropdown listing formatted LoRA names.
- **`strength_model`** (`FLOAT`): Model weight strength.
- **`strength_clip`** (`FLOAT`): CLIP weight strength.

#### Outputs
- **`MODEL`**: Patched model.
- **`CLIP`**: Patched CLIP.
- **`lora_name`** (`STRING`): Selected LoRA name.
</details>

<details>
<summary><b>🪐 🖼️ Visual LoRA Loader</b> (<code>VisualLoraLoader</code> / alias <code>FolderLoraLoaderVisualPrettyV2</code>)</summary>

#### Overview
Visual thumbnail browser for LoRAs with Civitai SHA256 search & TMDB auto-scraping, popularity rank badges (🔥), multi-selection support, and independent per-node thumbnail zoom sizing.

#### Inputs & Widgets
- **`model`** (`MODEL`): Input model.
- **`clip`** (`CLIP`): Input CLIP.
- **`folder`** (`STRING`): Subfolder filter.
- **`strength_model`** (`FLOAT`): Model strength.
- **`strength_clip`** (`FLOAT`): CLIP strength.
- **`tile_size`** (`SLIDER`, UI): Adjust thumbnail card size (persisted per node in workflow JSON).
- **`display_mode`** (`COMBO`, *Advanced*): `Scrollable` vs `Show All`.
- **`sort_loras_by`** (`COMBO`, *Advanced*): Sort by `Name (A-Z)`, `Name (Z-A)`, `Date Modified (Newest First)`, `Date Modified (Oldest First)`, or `Usage (Most Used First)`.

#### Outputs
- **`MODEL`**: Patched model.
- **`CLIP`**: Patched CLIP.
- **`lora_name`** (`STRING`): Comma-separated list of active LoRA names.
</details>

<details>
<summary><b>🪐 📷 Visual Image Loader</b> (<code>VisualImageLoader</code> / alias <code>ImageLoaderVisualPrettyV2</code>)</summary>

#### Overview
Visual thumbnail browser for image folders with instant preview selection, independent per-node thumbnail zoom sizing, and EXIF positive prompt metadata extraction. Path access is strictly confined to ComfyUI `input`, `output`, and `temp` directories for safe operation.

#### Inputs & Widgets
- **`folder`** (`STRING`): Folder path to load images from (confined to ComfyUI input/output/temp).
- **`tile_size`** (`SLIDER`, UI): Adjust thumbnail card size (persisted per node in workflow JSON).
- **`display_mode`** (`COMBO`, *Advanced*): `Scrollable` vs `Show All`.
- **`sort_images_by`** (`COMBO`, *Advanced*): `Name (A-Z)`, `Name (Z-A)`, `Date Modified (Newest First)`, `Date Modified (Oldest First)`.

#### Outputs
- **`IMAGE`**: Selected image tensor.
- **`positive_prompt`** (`STRING`): Extracted prompt metadata.
- **`width`** (`INT`): Image width.
- **`height`** (`INT`): Image height.
</details>

<details>
<summary><b>🪐 📂 Load Image From Folder</b> (<code>LoadImageFromFolder</code>)</summary>

#### Overview
Monitors a folder for incoming images, loads the target image into a PyTorch tensor, with an optional toggle to delete the image after loading.

#### Inputs & Widgets
- **`folder`** (`STRING`): Watch directory path (default `input/watch`).
- **`wait_if_folder_is_empty`** (`BOOLEAN`): Poll until image arrives vs return dummy tensor immediately.
- **`rescan_interval`** (`INT`): Polling frequency in seconds.
- **`sort_by`** (`COMBO`): Sort by `date_modified`, `date_created`, or `name`.
- **`regex_filter`** (`STRING`): Regex pattern to filter filenames.
- **`delete_image`** (`BOOLEAN`, *Default: false*): If enabled, deletes the image file from disk after loading.

#### Outputs
- **`image`** (`IMAGE`): Loaded image tensor.
- **`has_image`** (`BOOLEAN`): True if image loaded, False if folder empty.
</details>

<details>
<summary><b>🪐 ⏱️ Recent Outputs</b> (<code>LoadRecentOutputs</code>)</summary>

#### Overview
Loads the N newest images from an output directory with step-through index selection.

#### Inputs & Widgets
- **`output_folder`** (`STRING`): Target output directory.
- **`amount`** (`INT`): Number of newest images to pool (1-100).
- **`index`** (`INT`): Step index selection.

#### Outputs
- **`IMAGE`**: Output image tensor.
</details>

<details>
<summary><b>🪐 👁️ Live Latent Preview</b> (<code>PreviewLatentLiveNode</code>)</summary>

#### Overview
Canvas rendering node that listens to sampler WebSocket latent binary streams and displays real-time live previews on the canvas during generation.

#### Inputs & Outputs
- **Category**: `🪐 SaturnNodes/Previews`
- **Output Node**: True
</details>

<details>
<summary><b>🪐 ⏸️ Saturn Decision</b> (<code>SaturnDecision</code> / alias <code>LeafFlowDecision</code>)</summary>

#### Overview
Pauses workflow execution at a specific step and displays an inline UI popup with Continue, Cancel, or Stop Workflow actions, plus optional native OS desktop notifications. Fully backward compatible with workflows containing `LeafFlowDecision`.

#### Inputs & Widgets
- **`disable`** (`BOOLEAN`): Bypass decision gate.
- **`send_os_notification`** (`BOOLEAN`): Trigger native OS desktop toast on pause.
- **`timeout`** (`INT`): Auto-continue timeout in seconds (-1 = infinite).

#### Outputs
- **`cancel`** (`BOOLEAN`): False on Continue, True on Cancel (for branch routing).
</details>

<details>
<summary><b>🪐 📐 Text Aspect Ratio Finder</b> (<code>TextAspectRatioFinder</code> / alias <code>AspectRatioFinder</code>)</summary>

#### Overview
Parses input text for aspect ratios (e.g. `16:9`, `2.35:1`), syntax-checks them, and calculates pixel resolution for a target megapixel target.

#### Inputs & Widgets
- **`aspect_ratios`** (`STRING`): Allowed ratio list (e.g. `16:9, 9:16, 1:1`). When populated, strictly enforces matching only the configured ratios and ignores any other numbers/ratios in text. When left completely empty (`""`), acts in open mode and accepts any valid ratio found in text.
- **`search_mode`** (`COMBO`): `First match (Front)` vs `Last match (Back)`.
- **`target_mp`** (`FLOAT`): Target megapixels (e.g. `1.0 MP`).
- **`default_aspect_ratio`** (`COMBO`): Fallback ratio if none found.
- **`multiple_of`** (`INT`, *Advanced*): Dimension step multiple (default `8`).
- **`min_mp`** (`FLOAT`, *Advanced*): Minimum megapixel limit.
- **`max_mp`** (`FLOAT`, *Advanced*): Maximum megapixel limit.
- **`text`** (`STRING`, *Optional Input*): Input text to search.

#### Outputs
- **`width`** (`INT`): Computed width in pixels.
- **`height`** (`INT`): Computed height in pixels.
- **`aspect_ratio`** (`STRING`): Detected or fallback aspect ratio string.
- **`cleaned_text`** (`STRING`): Input text with the aspect ratio token stripped.
</details>

<details>
<summary><b>🪐 📐 Preview Image Size & Aspect Ratio</b> (<code>PreviewImageSizeAspectRatio</code>)</summary>

#### Overview
Computes image dimensions and aspect ratio from an input image tensor and formats the result for previewing.

#### Inputs & Widgets
- **`image`** (`IMAGE`): Input image tensor.

#### Outputs
- **`width`** (`INT`): Image width.
- **`height`** (`INT`): Image height.
- **`aspect_ratio`** (`STRING`): Closest matched aspect ratio string.
</details>

<details>
<summary><b>🪐 🔎 Text LoRA Finder & Loader</b> (<code>TextLoraFinder</code> / alias <code>LoraTextFinder</code>)</summary>

#### Overview
Scans input prompt text for `<lora:name:strength>` tags or names matching a folder on disk, dynamically applies them, and returns patched models along with sanitized prompt text.

#### Inputs & Widgets
- **`model`** (`MODEL`): Input model.
- **`clip`** (`CLIP`): Input CLIP.
- **`folder`** (`STRING`): Subfolder to search for LoRA files.
- **`fallback_strength_model`** (`FLOAT`): Default model strength if omitted in prompt tag.
- **`fallback_strength_clip`** (`FLOAT`): Default CLIP strength if omitted in prompt tag.
- **`clean_prompt`** (`BOOLEAN`): Strips matched `<lora:...>` tags from output text.
- **`text`** (`STRING`, *Optional Input*): Input prompt text.

#### Outputs
- **`MODEL`**: Patched model.
- **`CLIP`**: Patched CLIP.
- **`text`** (`STRING`): Cleaned prompt text.
- **`lora_name`** (`STRING`): Comma-separated list of loaded LoRAs.
</details>

<details>
<summary><b>🪐 🔄 Prompt Queue Iterator</b> (<code>PromptQueueIterator</code>)</summary>

#### Overview
Deterministically iterates over multiline prompt text blocks per queue run with live progress display, counter reset controls, and index tracking. Supports splitting prompts by empty lines, newlines, or a custom regular expression delimiter.

#### Inputs & Widgets
- **`pop_mode`** (`COMBO`): `Sequential (Loop on End)`, `Sequential (Stop on End)`, `Random (Keep)`, `Random (Cycle)`.
- **`separator`** (`COMBO`): Split prompts by `>1 Empty Line`, `Newline`, `>2 Empty Lines`, or `Custom Regex`.
- **`custom_regex`** (`STRING`): Custom regular expression delimiter (e.g. `\n---\n`). Automatically enabled when `separator` is set to `Custom Regex` and disabled otherwise.
- **`text`** (`STRING`, Multiline): Multiline prompt text containing your queued blocks.
- **`prompt`** (`STRING`, Optional Input): Connect an external multiline string node (such as *Prompt Counter*).

#### Outputs
- **`prompt`** (`STRING`): The selected prompt block for the current queue run.
- **`remaining_text`** (`STRING`): All remaining prompt blocks joined by the delimiter.
- **`remaining_count`** (`INT`): Count of remaining items in queue.
</details>

<details>
<summary><b>🪐 📝 Prompt Counter</b> (<code>PromptCounter</code>)</summary>

#### Overview
Multiline text prompt input node that functions identically to a standard multiline string node, with real-time prompt counting according to your chosen delimiter (`>1 Empty Line`, `Newline`, `>2 Empty Lines`, or `Custom Regex`). Displays the live prompt count directly on the node on every keystroke, allowing you to easily determine and set the exact ComfyUI batch size before running your queue.

#### Inputs & Widgets
- **`text`** (`STRING`, Multiline): Input prompt text block.
- **`separator`** (`COMBO`, *Advanced*): Prompt delimiter (`>1 Empty Line`, `Newline`, `>2 Empty Lines`, `Custom Regex`). Hidden by default under Advanced Options.
- **`custom_regex`** (`STRING`, *Advanced*): Custom regex delimiter pattern (e.g. `\n---\n`). Dynamically enabled/disabled based on delimiter selection.

#### Outputs
- **`STRING`**: The unmodified prompt text (ready to connect into samplers or *Prompt Queue Iterator*).
- **`count`** (`INT`): The registered prompt count integer.
</details>

<details>
<summary><b>🪐 🔤 Multi Text Replacer</b> (<code>MultiTextReplacer</code>)</summary>

#### Overview
Performs multiple text replacements in a single step using comma-separated or newline-separated find/replace lists, with support for exact phrases and regex matching.

#### Inputs & Widgets
- **`text`** (`STRING`, Multiline): Input text to modify.
- **`find_text`** (`STRING`, Multiline): Search terms (comma-separated or lines).
- **`replace_text`** (`STRING`, Multiline): Replacement terms.
- **`case_sensitive`** (`BOOLEAN`): Toggle case-sensitive matching.
- **`use_regex`** (`BOOLEAN`): Treat find patterns as regular expressions.

#### Outputs
- **`text`** (`STRING`): Modified text.
</details>

<details>
<summary><b>🪐 ✂️ Text Split</b> (<code>SaturnTextSplit</code> / alias <code>LeafFlowTextSplit</code>)</summary>

#### Overview
Splits text into two parts at a specified delimiter. Supports forward (from start) and backward (from end) search, as well as regular expressions.

#### Inputs & Widgets
- **`text`** (`STRING`, Multiline): Input text to split.
- **`split_by`** (`STRING`): Character sequence or regex pattern to split on (e.g. `--`, `,`, `---`, `\n`).
- **`split_direction`** (`COMBO`, *Advanced*): `forward (first occurrence from start)` vs `backward (last occurrence from end)`.
- **`use_regex`** (`BOOLEAN`, *Advanced*): Treat delimiter as a regular expression pattern.
- **`strip_whitespace`** (`BOOLEAN`, *Advanced*): Trims surrounding whitespace from output strings.

#### Outputs
- **`text1`** (`STRING`): Text before the split delimiter.
- **`text2`** (`STRING`): Text after the split delimiter.
</details>

<details>
<summary><b>🪐 ⚡ Run Local File</b> (<code>RunLocalFileNode</code>)</summary>

#### Overview
Safely executes a local script or executable (`.bat`, `.cmd`, `.ps1`, `.exe` on Windows; `.sh` or binaries on Linux/macOS) with command-line parameters and working directory control. Built with multi-layered security guards to ensure malicious workflows or dropped images cannot execute code without explicit authorization.

> [!IMPORTANT]
> **Scripts Directory Restriction**: For operator security, this node can **ONLY execute scripts and binaries located inside the `ComfyUI/scripts/` directory** (e.g. `ComfyUI/scripts/my_script.bat`). Relative subfolders (such as `subfolder/process.sh`) are supported as long as they resolve inside `ComfyUI/scripts/`. Absolute paths (e.g. `C:\...` or `/bin/...`) and directory traversal sequences (`..`) are permanently blocked.

#### Inputs & Widgets
- **`file_path`** (`STRING`): Relative path to the executable or script (e.g. `process.bat`, `subfolder/script.sh`). Strictly confined to `ComfyUI/scripts/` with absolute path and traversal (`..`) rejection.
- **`parameters`** (`STRING`, Multiline, Optional): Command-line arguments. Supports spaces and standard quoting (parsed safely via `shlex` without shell expansion).
- **`working_directory`** (`STRING`, Optional): Execution working directory (`cwd`). Defaults to the folder containing the script if left blank.
- **`run_mode`** (`COMBO`): `Synchronous (Wait for Output)` vs `Asynchronous (Background)`.
- **`timeout`** (`INT`): Maximum execution time in seconds for synchronous mode (`0` = no timeout). If exceeded, the process tree is cleanly terminated via OS process management.
- **`trigger`** (`*`, Optional Wildcard): Input wire allowing you to connect any workflow data to order execution.
- **⚡ In-Memory Authorization**: Does NOT use an input widget (preventing malicious authorization smuggling inside shared workflow JSON or image metadata). Instead, the operator must click the interactive `⚡ Authorize Run (5 min)` button directly on the canvas node to grant a 5-minute single-use execution token.

#### Outputs
- **`stdout`** (`STRING`): Captured standard output stream.
- **`stderr`** (`STRING`): Captured standard error stream.
- **`exit_code`** (`INT`): Process exit return code (`0` = success, `-1` = blocked / timed out).
- **`success`** (`BOOLEAN`): `True` if `exit_code == 0`, `False` otherwise.
- **`passthrough`** (`*`): Passes input `trigger` data through untouched to downstream nodes.
</details>

---

## ⚙️ ComfyUI Settings Menu Reference

Configure options directly under ComfyUI Settings (⚙ gear icon):

<details>
<summary><b>1. 🖼️ Visual Loaders (Civitai & TMDB Duo)</b></summary>

- **`Enable Custom SaturnNodes Colors`** (`boolean`, *Default: true*): Applies a Saturn Gold/Amber color theme to SaturnNodes on the canvas. When disabled, nodes use default ComfyUI colors.
- **`Civitai API Key`** (`text`): Optional key for Civitai SHA256 model preview search (`Authorization: Bearer <key>`).
- **`Enable Civitai Auto-Scraping`** (`boolean`, *Default: true*): Automatically download model preview images from Civitai via SHA256 file hashes. (Note: Local SHA256 hash searching always works).
- **`TMDB Access Token`** (`text`): Optional key or v4 Read Access Token (`eyJ...`) for celebrity preview search.
- **`Enable TMDB Auto-Scraping`** (`boolean`, *Default: false*): Automatically download celebrity preview images from TMDB.
- **`Enable LoRA Usage Tracking`** (`boolean`, *Default: true*): Toggle LoRA usage counting and visual rank badges (🔥, Gold, Silver, Bronze) in the picker.
- **`Reset Failed Scrapes Cache`** (*Button: `🗑️ Clear Scrapes Cache`*): Clears failed scrape history so Civitai/TMDB can retry downloading missing preview images.
</details>

<details>
<summary><b>2. 🔄 Prompt Iterator</b></summary>

- **`Clear State on Launch`** (`boolean`, *Default: false*): Privacy toggle to empty `prompt_iterator_state.json` on ComfyUI startup.
- **`Reset All Queues`** (*Button: `🔄 Reset All Queues`*): Immediately empties all active prompt queues and resets iterator state.
</details>

<details>
<summary><b>3. 📋 Prompt Actions</b></summary>

- **`Show "Copy Prompt" Button on Images`** (`boolean`, *Default: true*): Shows the 📋 "Copy Prompt" overlay action button when hovering over generated images in the Assets / History pane and preview nodes.
- **`Show Right-Click "Copy Prompt" Menu Action`** (`boolean`, *Default: true*): Adds "📋 Copy Prompt" to node right-click context menus.
- **`Show "Inspect Asset" (Zoom) Button on Images`** (`boolean`, *Default: false*): Restores the 🔍 "Inspect asset" (zoom in) button directly onto image cards in the Assets pane next to Download and Copy Prompt (restoring one-click access moved behind the 3-dots menu in newer ComfyUI versions).
</details>

<details>
<summary><b>4. ⏸️ Pause Controls</b></summary>

- **`Default State on Launch`** (`combo`, *Default: `Running`*): Sets whether the queue starts `Paused` or `Running` on boot.
- **`Default Pause Action`** (`combo`, *Default: `Finish Active Prompt`*): Sets default pause behavior (`Finish Active Prompt` vs `Instant Resume Node`).
- **`Enable Top Toolbar Button`** (`boolean`, *Default: true*): Toggle top action bar Pause & Continue button group ON/OFF.
- **`Toolbar Button Unpaused Color`** (`text`, *Default: `#16a34a`*): Hex color for the toolbar unpaused/running state.
- **`Toolbar Button Paused Color`** (`text`, *Default: `#ea580c`*): Hex color for the toolbar paused state.
- **`Enable System Tray Icon`** (`boolean`, *Default: false*): Displays an OS system tray icon with real-time queue status colors and outside-browser controls.
- **`Allow Process Management (Restart / Shutdown)`** (`boolean`, *Default: false*): Opt-in authorization allowing server restart and shutdown actions from the SaturnNodes power controls. Disabled by default for maximum security.
</details>

<details>
<summary><b>5. 💾 Persistent Queue</b></summary>

- **`Persistent Queue (Auto-Recovery)`** (`boolean`, *Default: true*): Automatically saves unfinished queue items and restores them after restart/crash.
- **`Recovery Launch State`** (`combo`, *Default: `Match Default`*): Override launch state when restored queue items are recovered on startup (`Match Default`, `Force Paused`, `Force Running`).
</details>

<details>
<summary><b>6. 🖼️ Assets & History Restore</b></summary>

- **`Restore Assets on Launch`** (`boolean`, *Default: true*): Automatically restores your latest generated images into the Assets / History pane on startup.
- **`Restored Assets Count`** (`number`, *Default: 64*): The number of newest images from the output folder to populate into the Assets pane.
</details>

<details>
<summary><b>7. 🩺 Diagnostics & Debug</b></summary>

- **`Export Debug Profile`** (*Button: `📥 Export Debug Profile`*): Exports non-sensitive system environment details (OS, Python, PyTorch, SaturnNodes settings, local cache counts) to a JSON file to share when reporting bugs or requesting assistance. Sensitive API keys and tokens are never exported.
</details>

<details>
<summary><b>8. 🎨 Batch Queue Visuals</b></summary>

- **`Show Batch Queue 1D Lines`** (`boolean`, *Default: true*): Renders a 1D git-graph style colored line on the left side of queued items in the queue list.
  - **36 Cycling Colors:** Every queued batch is assigned a vibrant, high-contrast color from a 36-color sequence.
  - **Clean 1D Line:** The first item starts with a top curve (`┌`), middle items are straight lines (`│`), and the last item ends with a bottom curve (`└`). Standalone 1-item batches are rounded at both ends (`(`).
  - **In-between Infiltration Detection:** If a different prompt is queued in-between items of a batch, the interrupted batch maintains its open line ends without false curves, while the inserted item is highlighted with its own bracket.
  - **Works Standalone or with PersistentQueue:** Operates client-side via `localStorage` when standalone, and syncs with `PersistentQueue` to retain batch relationships after server restarts.
- **`Batch Graph Snapshot Guard`** (`boolean`, *Default: true*): Background prompt and node input snapshotting ensuring canvas edits don't mutate active batches.
</details>

<details>
<summary><b>9. 🛡️ Security & Script Execution</b></summary>

- **`Allow Local File Execution`** (`boolean`, *Default: false*): Master toggle controlling whether the *Run Local File* node is permitted to execute local scripts or executables. Disabled by default for operator safety.
- **Strict Confinement**: Execution is strictly limited to the `ComfyUI/scripts/` directory. Absolute paths and directory traversal (`..`) are permanently blocked.
</details>

---

## 🔒 Security & Privacy

- **Local Runner Sandbox & Operator Authorization Gate:** The `Run Local File` node enforces single-use interactive operator authorization (`⚡ Authorize Run (5 min)`), strictly confines execution to `ComfyUI/scripts/`, never uses `shell=True`, terminates whole process trees on timeout or cancellation, and **never persists authorization inside workflow JSON or image metadata**.
- **CSRF Defense & Fetch Metadata Validation:** All administrative endpoints (`/saturnnodes/settings`, `/saturnnodes/power/*`, `/saturnnodes/local_runner/*`, `/saturnnodes/scrapes/clear` and backward-compatible `/leafflow/*` aliases) enforce loopback checks, `Sec-Fetch-Site` header checks (blocking cross-site requests from visited web pages), and cryptographic per-session `X-SaturnNodes-CSRF-Token` headers.
- **Two-Step Ephemeral Ticket Handshake for Power Actions:** Process restart and shutdown controls are disabled by default (`ALLOW_PROCESS_MANAGEMENT=false`), require CSRF authentication, and execute only after a single-use 30-second ephemeral ticket confirmation handshake.
- **Universal Loopback Protection:** All administrative and queue endpoints strictly verify loopback origin (`127.0.0.1` / `::1`), rejecting external network requests with `403 Forbidden`.
- **Directory Traversal Protection:** Image loading and thumbnail routes are strictly confined to ComfyUI `input`, `output`, and `temp` directories with traversal guards.
- **Optional Headless Dependencies:** System tray desktop integration (`pystray`) is an optional dependency, ensuring cloud containers (Docker, Colab, RunPod) run with zero dependency errors.
- **Opt-In Scraping:** Civitai and TMDB network scraping are opt-in and disabled by default.
- **Zero Runtime Package Installs:** No `install.py` or dynamic `pip` execution; all standard dependencies are cleanly declared in `requirements.txt`.
- **Local Environment:** All API keys and settings are stored locally in `.env` inside `user/default/SaturnNodes/` (auto-migrated from legacy `LeafFlow/` folder if present).
- **Atomic File Writes:** Safe atomic writes (`.tmp` + `os.replace`) prevent JSON corruption during sudden crashes.

---

## 🚀 Installation & Setup

1. Open your terminal and navigate to your ComfyUI `custom_nodes` directory:
   ```bash
   cd ComfyUI/custom_nodes
   git clone https://github.com/KOFiblto/ComfyUI-SaturnNodes.git
   ```
2. Restart ComfyUI.
3. Open ComfyUI Settings (⚙ gear menu) to configure API keys or feature toggles if desired.

---

## 📜 License

Distributed under the [MIT License](LICENSE).

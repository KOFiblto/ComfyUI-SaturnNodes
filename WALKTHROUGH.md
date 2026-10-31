# 🪐 ComfyUI-SaturnNodes Complete Walkthrough

Welcome to the full guide for ComfyUI-SaturnNodes! This custom node suite is designed to give you unprecedented control over your generations, visual asset management, and queue resilience.

This walkthrough covers everything from basic setup to advanced workflows across both the new ComfyUI V2 (Vue) and the classic ComfyUI (LiteGraph).

---

## 1. Global Features

### The Pause Queue Toolbar
Upon installing the extension, you will notice a new **Green/Orange Pause Button** nestled next to your standard "Queue Prompt" button.
- **Green (Running)**: ComfyUI operates normally.
- **Orange (Pausing/Paused)**: ComfyUI is holding the queue.

You have two pause modes, accessible by clicking the small dropdown arrow next to the Pause button:
1. **Pause (Finish)**: This will let your currently generating workflow finish completely, but it will intercept and hold any subsequent workflows in the queue until you click Continue.
2. **Pause (Instant)**: This tells ComfyUI to freeze *immediately* before executing the next node in your active workflow. You can resume precisely from where you left off later without losing progress!

### The System Tray Icon (Outside-Browser Queue Control)
Want to check your queue status or pause/resume generations while working in other apps (Photoshop, Blender, games) without opening ComfyUI in your browser?
1. Open ComfyUI Settings (⚙️ gear icon) and enable **`Enable System Tray Icon`** (search for `SaturnNodes` in the settings search box, or set `ENABLE_TRAY_ICON=true` in `ComfyUI/user/default/SaturnNodes/.env`).
2. SaturnNodes will spawn an OS system tray icon in your Windows/macOS/Linux taskbar notification area:
   - **Green Icon (❚❚)**: Indicates ComfyUI queue is actively running.
   - **Orange Icon (▶)**: Indicates ComfyUI queue is paused and waiting for you to continue.
   - **Orange Icon (❚❚)**: Indicates ComfyUI is in the middle of a generation and will pause as soon as the active workflow/node finishes.
3. Left-click the tray icon to quickly toggle between **Pause** and **Continue**.
4. Right-click the tray icon to choose explicit actions: **Pause (Finish)**, **Pause (Instant)**, **Continue / Resume**, switch default pause modes, or quickly **Open ComfyUI in Browser**.

### The 1D Git-Graph Batch Queue Visualizer
SaturnNodes automatically tracks which workflows are submitted together as a batch (whether through "Batch count" or sequential submission) and renders a clean, purely graphical 1D git-graph line directly to the left of your queued items in the queue list:
- **36 High-Contrast Cycling Colors**: Every new batch gets a distinct color from an accessible 36-color sequence so adjacent batches are visually distinguishable at a glance.
- **Purely Graphical (No Clutter)**: No numbers or text labels.
  - **Batch Start (`┌`)**: The top of the line curves inward towards the card and runs straight down.
  - **Batch Middle (`│`)**: Seamless, continuous straight vertical line.
  - **Batch End (`└`)**: Runs straight from above and curves inward towards the card at the bottom.
  - **Single Item (`(`)**: A standalone 1-item batch curves inward at both top and bottom like a bracket.
- **In-between Infiltration**: If you use "Queue Front" or insert another prompt between items of an active batch, the original batch maintains its open ends (no false start/end curves), while the inserted prompt is enclosed in its own bracket.
- **Works Standalone or with Persistent Queue**: Runs locally via `localStorage`, and synchronizes with the Persistent Queue so batch groupings survive server restarts.
- **V1 & V2 Frontend Compatible**: Works in the modern V2 queue sidebar (`JobAssetsList`) and classic V1 queue dialog.

### The Persistent Queue (Crash Recovery)
You don't need to interact with this—it runs silently in the background!
Every time you queue a prompt, SaturnNodes saves the entire queue state to your hard drive in real time. If your computer crashes, power goes out, or you accidentally close the terminal, ComfyUI will automatically restore your unfinished queue upon next boot. The **Recovery Launch State** setting controls whether recovery uses your normal launch state (`Match Default`), always pauses (`Force Paused`), or always runs (`Force Running`); use `Force Paused` if you want to inspect the restored queue before it starts.

The queue file is versioned. Older queue files are upgraded automatically, and if you downgrade to an older SaturnNodes version, a queue file written by a newer version is left read-only instead of being overwritten.

### Automatic Assets Pane & History Restore
In standard ComfyUI, restarting your server wipes the in-memory execution history, leaving your sidebar Assets Pane / History tab completely blank on launch.
- SaturnNodes automatically scans your `output` folder (read-only) on server startup and pre-populates the history with your latest **64 images** (or custom count).
- Scans run without blocking ComfyUI's queue mutex, include nested output subfolders by default, and understand PNG, JPEG, WebP, ComfyUI graphs, and A1111/Forge `parameters` metadata.
- All images are loaded in strict chronological order with embedded workflow and prompt graphs intact.
- Features like **Copy Prompt** and **Copy Workflow** immediately work with restored images as if they were generated in your current session!
- New generations record their real execution duration in `generation_times.json`; restored images show that time when available. Older images still use their file mtime for ordering, but no invented duration is shown when none was recorded.
- Use **`Restore Now`** in Settings to rescan immediately, or adjust **`Restored Assets Count`**, **`Scan Output Subfolders Recursively`**, and **`Show Generation Time on Restored Assets`** (search for `SaturnNodes`).

### Image Overlay Actions & Prompt Bookmarks
Hovering over any image in the ComfyUI Assets / History pane or preview nodes provides powerful quick actions directly on the card:
- **📋 Copy Prompt**: Instantly copies the positive prompt text/graph to your clipboard.
- **🔖 Save to Prompt Bookmarks**: One-click saves prompt text straight into your Prompt Bookmarks list with robust SVG bookmark iconography.
- **🔍 Inspect Asset (Zoom)**: When enabled via the **Show "Inspect Asset" (Zoom) Button on Images** setting, restores the direct full-size zoom inspect button right on the card hover pill bar alongside Download and Copy Prompt (bringing back quick one-click access that newer ComfyUI frontend versions moved into the 3-dots submenu).
- **Dynamic Button Pill Styling**: The action button bar dynamically calculates borders and corner rounding (`rounded-l-lg`, `rounded-r-lg`) depending on which actions are enabled in settings, maintaining a seamless native appearance.

---

## 2. Advanced Nodes

### 🪐 ⏸️ Saturn Decision
Sometimes you run a complex workflow that takes hours (e.g., upscaling), but you want to check a low-res preview first to ensure it's worth the compute time.
1. Drop the **`🪐 ⏸️ Saturn Decision`** node into your workflow between the low-res and high-res stages.
2. When the execution reaches this node, your workflow will pause, and a native desktop notification (Windows/macOS/Linux) will alert you!
3. You will see a popup UI on your ComfyUI canvas giving you three choices:
   - **Continue**: Proceeds with the workflow normally.
   - **Cancel**: Outputs a `True` signal. You can route this into a Switch node to bypass the high-res stage entirely.
   - **Stop Workflow**: Instantly aborts the generation queue, exactly like clicking the red X in ComfyUI.

### 🪐 📂 Load Image From Folder
An absolute powerhouse for automation. Point this node at any folder on your hard drive, and it will automatically ingest incoming images, convert them into tensors, and delete the original files to keep the folder clean.
- **wait_if_folder_is_empty**: If set to `True`, the workflow will patiently pause and poll the folder at your `rescan_interval` until an image arrives. Perfect for linking ComfyUI to external tools like Photoshop or Blender auto-exports!
- **Regex Filtering**: Only want it to grab images that start with `render_`? Just use standard regex like `^render_.*\.png$`.

### 🪐 🖼️ Visual LoRA & Image Loaders
Tired of guessing what a LoRA does based on its filename?
1. Use the **`🪐 🖼️ Visual LoRA Loader`**. It natively extracts preview images if you place an identically named `.png`/`.jpg` next to your `.safetensors` file.
2. If you enable the **Civitai Auto-Scraper** in your ComfyUI Settings, the node will calculate the SHA256 hash of your LoRA and automatically download the official preview thumbnail directly from Civitai!
3. **Pretty Name String Output**: The node outputs the parsed, human-readable name of the loaded LoRA (e.g. "Addison Rae V1") by default, allowing you to route it into a text prompt or watermark node. You can easily switch this via the `output_name` toggle on the node to output the raw filename without extension instead.
4. **Independent Per-Node Zoom**: Use the `tile_size` slider to adjust preview card sizes to your preference. Zoom levels are saved per node directly inside your workflow JSON, so different visual loaders maintain independent tile sizes across browser reloads.
5. **Maintenance Reset Buttons**: The control bar offers `↺ Counter` (reset this node's Sequential/Random LoRA cycle + prompt→LoRA assignments), `🧹 Usage` (clear usage badges), and `🗑 Cache` (delete cached thumbnails). Each asks for confirmation. ⚠️ Only use `↺ Counter` when the queue is empty — resetting mid-batch restarts the LoRA cycle from the first selected LoRA and can mismatch prompts against LoRAs.

### 🪐 🧑‍🎤 Character Preset Picker
Keep characters as **cards** instead of remembering LoRA filenames and trigger words.

1. Add **`🪐 🧑‍🎤 Character Preset Picker`** and click **New** in its toolbar. Give the card an id (`Folder/Name` for categories), a trigger word, a positive prompt, a negative prompt, and one or more LoRAs with their own model/clip strengths.
2. Drop a thumbnail in with **Upload image**, or click **Use LoRA preview** to copy the preview of a card that has exactly one LoRA.
3. Connect the picker's `loras` (or `loras_json`) output to **`🪐 🧬 Apply Character LoRAs`**, and route `positive`/`negative` into your prompt encoder. The picker itself never touches `MODEL`/`CLIP`, so it can sit anywhere in the graph.
4. **Clicking cards**: click cards to add them to the run — each selected card shows a numbered badge with its click order. Choose how they are consumed with `selection_mode` — `Sequential` cycles through the clicked cards, `Random` picks one, `Random (No Replace)` uses all of them before repeating, `All` uses every clicked card at once (in click order).
5. **Prompt-driven picking**: wire your prompt text into the `text` input and the picker highlights the card whose trigger appears in it (the first trigger in the text wins; enable `match_all` for several). While text is connected the grid is read-only; disconnect it or clear the text and your clicked cards are used again. After each run the card that was actually used flashes on the canvas.
6. Type the trigger word into your prompt yourself — the picker does not inject it.

> [!NOTE]
> Cards live in `ComfyUI/user/default/SaturnNodes/character_presets/` as `<Name>.json` plus an optional sidecar image. Use the **Folder** button to open that directory and back it up or share cards.

#### Bulk importing existing character LoRAs
Already have a folder full of character LoRAs (for example `Krea2/Celebrity`)? Open the picker, click **Import**, enter that folder and scan.

1. **Card folder** is prefilled with the last folder name, so the cards land under `Celebrity/…` and keep the LoRA subfolders (`Celebrity/Actresses`, `Celebrity/Marvel`, …).
2. **Trigger word**: `From LoRA metadata` uses the training captions when they contain something specific (generic tokens like `sks woman` are ignored) and otherwise falls back to the humanised file name — usually the character's name, which is exactly what you type in the prompt anyway.
3. Untick anything you do not want, then **Import**. Each card gets the LoRA at 1.0 and inherits the LoRA's sidecar preview image. Prompts start empty so your existing workflow stays in charge.
4. Re-importing later with **Overwrite existing cards** keeps the prompts and triggers you already wrote and only refreshes the LoRA link.

### 🪐 ⏱️ Recent Outputs
Want to quickly reference your recent generations without digging through Windows Explorer? The **`🪐 ⏱️ Recent Outputs`** node cycles chronologically through your `output/` directory, pulling your freshest creations right back into the workflow canvas.

### 🪐 📝 Prompt Counter & 🪐 🔄 Prompt Queue Iterator
Managing multi-prompt queues and setting the exact ComfyUI batch size has never been easier:
1. **`🪐 📝 Prompt Counter`**: Place this multiline text node in your workflow and paste all your prompts.
   - As you type or paste, the live badge instantly updates (e.g. `24 Prompts`), so you know exactly what batch size to set before clicking Queue!
   - Under Advanced Options, select your delimiter (`>1 Empty Line`, `Newline`, `>2 Empty Lines`, or `Custom Regex`).
   - If `Custom Regex` is selected, enter any custom delimiter pattern (such as `\n---\n`). The regex field is dynamically enabled only when Custom Regex is active.
2. **`🪐 🔄 Prompt Queue Iterator`**: Connect the `STRING` output of the Prompt Counter into the Prompt Queue Iterator to sequentially pop and execute each prompt run-by-run.
   - Now supports `Custom Regex` in addition to empty line and newline separators.
   - Choose **`Text & Node`** tracking to keep independent pointers per prompt text/splitter, or **`Node Only`** to keep one pointer per node while you edit prompts.
   - `Sequential (Stop on End)` exposes an **`exhausted`** boolean so a workflow can stop after the last prompt.
   - Includes live progress counter widget (`Run X / Y`), an index reset button (`Reset Counter (0)`, now with a confirmation explaining that it restarts the run pointer and clears crash-recovery assignments/shuffle state — it does **not** empty the queue state file; use Settings → `🔄 Reset All Queues` for a full wipe), and direct state file access (`Open Queue File`).

---

## 3. Formatting Folder Paths
Several nodes across this suite (e.g. *Load Image From Folder*, *Recent Outputs*, *Visual Image Loader*, *Visual LoRA Loader*) take a `folder` or `folder_path` string as input. Here is how they work:

- **Empty String**: Leaving a field completely empty (or spaces) will default to the sensible native directory for that node (e.g., leaving it empty on *Recent Outputs* will automatically target ComfyUI's root `output/` directory).
- **Safe Directory Containment**: For security, image loading and visual thumbnail nodes are confined to ComfyUI `input`, `output`, and `temp` directories with path traversal protection.
- **Subfolder Paths**: You can specify subdirectories like `batch_01` or `renders/portraits` within the allowed ComfyUI directories.
- **Wildcard Filters (`*`)**:
  - **For the LoRA Loader**: Ending a path with `*` acts as a wildcard directory filter. For example, if you input `style/*`, the loader will recursively display all LoRAs located inside any subfolder that begins with `style/`.
  - **For File Loaders**: If you accidentally copy a path from Windows Explorer that ends in `\*` or `*`, these nodes are smart enough to automatically strip the trailing asterisk so the folder path still resolves cleanly without throwing an OS Error.

---

## 4. Settings & Configuration

Click the standard ComfyUI Settings gear ⚙️ and search for `SaturnNodes` to access the suite's configurations. Here you can:
- Safely enter and mask API Keys for Civitai and TMDB scraping.
- Change the colors of the Pause Queue buttons via built-in color pickers.
- Adjust the default boot behavior for the Persistent Queue (e.g., forcing ComfyUI to always boot in a Paused state), retry limits for failed queue restores, and whether the last manual pause state survives a restart.
- Tune the Visual Image Loader metadata scan limit, restore nested output folders, show recorded generation times on restored assets, and trigger **Restore Now** without restarting.
- Enable the floating Live Latent dock, drag-resize the queue overlay, and hide entire nodes from the Add Node menu under **Node Management**.

> **Cross-Platform Note**: All of the visual nodes, pause features, and OS notifications are fully compatible with Windows, macOS, and Linux, and seamlessly adapt to both the modern ComfyUI V2 interface and the classic LiteGraph UI!

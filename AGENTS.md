# 🤖 Agent & Developer Standard Operating Procedure (SOP)
## `ComfyUI-SaturnNodes` Contributor & Automation Guide

This guide defines the engineering checklist and architecture standards for all AI agents (Antigravity, Claude, Gemini, Cursor, Copilot) and human developers contributing to **`ComfyUI-SaturnNodes`**.

For Git workflow, branch protection, and Pull Request guidelines, see **[`CONTRIBUTING.md`](./CONTRIBUTING.md)**.

---

## 📚 Repository Markdown Index

| File | Purpose & Contents | Link |
| :--- | :--- | :--- |
| **`AGENTS.md`** | Authoritative developer & agent standard operating procedure, engineering checklists, architecture rules. | [AGENTS.md](./AGENTS.md) |
| **`CONTRIBUTING.md`** | Community contribution guidelines, strict branch rules, PR submission workflow. | [CONTRIBUTING.md](./CONTRIBUTING.md) |
| **`README.md`** | Main project homepage, installation guide, complete node catalog with parameter tables and UI settings guide. | [README.md](./README.md) |
| **`WALKTHROUGH.md`** | Step-by-step user tutorials, example workflows, visual load guides, and batch prompting patterns. | [WALKTHROUGH.md](./WALKTHROUGH.md) |
| **`CHANGELOG.md`** | Strict Keep-A-Changelog semantic version release history across all updates. | [CHANGELOG.md](./CHANGELOG.md) |
| **`SECURITY.md`** | Security policies, supported versions, and private vulnerability disclosure instructions. | [SECURITY.md](./SECURITY.md) |
| **`SECURITY_AUDIT_PLAYBOOK.md`** | Authoritative ComfyUI custom node security rulebook, PR #3200 review precedents, threat model, and coding standards. | [SECURITY_AUDIT_PLAYBOOK.md](./SECURITY_AUDIT_PLAYBOOK.md) |
| **`CLAUDE.md`** | AI agent instruction pointer. | [CLAUDE.md](./CLAUDE.md) |
| **`GEMINI.md`** | AI agent instruction pointer. | [GEMINI.md](./GEMINI.md) |
| **`bug_report.md`** | GitHub issue template for reporting reproducible defects. | [bug_report.md](./.github/ISSUE_TEMPLATE/bug_report.md) |
| **`feature_request.md`** | GitHub issue template for proposing new nodes or UI features. | [feature_request.md](./.github/ISSUE_TEMPLATE/feature_request.md) |

---

## 📑 Table of Contents
1. [Architecture & Directory Layout](#1-architecture--directory-layout)
2. [Checklist: Adding a New Node](#2-checklist-adding-a-new-node)
3. [Checklist: Adding a New Setting / Feature Flag](#3-checklist-adding-a-new-setting--feature-flag)
4. [Checklist: Updating Dependencies](#4-checklist-updating-dependencies)
5. [Cross-Platform & Safe Coding Standards](#5-cross-platform--safe-coding-standards)
6. [User Data & Storage Architecture (`ComfyUI/user/default/SaturnNodes/`)](#7-user-data--storage-architecture-comfyuiuserdefaultsaturnnodes)
7. [Git, Branching & Commit Conventions](#6-git-branching--commit-conventions)

---

## 1. Architecture & Directory Layout

```
ComfyUI-SaturnNodes/
├── __init__.py                # Node registration (NODE_CLASS_MAPPINGS), settings routes (/saturnnodes/*)
├── pyproject.toml             # Package metadata, dependencies & ComfyUI Registry configuration
├── requirements.txt           # Pip dependencies (auto-installed by ComfyUI Manager)
├── .env.example               # Template of all supported environment variables
├── .gitignore                 # Exclusion rules for caches, states, and credentials
├── .comfyignore               # Files excluded from the ComfyUI Registry package archive
├── nodes/                     # Python backend node implementations
│   ├── aspect_ratio.py        # Text & preview aspect ratio calculation nodes
│   ├── assets_restore.py      # Startup output-folder history restoration
│   ├── auto_watcher.py        # Automated folder watch image loaders
│   ├── character_presets.py   # Character preset cards, visual picker & LoRA applier
│   ├── decision_node.py       # Inline pause/gate decision node & notifications
│   ├── generation_times.py    # Prompt duration recording for restored asset history
│   ├── image_loader.py        # Visual image browser & EXIF/PNG metadata parser
│   ├── load_recent.py         # Recent outputs loader node
│   ├── local_runner.py        # Confined local script execution node & authorization routes
│   ├── lora_finder.py         # Text-based prompt LoRA scanner & patcher
│   ├── lora_loader.py         # Folder & visual LoRA loaders + Civitai/TMDB scrapers
│   ├── preview_latent.py      # Live latent WebSocket preview node
│   ├── prompt_counter.py      # Multiline prompt counter node
│   ├── prompt_iterator.py     # Multiline prompt queue batch popper
│   ├── queue_control.py       # Pause Queue, Persistent Queue hooks, and server routes
│   ├── stereogram.py          # Stereoscopic 3D / cross-eye generator nodes
│   ├── text_replacer.py       # Multiline regex & list text replacer node
│   ├── text_split.py          # Forward/backward & regex text splitter node
│   ├── tray_icon.py           # OS system tray icon manager & status indicator
│   └── utils.py               # Shared path sanitization, string parsing, and formatting helpers
├── web/                       # Frontend extensions & static assets
│   ├── saturnnodes_colors.js  # Node theme colors (LiteGraph canvas & Vue V2)
│   ├── saturnnodes_settings.js# Native ComfyUI Settings panel registrations
│   ├── pause_queue.js         # Top toolbar Pause/Continue button group & dropdown
│   ├── pause_queue.css        # Toolbar styling
│   ├── persistent_queue.js    # Queue crash-recovery client ownership claimer
│   ├── batch_queue.js         # 1D git-graph batch queue visualizer
│   ├── floating_latent_dock.js# Floating live latent preview dock
│   ├── preview_node.js        # Live latent canvas preview widget
│   ├── logo.png               # Registry icon (400x400)
│   └── js/                    # Node-specific UI widgets (visual pickers, buttons, aspect preview)
│       ├── auth_helper.js     # CSRF token helper shared by all frontend extensions
│       ├── character_presets.js # Character preset card grid, editor modal & detect preview
│       ├── copy_prompt.js
│       ├── decision_node.js
│       ├── folder_lora_loader.js
│       ├── image_loader.js
│       ├── local_runner.js
│       ├── power_sidebar.js
│       ├── preview_aspect_ratio.js
│       ├── preview_manager.js
│       ├── prompt_counter.js
│       ├── prompt_iterator.js
│       └── stereogram.js
├── README.md                  # Main documentation & complete node reference
├── WALKTHROUGH.md             # End-user guide for workflows and features
└── CHANGELOG.md               # Version release history
```

---

## 2. Checklist: Adding a New Node

When implementing a new custom node, you **must complete all 5 steps**:

### Step 2.1: Python Backend (`nodes/<module>.py`)
- [ ] Define standard class attributes:
  - `INPUT_TYPES(cls)`: Return dict with `required`, `optional`, and `hidden` widgets. Always specify defaults, min/max/step for numbers.
  - `RETURN_TYPES`: Tuple of output types (e.g. `("IMAGE", "STRING")`).
  - `RETURN_NAMES`: Tuple of human-readable output labels.
  - `FUNCTION`: Exact method name to execute.
  - `CATEGORY`: Categorized under `"🪐 SaturnNodes/Loaders"`, `"🪐 SaturnNodes/Utils"`, `"🪐 SaturnNodes/Automation"`, `"🪐 SaturnNodes/Previews"`, or `"🪐 SaturnNodes/3D & Previews"`.
  - `DESCRIPTION`: Clear multi-line string explaining node functionality and parameters.
- [ ] Use `sanitize_folder_path(folder_input, default_dir)` from `nodes.utils` for any path/directory arguments (handles Windows/Linux slashes, wildcards `*`, and relative paths cleanly).
- [ ] Ensure dummy tensors are valid 4D float32 batches `torch.zeros((1, 64, 64, 3), dtype=torch.float32)` for empty image states.
- [ ] Use `comfy.model_management.throw_exception_if_processing_interrupted()` inside long loops.

### Step 2.2: Export & Map in `__init__.py`
- [ ] Import the node class into [`__init__.py`](./__init__.py).
- [ ] Register in `NODE_CLASS_MAPPINGS`:
  ```python
  NODE_CLASS_MAPPINGS = {
      "YourNewNodeName": YourNewNodeClass,
      # ...
  }
  ```
- [ ] Register in `NODE_DISPLAY_NAME_MAPPINGS` with the Saturn prefix and emoji:
  ```python
  NODE_DISPLAY_NAME_MAPPINGS = {
      "YourNewNodeName": "🪐 🏷️ Your Display Name",
      # ...
  }
  ```
- [ ] Avoid renaming or replacing existing node class names; if unavoidable, migrate known workflow files to the new class name instead of keeping permanent legacy aliases (see §7).

### Step 2.3: Frontend Extensions & Colors (`web/`)
- [ ] If the node needs custom canvas/DOM widgets, implement the extension under `web/js/<feature>.js`.
- [ ] In `nodeCreated(node)` or `beforeRegisterNodeDef(nodeType, nodeData)`, **always check both `node.comfyClass` and `node.type`**:
  ```javascript
  const isTargetNode = node.comfyClass === "YourNodeName" ||
                       node.type === "YourNodeName";
  ```
- [ ] Register node theme colors in [`web/saturnnodes_colors.js`](./web/saturnnodes_colors.js):
  - The suite uses a single unified Saturn amber theme (`DEFAULT_HEADER_COLOR = "#6a3f20"`, `DEFAULT_BG_COLOR = "#472a15"`), user-overridable via the Custom Node Title/Body Color settings.
  - Add the new node class key to `SATURN_NODE_TYPES` so the custom colors apply to it.

### Step 2.4: Documentation (`README.md` & `WALKTHROUGH.md`)
- [ ] Add a clean heading section in [`README.md`](./README.md) under `## 📦 Individual Nodes Reference`:
  - Heading: `### 🪐 🏷️ Display Name — \`ClassName\``
  - `#### Overview`
  - `#### Inputs & Widgets`
  - `#### Outputs`
- [ ] If the node introduces a new workflow pattern, add a section in [`WALKTHROUGH.md`](./WALKTHROUGH.md).

### Step 2.5: Changelog
- [ ] Add entry under `### Added` in [`CHANGELOG.md`](./CHANGELOG.md).

---

## 3. Checklist: Adding a New Setting / Feature Flag

When introducing a configurable option or feature toggle:

### Step 3.1: `.env.example`
- [ ] Add the variable with default value and explanation in [`.env.example`](./.env.example):
  ```ini
  # Brief description of what this setting controls
  YOUR_NEW_SETTING=true
  ```

### Step 3.2: Backend Settings Synchronization (`__init__.py`)
- [ ] In `get_settings()` route: parse and return the setting.
- [ ] In `save_settings()` route: read value from incoming JSON, persist to `.env` file via `new_lines`, update `os.environ`, and trigger any dynamic runtime manager updates.

### Step 3.3: Frontend Settings Registration (`web/saturnnodes_settings.js`)
- [ ] Register via `app.ui.settings.addSetting({...})`:
  ```javascript
  app.ui.settings.addSetting({
      id: "SaturnNodes.YourSettingName",
      name: "🪐 SaturnNodes: Your Setting Display Name",
      type: "boolean" /* or "text", "combo" */,
      defaultValue: false,
      tooltip: "Descriptive tooltip explaining user impact.",
      onChange(value) {
          api.fetchApi("/saturnnodes/settings", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ your_setting_key: value })
          }).catch(() => {});
      }
  });
  ```

### Step 3.4: Documentation
- [ ] Update `## ⚙️ ComfyUI Settings Menu Reference` in [`README.md`](./README.md).
- [ ] Update `## 4. Settings & Configuration` in [`WALKTHROUGH.md`](./WALKTHROUGH.md).

---

## 4. Checklist: Updating Dependencies

If a feature requires a new Python package:
- [ ] Add the package to `dependencies` in [`pyproject.toml`](./pyproject.toml) (ComfyUI Registry packaging).
- [ ] Keep [`requirements.txt`](./requirements.txt) in sync for ComfyUI Manager auto-install.
- [ ] Check imports gracefully handle missing optional libraries (e.g. `try... except ImportError`).
- [ ] **Never** add an `install.py` or any runtime `pip`/`subprocess` installation — the suite is ComfyUI Registry compliant and installs nothing dynamically.

---

## 5. Cross-Platform & Safe Coding Standards

1. **Terminal Console Safety (Windows `cp1252` encoding)**:
   - **Never include raw unicode emojis in backend `print()` calls** (e.g. write `print("[SaturnNodes] Started")` instead of `print("[SaturnNodes] 🪐 ...")`).
   - Windows consoles running on default codepages will raise fatal `UnicodeEncodeError: 'charmap' codec can't encode character` if raw emoji bytes hit standard output.
2. **Path Sanitization**:
   - Never assume `/` or `\` separators; always use `os.path.join()`, `os.path.normpath()`, or `sanitize_folder_path()`.
3. **OS Platform Detection**:
   - Use `sys.platform` (`'win32'`, `'darwin'`, `'linux'`) rather than POSIX-only calls like `os.uname()`.
4. **Non-Blocking & Daemon Threads**:
   - All background threads (scraping, tray icons, persistent queue sync) must set `daemon=True` so they do not block ComfyUI shutdown.
5. **Bytecode Validation**:
   - Before committing, always run:
     ```bash
     python -m compileall .
     ```
     Ensure 0 syntax errors across all modules.

---

## 7. User Data & Storage Architecture (`ComfyUI/user/default/SaturnNodes/`)

All user-specific runtime states, API credentials, usage counters, and temporary caches **MUST** be stored centrally in `ComfyUI/user/default/SaturnNodes/` using the helper `get_saturnnodes_user_dir()` in `nodes/utils.py`:

```python
from .utils import get_saturnnodes_user_dir

USER_DIR = get_saturnnodes_user_dir()
STATE_FILE = os.path.join(USER_DIR, "your_state.json")
```

### Stored User Files:
- `ComfyUI/user/default/SaturnNodes/.env` — API keys and persistent settings
- `ComfyUI/user/default/SaturnNodes/lora_usage.json` — LoRA selection counts and usage badges
- `ComfyUI/user/default/SaturnNodes/image_prompts_cache.json` — Cached positive prompts extracted from images
- `ComfyUI/user/default/SaturnNodes/generation_times.json` — Recorded prompt durations and output filenames for restored asset history
- `ComfyUI/user/default/SaturnNodes/failed_scrapes.json` — Failed Civitai/TMDB scraping attempts cache
- `ComfyUI/user/default/SaturnNodes/prompt_iterator_state.json` — Current iteration pointers and popped prompt queues
- `ComfyUI/user/default/SaturnNodes/persistent_queue.json` — Real-time queue crash recovery state

### Directory Rules & Compatibility Policy:
- All state, caches, and credentials live in `ComfyUI/user/default/SaturnNodes/` only. No legacy directories are read, migrated, or referenced.
- No pre-rename compatibility shims exist or may be reintroduced (old HTTP routes, old setting keys/IDs, old localStorage keys, old headers, old user directories, old node class-name aliases). Old workflow files are migrated to the current node names instead.

---

## 6. Git, Branching, Versioning & Release Strategy (MANDATORY)

### 6.1 Version-Named Branching Workflow
From version `v2.5.0` onward, all development work in this repository strictly adheres to a version-scoped branching model:
1. **Active Work Occurs ONLY in the Current Version Branch**:
   - All active development, bug fixes, UI improvements, and code changes **MUST** occur on a dedicated branch named directly after the target version prefixed with `v` (e.g. `v2.5.0`).
   - Git and GitHub fully support dots in branch names (`v2.5.0`, `v2.6.0`, `v3.0.0`).
   - **STRICTLY PROHIBITED**: Never commit or push directly to `main` during active development.
2. **Strict User-Approval Gate for Merges & Releases**:
   - Merging to `main` is **STRICTLY GATED** by explicit user approval.
   - **NEVER** merge a version branch into `main` unless the user explicitly commands: *"merge to main"* or *"make a release"*.
3. **Release & Tagging Execution Steps (Upon User Command)**:
   When explicit permission to release is granted:
   - **Merge**: Merge the version branch (e.g. `v2.5.0`) into `main`.
   - **Tag**: Create an annotated Git tag prefixed with `v` (e.g. `git tag -a v2.5.0 -m "v2.5.0 ..."`).
     - *Rule*: **ALWAYS** use the `v` prefix (`v2.5.0`, `v2.6.0`). **NEVER** create bare tags without `v` (like `2.5.0`).
   - **GitHub Release**: Publish or update the GitHub Release attached to that `vX.Y.Z` tag.
     - *Rule*: Every release **MUST** include a clear, descriptive title (e.g. `v2.5.0 - <Feature/Theme Summary> 🪐`) and a concise markdown bullet-point explanation of what changed and what was fixed (matching the standard of `v2.3.2` and `v2.4.0`), never just bare automated compare links.
   - **Next Version Transition**:
     - Immediately checkout a new branch from `main` named after the next target version (e.g. `git checkout -b v2.6.0` or `git checkout -b v3.0.0`).
     - Update version identifiers in `pyproject.toml`, `__init__.py`, `CHANGELOG.md`, and frontend info to the new development version.
     - Continue all subsequent work exclusively on the new version branch.

### 6.2 Excluded Files & Privacy
Never commit sensitive keys, personal paths, runtime states, or caches:
- `.env`, `.env.local`
- `persistent_queue.json`, `lora_usage.json`, `failed_scrapes.json`, `image_prompts_cache.json`
- `user/` directory
- Personal user names, machine paths (`C:\Users\...`), or private model names.

### 6.3 Commit Messages
Use atomic, descriptive English commit headers:
- `Feat: ...` (New features or nodes)
- `Fix: ...` (Bug fixes, UI repairs)
- `Docs: ...` (Documentation, README, Walkthrough updates)
- `Refactor: ...` (Code restructuring or cleanup)
- `Release: ...` (Consolidated version release merge)

### 6.4 Registry Publishing (ComfyUI Registry)
- Registry node name: `saturnnodes` (Publisher `KOFiblto`, `DisplayName = ComfyUI-SaturnNodes`). **Published versions are immutable** — always bump the version before publishing a change.
- `.github/workflows/publish_action.yml` publishes automatically when `pyproject.toml` changes on `main` (and can also be triggered manually via workflow dispatch). It requires the `REGISTRY_ACCESS_TOKEN` repository secret.
- `.comfyignore` excludes development files (tests, CI, contributor docs) from the published package archive.
- Icon (`web/logo.png`) must be square, 400x400 or smaller.

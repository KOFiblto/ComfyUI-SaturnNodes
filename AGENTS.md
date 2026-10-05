# 🤖 Agent & Developer Standard Operating Procedure (SOP)
## `ComfyUI-LeafFlow` Contributor & Automation Guide

This guide defines the engineering checklist and architecture standards for all AI agents (Antigravity, Claude, Gemini, Cursor, Copilot) and human developers contributing to **`ComfyUI-LeafFlow`**.

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
6. [User Data & Storage Architecture (`ComfyUI/user/default/LeafFlow/`)](#7-user-data--storage-architecture-comfyuiuserdefaultleafflow)
7. [Git, Branching & Commit Conventions](#6-git-branching--commit-conventions)

---

## 1. Architecture & Directory Layout

```
ComfyUI-LeafFlow/
├── __init__.py                # Node registration (NODE_CLASS_MAPPINGS), web endpoints (/leafflow/settings)
├── install.py                 # Dependency installer script for ComfyUI Manager
├── pyproject.toml             # Package metadata and pip dependencies
├── .env.example               # Template of all supported environment variables
├── .gitignore                 # Exclusion rules for caches, states, and credentials
├── nodes/                     # Python backend node implementations
│   ├── aspect_ratio.py        # Text & preview aspect ratio calculation nodes
│   ├── auto_watcher.py        # Automated folder watch image loaders
│   ├── decision_node.py       # Inline pause/gate decision node & notifications
│   ├── text_split.py          # Forward/backward & regex text splitter node
│   ├── image_loader.py        # Visual image browser & EXIF/PNG metadata parser
│   ├── load_recent.py         # Recent outputs loader node
│   ├── lora_finder.py         # Text-based prompt LoRA scanner & patcher
│   ├── lora_loader.py         # Folder & visual LoRA loaders + Civitai/TMDB scrapers
│   ├── preview_latent.py      # Live latent WebSocket preview node
│   ├── prompt_iterator.py     # Multiline prompt queue batch popper
│   ├── queue_control.py       # Pause Queue, Persistent Queue hooks, and server routes
│   ├── text_replacer.py       # Multiline regex & list text replacer node
│   ├── tray_icon.py           # OS system tray icon manager & status indicator
│   └── utils.py               # Shared path sanitization, string parsing, and formatting helpers
├── web/                       # Frontend extensions & static assets
│   ├── leafflow_colors.js # Node theme colors (LiteGraph canvas & Vue V2)
│   ├── leafflow_settings.js# Native ComfyUI Settings panel registrations
│   ├── pause_queue.js         # Top toolbar Pause/Continue button group & dropdown
│   ├── pause_queue.css        # Toolbar styling
│   ├── persistent_queue.js    # Queue crash-recovery client ownership claimer
│   ├── preview_node.js        # Live latent canvas preview widget
│   └── js/                    # Node-specific UI widgets (visual pickers, buttons, aspect preview)
│       ├── decision_node.js
│       ├── copy_prompt.js
│       ├── folder_lora_loader.js
│       ├── image_loader.js
│       ├── preview_aspect_ratio.js
│       ├── preview_manager.js
│       └── prompt_iterator.js
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
  - `CATEGORY`: Categorized under `"🍃 LeafFlow/Loaders"`, `"🍃 LeafFlow/Utils"`, `"🍃 LeafFlow/Automation"`, or `"🍃 LeafFlow/Previews"`.
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
- [ ] Register in `NODE_DISPLAY_NAME_MAPPINGS` with leaf prefix and emoji:
  ```python
  NODE_DISPLAY_NAME_MAPPINGS = {
      "YourNewNodeName": "🍃 🏷️ Your Display Name",
      # ...
  }
  ```
- [ ] If renaming or replacing an existing node, **always preserve the old name in `NODE_CLASS_MAPPINGS` as an alias** to avoid breaking user workflows!

### Step 2.3: Frontend Extensions & Colors (`web/`)
- [ ] If the node needs custom canvas/DOM widgets, implement the extension under `web/js/<feature>.js`.
- [ ] In `nodeCreated(node)` or `beforeRegisterNodeDef(nodeType, nodeData)`, **always check both `node.comfyClass` and `node.type`**, and support aliases:
  ```javascript
  const isTargetNode = ["YourNodeName", "YourOldAlias"].includes(node.comfyClass) || 
                       ["YourNodeName", "YourOldAlias"].includes(node.type);
  ```
- [ ] Register node theme colors in [`web/leafflow_colors.js`](./web/leafflow_colors.js):
  - Loaders: Emerald Green (`color: "#059669"`, `bgcolor: "#047857"`)
  - Automation & Utils: Amber (`color: "#d97706"`, `bgcolor: "#b45309"`)
  - Previews & Decisions: Violet (`color: "#7c3aed"`, `bgcolor: "#6d28d9"`)

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

### Step 3.3: Frontend Settings Registration (`web/leafflow_settings.js`)
- [ ] Register via `app.ui.settings.addSetting({...})`:
  ```javascript
  app.ui.settings.addSetting({
      id: "LeafFlow.YourSettingName",
      name: "🍃 LeafFlow: Your Setting Display Name",
      type: "boolean" /* or "text", "combo" */,
      defaultValue: false,
      tooltip: "Descriptive tooltip explaining user impact.",
      onChange(value) {
          api.fetchApi("/leafflow/settings", {
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
- [ ] Add package to `dependencies` in [`pyproject.toml`](./pyproject.toml).
- [ ] Add package to `dependencies` list in [`install.py`](./install.py).
- [ ] Check imports gracefully handle missing optional libraries (e.g. `try... except ImportError`).

---

## 5. Cross-Platform & Safe Coding Standards

1. **Terminal Console Safety (Windows `cp1252` encoding)**:
   - **Never include raw unicode emojis in backend `print()` calls** (e.g. write `print("[LeafFlow] Started")` instead of `print("[LeafFlow] 🍃 ...")`).
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

## 7. User Data & Storage Architecture (`ComfyUI/user/default/LeafFlow/`)

All user-specific runtime states, API credentials, usage counters, and temporary caches **MUST** be stored centrally in `ComfyUI/user/default/LeafFlow/` using the helper `get_leafflow_user_dir()` in `nodes/utils.py`:

```python
from .utils import get_leafflow_user_dir

USER_DIR = get_leafflow_user_dir()
STATE_FILE = os.path.join(USER_DIR, "your_state.json")
```

### Stored User Files:
- `ComfyUI/user/default/LeafFlow/.env` — API keys and persistent settings
- `ComfyUI/user/default/LeafFlow/lora_usage.json` — LoRA selection counts and usage badges
- `ComfyUI/user/default/LeafFlow/image_prompts_cache.json` — Cached positive prompts extracted from images
- `ComfyUI/user/default/LeafFlow/failed_scrapes.json` — Failed Civitai/TMDB scraping attempts cache
- `ComfyUI/user/default/LeafFlow/prompt_iterator_state.json` — Current iteration pointers and popped prompt queues
- `ComfyUI/user/default/LeafFlow/persistent_queue.json` — Real-time queue crash recovery state

### Future Migration Hooks SOP:
If legacy files need to be migrated in future multi-user releases or version upgrades:
1. In `nodes/utils.py`, define a startup check `migrate_legacy_user_data()`.
2. Inspect `custom_nodes/ComfyUI-LeafFlow/` for legacy files (`.env`, `lora_usage.json`, etc.).
3. Atomically move them to `get_leafflow_user_dir()` using `shutil.move()` or copy + delete.
4. Log a single clean notification `[LeafFlow] 🍃 Migrated legacy user data to ComfyUI/user/default/LeafFlow/`.

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

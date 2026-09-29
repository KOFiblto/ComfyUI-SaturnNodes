# 🤝 Contributing to ComfyUI-SaturnNodes

Thank you for your interest in contributing to **`ComfyUI-SaturnNodes`**! We welcome bug reports, feature suggestions, documentation updates, and pull requests from the community.

Please take a moment to review these guidelines before submitting an issue or pull request.

---

## 🐛 Reporting Issues & Bugs

Before opening a new issue:
1. **Check Existing Issues**: Search the [Issue Tracker](https://github.com/KOFiblto/ComfyUI-SaturnNodes/issues) to see if your bug or feature request has already been reported.
2. **Include Reproduction Steps**: Provide a clear step-by-step description of how to reproduce the bug.
3. **Include Logs & Environment Details**:
   - **ComfyUI Version** (V2 Vue UI or Classic V1 LiteGraph)
   - **OS** (Windows, Linux, macOS)
   - **Browser** (Chrome, Firefox, Edge)
   - Full Python console log traceback (if execution errored).

---

## 🛠️ Contribution Workflow (Feature Branches & PRs)

### Branch and Pull Request Policy
Direct pushes to the `main` branch are strictly prohibited. Active development is organized into dedicated version branches (e.g. `v2.5.0`, `v2.6.0`). Community features or fixes should branch off the active version branch or submit Pull Requests targeting it.

Merging into `main` and creating releases is strictly gated by repository maintainer explicit authorization. Every release is tagged with `v` prefix (`vX.Y.Z`) and accompanied by release notes detailing all changes.

All development follows a **Branch $\rightarrow$ Pull Request** workflow:

```
1. Fork/Branch Repository  -->  2. Create Working Branch  -->  3. Commit Changes  -->  4. Open Pull Request
```

### Step 1: Fork and Clone
Fork the repository on GitHub, then clone your fork locally:
```bash
git clone https://github.com/YOUR_USERNAME/ComfyUI-SaturnNodes.git
cd ComfyUI-SaturnNodes
```

### Step 2: Create a Working Branch
Create a descriptive branch for your change:
```bash
git checkout -b feature/short-description
# Example: git checkout -b feature/live-preview-aspect-ratio
```

### Step 3: Coding & Style Guidelines
- **Python Style:** Match existing repository conventions. Keep imports at module scope. Do not add unnecessary `try/except` swallow blocks.
- **No Internet Requests in Core Execution:** All node execution must run locally. Outbound network requests (e.g. Civitai/TMDB thumbnail scraping) must strictly require user consent via settings.
- **No Hardcoded Keys or Absolute System Paths:** Do not commit personal system paths (`C:\Users\...` or `D:\...`), API keys, or private tokens.

### Step 4: Commit Your Changes
Use concise, imperative subject lines for commits:
- `Feat: ...` (New node or feature)
- `Fix: ...` (Bug fix)
- `Docs: ...` (Documentation update)
- `Refactor: ...` (Code cleanup or restructuring)

Example:
```bash
git add .
git commit -m "Fix: Resolve aspect ratio bounding box in Live Latent Preview"
```

### Step 5: Push & Submit a Pull Request
Push your branch to your fork on GitHub and open a Pull Request:
```bash
git push origin feature/short-description
```
1. Open [Pull Requests](https://github.com/KOFiblto/ComfyUI-SaturnNodes/pulls) $\rightarrow$ Click **New pull request**.
2. Select the active version branch (e.g. `v2.5.0`) or `main` as base $\leftarrow$ `compare: feature/short-description`.
3. Provide a brief summary of what changed and how you verified your fix.
4. Wait for code review approval and automated status check validation!

---

## 📜 Code of Conduct & Mascot

- Be respectful and constructive when commenting on issues and reviewing pull requests.
- The official mascot of ComfyUI is a very cute anime girl with massive fennec ears, a big fluffy tail, long blonde wavy hair, and blue eyes. Treat her with respect!

Thank you for helping make `ComfyUI-SaturnNodes` better for everyone!

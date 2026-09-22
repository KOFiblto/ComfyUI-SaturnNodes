import { app } from "/scripts/app.js";

// Saturn Gold / Amber and Deep Space Emerald palette matching the 🪐 emoji
const SATURN_GOLD = { color: "#d97706", bgcolor: "#78350f" };
const SATURN_AMBER = { color: "#b45309", bgcolor: "#451a03" };
const SATURN_SPACE = { color: "#059669", bgcolor: "#064e3b" };

export const COLOR_MAP = {
    // Visual Loaders
    "VisualLoraLoader": SATURN_GOLD,
    "FolderLoraLoader": SATURN_GOLD,
    "FolderLoraLoaderPretty": SATURN_GOLD,
    "FolderLoraLoaderVisualPrettyV2": SATURN_GOLD,
    "VisualImageLoader": SATURN_GOLD,
    "ImageLoaderVisualPrettyV2": SATURN_GOLD,
    "LoadRecentOutputs": SATURN_GOLD,

    // Automation, Flow & Utilities
    "LoadImageFromFolder": SATURN_AMBER,
    "TextAspectRatioFinder": SATURN_AMBER,
    "AspectRatioFinder": SATURN_AMBER,
    "PreviewImageSizeAspectRatio": SATURN_AMBER,
    "TextLoraFinder": SATURN_AMBER,
    "LoraTextFinder": SATURN_AMBER,
    "PromptQueueIterator": SATURN_AMBER,
    "PromptCounter": SATURN_AMBER,
    "MultiTextReplacer": SATURN_AMBER,
    "SaturnTextSplit": SATURN_AMBER,
    "LeafFlowTextSplit": SATURN_AMBER,
    "SaturnDecision": SATURN_AMBER,
    "LeafFlowDecision": SATURN_AMBER,
    "RunLocalFileNode": SATURN_AMBER,

    // Queue & Previews
    "PreviewLatentLive": SATURN_SPACE,
    "PauseQueueNode": SATURN_SPACE,
    "PersistentQueueNode": SATURN_SPACE
};

export function isSaturnColorsEnabled() {
    try {
        if (app.ui?.settings?.get) {
            const val = app.ui.settings.get("SaturnNodes.1 - 🖼️ Visual Loaders.00_EnableCustomColors");
            if (val !== undefined && val !== null) return Boolean(val);
        }
        if (app.ui?.settings?.getSettingValue) {
            const val = app.ui.settings.getSettingValue("SaturnNodes.1 - 🖼️ Visual Loaders.00_EnableCustomColors");
            if (val !== undefined && val !== null) return Boolean(val);
        }
        if (typeof localStorage !== "undefined") {
            for (const key of [
                "Comfy.Settings.SaturnNodes.1 - 🖼️ Visual Loaders.00_EnableCustomColors",
                "SaturnNodes.1 - 🖼️ Visual Loaders.00_EnableCustomColors",
                "Comfy.Settings.LeafFlow.1 - 🖼️ Visual Loaders.00_EnableCustomColors",
                "LeafFlow.1 - 🖼️ Visual Loaders.00_EnableCustomColors"
            ]) {
                const item = localStorage.getItem(key);
                if (item !== null && item !== undefined) {
                    try { return JSON.parse(item); } catch (_) { return Boolean(item); }
                }
            }
        }
    } catch (_) {}
    return true; // Default is enabled
}

export function applySaturnColorToNode(node) {
    if (!node) return;
    const type = node.comfyClass || node.type || node.constructor?.comfyClass || node.constructor?.type;
    const theme = COLOR_MAP[type];
    if (!theme) return;

    if (isSaturnColorsEnabled()) {
        node.color = theme.color;
        node.bgcolor = theme.bgcolor;
    } else {
        node.color = undefined;
        node.bgcolor = undefined;
    }
}

export function updateAllSaturnNodeColors() {
    if (!app.graph?._nodes) return;
    for (const node of app.graph._nodes) {
        applySaturnColorToNode(node);
    }
    app.graph.setDirtyCanvas(true, true);
}

app.registerExtension({
    name: "ComfyUI.SaturnNodes.Colors",
    beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData && nodeData.name && COLOR_MAP[nodeData.name]) {
            const theme = COLOR_MAP[nodeData.name];
            if (isSaturnColorsEnabled()) {
                nodeType.color = theme.color;
                nodeType.bgcolor = theme.bgcolor;
                nodeType.prototype.color = theme.color;
                nodeType.prototype.bgcolor = theme.bgcolor;
            }
        }
    },
    async nodeCreated(node) {
        applySaturnColorToNode(node);
    },
    async loadedGraphNode(node) {
        applySaturnColorToNode(node);
    },
    afterConfigureGraph() {
        updateAllSaturnNodeColors();
    },
    async setup() {
        setTimeout(() => updateAllSaturnNodeColors(), 100);
        setTimeout(() => updateAllSaturnNodeColors(), 500);
    }
});

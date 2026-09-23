import { app } from "/scripts/app.js";

// Soft, desaturated pastel Saturn Gold/Amber theme consistent across all SaturnNodes
const SATURN_PASTEL = { color: "#967d5e", bgcolor: "#2b2621" };

export const COLOR_MAP = {
    // Visual Loaders
    "VisualLoraLoader": SATURN_PASTEL,
    "FolderLoraLoader": SATURN_PASTEL,
    "FolderLoraLoaderPretty": SATURN_PASTEL,
    "FolderLoraLoaderVisualPrettyV2": SATURN_PASTEL,
    "VisualImageLoader": SATURN_PASTEL,
    "ImageLoaderVisualPrettyV2": SATURN_PASTEL,
    "LoadRecentOutputs": SATURN_PASTEL,

    // Automation, Flow & Utilities
    "LoadImageFromFolder": SATURN_PASTEL,
    "TextAspectRatioFinder": SATURN_PASTEL,
    "AspectRatioFinder": SATURN_PASTEL,
    "PreviewImageSizeAspectRatio": SATURN_PASTEL,
    "TextLoraFinder": SATURN_PASTEL,
    "LoraTextFinder": SATURN_PASTEL,
    "PromptQueueIterator": SATURN_PASTEL,
    "PromptCounter": SATURN_PASTEL,
    "MultiTextReplacer": SATURN_PASTEL,
    "SaturnTextSplit": SATURN_PASTEL,
    "LeafFlowTextSplit": SATURN_PASTEL,
    "SaturnDecision": SATURN_PASTEL,
    "LeafFlowDecision": SATURN_PASTEL,
    "RunLocalFileNode": SATURN_PASTEL,

    // Queue & Previews (Live Latent Preview is now consistent with Saturn theme, not green)
    "PreviewLatentLive": SATURN_PASTEL,
    "PauseQueueNode": SATURN_PASTEL,
    "PersistentQueueNode": SATURN_PASTEL
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

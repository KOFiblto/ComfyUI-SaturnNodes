import { app } from "/scripts/app.js";

// Default Amber theme matching the Saturn theme (warm, deep amber, not blinding neon and not muddy brown)
export const DEFAULT_HEADER_COLOR = "#b45309";
export const DEFAULT_BG_COLOR = "#351e08";

export const SATURN_NODE_TYPES = new Set([
    // Visual Loaders
    "VisualLoraLoader",
    "FolderLoraLoader",
    "FolderLoraLoaderPretty",
    "FolderLoraLoaderVisualPrettyV2",
    "VisualImageLoader",
    "ImageLoaderVisualPrettyV2",
    "LoadRecentOutputs",

    // Automation, Flow & Utilities
    "LoadImageFromFolder",
    "TextAspectRatioFinder",
    "AspectRatioFinder",
    "PreviewImageSizeAspectRatio",
    "TextLoraFinder",
    "LoraTextFinder",
    "PromptQueueIterator",
    "PromptCounter",
    "MultiTextReplacer",
    "SaturnTextSplit",
    "LeafFlowTextSplit",
    "SaturnDecision",
    "LeafFlowDecision",
    "RunLocalFileNode",

    // Queue & Previews
    "PreviewLatentLive",
    "PauseQueueNode",
    "PersistentQueueNode"
]);

export function getSaturnTheme() {
    let headerColor = DEFAULT_HEADER_COLOR;
    let bgColor = DEFAULT_BG_COLOR;
    try {
        if (app.ui?.settings?.get) {
            const hc = app.ui.settings.get("SaturnNodes.1 - 🖼️ Visual Loaders.00_CustomNodeHeaderColor");
            if (hc) headerColor = hc;
            const bg = app.ui.settings.get("SaturnNodes.1 - 🖼️ Visual Loaders.00_CustomNodeBgColor");
            if (bg) bgColor = bg;
        } else if (typeof localStorage !== "undefined") {
            const hc = localStorage.getItem("Comfy.Settings.SaturnNodes.1 - 🖼️ Visual Loaders.00_CustomNodeHeaderColor");
            if (hc) {
                try { headerColor = JSON.parse(hc); } catch (_) { headerColor = hc; }
            }
            const bg = localStorage.getItem("Comfy.Settings.SaturnNodes.1 - 🖼️ Visual Loaders.00_CustomNodeBgColor");
            if (bg) {
                try { bgColor = JSON.parse(bg); } catch (_) { bgColor = bg; }
            }
        }
    } catch (_) {}
    return { color: headerColor, bgcolor: bgColor };
}

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
                "SaturnNodes.1 - 🖼️ Visual Loaders.00_EnableCustomColors"
            ]) {
                const item = localStorage.getItem(key);
                if (item !== null && item !== undefined) {
                    try { return JSON.parse(item); } catch (_) { return Boolean(item); }
                }
            }
        }
    } catch (_) {}
    return false; // Default is disabled (false)
}

export function applySaturnColorToNode(node) {
    if (!node) return;
    const type = node.comfyClass || node.type || node.constructor?.comfyClass || node.constructor?.type;
    if (!SATURN_NODE_TYPES.has(type)) return;

    if (isSaturnColorsEnabled()) {
        const theme = getSaturnTheme();
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
        if (nodeData && nodeData.name && SATURN_NODE_TYPES.has(nodeData.name)) {
            if (isSaturnColorsEnabled()) {
                const theme = getSaturnTheme();
                nodeType.color = theme.color;
                nodeType.bgcolor = theme.bgcolor;
                nodeType.prototype.color = theme.color;
                nodeType.prototype.bgcolor = theme.bgcolor;
            } else {
                nodeType.color = undefined;
                nodeType.bgcolor = undefined;
                nodeType.prototype.color = undefined;
                nodeType.prototype.bgcolor = undefined;
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

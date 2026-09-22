import { app } from "/scripts/app.js";

// Saturn Gold / Amber and Deep Space Emerald palette matching the 🪐 emoji
const SATURN_GOLD = { color: "#d97706", bgcolor: "#78350f" };
const SATURN_AMBER = { color: "#b45309", bgcolor: "#451a03" };
const SATURN_SPACE = { color: "#059669", bgcolor: "#064e3b" };

const COLOR_MAP = {
    // Visual Loaders
    "VisualLoraLoader": SATURN_GOLD,
    "FolderLoraLoader": SATURN_GOLD,
    "FolderLoraLoaderPretty": SATURN_GOLD,
    "VisualImageLoader": SATURN_GOLD,
    "LoadRecentOutputs": SATURN_GOLD,

    // Automation, Flow & Utilities
    "LoadImageFromFolder": SATURN_AMBER,
    "TextAspectRatioFinder": SATURN_AMBER,
    "PreviewImageSizeAspectRatio": SATURN_AMBER,
    "TextLoraFinder": SATURN_AMBER,
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

app.registerExtension({
    name: "ComfyUI.SaturnNodes.Colors",
    async nodeCreated(node) {
        let enabled = app.ui?.settings?.getSettingValue?.("SaturnNodes.1 - 🖼️ Visual Loaders.00_EnableCustomColors");
        if (enabled === undefined) {
            enabled = app.ui?.settings?.getSettingValue?.("LeafFlow.1 - 🖼️ Visual Loaders.00_EnableCustomColors", true);
        }
        if (enabled === false) return;

        if (node && node.type && COLOR_MAP[node.type]) {
            const theme = COLOR_MAP[node.type];
            node.color = theme.color;
            node.bgcolor = theme.bgcolor;
        }
    }
});

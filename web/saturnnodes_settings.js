import { app } from "/scripts/app.js";
import { api } from "/scripts/api.js";
import { authenticatedFetch } from "./js/auth_helper.js";
import { updateAllSaturnNodeColors } from "./saturnnodes_colors.js";

async function postSaturnNodesSettings(bodyObj) {
    try {
        return await authenticatedFetch("/saturnnodes/settings", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(bodyObj)
        });
    } catch (e) {
        console.warn("[SaturnNodes Settings] Failed to save setting:", e);
    }
}

// Inject CSS to ensure settings buttons look distinct, styled with a Saturn Amber/Emerald theme
if (typeof document !== "undefined") {
    const styleId = "saturnnodes-settings-button-styles";
    if (!document.getElementById(styleId)) {
        const style = document.createElement("style");
        style.id = styleId;
        style.textContent = `
            /* ComfyUI V2 Vue Toggle Switches Protection: NEVER apply button background or borders to switches */
            [data-setting-id*="SaturnNodes"] button[role="switch"],
            [data-setting-id*="saturnnodes"] button[role="switch"],
            [data-setting-id*="LeafFlow"] button[role="switch"],
            [data-setting-id*="leafflow"] button[role="switch"],
            [data-setting-id*="SaturnNodes"] [role="switch"],
            [data-setting-id*="saturnnodes"] [role="switch"],
            [data-setting-id*="LeafFlow"] [role="switch"],
            [data-setting-id*="leafflow"] [role="switch"],
            button[role="switch"].saturnnodes-settings-btn {
                background: transparent !important;
                border: 0 !important;
                box-shadow: none !important;
                padding: 0 !important;
                margin: 0 !important;
                transform: none !important;
            }

            /* ComfyUI Settings Action Buttons (Buttons and Fallback Input Elements) */
            .saturnnodes-settings-btn,
            .leafflow-settings-btn,
            button.saturnnodes-settings-btn,
            button.leafflow-settings-btn,
            input.saturnnodes-settings-btn,
            input.leafflow-settings-btn,
            [data-setting-id*="SaturnNodes"] button:not([role="switch"]):not([data-pc-name="toggleswitch"]),
            [data-setting-id*="saturnnodes"] button:not([role="switch"]):not([data-pc-name="toggleswitch"]),
            [data-setting-id*="LeafFlow"] button:not([role="switch"]):not([data-pc-name="toggleswitch"]),
            [data-setting-id*="leafflow"] button:not([role="switch"]):not([data-pc-name="toggleswitch"]) {
                background: linear-gradient(135deg, #d97706 0%, #b45309 100%) !important;
                border: 1px solid #f59e0b !important;
                color: #ffffff !important;
                font-weight: 600 !important;
                font-size: 12px !important;
                padding: 6px 14px !important;
                border-radius: 6px !important;
                width: auto !important;
                min-width: max-content !important;
                max-width: none !important;
                white-space: nowrap !important;
                overflow: visible !important;
                text-overflow: clip !important;
                cursor: pointer !important;
                text-align: center !important;
                box-shadow: 0 1px 3px rgba(0, 0, 0, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.15) !important;
                transition: all 0.2s ease !important;
                display: inline-flex !important;
                align-items: center !important;
                justify-content: center !important;
                user-select: none !important;
                box-sizing: border-box !important;
            }

            .saturnnodes-settings-btn:hover,
            .leafflow-settings-btn:hover,
            button.saturnnodes-settings-btn:hover,
            button.leafflow-settings-btn:hover,
            input.saturnnodes-settings-btn:hover,
            input.leafflow-settings-btn:hover,
            [data-setting-id*="SaturnNodes"] button:not([role="switch"]):not([data-pc-name="toggleswitch"]):hover,
            [data-setting-id*="saturnnodes"] button:not([role="switch"]):not([data-pc-name="toggleswitch"]):hover,
            [data-setting-id*="LeafFlow"] button:not([role="switch"]):not([data-pc-name="toggleswitch"]):hover,
            [data-setting-id*="leafflow"] button:not([role="switch"]):not([data-pc-name="toggleswitch"]):hover {
                background: linear-gradient(135deg, #b45309 0%, #d97706 100%) !important;
                border-color: #fbbf24 !important;
                color: #ffffff !important;
                box-shadow: 0 0 10px rgba(245, 158, 11, 0.45) !important;
                transform: translateY(-1px) !important;
            }

            .saturnnodes-settings-btn:active,
            .leafflow-settings-btn:active,
            button.saturnnodes-settings-btn:active,
            input.saturnnodes-settings-btn:active,
            [data-setting-id*="SaturnNodes"] button:not([role="switch"]):not([data-pc-name="toggleswitch"]):active {
                transform: translateY(0) !important;
            }
        `;
        document.head.appendChild(style);
    }
}

// Global Non-Fatal Warning & Native Node Error Highlighter
try {
    const handleNodeError = (e) => {
        const { node_id, title, message, fallback } = e.detail || {};
        if (node_id && app.graph) {
            const targetNode = app.graph.getNodeById(Number(node_id)) || app.graph.getNodeById(String(node_id));
            if (targetNode) {
                targetNode.has_errors = true;
                targetNode.bgcolor = "#7f1d1d";
                targetNode.color = "#ef4444";
                targetNode.setDirtyCanvas(true, true);
                if (typeof targetNode.onExecutionError === "function") {
                    targetNode.onExecutionError(message);
                }
            }
        }
        if (app.extensionManager?.toast?.add) {
            app.extensionManager.toast.add({
                severity: "warn",
                summary: `🪐 ${title || "SaturnNodes"}`,
                detail: `${message} (Auto-resolved with ${fallback})`,
                life: 6000
            });
        }
    };

    const handleToast = (e) => {
        const data = e.detail || {};
        const title = data.title || "SaturnNodes Notice";
        const message = data.message || "";
        const type = data.type || "warn";
        if (app.extensionManager?.toast?.add) {
            app.extensionManager.toast.add({
                severity: type === "error" ? "error" : "warn",
                summary: `🪐 ${title}`,
                detail: message,
                life: 6000
            });
        } else if (app.ui?.dialog) {
            console.warn(`[SaturnNodes] ${title}: ${message}`);
        }
    };

    api.addEventListener("saturnnodes_node_error_state", handleNodeError);
    api.addEventListener("saturnnodes_toast", handleToast);
} catch (_) {}

/**
 * Custom renderer for real, styled action buttons in ComfyUI Settings Modal.
 */
function renderSettingButton(label, workingText, successText, onClickHandler) {
    return (name, setter, value) => {
        const container = document.createElement("div");
        container.style.cssText = "display: flex; align-items: center; justify-content: flex-end; width: 100%; padding: 2px 0;";

        const btn = document.createElement("button");
        btn.type = "button";
        btn.textContent = label;
        btn.className = "p-button saturnnodes-settings-btn";
        btn.style.cssText = `
            padding: 6px 14px !important;
            background: linear-gradient(135deg, #d97706 0%, #b45309 100%) !important;
            color: #ffffff !important;
            border: 1px solid #f59e0b !important;
            border-radius: 6px !important;
            font-weight: 600 !important;
            font-size: 12px !important;
            cursor: pointer !important;
            transition: all 0.2s ease !important;
            outline: none !important;
            min-width: max-content !important;
            width: auto !important;
            white-space: nowrap !important;
            text-align: center !important;
            box-shadow: 0 1px 3px rgba(0,0,0,0.4) !important;
        `;

        btn.onmouseover = () => {
            if (!btn.disabled) {
                btn.style.background = "#b45309";
                btn.style.borderColor = "#fbbf24";
                btn.style.transform = "translateY(-1px)";
                btn.style.boxShadow = "0 0 10px rgba(245, 158, 11, 0.45)";
            }
        };
        btn.onmouseout = () => {
            if (!btn.disabled) {
                btn.style.background = "linear-gradient(135deg, #d97706 0%, #b45309 100%)";
                btn.style.borderColor = "#f59e0b";
                btn.style.transform = "translateY(0)";
                btn.style.boxShadow = "0 1px 3px rgba(0,0,0,0.4)";
            }
        };

        btn.onclick = async (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (btn.disabled) return;

            const originalText = btn.textContent;
            btn.disabled = true;
            btn.textContent = workingText;
            btn.style.opacity = "0.75";
            btn.style.cursor = "wait";

            try {
                await onClickHandler();
                btn.textContent = successText;
                btn.style.background = "linear-gradient(135deg, #059669 0%, #047857 100%)";
                btn.style.borderColor = "#34d399";
                setTimeout(() => {
                    btn.textContent = originalText;
                    btn.disabled = false;
                    btn.style.opacity = "1";
                    btn.style.cursor = "pointer";
                    btn.style.background = "linear-gradient(135deg, #d97706 0%, #b45309 100%)";
                    btn.style.borderColor = "#f59e0b";
                }, 2000);
            } catch (err) {
                console.error("[SaturnNodes Settings] Action failed:", err);
                btn.textContent = "❌ Failed";
                btn.style.background = "linear-gradient(135deg, #dc2626 0%, #991b1b 100%)";
                btn.style.borderColor = "#f87171";
                setTimeout(() => {
                    btn.textContent = originalText;
                    btn.disabled = false;
                    btn.style.opacity = "1";
                    btn.style.cursor = "pointer";
                    btn.style.background = "linear-gradient(135deg, #d97706 0%, #b45309 100%)";
                    btn.style.borderColor = "#f59e0b";
                }, 3000);
            }
        };

        container.appendChild(btn);
        return container;
    };
}

/**
 * Migration helper ensuring user preferences from legacy LeafFlow.* are seamlessly inherited.
 */
function migrateSavedSettings() {
    try {
        if (typeof localStorage === "undefined") return;
        const keysToMigrate = [];
        for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            if (k && (k.includes("LeafFlow.") || k.includes("leafflow."))) {
                keysToMigrate.push(k);
            }
        }
        for (const oldKey of keysToMigrate) {
            const val = localStorage.getItem(oldKey);
            if (val === null) continue;
            const newKey = oldKey.replace(/LeafFlow/g, "SaturnNodes").replace(/leafflow/g, "saturnnodes");
            if (newKey !== oldKey && localStorage.getItem(newKey) === null) {
                localStorage.setItem(newKey, val);
            }
        }
    } catch (e) {
        console.warn("[SaturnNodes] Settings migration skipped:", e);
    }
}
migrateSavedSettings();

function getInitialSetting(saturnId, defaultVal) {
    if (typeof localStorage === "undefined") return defaultVal;
    const legacyId = saturnId.replace(/^SaturnNodes\./, "LeafFlow.");
    for (const prefix of ["Comfy.Settings.", ""]) {
        const sVal = localStorage.getItem(`${prefix}${saturnId}`);
        if (sVal !== null && sVal !== undefined) {
            try { return JSON.parse(sVal); } catch (_) { return sVal; }
        }
        const lVal = localStorage.getItem(`${prefix}${legacyId}`);
        if (lVal !== null && lVal !== undefined) {
            try { return JSON.parse(lVal); } catch (_) { return lVal; }
        }
    }
    return defaultVal;
}

app.registerExtension({
    name: "ComfyUI.SaturnNodes.Settings",
    async setup() {
        migrateSavedSettings();

        // =========================================================================
        // GROUP 1: 1 - 🖼️ Visual Loaders
        // =========================================================================

        // 1.0 Custom Node Colors Toggle
        app.ui.settings.addSetting({
            id: "SaturnNodes.1 - 🖼️ Visual Loaders.00_EnableCustomColors",
            name: "Enable Custom SaturnNodes Colors",
            type: "boolean",
            defaultValue: getInitialSetting("SaturnNodes.1 - 🖼️ Visual Loaders.00_EnableCustomColors", true),
            tooltip: "Applies a Saturn Gold/Amber color theme to SaturnNodes on the canvas. When disabled, nodes use default ComfyUI colors.",
            onChange(value) {
                if (typeof localStorage !== "undefined") {
                    try {
                        localStorage.setItem("Comfy.Settings.SaturnNodes.1 - 🖼️ Visual Loaders.00_EnableCustomColors", JSON.stringify(Boolean(value)));
                    } catch (_) {}
                }
                updateAllSaturnNodeColors();
            }
        });

        // 1.1 Civitai API Key
        app.ui.settings.addSetting({
            id: "SaturnNodes.1 - 🖼️ Visual Loaders.01_CivitaiApiKey",
            name: "Civitai API Key",
            type: "text",
            defaultValue: getInitialSetting("SaturnNodes.1 - 🖼️ Visual Loaders.01_CivitaiApiKey", ""),
            tooltip: "Optional. Civitai SHA256 search works publicly without a key for normal models. Only needed for NSFW/private models or higher rate limits. Whitespace is automatically stripped.",
            onChange(value) {
                const cleanKey = (value || "").trim();
                postSaturnNodesSettings({ civitai_api_key: cleanKey });
            }
        });

        // 1.2 Enable Civitai Auto-Scraping Toggle (default: true)
        app.ui.settings.addSetting({
            id: "SaturnNodes.1 - 🖼️ Visual Loaders.02_EnableCivitaiScraping",
            name: "Enable Civitai Auto-Scraping",
            type: "boolean",
            defaultValue: getInitialSetting("SaturnNodes.1 - 🖼️ Visual Loaders.02_EnableCivitaiScraping", true),
            tooltip: "Toggles automated downloading of preview thumbnails for new LoRAs from Civitai via SHA256 file hashes. Note: SHA256 hash searching will always work regardless of this setting when matching local models.",
            onChange(value) {
                postSaturnNodesSettings({ enable_civitai_scraping: value ? "true" : "false" });
            }
        });

        // 1.3 TMDB Access Token
        app.ui.settings.addSetting({
            id: "SaturnNodes.1 - 🖼️ Visual Loaders.03_TMDBApiKey",
            name: "TMDB Access Token",
            type: "text",
            defaultValue: getInitialSetting("SaturnNodes.1 - 🖼️ Visual Loaders.03_TMDBApiKey", ""),
            tooltip: "Optional. Accepts TMDB v3 API keys or TMDB v4 Read Access Tokens (eyJ...). Used for celebrity poster and preview image lookup. Whitespace is automatically stripped.",
            onChange(value) {
                const cleanKey = (value || "").trim();
                postSaturnNodesSettings({ tmdb_api_key: cleanKey });
            }
        });

        // 1.4 Enable TMDB Auto-Scraping Toggle (default: false)
        app.ui.settings.addSetting({
            id: "SaturnNodes.1 - 🖼️ Visual Loaders.04_EnableTMDBScraping",
            name: "Enable TMDB Auto-Scraping",
            type: "boolean",
            defaultValue: getInitialSetting("SaturnNodes.1 - 🖼️ Visual Loaders.04_EnableTMDBScraping", false),
            tooltip: "Toggles automated downloading of celebrity preview thumbnails from TMDB. Default is disabled.",
            onChange(value) {
                postSaturnNodesSettings({ enable_tmdb_scraping: value ? "true" : "false" });
            }
        });

        // 1.5 Enable LoRA Usage Tracking (default: true)
        app.ui.settings.addSetting({
            id: "SaturnNodes.1 - 🖼️ Visual Loaders.05_EnableLoraUsage",
            name: "Enable LoRA Usage Tracking",
            type: "boolean",
            defaultValue: getInitialSetting("SaturnNodes.1 - 🖼️ Visual Loaders.05_EnableLoraUsage", true),
            tooltip: "Toggles tracking and displaying LoRA usage counts & visual rank badges (🔥, Gold, Silver, Bronze) in the LoRA picker. Existing usage history is preserved when disabled.",
            onChange(value) {
                postSaturnNodesSettings({ enable_lora_usage: value ? "true" : "false" });
            }
        });

        // 1.6 Reset Scrapes Cache Button
        const renderScrapesCacheBtn = renderSettingButton("🗑️ Clear Scrapes Cache", "⏳ Clearing...", "✅ Cache Reset!", async () => {
            const resp = await authenticatedFetch("/saturnnodes/scrapes/clear", { method: "POST" });
            const data = await resp.json();
            if (data && data.status === "ok") {
                return data;
            } else {
                throw new Error((data && data.message) || "Failed to reset scrapes cache");
            }
        });

        app.ui.settings.addSetting({
            id: "SaturnNodes.1 - 🖼️ Visual Loaders.06_ResetScrapesCache",
            name: "Reset Failed Scrapes Cache",
            type: renderScrapesCacheBtn,
            render: renderScrapesCacheBtn,
            defaultValue: "🗑️ Clear Scrapes Cache",
            tooltip: "Immediately clears failed_scrapes.json so Civitai and TMDB can retry downloading missing preview thumbnails on the next folder scan.",
            attrs: {
                className: "saturnnodes-settings-btn",
                class: "saturnnodes-settings-btn",
                readOnly: true,
                style: "cursor: pointer; text-align: center;",
                onClick: async () => {
                    try {
                        const resp = await authenticatedFetch("/saturnnodes/scrapes/clear", { method: "POST" });
                        const data = await resp.json();
                        if (data && data.status === "ok") {
                            alert("SaturnNodes: Failed scrapes cache successfully reset!");
                        } else {
                            alert("SaturnNodes: Failed to reset cache.");
                        }
                    } catch (err) {
                        alert("SaturnNodes: Error resetting cache: " + err);
                    }
                }
            }
        });

        // =========================================================================
        // GROUP 2: 2 - 🔄 Prompt Queue Iterator
        // =========================================================================

        // 2.1 Clear Prompt Iterator State on Launch (default: false)
        app.ui.settings.addSetting({
            id: "SaturnNodes.2 - 🔄 Prompt Iterator.01_ClearOnLaunch",
            name: "Clear State on Launch",
            type: "boolean",
            defaultValue: getInitialSetting("SaturnNodes.2 - 🔄 Prompt Iterator.01_ClearOnLaunch", false),
            tooltip: "Privacy setting. When enabled, prompt_iterator_state.json will be emptied automatically every time ComfyUI starts up.",
            onChange(value) {
                postSaturnNodesSettings({ clear_prompt_iterator_on_launch: value ? "true" : "false" });
            }
        });

        // 2.2 Reset Prompt Iterator Queues Now
        const renderResetQueuesBtn = renderSettingButton("🔄 Reset All Queues", "⏳ Resetting...", "✅ State Reset!", async () => {
            const resp = await authenticatedFetch("/saturnnodes/prompt_iterator/clear", { method: "POST" });
            const data = await resp.json();
            if (data && data.status === "ok") {
                return data;
            } else {
                throw new Error((data && data.message) || "Failed to clear prompt iterator state");
            }
        });

        app.ui.settings.addSetting({
            id: "SaturnNodes.2 - 🔄 Prompt Iterator.02_ResetActiveQueues",
            name: "Reset Active Queues State",
            type: renderResetQueuesBtn,
            render: renderResetQueuesBtn,
            defaultValue: "🔄 Reset All Queues",
            tooltip: "Immediately empties all active prompt queues and resets iterator state across all workflows.",
            attrs: {
                className: "saturnnodes-settings-btn",
                class: "saturnnodes-settings-btn",
                readOnly: true,
                style: "cursor: pointer; text-align: center;",
                onClick: async () => {
                    try {
                        const resp = await authenticatedFetch("/saturnnodes/prompt_iterator/clear", { method: "POST" });
                        const data = await resp.json();
                        if (data && data.status === "ok") {
                            alert("SaturnNodes: Prompt Iterator queues successfully reset!");
                        } else {
                            alert("SaturnNodes: Failed to reset queues.");
                        }
                    } catch (err) {
                        alert("SaturnNodes: Error resetting queues: " + err);
                    }
                }
            }
        });

        // =========================================================================
        // GROUP 3: 3 - 📋 Prompt Actions
        // =========================================================================

        // 3.1 Show "Copy Prompt" Button on Image Overlays
        app.ui.settings.addSetting({
            id: "SaturnNodes.3 - 📋 Prompt Actions.01_EnableAssetsCopyPromptButton",
            name: "Show \"Copy Prompt\" Button on Images",
            type: "boolean",
            defaultValue: getInitialSetting("SaturnNodes.3 - 📋 Prompt Actions.01_EnableAssetsCopyPromptButton", true),
            tooltip: "Shows the 📋 'Copy Prompt' overlay action button when hovering over generated images in the Assets / History pane and preview nodes.",
        });

        // 3.2 Show Right-Click "Copy Prompt" Menu Action
        app.ui.settings.addSetting({
            id: "SaturnNodes.3 - 📋 Prompt Actions.02_EnableContextMenuCopyPrompt",
            name: "Show Right-Click \"Copy Prompt\" Menu Action",
            type: "boolean",
            defaultValue: getInitialSetting("SaturnNodes.3 - 📋 Prompt Actions.02_EnableContextMenuCopyPrompt", true),
            tooltip: "Adds '📋 Copy Prompt' to node right-click context menus.",
        });

        // 3.3 Show "Inspect Asset" (Zoom) Button on Image Overlays
        app.ui.settings.addSetting({
            id: "SaturnNodes.3 - 📋 Prompt Actions.04_EnableInspectAssetButton",
            name: "Show \"Inspect Asset\" (Zoom) Button on Images",
            type: "boolean",
            defaultValue: getInitialSetting("SaturnNodes.3 - 📋 Prompt Actions.04_EnableInspectAssetButton", false),
            tooltip: "Restores the 🔍 'Inspect asset' (zoom in) button directly on image cards in the Assets pane next to Download and Copy Prompt (moved behind the 3-dots menu in newer ComfyUI versions).",
        });

        // =========================================================================
        // GROUP 4: 4 - ⏸️ Pause & Resume Controls
        // =========================================================================

        // 4.1 Default Pause Queue State on Launch
        app.ui.settings.addSetting({
            id: "SaturnNodes.4 - ⏸️ Pause Controls.01_DefaultStateOnLaunch",
            name: "Default State on Launch",
            type: "combo",
            options: ["Paused", "Running"],
            defaultValue: getInitialSetting("SaturnNodes.4 - ⏸️ Pause Controls.01_DefaultStateOnLaunch", "Paused"),
            tooltip: "Choose whether execution starts in Paused state or Running state on ComfyUI startup.",
            onChange(value) {
                postSaturnNodesSettings({ default_pause_state: value });
            }
        });

        // 4.2 Default Pause Queue Mode on Launch
        app.ui.settings.addSetting({
            id: "SaturnNodes.4 - ⏸️ Pause Controls.02_DefaultPauseAction",
            name: "Default Pause Action",
            type: "combo",
            options: ["Finish Active Prompt", "Instant Resume Node"],
            defaultValue: getInitialSetting("SaturnNodes.4 - ⏸️ Pause Controls.02_DefaultPauseAction", "Finish Active Prompt"),
            tooltip: "Choose default pause behavior when the pause button or hotkey is triggered.",
            onChange(value) {
                const modeKey = (value === "Instant Resume Node" || value === "Pause (Instant)") ? "instantly" : "after_finish";
                postSaturnNodesSettings({ default_pause_mode: modeKey });
            }
        });

        // 4.3 Enable Pause Queue Toolbar Button
        app.ui.settings.addSetting({
            id: "SaturnNodes.4 - ⏸️ Pause Controls.03_EnableToolbarButton",
            name: "Enable Top Toolbar Button",
            type: "boolean",
            defaultValue: getInitialSetting("SaturnNodes.4 - ⏸️ Pause Controls.03_EnableToolbarButton", true),
            tooltip: "Displays the green/orange Pause & Continue button group in the top action bar.",
            onChange(value) {
                const group = document.querySelector(".pq-button-group");
                if (group) {
                    group.style.display = value ? "inline-flex" : "none";
                }
            }
        });

        // 4.4 Toolbar Button Unpaused Color
        app.ui.settings.addSetting({
            id: "SaturnNodes.4 - ⏸️ Pause Controls.04_ToolbarButtonUnpausedColor",
            name: "Toolbar Button Unpaused Color",
            type: "text",
            defaultValue: getInitialSetting("SaturnNodes.4 - ⏸️ Pause Controls.04_ToolbarButtonUnpausedColor", "#16a34a"),
            tooltip: "Hex color code for the Pause toolbar button when execution is unpaused/running (default: #16a34a).",
            onChange(value) {
                document.documentElement.style.setProperty("--pq-unpaused-color", value || "#16a34a");
            }
        });

        // 4.5 Toolbar Button Paused Color
        app.ui.settings.addSetting({
            id: "SaturnNodes.4 - ⏸️ Pause Controls.05_ToolbarButtonPausedColor",
            name: "Toolbar Button Paused Color",
            type: "text",
            defaultValue: getInitialSetting("SaturnNodes.4 - ⏸️ Pause Controls.05_ToolbarButtonPausedColor", "#ea580c"),
            tooltip: "Hex color code for the Pause toolbar button when execution is paused (default: #ea580c).",
            onChange(value) {
                document.documentElement.style.setProperty("--pq-paused-color", value || "#ea580c");
            }
        });

        // 4.6 Enable System Tray Icon
        app.ui.settings.addSetting({
            id: "SaturnNodes.4 - ⏸️ Pause Controls.06_EnableTrayIcon",
            name: "Enable System Tray Icon",
            type: "boolean",
            defaultValue: getInitialSetting("SaturnNodes.4 - ⏸️ Pause Controls.06_EnableTrayIcon", false),
            tooltip: "Displays an OS system tray icon with real-time queue status colors and outside-browser queue controls.",
            onChange(value) {
                postSaturnNodesSettings({ enable_tray_icon: value ? "true" : "false" });
            }
        });

        // 4.7 Allow Process Management (Restart / Shutdown)
        app.ui.settings.addSetting({
            id: "SaturnNodes.4 - ⏸️ Pause Controls.07_AllowProcessManagement",
            name: "Allow Process Management (Restart / Shutdown)",
            type: "boolean",
            defaultValue: getInitialSetting("SaturnNodes.4 - ⏸️ Pause Controls.07_AllowProcessManagement", false),
            tooltip: "Enables server restart and shutdown actions from the SaturnNodes power controls. Disabled by default for security.",
            onChange(value) {
                postSaturnNodesSettings({ enable_process_management: value ? "true" : "false" });
            }
        });

        // =========================================================================
        // GROUP 5: 5 - 💾 Persistent Queue (Auto-Recovery)
        // =========================================================================

        // 5.1 Enable Persistent Queue (Auto-Recovery)
        app.ui.settings.addSetting({
            id: "SaturnNodes.5 - 💾 Persistent Queue.01_EnablePersistentQueue",
            name: "Enable Persistent Queue (Auto-Recovery)",
            type: "boolean",
            defaultValue: getInitialSetting("SaturnNodes.5 - 💾 Persistent Queue.01_EnablePersistentQueue", true),
            tooltip: "Automatically persists unfinished batch queue items to disk and restores them after server or browser crashes.",
            onChange(value) {
                postSaturnNodesSettings({ enable_persistent_queue: value ? "true" : "false" });
            }
        });

        // 5.2 Persistent Queue Restored Launch State
        app.ui.settings.addSetting({
            id: "SaturnNodes.5 - 💾 Persistent Queue.02_RecoveryLaunchState",
            name: "Recovery Launch State",
            type: "combo",
            options: ["Match Default", "Force Paused", "Force Running"],
            defaultValue: getInitialSetting("SaturnNodes.5 - 💾 Persistent Queue.02_RecoveryLaunchState", "Match Default"),
            tooltip: "Override launch state when unfinished queue items are recovered on startup.",
            onChange(value) {
                postSaturnNodesSettings({ persistent_queue_restored_state: value });
            }
        });

        // =========================================================================
        // GROUP 6: 6 - 🖼️ Assets & History Restore
        // =========================================================================

        // 6.1 Enable Assets / History Restore on Launch
        app.ui.settings.addSetting({
            id: "SaturnNodes.6 - 🖼️ Assets Restore.01_RestoreAssetsOnLaunch",
            name: "Restore Assets on Launch",
            type: "boolean",
            defaultValue: getInitialSetting("SaturnNodes.6 - 🖼️ Assets Restore.01_RestoreAssetsOnLaunch", true),
            tooltip: "Automatically populates the Assets / History pane upon ComfyUI launch with your latest generated images.",
            onChange(value) {
                postSaturnNodesSettings({ enable_assets_restore: value ? "true" : "false" });
            }
        });

        // 6.2 Restored Assets Count
        app.ui.settings.addSetting({
            id: "SaturnNodes.6 - 🖼️ Assets Restore.02_RestoredAssetsCount",
            name: "Restored Assets Count",
            type: "number",
            defaultValue: getInitialSetting("SaturnNodes.6 - 🖼️ Assets Restore.02_RestoredAssetsCount", 64),
            tooltip: "Number of newest images from the output folder to restore into the Assets / History pane on launch (default: 64).",
            onChange(value) {
                const count = parseInt(value, 10) || 64;
                postSaturnNodesSettings({ restore_assets_count: count });
            }
        });

        // =========================================================================
        // GROUP 7: 7 - 🩺 Diagnostics & Debug
        // =========================================================================

        // 7.1 Export Debug Profile Button
        // 7.1 Export Debug Profile Button
        const handleExportProfile = async () => {
            const approved = confirm("🪐 ComfyUI-SaturnNodes Diagnostics Export\n\nExport system diagnostics for troubleshooting?\n\nNOTE: Sensitive API keys, tokens, file paths, and private prompt texts are automatically stripped and NEVER exported.");
            if (!approved) return;

            try {
                const resp = await api.fetchApi("/saturnnodes/debug/export");
                const data = await resp.json();
                const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = `saturnnodes_debug_profile_${new Date().toISOString().slice(0, 10)}.json`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
                alert("✅ Diagnostics profile exported successfully! You can attach the downloaded JSON file to your bug report or GitHub issue.");
            } catch (e) {
                console.error("[SaturnNodes] Error exporting debug profile:", e);
                alert("❌ Failed to export debug profile: " + e.message);
            }
        };

        const renderExportProfileBtn = renderSettingButton("📥 Export Debug Profile", "⏳ Exporting...", "✅ Exported!", async () => {
            const resp = await api.fetchApi("/saturnnodes/debug/export");
            const data = await resp.json();
            const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `saturnnodes_debug_profile_${new Date().toISOString().slice(0, 10)}.json`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        });

        app.ui.settings.addSetting({
            id: "SaturnNodes.7 - 🩺 Diagnostics.01_ExportDebugProfile",
            name: "Export Debug Profile",
            type: renderExportProfileBtn,
            render: renderExportProfileBtn,
            defaultValue: "📥 Export Debug Profile",
            tooltip: "Exports non-sensitive environment diagnostics (OS, Python, PyTorch, SaturnNodes settings, local counts) as a JSON file to share when troubleshooting issues.",
            attrs: {
                className: "saturnnodes-settings-btn",
                class: "saturnnodes-settings-btn",
                readOnly: true,
                style: "cursor: pointer; text-align: center;",
                onClick: handleExportProfile
            }
        });

        // =========================================================================
        // GROUP 8: 8 - 🎨 Batch Queue Visuals
        // =========================================================================

        // 8.1 Enable Batch Queue Grouping Lines
        app.ui.settings.addSetting({
            id: "SaturnNodes.8 - 🎨 Batch Queue.01_ShowBatchLines",
            name: "Show Batch Queue 1D Lines",
            type: "boolean",
            defaultValue: getInitialSetting("SaturnNodes.8 - 🎨 Batch Queue.01_ShowBatchLines", getInitialSetting("SaturnNodes.BatchQueue.Enabled", true)),
            tooltip: "Renders 1D git-graph style colored lines indicating batch groupings and contiguous segments on queued items."
        });

        // 8.2 Batch Graph Snapshot Guard
        app.ui.settings.addSetting({
            id: "SaturnNodes.8 - 🎨 Batch Queue.02_SnapshotGuard",
            name: "Batch Graph Snapshot Guard",
            type: "boolean",
            defaultValue: getInitialSetting("SaturnNodes.8 - 🎨 Batch Queue.02_SnapshotGuard", getInitialSetting("SaturnNodes.BatchQueue.SnapshotGuard", true)),
            tooltip: "When queueing multi-item batches, snapshots prompt and node inputs (like text and LoRAs) in the background so mid-queue canvas edits do not corrupt queued items. Random seeds continue to randomize."
        });

        // =========================================================================
        // GROUP 9: 9 - 🛡️ Security & Script Execution
        // =========================================================================

        // 9.1 Allow Local File Execution (Default Disabled)
        app.ui.settings.addSetting({
            id: "SaturnNodes.9 - 🛡️ Security.01_AllowLocalFileExecution",
            name: "Allow Local File Execution",
            type: "boolean",
            defaultValue: getInitialSetting("SaturnNodes.9 - 🛡️ Security.01_AllowLocalFileExecution", false),
            tooltip: "Controls whether the '🪐 ⚡ Run Local File' node is permitted to run executable files (.bat, .ps1, .exe, .sh). Disabled by default for operator security. When enabled, scripts are strictly confined to the 'ComfyUI/scripts/' directory. Execution is blocked if this setting is disabled or if the node is not interactively authorized.",
            onChange(value) {
                postSaturnNodesSettings({ enable_local_file_execution: value ? "true" : "false" });
            }
        });

        // =========================================================================
        // GROUP 10: 10 - 🪐 About & GitHub
        // =========================================================================

        const renderGitHubBtn = renderSettingButton("🪐 Open GitHub Profile (@KOFiblto)", "⏳ Opening...", "✅ Opened!", () => {
            window.open("https://github.com/KOFiblto", "_blank", "noopener,noreferrer");
        });

        app.ui.settings.addSetting({
            id: "SaturnNodes.10 - 🪐 GitHub.01_GitHubProfile",
            name: "Author GitHub Profile & Repo",
            type: renderGitHubBtn,
            render: renderGitHubBtn,
            defaultValue: "https://github.com/KOFiblto",
            tooltip: "Opens the author's GitHub profile (@KOFiblto) and the ComfyUI-SaturnNodes repository to view updates, star the project, or report issues.",
            attrs: {
                className: "saturnnodes-settings-btn",
                class: "saturnnodes-settings-btn",
                readOnly: true,
                style: "cursor: pointer; text-align: center;",
                onClick: () => {
                    window.open("https://github.com/KOFiblto", "_blank", "noopener,noreferrer");
                }
            }
        });
    }
});

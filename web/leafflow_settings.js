import { app } from "/scripts/app.js";
import { api } from "/scripts/api.js";
import { authenticatedFetch } from "./js/auth_helper.js";

async function postLeafFlowSettings(bodyObj) {
    try {
        return await authenticatedFetch("/leafflow/settings", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(bodyObj)
        });
    } catch (e) {
        console.warn("[LeafFlow Settings] Failed to save setting:", e);
    }
}

// Inject CSS to ensure settings buttons look distinct, styled with an emerald theme, and never get text cut off
if (typeof document !== "undefined") {
    const styleId = "leafflow-settings-button-styles";
    if (!document.getElementById(styleId)) {
        const style = document.createElement("style");
        style.id = styleId;
        style.textContent = `
            /* ComfyUI V2 Vue & LiteGraph Settings Button Styling */
            button.leafflow-settings-btn,
            tr:has([id*="LeafFlow"]) button,
            tr:has([id*="leafflow"]) button,
            div:has(> [id*="LeafFlow"]) button,
            div:has(> [id*="leafflow"]) button,
            [data-setting-id*="LeafFlow"] button,
            div[class*="setting"]:has(span:contains("LeafFlow")) button {
                background: linear-gradient(135deg, #059669 0%, #047857 100%) !important;
                border: 1px solid #10b981 !important;
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
                box-shadow: 0 1px 3px rgba(0, 0, 0, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.15) !important;
                transition: all 0.2s ease !important;
                display: inline-flex !important;
                align-items: center !important;
                justify-content: center !important;
            }

            button.leafflow-settings-btn:hover,
            tr:has([id*="LeafFlow"]) button:hover,
            div:has(> [id*="LeafFlow"]) button:hover,
            [data-setting-id*="LeafFlow"] button:hover {
                background: linear-gradient(135deg, #047857 0%, #059669 100%) !important;
                border-color: #34d399 !important;
                color: #ffffff !important;
                box-shadow: 0 0 10px rgba(16, 185, 129, 0.45) !important;
                transform: translateY(-1px) !important;
            }

            button.leafflow-settings-btn:active,
            tr:has([id*="LeafFlow"]) button:active {
                transform: translateY(0) !important;
            }
        `;
        document.head.appendChild(style);
    }
}

// Global Non-Fatal Warning & Native Node Error Highlighter
try {
    api.addEventListener("leafflow_node_error_state", (e) => {
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
                summary: `🍃 ${title || "LeafFlow"}`,
                detail: `${message} (Auto-resolved with ${fallback})`,
                life: 6000
            });
        }
    });

    api.addEventListener("leafflow_toast", (e) => {
        const data = e.detail || {};
        const title = data.title || "LeafFlow Notice";
        const message = data.message || "";
        const type = data.type || "warn";
        if (app.extensionManager?.toast?.add) {
            app.extensionManager.toast.add({
                severity: type === "error" ? "error" : "warn",
                summary: `🍃 ${title}`,
                detail: message,
                life: 6000
            });
        } else if (app.ui?.dialog) {
            console.warn(`[LeafFlow] ${title}: ${message}`);
        }
    });
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
        btn.className = "p-button leafflow-settings-btn";
        btn.style.cssText = `
            padding: 6px 14px !important;
            background: linear-gradient(135deg, #059669 0%, #047857 100%) !important;
            color: #ffffff !important;
            border: 1px solid #10b981 !important;
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
                btn.style.background = "#047857";
                btn.style.borderColor = "#34d399";
                btn.style.boxShadow = "0 0 10px rgba(16, 185, 129, 0.45)";
            }
        };
        btn.onmouseout = () => {
            if (!btn.disabled) {
                btn.style.background = "linear-gradient(135deg, #059669 0%, #047857 100%)";
                btn.style.borderColor = "#10b981";
                btn.style.boxShadow = "0 1px 3px rgba(0,0,0,0.4)";
            }
        };

        btn.onclick = async (e) => {
            e.preventDefault();
            e.stopPropagation();
            btn.disabled = true;
            btn.style.opacity = "0.7";
            btn.textContent = workingText || "⏳ Working...";
            try {
                await onClickHandler();
                btn.textContent = successText || "✅ Done!";
                btn.style.background = "#1b5e20";
                btn.style.borderColor = "#2e7d32";
                btn.style.color = "#ffffff";
            } catch (err) {
                console.error("[LeafFlow] Button action failed:", err);
                btn.textContent = "❌ Error";
                btn.style.background = "#c62828";
                btn.style.borderColor = "#e53935";
            }
            setTimeout(() => {
                btn.textContent = label;
                btn.disabled = false;
                btn.style.opacity = "1";
                btn.style.background = "linear-gradient(135deg, #059669 0%, #047857 100%)";
                btn.style.borderColor = "#10b981";
            }, 1800);
        };

        container.appendChild(btn);
        return container;
    };
}

/**
 * Automatic Settings Migration:
 * Seamlessly copies over existing user settings from older LeafFlow setting ID formats
 * so users never lose their saved API keys, tokens, or preferences.
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
            // Convert dot-numbered formats like "LeafFlow.1. 🖼️..." -> "LeafFlow.1 - 🖼️..."
            const newKey = oldKey.replace(/LeafFlow\.(\d+)\.\s+/g, "LeafFlow.$1 - ");
            if (newKey !== oldKey && localStorage.getItem(newKey) === null) {
                localStorage.setItem(newKey, val);
            }
        }
    } catch (e) {
        console.warn("[LeafFlow] Settings migration skipped:", e);
    }
}
migrateSavedSettings();

app.registerExtension({
    name: "ComfyUI.LeafFlow.Settings",
    async setup() {
        migrateSavedSettings();

        // =========================================================================
        // GRUPPE 1: 1 - 🖼️ Visual Loaders
        // =========================================================================

        // 1.0 Custom Node Colors Toggle
        app.ui.settings.addSetting({
            id: "LeafFlow.1 - 🖼️ Visual Loaders.00_EnableCustomColors",
            name: "Enable Custom LeafFlow Node Colors",
            type: "boolean",
            defaultValue: true,
            tooltip: "Applies a fresh Leaf Green color theme to LeafFlow nodes on the canvas. When disabled, nodes use default ComfyUI colors.",
        });

        // 1.1 Civitai API Key
        app.ui.settings.addSetting({
            id: "LeafFlow.1 - 🖼️ Visual Loaders.01_CivitaiApiKey",
            name: "Civitai API Key",
            type: "text",
            defaultValue: "",
            tooltip: "Optional. Civitai SHA256 search works publicly without a key for normal models. Only needed for NSFW/private models or higher rate limits. Whitespace is automatically stripped.",
            onChange(value) {
                const cleanKey = (value || "").trim();
                postLeafFlowSettings({ civitai_api_key: cleanKey });
            }
        });

        // 1.2 Enable Civitai Auto-Scraping Toggle (default: true)
        app.ui.settings.addSetting({
            id: "LeafFlow.1 - 🖼️ Visual Loaders.02_EnableCivitaiScraping",
            name: "Enable Civitai Auto-Scraping",
            type: "boolean",
            defaultValue: true,
            tooltip: "Toggles automated downloading of preview thumbnails for new LoRAs from Civitai via SHA256 file hashes. Note: SHA256 hash searching will always work regardless of this setting when matching local models.",
            onChange(value) {
                postLeafFlowSettings({ enable_civitai_scraping: value ? "true" : "false" });
            }
        });

        // 1.3 TMDB Access Token
        app.ui.settings.addSetting({
            id: "LeafFlow.1 - 🖼️ Visual Loaders.03_TMDBApiKey",
            name: "TMDB Access Token",
            type: "text",
            defaultValue: "",
            tooltip: "Optional. Accepts TMDB v3 API keys or TMDB v4 Read Access Tokens (eyJ...). Used for celebrity poster and preview image lookup. Whitespace is automatically stripped.",
            onChange(value) {
                const cleanKey = (value || "").trim();
                postLeafFlowSettings({ tmdb_api_key: cleanKey });
            }
        });

        // 1.4 Enable TMDB Auto-Scraping Toggle (default: false)
        app.ui.settings.addSetting({
            id: "LeafFlow.1 - 🖼️ Visual Loaders.04_EnableTMDBScraping",
            name: "Enable TMDB Auto-Scraping",
            type: "boolean",
            defaultValue: false,
            tooltip: "Toggles automated downloading of celebrity preview thumbnails from TMDB. Default is disabled.",
            onChange(value) {
                postLeafFlowSettings({ enable_tmdb_scraping: value ? "true" : "false" });
            }
        });

        // 1.5 Enable LoRA Usage Tracking (default: true)
        app.ui.settings.addSetting({
            id: "LeafFlow.1 - 🖼️ Visual Loaders.05_EnableLoraUsage",
            name: "Enable LoRA Usage Tracking",
            type: "boolean",
            defaultValue: true,
            tooltip: "Toggles tracking and displaying LoRA usage counts & visual rank badges (🔥, Gold, Silver, Bronze) in the LoRA picker. Existing usage history is preserved when disabled.",
            onChange(value) {
                postLeafFlowSettings({ enable_lora_usage: value ? "true" : "false" });
            }
        });

        // 1.6 Reset Scrapes Cache Button
        app.ui.settings.addSetting({
            id: "LeafFlow.1 - 🖼️ Visual Loaders.06_ResetScrapesCache",
            name: "Reset Failed Scrapes Cache",
            type: "button",
            defaultValue: "🗑️ Clear Scrapes Cache",
            tooltip: "Immediately clears failed_scrapes.json so Civitai and TMDB can retry downloading missing preview thumbnails on the next folder scan.",
            attrs: {
                className: "leafflow-settings-btn",
                class: "leafflow-settings-btn",
                onClick: async () => {
                    try {
                        const resp = await authenticatedFetch("/leafflow/scrapes/clear", { method: "POST" });
                        const data = await resp.json();
                        if (data && data.status === "ok") {
                            alert("LeafFlow: Failed scrapes cache successfully reset!");
                        } else {
                            alert("LeafFlow: Failed to reset cache.");
                        }
                    } catch (err) {
                        alert("LeafFlow: Error resetting cache: " + err);
                    }
                }
            },
            render: renderSettingButton("🗑️ Clear Scrapes Cache", "⏳ Clearing...", "✅ Cache Reset!", async () => {
                const resp = await authenticatedFetch("/leafflow/scrapes/clear", { method: "POST" });
                const data = await resp.json();
                if (data.status !== "ok") {
                    throw new Error(data.message || "Failed to reset scrapes cache");
                }
            })
        });


        // =========================================================================
        // GRUPPE 2: 2 - 🔄 Prompt Queue Iterator
        // =========================================================================

        // 2.1 Clear Prompt Iterator State on Launch (default: false)
        app.ui.settings.addSetting({
            id: "LeafFlow.2 - 🔄 Prompt Iterator.01_ClearOnLaunch",
            name: "Clear State on Launch",
            type: "boolean",
            defaultValue: false,
            tooltip: "Privacy setting. When enabled, prompt_iterator_state.json will be emptied automatically every time ComfyUI starts up.",
            onChange(value) {
                postLeafFlowSettings({ clear_prompt_iterator_on_launch: value ? "true" : "false" });
            }
        });

        // 2.2 Reset Prompt Iterator Queues Now
        app.ui.settings.addSetting({
            id: "LeafFlow.2 - 🔄 Prompt Iterator.02_ResetActiveQueues",
            name: "Reset Active Queues State",
            type: "button",
            defaultValue: "🔄 Reset All Queues",
            tooltip: "Immediately empties all active prompt queues and resets iterator state across all workflows.",
            attrs: {
                className: "leafflow-settings-btn",
                class: "leafflow-settings-btn",
                onClick: async () => {
                    try {
                        const resp = await authenticatedFetch("/leafflow/prompt_iterator/clear", { method: "POST" });
                        const data = await resp.json();
                        if (data && data.status === "ok") {
                            alert("LeafFlow: Prompt Iterator queues successfully reset!");
                        } else {
                            alert("LeafFlow: Failed to reset queues.");
                        }
                    } catch (err) {
                        alert("LeafFlow: Error resetting queues: " + err);
                    }
                }
            },
            render: renderSettingButton("🔄 Reset All Queues", "⏳ Resetting...", "✅ State Reset!", async () => {
                const resp = await authenticatedFetch("/leafflow/prompt_iterator/clear", { method: "POST" });
                const data = await resp.json();
                if (data.status !== "ok") {
                    throw new Error(data.message || "Failed to clear prompt iterator state");
                }
            })
        });


        // =========================================================================
        // GRUPPE 3: 3 - 📋 Prompt Actions
        // =========================================================================

        // 3.1 Show "Copy Prompt" Button on Image Overlays
        app.ui.settings.addSetting({
            id: "LeafFlow.3 - 📋 Prompt Actions.01_EnableAssetsCopyPromptButton",
            name: "Show \"Copy Prompt\" Button on Images",
            type: "boolean",
            defaultValue: true,
            tooltip: "Shows the 📋 'Copy Prompt' overlay action button when hovering over generated images in the Assets / History pane and preview nodes.",
        });

        // 3.2 Show Right-Click "Copy Prompt" Menu Action
        app.ui.settings.addSetting({
            id: "LeafFlow.3 - 📋 Prompt Actions.02_EnableContextMenuCopyPrompt",
            name: "Show Right-Click \"Copy Prompt\" Menu Action",
            type: "boolean",
            defaultValue: true,
            tooltip: "Adds '📋 Copy Prompt' to node right-click context menus.",
        });

        // 3.3 Show "Save to Prompt Bookmarks" Button on Images & Context Menu
        app.ui.settings.addSetting({
            id: "LeafFlow.3 - 📋 Prompt Actions.03_EnableSaveToPromptSaver",
            name: "Show \"Save to Prompt Saver\" Action",
            type: "boolean",
            defaultValue: true,
            tooltip: "Adds 🔖 'Save to Prompt Bookmarks' to image hover overlay bars and node context menus.",
        });

        // 3.4 Show "Inspect Asset" (Zoom) Button on Image Overlays
        app.ui.settings.addSetting({
            id: "LeafFlow.3 - 📋 Prompt Actions.04_EnableInspectAssetButton",
            name: "Show \"Inspect Asset\" (Zoom) Button on Images",
            type: "boolean",
            defaultValue: false,
            tooltip: "Restores the 🔍 'Inspect asset' (zoom in) button directly on image cards in the Assets pane next to Download, Copy Prompt, and Bookmarks (moved behind the 3-dots menu in newer ComfyUI versions).",
        });


        // =========================================================================
        // GRUPPE 4: 4 - ⏸️ Pause & Resume Controls
        // =========================================================================

        // 4.1 Default Pause Queue State on Launch
        app.ui.settings.addSetting({
            id: "LeafFlow.4 - ⏸️ Pause Controls.01_DefaultStateOnLaunch",
            name: "Default State on Launch",
            type: "combo",
            options: ["Paused", "Running"],
            defaultValue: "Paused",
            tooltip: "Choose whether execution starts in Paused state or Running state on ComfyUI startup.",
            onChange(value) {
                postLeafFlowSettings({ default_pause_state: value });
            }
        });

        // 4.2 Default Pause Queue Mode on Launch
        app.ui.settings.addSetting({
            id: "LeafFlow.4 - ⏸️ Pause Controls.02_DefaultPauseAction",
            name: "Default Pause Action",
            type: "combo",
            options: ["Finish Active Prompt", "Instant Resume Node"],
            defaultValue: "Finish Active Prompt",
            tooltip: "Choose default pause behavior when the pause button or hotkey is triggered.",
            onChange(value) {
                const modeKey = (value === "Instant Resume Node" || value === "Pause (Instant)") ? "instantly" : "after_finish";
                postLeafFlowSettings({ default_pause_mode: modeKey });
            }
        });

        // 4.3 Enable Pause Queue Toolbar Button
        app.ui.settings.addSetting({
            id: "LeafFlow.4 - ⏸️ Pause Controls.03_EnableToolbarButton",
            name: "Enable Top Toolbar Button",
            type: "boolean",
            defaultValue: true,
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
            id: "LeafFlow.4 - ⏸️ Pause Controls.04_ToolbarButtonUnpausedColor",
            name: "Toolbar Button Unpaused Color",
            type: "text",
            defaultValue: "#16a34a",
            tooltip: "Hex color code for the Pause toolbar button when execution is unpaused/running (default: #16a34a).",
            onChange(value) {
                document.documentElement.style.setProperty("--pq-unpaused-color", value || "#16a34a");
            }
        });

        // 4.5 Toolbar Button Paused Color
        app.ui.settings.addSetting({
            id: "LeafFlow.4 - ⏸️ Pause Controls.05_ToolbarButtonPausedColor",
            name: "Toolbar Button Paused Color",
            type: "text",
            defaultValue: "#ea580c",
            tooltip: "Hex color code for the Pause toolbar button when execution is paused (default: #ea580c).",
            onChange(value) {
                document.documentElement.style.setProperty("--pq-paused-color", value || "#ea580c");
            }
        });

        // 4.6 Enable System Tray Icon
        app.ui.settings.addSetting({
            id: "LeafFlow.4 - ⏸️ Pause Controls.06_EnableTrayIcon",
            name: "Enable System Tray Icon",
            type: "boolean",
            defaultValue: false,
            tooltip: "Displays an OS system tray icon with real-time queue status colors and outside-browser queue controls.",
            onChange(value) {
                postLeafFlowSettings({ enable_tray_icon: value ? "true" : "false" });
            }
        });

        // 4.7 Allow Process Management (Restart / Shutdown)
        app.ui.settings.addSetting({
            id: "LeafFlow.4 - ⏸️ Pause Controls.07_AllowProcessManagement",
            name: "Allow Process Management (Restart / Shutdown)",
            type: "boolean",
            defaultValue: false,
            tooltip: "Enables server restart and shutdown actions from the LeafFlow power controls. Disabled by default for security.",
            onChange(value) {
                postLeafFlowSettings({ enable_process_management: value ? "true" : "false" });
            }
        });


        // =========================================================================
        // GRUPPE 5: 5 - 💾 Persistent Queue (Auto-Recovery)
        // =========================================================================

        // 5.1 Enable Persistent Queue (Auto-Recovery)
        app.ui.settings.addSetting({
            id: "LeafFlow.5 - 💾 Persistent Queue.01_EnablePersistentQueue",
            name: "Enable Persistent Queue (Auto-Recovery)",
            type: "boolean",
            defaultValue: true,
            tooltip: "Automatically persists unfinished batch queue items to disk and restores them after server or browser crashes.",
            onChange(value) {
                postLeafFlowSettings({ enable_persistent_queue: value ? "true" : "false" });
            }
        });

        // 5.2 Persistent Queue Restored Launch State
        app.ui.settings.addSetting({
            id: "LeafFlow.5 - 💾 Persistent Queue.02_RecoveryLaunchState",
            name: "Recovery Launch State",
            type: "combo",
            options: ["Match Default", "Force Paused", "Force Running"],
            defaultValue: "Match Default",
            tooltip: "Override launch state when unfinished queue items are recovered on startup.",
            onChange(value) {
                postLeafFlowSettings({ persistent_queue_restored_state: value });
            }
        });


        // =========================================================================
        // GRUPPE 6: 6 - 🖼️ Assets & History Restore
        // =========================================================================

        // 6.1 Enable Assets / History Restore on Launch
        app.ui.settings.addSetting({
            id: "LeafFlow.6 - 🖼️ Assets Restore.01_RestoreAssetsOnLaunch",
            name: "Restore Assets on Launch",
            type: "boolean",
            defaultValue: true,
            tooltip: "Automatically populates the Assets / History pane upon ComfyUI launch with your latest generated images.",
            onChange(value) {
                postLeafFlowSettings({ enable_assets_restore: value ? "true" : "false" });
            }
        });

        // 6.2 Restored Assets Count
        app.ui.settings.addSetting({
            id: "LeafFlow.6 - 🖼️ Assets Restore.02_RestoredAssetsCount",
            name: "Restored Assets Count",
            type: "number",
            defaultValue: 64,
            tooltip: "Number of newest images from the output folder to restore into the Assets / History pane on launch (default: 64).",
            onChange(value) {
                const count = parseInt(value, 10) || 64;
                postLeafFlowSettings({ restore_assets_count: count });
            }
        });


        // =========================================================================
        // GRUPPE 7: 7 - 🩺 Diagnostics & Debug
        // =========================================================================

        // 7.1 Export Debug Profile Button
        app.ui.settings.addSetting({
            id: "LeafFlow.7 - 🩺 Diagnostics.01_ExportDebugProfile",
            name: "Export Debug Profile",
            type: "button",
            defaultValue: "📥 Export Debug Profile",
            tooltip: "Exports non-sensitive environment diagnostics (OS, Python, PyTorch, LeafFlow settings, local counts) as a JSON file to share when troubleshooting issues.",
            attrs: {
                className: "leafflow-settings-btn",
                class: "leafflow-settings-btn",
                onClick: async () => {
                    const approved = confirm("🍃 ComfyUI-LeafFlow Diagnostics Export\n\nExport system diagnostics for troubleshooting?\n\nNOTE: Sensitive API keys, tokens, file paths, and private prompt texts are automatically stripped and NEVER exported.");
                    if (!approved) return;

                    try {
                        const resp = await api.fetchApi("/leafflow/debug/export");
                        const data = await resp.json();
                        const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement("a");
                        a.href = url;
                        a.download = `leafflow_debug_profile_${new Date().toISOString().slice(0, 10)}.json`;
                        document.body.appendChild(a);
                        a.click();
                        document.body.removeChild(a);
                        URL.revokeObjectURL(url);
                        alert("✅ Diagnostics profile exported successfully! You can attach the downloaded JSON file to your bug report or GitHub issue.");
                    } catch (e) {
                        console.error("[LeafFlow] 🍃 Error exporting debug profile:", e);
                        alert("❌ Failed to export debug profile: " + e.message);
                    }
                }
            },
            render: renderSettingButton("📥 Export Debug Profile", "⏳ Exporting...", "✅ Exported!", async () => {
                const resp = await api.fetchApi("/leafflow/debug/export");
                const data = await resp.json();
                const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = `leafflow_debug_profile_${new Date().toISOString().slice(0, 10)}.json`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
            })
        });
        // =========================================================================
        // GRUPPE 8: 8 - 🎨 Batch Queue Visuals
        // =========================================================================

        // 8.1 Enable Batch Queue Grouping Lines
        app.ui.settings.addSetting({
            id: "LeafFlow.BatchQueue.Enabled",
            name: "Show Batch Queue 1D Lines",
            type: "boolean",
            defaultValue: true,
            tooltip: "Renders 1D git-graph style colored lines indicating batch groupings and contiguous segments on queued items."
        });

        // 8.2 Batch Graph Snapshot Guard
        app.ui.settings.addSetting({
            id: "LeafFlow.BatchQueue.SnapshotGuard",
            name: "Batch Graph Snapshot Guard",
            type: "boolean",
            defaultValue: true,
            tooltip: "When queueing multi-item batches, snapshots prompt and node inputs (like text and LoRAs) in the background so mid-queue canvas edits do not corrupt queued items. Random seeds continue to randomize."
        });

        // =========================================================================
        // GRUPPE 9: 9 - 🛡️ Security & Script Execution
        // =========================================================================

        // 9.1 Allow Local File Execution (Default Disabled)
        app.ui.settings.addSetting({
            id: "LeafFlow.9 - 🛡️ Security.01_AllowLocalFileExecution",
            name: "Allow Local File Execution",
            type: "boolean",
            defaultValue: false,
            tooltip: "Controls whether the '🍃 ⚡ Run Local File' node is permitted to run executable files (.bat, .ps1, .exe, .sh). Disabled by default for operator security. When enabled, scripts are strictly confined to the 'ComfyUI/scripts/' directory. Execution is blocked if this setting is disabled or if the node is not interactively authorized.",
            onChange(value) {
                postLeafFlowSettings({ enable_local_file_execution: value ? "true" : "false" });
            }
        });
    }
});


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

// Inject CSS to ensure settings buttons look distinct and dropdown menus retain proper styling
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

            /* Ensure wrapper divs created specifically for action buttons do not render borders */
            div.saturnnodes-settings-btn-wrap {
                background: transparent !important;
                border: none !important;
                box-shadow: none !important;
                padding: 0 !important;
            }

            /* ComfyUI Settings Dropdowns & Combos (PrimeVue Select protection) */
            [data-setting-id*="SaturnNodes"] select,
            [data-setting-id*="SaturnNodes"] .p-select,
            [data-setting-id*="SaturnNodes"] .p-dropdown,
            [data-setting-id*="saturnnodes"] select,
            [data-setting-id*="saturnnodes"] .p-select,
            [data-setting-id*="saturnnodes"] .p-dropdown,
            div[id*="SaturnNodes"][role="combobox"],
            div[id*="saturnnodes"][role="combobox"],
            div[id*="SaturnNodes"].p-select,
            div[id*="saturnnodes"].p-select {
                background: var(--p-select-background, #18181b) !important;
                border: 1px solid var(--p-select-border-color, rgba(255, 255, 255, 0.2)) !important;
                border-radius: 6px !important;
                color: var(--p-select-color, #e4e4e7) !important;
                min-height: 32px !important;
                padding: 4px 10px !important;
                display: inline-flex !important;
                align-items: center !important;
            }

            /* ComfyUI Settings Action Buttons (Buttons only: 1.5x height, font-size 13px) */
            button.saturnnodes-settings-btn,
            button.leafflow-settings-btn,
            [data-setting-id*="SaturnNodes"] button:not([role="switch"]):not([data-pc-name="toggleswitch"]),
            [data-setting-id*="saturnnodes"] button:not([role="switch"]):not([data-pc-name="toggleswitch"]),
            [data-setting-id*="LeafFlow"] button:not([role="switch"]):not([data-pc-name="toggleswitch"]),
            [data-setting-id*="leafflow"] button:not([role="switch"]):not([data-pc-name="toggleswitch"]) {
                background: #8b7355 !important;
                border: 1px solid #a68a67 !important;
                color: #ffffff !important;
                font-weight: 500 !important;
                font-size: 13px !important;
                padding: 6px 16px !important;
                min-height: 32px !important;
                border-radius: 4px !important;
                width: auto !important;
                min-width: max-content !important;
                max-width: none !important;
                white-space: nowrap !important;
                overflow: visible !important;
                text-overflow: clip !important;
                cursor: pointer !important;
                text-align: center !important;
                box-shadow: 0 1px 2px rgba(0, 0, 0, 0.25) !important;
                transition: all 0.15s ease !important;
                display: inline-flex !important;
                align-items: center !important;
                justify-content: center !important;
                user-select: none !important;
                box-sizing: border-box !important;
                line-height: 1.4 !important;
            }

            button.saturnnodes-settings-btn:hover,
            button.leafflow-settings-btn:hover,
            [data-setting-id*="SaturnNodes"] button:not([role="switch"]):not([data-pc-name="toggleswitch"]):hover,
            [data-setting-id*="saturnnodes"] button:not([role="switch"]):not([data-pc-name="toggleswitch"]):hover,
            [data-setting-id*="LeafFlow"] button:not([role="switch"]):not([data-pc-name="toggleswitch"]):hover,
            [data-setting-id*="leafflow"] button:not([role="switch"]):not([data-pc-name="toggleswitch"]):hover {
                background: #9e8565 !important;
                border-color: #c4a780 !important;
                color: #ffffff !important;
                box-shadow: 0 0 8px rgba(180, 140, 95, 0.35) !important;
                transform: translateY(-1px) !important;
            }

            button.saturnnodes-settings-btn:active,
            button.leafflow-settings-btn:active,
            [data-setting-id*="SaturnNodes"] button:not([role="switch"]):not([data-pc-name="toggleswitch"]):active {
                background: #7d6549 !important;
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
 * Sketch-style Color Picker for Settings (integrated from kikotools)
 */
class SketchColorPicker {
    constructor(initialColor = '#ff9966', onChange = () => {}) {
        this.color = this.hexToHsv(initialColor);
        this.hex = initialColor;
        this.onChange = onChange;
        this.isOpen = false;

        this.presetColors = [
            '#D0021B', '#F5A623', '#F8E71C', '#8B572A', '#7ED321',
            '#417505', '#BD10E0', '#9013FE', '#4A90D9', '#50E3C2',
            '#B8E986', '#000000', '#4A4A4A', '#9B9B9B', '#FFFFFF',
        ];

        this.createElements();
    }

    createElements() {
        // Swatch button
        this.swatch = document.createElement('div');
        this.swatch.style.cssText = `
            width: 50px; height: 28px; border-radius: 4px;
            background: ${this.hex}; cursor: pointer;
            box-shadow: 0 0 0 1px rgba(0,0,0,.2), inset 0 0 0 1px rgba(0,0,0,.1);
            display: inline-block;
        `;
        this.swatch.addEventListener('click', (e) => {
            e.stopPropagation();
            this.toggle();
        });

        // Popup container
        this.popup = document.createElement('div');
        this.popup.style.cssText = `
            position: absolute; z-index: 10000;
            background: #2a2a2a; border-radius: 6px;
            box-shadow: 0 0 0 1px rgba(255,255,255,.1), 0 8px 24px rgba(0,0,0,.4);
            padding: 12px; display: none; width: 220px;
            bottom: 100%; margin-bottom: 8px; right: 0;
        `;

        // Saturation/Brightness picker
        this.satBright = document.createElement('div');
        this.satBright.style.cssText = `
            width: 196px; height: 140px; position: relative;
            border-radius: 4px; cursor: crosshair; margin-bottom: 12px;
        `;
        this.updateSatBrightBackground();

        this.satBrightPointer = document.createElement('div');
        this.satBrightPointer.style.cssText = `
            width: 14px; height: 14px; border-radius: 50%;
            border: 2px solid #fff; box-shadow: 0 0 0 1px rgba(0,0,0,.3), 0 2px 4px rgba(0,0,0,.3);
            position: absolute; transform: translate(-50%, -50%);
            pointer-events: none;
        `;
        this.satBright.appendChild(this.satBrightPointer);

        // Hue slider
        this.hueSlider = document.createElement('div');
        this.hueSlider.style.cssText = `
            width: 196px; height: 14px; border-radius: 4px;
            background: linear-gradient(to right, #f00 0%, #ff0 17%, #0f0 33%, #0ff 50%, #00f 67%, #f0f 83%, #f00 100%);
            position: relative; cursor: pointer; margin-bottom: 12px;
        `;
        this.huePointer = document.createElement('div');
        this.huePointer.style.cssText = `
            width: 8px; height: 18px; border-radius: 3px;
            background: #fff; border: 1px solid rgba(0,0,0,.3);
            position: absolute; top: -2px; transform: translateX(-50%);
            pointer-events: none; box-shadow: 0 1px 3px rgba(0,0,0,.3);
        `;
        this.hueSlider.appendChild(this.huePointer);

        // Hex input row
        this.hexRow = document.createElement('div');
        this.hexRow.style.cssText = 'display: flex; align-items: center; margin-bottom: 12px; gap: 8px;';

        this.hexInput = document.createElement('input');
        this.hexInput.type = 'text';
        this.hexInput.value = this.hex;
        this.hexInput.style.cssText = `
            flex: 1; padding: 6px 8px; border: 1px solid #444;
            border-radius: 4px; font-size: 13px; font-family: monospace;
            text-transform: uppercase; background: #1a1a1a; color: #eee;
        `;
        this.hexInput.addEventListener('change', () => this.setHex(this.hexInput.value));

        const hexLabel = document.createElement('span');
        hexLabel.textContent = 'Hex';
        hexLabel.style.cssText = 'font-size: 12px; color: #888; min-width: 28px;';

        this.hexRow.appendChild(this.hexInput);
        this.hexRow.appendChild(hexLabel);

        // Preset swatches
        this.presetsContainer = document.createElement('div');
        this.presetsContainer.style.cssText = `
            display: flex; flex-wrap: wrap; gap: 6px;
            border-top: 1px solid #444; padding-top: 12px;
        `;

        this.presetColors.forEach(color => {
            const preset = document.createElement('div');
            preset.style.cssText = `
                width: 18px; height: 18px; border-radius: 3px;
                background: ${color}; cursor: pointer;
                box-shadow: inset 0 0 0 1px rgba(0,0,0,.2);
                transition: transform 0.1s;
            `;
            preset.addEventListener('mouseenter', () => preset.style.transform = 'scale(1.15)');
            preset.addEventListener('mouseleave', () => preset.style.transform = 'scale(1)');
            preset.addEventListener('click', () => this.setHex(color));
            this.presetsContainer.appendChild(preset);
        });

        // Assemble popup
        this.popup.appendChild(this.satBright);
        this.popup.appendChild(this.hueSlider);
        this.popup.appendChild(this.hexRow);
        this.popup.appendChild(this.presetsContainer);

        // Event handlers
        this.setupDrag(this.satBright, this.handleSatBrightChange.bind(this));
        this.setupDrag(this.hueSlider, this.handleHueChange.bind(this));

        // Close on outside click
        this.closeHandler = (e) => {
            if (!this.popup.contains(e.target) && e.target !== this.swatch) {
                this.close();
            }
        };
    }

    setupDrag(element, handler) {
        const onMove = (e) => {
            e.preventDefault();
            const rect = element.getBoundingClientRect();
            const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
            const y = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
            handler(x, y);
        };

        const onUp = () => {
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
        };

        element.addEventListener('mousedown', (e) => {
            e.preventDefault();
            onMove(e);
            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
        });

        element.addEventListener('mousemove', (e) => {
            if (e.buttons === 0) {
                const rect = element.getBoundingClientRect();
                const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
                const y = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
                handler(x, y);
            }
        });
    }

    handleSatBrightChange(x, y) {
        this.color.s = x * 100;
        this.color.v = (1 - y) * 100;
        this.updateFromHsv();
    }

    handleHueChange(x) {
        this.color.h = x * 360;
        this.updateFromHsv();
    }

    updateFromHsv() {
        this.hex = this.hsvToHex(this.color.h, this.color.s, this.color.v);
        this.updateUI();
        this.onChange(this.hex);
    }

    updateUI() {
        this.swatch.style.background = this.hex;
        this.updateSatBrightBackground();
        this.satBrightPointer.style.left = `${this.color.s}%`;
        this.satBrightPointer.style.top = `${100 - this.color.v}%`;
        this.huePointer.style.left = `${(this.color.h / 360) * 100}%`;
        this.hexInput.value = this.hex.toUpperCase();
    }

    updateSatBrightBackground() {
        const hueColor = this.hsvToHex(this.color.h, 100, 100);
        this.satBright.style.background = `
            linear-gradient(to top, #000, transparent),
            linear-gradient(to right, #fff, ${hueColor})
        `;
    }

    setHex(hex) {
        if (!/^#?[0-9A-Fa-f]{6}$/.test(hex)) return;
        if (!hex.startsWith('#')) hex = '#' + hex;
        this.hex = hex;
        this.color = this.hexToHsv(hex);
        this.updateUI();
        this.onChange(this.hex);
    }

    toggle() { this.isOpen ? this.close() : this.open(); }

    open() {
        this.isOpen = true;
        this.popup.style.display = 'block';
        const rect = this.swatch.getBoundingClientRect();
        if (rect.top < 240) {
            this.popup.style.bottom = 'auto';
            this.popup.style.top = '100%';
            this.popup.style.marginTop = '8px';
            this.popup.style.marginBottom = '0';
        } else {
            this.popup.style.top = 'auto';
            this.popup.style.bottom = '100%';
            this.popup.style.marginBottom = '8px';
            this.popup.style.marginTop = '0';
        }
        this.updateUI();
        setTimeout(() => document.addEventListener('click', this.closeHandler), 0);
    }

    close() {
        this.isOpen = false;
        this.popup.style.display = 'none';
        document.removeEventListener('click', this.closeHandler);
    }

    getElement() {
        const container = document.createElement('div');
        container.style.cssText = 'position: relative; display: inline-block;';
        container.appendChild(this.swatch);
        container.appendChild(this.popup);
        return container;
    }

    hexToHsv(hex) {
        const r = parseInt(hex.slice(1, 3), 16) / 255;
        const g = parseInt(hex.slice(3, 5), 16) / 255;
        const b = parseInt(hex.slice(5, 7), 16) / 255;
        const max = Math.max(r, g, b), min = Math.min(r, g, b);
        const v = max * 100, d = max - min;
        const s = max === 0 ? 0 : (d / max) * 100;
        let h = 0;
        if (d !== 0) {
            switch (max) {
                case r: h = ((g - b) / d + (g < b ? 6 : 0)) * 60; break;
                case g: h = ((b - r) / d + 2) * 60; break;
                case b: h = ((r - g) / d + 4) * 60; break;
            }
        }
        return { h, s, v };
    }

    hsvToHex(h, s, v) {
        s /= 100; v /= 100;
        const c = v * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = v - c;
        let r = 0, g = 0, b = 0;
        if (h < 60) { r = c; g = x; }
        else if (h < 120) { r = x; g = c; }
        else if (h < 180) { g = c; b = x; }
        else if (h < 240) { g = x; b = c; }
        else if (h < 300) { r = x; b = c; }
        else { r = c; b = x; }
        const toHex = (n) => Math.round((n + m) * 255).toString(16).padStart(2, '0');
        return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
    }
}

/**
 * Custom renderer for Kikotools-style Sketch Color Picker
 */
function renderSketchColorSetting(settingId, defaultColor) {
    return (name, setter, value) => {
        let currentColor = value;
        if (!currentColor || currentColor === "default") {
            currentColor = defaultColor;
        }

        const container = document.createElement("div");
        container.id = settingId;
        container.setAttribute("model-value", currentColor);
        container.setAttribute("aria-labelledby", `${settingId}-label`);
        container.style.cssText = "display: flex; align-items: center; justify-content: flex-end; gap: 10px; width: 100%; box-sizing: border-box;";

        const hexText = document.createElement("span");
        hexText.style.cssText = "color: #888888; font-family: monospace; font-size: 12px; text-transform: uppercase;";
        hexText.textContent = currentColor;

        const picker = new SketchColorPicker(currentColor, (newHex) => {
            hexText.textContent = newHex.toUpperCase();
            container.setAttribute("model-value", newHex);
            if (typeof setter === "function") {
                setter(newHex);
            }
            if (typeof localStorage !== "undefined") {
                try {
                    localStorage.setItem(`Comfy.Settings.${settingId}`, JSON.stringify(newHex));
                } catch (_) {}
            }
            updateAllSaturnNodeColors();
        });

        container.appendChild(picker.getElement());
        container.appendChild(hexText);
        return container;
    };
}

/**
 * Custom renderer for styled action buttons in ComfyUI Settings Modal.
 */
function renderSettingButton(label, workingText, successText, onClickHandler) {
    return (name, setter, value) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.textContent = label;
        btn.className = "saturnnodes-settings-btn";
        btn.style.cssText = `
            padding: 6px 16px !important;
            min-height: 32px !important;
            background: #8b7355 !important;
            color: #ffffff !important;
            border: 1px solid #a68a67 !important;
            border-radius: 4px !important;
            font-weight: 500 !important;
            font-size: 13px !important;
            cursor: pointer !important;
            transition: all 0.15s ease !important;
            outline: none !important;
            min-width: max-content !important;
            width: auto !important;
            white-space: nowrap !important;
            text-align: center !important;
            box-shadow: 0 1px 2px rgba(0, 0, 0, 0.25) !important;
            line-height: 1.4 !important;
            display: inline-flex !important;
            align-items: center !important;
            justify-content: center !important;
            box-sizing: border-box !important;
        `;

        btn.onmouseover = () => {
            if (!btn.disabled) {
                btn.style.background = "#9e8565";
                btn.style.borderColor = "#c4a780";
                btn.style.transform = "translateY(-1px)";
                btn.style.boxShadow = "0 0 8px rgba(180, 140, 95, 0.35)";
            }
        };
        btn.onmouseout = () => {
            if (!btn.disabled) {
                btn.style.background = "#8b7355";
                btn.style.borderColor = "#a68a67";
                btn.style.transform = "translateY(0)";
                btn.style.boxShadow = "0 1px 2px rgba(0, 0, 0, 0.25)";
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
                btn.style.background = "#059669";
                btn.style.borderColor = "#34d399";
                setTimeout(() => {
                    btn.textContent = originalText;
                    btn.disabled = false;
                    btn.style.opacity = "1";
                    btn.style.cursor = "pointer";
                    btn.style.background = "#8b7355";
                    btn.style.borderColor = "#a68a67";
                }, 2000);
            } catch (err) {
                console.error("[SaturnNodes Settings] Action failed:", err);
                btn.textContent = "❌ Failed";
                btn.style.background = "#dc2626";
                btn.style.borderColor = "#f87171";
                setTimeout(() => {
                    btn.textContent = originalText;
                    btn.disabled = false;
                    btn.style.opacity = "1";
                    btn.style.cursor = "pointer";
                    btn.style.background = "#8b7355";
                    btn.style.borderColor = "#a68a67";
                }, 3000);
            }
        };

        return btn;
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

    // Build lookup keys: unnumbered, numbered, and legacy variants
    const variations = [saturnId];

    const categoryMap = {
        "🖼️ Visual Loaders": "1 - 🖼️ Visual Loaders",
        "🔄 Prompt Iterator": "2 - 🔄 Prompt Iterator",
        "📋 Prompt Actions": "3 - 📋 Prompt Actions",
        "⏸️ Pause Controls": "4 - ⏸️ Pause Controls",
        "💾 Persistent Queue": "5 - 💾 Persistent Queue",
        "🖼️ Assets Restore": "6 - 🖼️ Assets Restore",
        "🩺 Diagnostics": "7 - 🩺 Diagnostics",
        "🎨 Batch Queue": "8 - 🎨 Batch Queue",
        "🛡️ Security": "9 - 🛡️ Security"
    };

    for (const [plain, num] of Object.entries(categoryMap)) {
        if (saturnId.includes(plain)) {
            variations.push(saturnId.replace(plain, num));
            break;
        }
    }

    const len = variations.length;
    for (let i = 0; i < len; i++) {
        variations.push(variations[i].replace(/^SaturnNodes\./, "LeafFlow."));
    }

    for (const prefix of ["Comfy.Settings.", ""]) {
        for (const vId of variations) {
            const val = localStorage.getItem(`${prefix}${vId}`);
            if (val !== null && val !== undefined) {
                try { return JSON.parse(val); } catch (_) { return val; }
            }
        }
    }
    return defaultVal;
}

app.registerExtension({
    name: "ComfyUI.SaturnNodes.Settings",
    async setup() {
        migrateSavedSettings();

        // =========================================================================
        // GROUP: 🖼️ Visual Loaders
        // =========================================================================

        // 1.0 Custom Node Colors Toggle (Default: false)
        app.ui.settings.addSetting({
            id: "SaturnNodes.🖼️ Visual Loaders.00_EnableCustomColors",
            name: "Enable Custom SaturnNodes Colors",
            type: "boolean",
            defaultValue: getInitialSetting("SaturnNodes.🖼️ Visual Loaders.00_EnableCustomColors", false),
            tooltip: "Applies custom amber colors to SaturnNodes on the canvas. When disabled (default), nodes use default ComfyUI colors.",
            onChange(value) {
                if (typeof localStorage !== "undefined") {
                    try {
                        localStorage.setItem("Comfy.Settings.SaturnNodes.🖼️ Visual Loaders.00_EnableCustomColors", JSON.stringify(Boolean(value)));
                    } catch (_) {}
                }
                updateAllSaturnNodeColors();
            }
        });

        // 1.0b Custom Node Title Color (Kikotools-style Sketch Color Picker)
        const renderTitleColor = renderSketchColorSetting("SaturnNodes.🖼️ Visual Loaders.00_CustomNodeHeaderColor", "#6a3f20");
        app.ui.settings.addSetting({
            id: "SaturnNodes.🖼️ Visual Loaders.00_CustomNodeHeaderColor",
            name: "Custom Node Title Color",
            type: renderTitleColor,
            render: renderTitleColor,
            defaultValue: getInitialSetting("SaturnNodes.🖼️ Visual Loaders.00_CustomNodeHeaderColor", "#6a3f20"),
            tooltip: "Title / header bar color for SaturnNodes on canvas when custom colors are enabled.",
            onChange(value) {
                if (typeof localStorage !== "undefined") {
                    try {
                        localStorage.setItem("Comfy.Settings.SaturnNodes.🖼️ Visual Loaders.00_CustomNodeHeaderColor", JSON.stringify(value));
                    } catch (_) {}
                }
                updateAllSaturnNodeColors();
            }
        });

        // 1.0c Custom Node Body Color (Kikotools-style Sketch Color Picker)
        const renderBgColor = renderSketchColorSetting("SaturnNodes.🖼️ Visual Loaders.00_CustomNodeBgColor", "#472a15");
        app.ui.settings.addSetting({
            id: "SaturnNodes.🖼️ Visual Loaders.00_CustomNodeBgColor",
            name: "Custom Node Body Color",
            type: renderBgColor,
            render: renderBgColor,
            defaultValue: getInitialSetting("SaturnNodes.🖼️ Visual Loaders.00_CustomNodeBgColor", "#472a15"),
            tooltip: "Body background color for SaturnNodes on canvas when custom colors are enabled.",
            onChange(value) {
                if (typeof localStorage !== "undefined") {
                    try {
                        localStorage.setItem("Comfy.Settings.SaturnNodes.🖼️ Visual Loaders.00_CustomNodeBgColor", JSON.stringify(value));
                    } catch (_) {}
                }
                updateAllSaturnNodeColors();
            }
        });

        // 1.1 Civitai API Key
        app.ui.settings.addSetting({
            id: "SaturnNodes.🖼️ Visual Loaders.01_CivitaiApiKey",
            name: "Civitai API Key",
            type: "text",
            defaultValue: getInitialSetting("SaturnNodes.🖼️ Visual Loaders.01_CivitaiApiKey", ""),
            tooltip: "Optional. Civitai SHA256 search works publicly without a key for normal models. Only needed for NSFW/private models or higher rate limits. Whitespace is automatically stripped.",
            onChange(value) {
                const cleanKey = (value || "").trim();
                postSaturnNodesSettings({ civitai_api_key: cleanKey });
            }
        });

        // 1.2 Enable Civitai Auto-Scraping Toggle (default: true)
        app.ui.settings.addSetting({
            id: "SaturnNodes.🖼️ Visual Loaders.02_EnableCivitaiScraping",
            name: "Enable Civitai Auto-Scraping",
            type: "boolean",
            defaultValue: getInitialSetting("SaturnNodes.🖼️ Visual Loaders.02_EnableCivitaiScraping", true),
            tooltip: "Toggles automated downloading of preview thumbnails for new LoRAs from Civitai via SHA256 file hashes. Note: SHA256 hash searching will always work regardless of this setting when matching local models.",
            onChange(value) {
                postSaturnNodesSettings({ enable_civitai_scraping: value ? "true" : "false" });
            }
        });

        // 1.3 TMDB Access Token
        app.ui.settings.addSetting({
            id: "SaturnNodes.🖼️ Visual Loaders.03_TMDBApiKey",
            name: "TMDB Access Token",
            type: "text",
            defaultValue: getInitialSetting("SaturnNodes.🖼️ Visual Loaders.03_TMDBApiKey", ""),
            tooltip: "Optional. Accepts TMDB v3 API keys or TMDB v4 Read Access Tokens (eyJ...). Used for celebrity poster and preview image lookup. Whitespace is automatically stripped.",
            onChange(value) {
                const cleanKey = (value || "").trim();
                postSaturnNodesSettings({ tmdb_api_key: cleanKey });
            }
        });

        // 1.4 Enable TMDB Auto-Scraping Toggle (default: false)
        app.ui.settings.addSetting({
            id: "SaturnNodes.🖼️ Visual Loaders.04_EnableTMDBScraping",
            name: "Enable TMDB Auto-Scraping",
            type: "boolean",
            defaultValue: getInitialSetting("SaturnNodes.🖼️ Visual Loaders.04_EnableTMDBScraping", false),
            tooltip: "Toggles automated downloading of celebrity preview thumbnails from TMDB. Default is disabled.",
            onChange(value) {
                postSaturnNodesSettings({ enable_tmdb_scraping: value ? "true" : "false" });
            }
        });

        // 1.5 Enable LoRA Usage Tracking (default: true)
        app.ui.settings.addSetting({
            id: "SaturnNodes.🖼️ Visual Loaders.05_EnableLoraUsage",
            name: "Enable LoRA Usage Tracking",
            type: "boolean",
            defaultValue: getInitialSetting("SaturnNodes.🖼️ Visual Loaders.05_EnableLoraUsage", true),
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
            id: "SaturnNodes.🖼️ Visual Loaders.06_ResetScrapesCache",
            name: "Reset Failed Scrapes Cache",
            type: renderScrapesCacheBtn,
            render: renderScrapesCacheBtn,
            defaultValue: "🗑️ Clear Scrapes Cache",
            tooltip: "Immediately clears failed_scrapes.json so Civitai and TMDB can retry downloading missing preview thumbnails on the next folder scan.",
            attrs: {
                readOnly: true,
                style: "display: flex; justify-content: flex-end; width: 100%; border: none !important; background: transparent !important; padding: 0 !important; box-shadow: none !important;",
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
        // GROUP: 🔄 Prompt Iterator
        // =========================================================================

        // 2.1 Clear Prompt Iterator State on Launch (default: false)
        app.ui.settings.addSetting({
            id: "SaturnNodes.🔄 Prompt Iterator.01_ClearOnLaunch",
            name: "Clear State on Launch",
            type: "boolean",
            defaultValue: getInitialSetting("SaturnNodes.🔄 Prompt Iterator.01_ClearOnLaunch", false),
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
            id: "SaturnNodes.🔄 Prompt Iterator.02_ResetActiveQueues",
            name: "Reset Active Queues State",
            type: renderResetQueuesBtn,
            render: renderResetQueuesBtn,
            defaultValue: "🔄 Reset All Queues",
            tooltip: "Immediately empties all active prompt queues and resets iterator state across all workflows.",
            attrs: {
                readOnly: true,
                style: "display: flex; justify-content: flex-end; width: 100%; border: none !important; background: transparent !important; padding: 0 !important; box-shadow: none !important;",
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
        // GROUP: 📋 Prompt Actions
        // =========================================================================

        // 3.1 Show "Copy Prompt" Button on Image Overlays
        app.ui.settings.addSetting({
            id: "SaturnNodes.📋 Prompt Actions.01_EnableAssetsCopyPromptButton",
            name: "Show \"Copy Prompt\" Button on Images",
            type: "boolean",
            defaultValue: getInitialSetting("SaturnNodes.📋 Prompt Actions.01_EnableAssetsCopyPromptButton", true),
            tooltip: "Shows the 📋 'Copy Prompt' overlay action button when hovering over generated images in the Assets / History pane and preview nodes.",
        });

        // 3.2 Show Right-Click "Copy Prompt" Menu Action
        app.ui.settings.addSetting({
            id: "SaturnNodes.📋 Prompt Actions.02_EnableContextMenuCopyPrompt",
            name: "Show Right-Click \"Copy Prompt\" Menu Action",
            type: "boolean",
            defaultValue: getInitialSetting("SaturnNodes.📋 Prompt Actions.02_EnableContextMenuCopyPrompt", true),
            tooltip: "Adds '📋 Copy Prompt' to node right-click context menus.",
        });

        // 3.3 Show "Inspect Asset" (Zoom) Button on Image Overlays
        app.ui.settings.addSetting({
            id: "SaturnNodes.📋 Prompt Actions.04_EnableInspectAssetButton",
            name: "Show \"Inspect Asset\" (Zoom) Button on Images",
            type: "boolean",
            defaultValue: getInitialSetting("SaturnNodes.📋 Prompt Actions.04_EnableInspectAssetButton", false),
            tooltip: "Restores the 🔍 'Inspect asset' (zoom in) button directly on image cards in the Assets pane next to Download and Copy Prompt (moved behind the 3-dots menu in newer ComfyUI versions).",
        });

        // =========================================================================
        // GROUP: ⏸️ Pause Controls
        // =========================================================================

        // 4.1 Default Pause Queue State on Launch
        app.ui.settings.addSetting({
            id: "SaturnNodes.⏸️ Pause Controls.01_DefaultStateOnLaunch",
            name: "Default State on Launch",
            type: "combo",
            options: ["Running", "Paused"],
            defaultValue: getInitialSetting("SaturnNodes.⏸️ Pause Controls.01_DefaultStateOnLaunch", "Running"),
            tooltip: "Choose whether execution starts in Paused state or Running state on ComfyUI startup (default: Running).",
            onChange(value) {
                postSaturnNodesSettings({ default_pause_state: value });
            }
        });

        // 4.2 Default Pause Queue Mode on Launch
        app.ui.settings.addSetting({
            id: "SaturnNodes.⏸️ Pause Controls.02_DefaultPauseAction",
            name: "Default Pause Action",
            type: "combo",
            options: ["Finish Active Prompt", "Instant Resume Node"],
            defaultValue: getInitialSetting("SaturnNodes.⏸️ Pause Controls.02_DefaultPauseAction", "Finish Active Prompt"),
            tooltip: "Choose default pause behavior when the pause button or hotkey is triggered.",
            onChange(value) {
                const modeKey = (value === "Instant Resume Node" || value === "Pause (Instant)") ? "instantly" : "after_finish";
                postSaturnNodesSettings({ default_pause_mode: modeKey });
            }
        });

        // 4.3 Enable Pause Queue Toolbar Button
        app.ui.settings.addSetting({
            id: "SaturnNodes.⏸️ Pause Controls.03_EnableToolbarButton",
            name: "Enable Top Toolbar Button",
            type: "boolean",
            defaultValue: getInitialSetting("SaturnNodes.⏸️ Pause Controls.03_EnableToolbarButton", true),
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
            id: "SaturnNodes.⏸️ Pause Controls.04_ToolbarButtonUnpausedColor",
            name: "Toolbar Button Unpaused Color",
            type: "text",
            defaultValue: getInitialSetting("SaturnNodes.⏸️ Pause Controls.04_ToolbarButtonUnpausedColor", "#16a34a"),
            tooltip: "Hex color code for the Pause toolbar button when execution is unpaused/running (default: #16a34a).",
            onChange(value) {
                document.documentElement.style.setProperty("--pq-unpaused-color", value || "#16a34a");
            }
        });

        // 4.5 Toolbar Button Paused Color
        app.ui.settings.addSetting({
            id: "SaturnNodes.⏸️ Pause Controls.05_ToolbarButtonPausedColor",
            name: "Toolbar Button Paused Color",
            type: "text",
            defaultValue: getInitialSetting("SaturnNodes.⏸️ Pause Controls.05_ToolbarButtonPausedColor", "#ea580c"),
            tooltip: "Hex color code for the Pause toolbar button when execution is paused (default: #ea580c).",
            onChange(value) {
                document.documentElement.style.setProperty("--pq-paused-color", value || "#ea580c");
            }
        });

        // 4.6 Enable System Tray Icon
        app.ui.settings.addSetting({
            id: "SaturnNodes.⏸️ Pause Controls.06_EnableTrayIcon",
            name: "Enable System Tray Icon",
            type: "boolean",
            defaultValue: getInitialSetting("SaturnNodes.⏸️ Pause Controls.06_EnableTrayIcon", false),
            tooltip: "Displays an OS system tray icon with real-time queue status colors and outside-browser queue controls.",
            onChange(value) {
                postSaturnNodesSettings({ enable_tray_icon: value ? "true" : "false" });
            }
        });

        // 4.7 Allow Process Management (Restart / Shutdown)
        app.ui.settings.addSetting({
            id: "SaturnNodes.⏸️ Pause Controls.07_AllowProcessManagement",
            name: "Allow Process Management (Restart / Shutdown)",
            type: "boolean",
            defaultValue: getInitialSetting("SaturnNodes.⏸️ Pause Controls.07_AllowProcessManagement", false),
            tooltip: "Enables server restart and shutdown actions from the SaturnNodes power controls. Disabled by default for security.",
            onChange(value) {
                postSaturnNodesSettings({ enable_process_management: value ? "true" : "false" });
            }
        });

        // =========================================================================
        // GROUP: 💾 Persistent Queue
        // =========================================================================

        // 5.1 Enable Persistent Queue (Auto-Recovery)
        app.ui.settings.addSetting({
            id: "SaturnNodes.💾 Persistent Queue.01_EnablePersistentQueue",
            name: "Enable Persistent Queue (Auto-Recovery)",
            type: "boolean",
            defaultValue: getInitialSetting("SaturnNodes.💾 Persistent Queue.01_EnablePersistentQueue", true),
            tooltip: "Automatically persists unfinished batch queue items to disk and restores them after server or browser crashes.",
            onChange(value) {
                postSaturnNodesSettings({ enable_persistent_queue: value ? "true" : "false" });
            }
        });

        // 5.2 Persistent Queue Restored Launch State
        app.ui.settings.addSetting({
            id: "SaturnNodes.💾 Persistent Queue.02_RecoveryLaunchState",
            name: "Recovery Launch State",
            type: "combo",
            options: ["Match Default", "Force Paused", "Force Running"],
            defaultValue: getInitialSetting("SaturnNodes.💾 Persistent Queue.02_RecoveryLaunchState", "Match Default"),
            tooltip: "Override launch state when unfinished queue items are recovered on startup.",
            onChange(value) {
                postSaturnNodesSettings({ persistent_queue_restored_state: value });
            }
        });

        // =========================================================================
        // GROUP: 🖼️ Assets Restore
        // =========================================================================

        // 6.1 Enable Assets / History Restore on Launch
        app.ui.settings.addSetting({
            id: "SaturnNodes.🖼️ Assets Restore.01_RestoreAssetsOnLaunch",
            name: "Restore Assets on Launch",
            type: "boolean",
            defaultValue: getInitialSetting("SaturnNodes.🖼️ Assets Restore.01_RestoreAssetsOnLaunch", true),
            tooltip: "Automatically populates the Assets / History pane upon ComfyUI launch with your latest generated images.",
            onChange(value) {
                postSaturnNodesSettings({ enable_assets_restore: value ? "true" : "false" });
            }
        });

        // 6.2 Restored Assets Count
        app.ui.settings.addSetting({
            id: "SaturnNodes.🖼️ Assets Restore.02_RestoredAssetsCount",
            name: "Restored Assets Count",
            type: "number",
            defaultValue: getInitialSetting("SaturnNodes.🖼️ Assets Restore.02_RestoredAssetsCount", 64),
            tooltip: "Number of newest images from the output folder to restore into the Assets / History pane on launch (default: 64).",
            onChange(value) {
                const count = parseInt(value, 10) || 64;
                postSaturnNodesSettings({ restore_assets_count: count });
            }
        });

        // =========================================================================
        // GROUP: 🩺 Diagnostics
        // =========================================================================

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
            id: "SaturnNodes.🩺 Diagnostics.01_ExportDebugProfile",
            name: "Export Debug Profile",
            type: renderExportProfileBtn,
            render: renderExportProfileBtn,
            defaultValue: "📥 Export Debug Profile",
            tooltip: "Exports non-sensitive environment diagnostics (OS, Python, PyTorch, SaturnNodes settings, local counts) as a JSON file to share when troubleshooting issues.",
            attrs: {
                readOnly: true,
                style: "display: flex; justify-content: flex-end; width: 100%; border: none !important; background: transparent !important; padding: 0 !important; box-shadow: none !important;",
                onClick: handleExportProfile
            }
        });

        // =========================================================================
        // GROUP: 🎨 Batch Queue
        // =========================================================================

        // 8.1 Enable Batch Queue Grouping Lines
        app.ui.settings.addSetting({
            id: "SaturnNodes.🎨 Batch Queue.01_ShowBatchLines",
            name: "Show Batch Queue 1D Lines",
            type: "boolean",
            defaultValue: getInitialSetting("SaturnNodes.🎨 Batch Queue.01_ShowBatchLines", getInitialSetting("SaturnNodes.BatchQueue.Enabled", true)),
            tooltip: "Renders 1D git-graph style colored lines indicating batch groupings and contiguous segments on queued items."
        });

        // 8.2 Batch Graph Snapshot Guard
        app.ui.settings.addSetting({
            id: "SaturnNodes.🎨 Batch Queue.02_SnapshotGuard",
            name: "Batch Graph Snapshot Guard",
            type: "boolean",
            defaultValue: getInitialSetting("SaturnNodes.🎨 Batch Queue.02_SnapshotGuard", getInitialSetting("SaturnNodes.BatchQueue.SnapshotGuard", true)),
            tooltip: "When queueing multi-item batches, snapshots prompt and node inputs (like text and LoRAs) in the background so mid-queue canvas edits do not corrupt queued items. Random seeds continue to randomize."
        });

        // =========================================================================
        // GROUP: 🛡️ Security
        // =========================================================================

        // 9.1 Allow Local File Execution (Default Disabled)
        app.ui.settings.addSetting({
            id: "SaturnNodes.🛡️ Security.01_AllowLocalFileExecution",
            name: "Allow Local File Execution",
            type: "boolean",
            defaultValue: getInitialSetting("SaturnNodes.🛡️ Security.01_AllowLocalFileExecution", false),
            tooltip: "Controls whether the '🪐 ⚡ Run Local File' node is permitted to run executable files (.bat, .ps1, .exe, .sh). Disabled by default for operator security. When enabled, scripts are strictly confined to the 'ComfyUI/scripts/' directory. Execution is blocked if this setting is disabled or if the node is not interactively authorized.",
            onChange(value) {
                postSaturnNodesSettings({ enable_local_file_execution: value ? "true" : "false" });
            }
        });

        // =========================================================================
        // Automatically inject footer linking to GitHub, author profile, and README guide
        setupSettingsFooterObserver();
    }
});

/**
 * Injects a clean footer linking to GitHub, author profile, and settings reference
 * at the bottom of the SaturnNodes settings panel.
 */
function setupSettingsFooterObserver() {
    function injectFooterIfMissing() {
        const saturnItem = document.querySelector('[data-setting-id^="SaturnNodes.🛡️ Security"]') ||
                           document.querySelector('[data-setting-id^="SaturnNodes.9 - 🛡️ Security"]') ||
                           document.querySelector('[data-setting-id^="SaturnNodes."]');
        if (!saturnItem || !saturnItem.parentElement) return;

        const container = saturnItem.parentElement;
        if (container.querySelector(".saturnnodes-settings-footer")) return;

        const footer = document.createElement("div");
        footer.className = "saturnnodes-settings-footer";
        footer.style.cssText = `
            margin-top: 48px !important;
            padding: 20px 10px 10px;
            border-top: 1px solid rgba(255, 255, 255, 0.12);
            display: flex;
            align-items: center;
            justify-content: space-between;
            flex-wrap: wrap;
            gap: 14px;
            font-size: 12px;
            color: #a1a1aa;
            width: 100%;
            box-sizing: border-box;
        `;

        const githubSvg = `<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" style="display:inline-block; vertical-align:text-bottom; margin-right:4px;"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"></path></svg>`;

        footer.innerHTML = `
            <div style="display: flex; align-items: center; gap: 8px;">
                <span style="font-size: 16px;">🪐</span>
                <span style="font-weight: 600; color: #e4e4e7;">ComfyUI-SaturnNodes</span>
                <span style="font-size: 11px; padding: 2px 7px; border-radius: 4px; background: rgba(180, 140, 95, 0.18); color: #decbb2; border: 1px solid rgba(180, 140, 95, 0.35);">v2.3.2</span>
            </div>
            <div style="display: flex; align-items: center; gap: 10px; flex-wrap: wrap;">
                <a href="https://github.com/KOFiblto/ComfyUI-SaturnNodes" target="_blank" rel="noopener noreferrer" style="color: #decbb2; text-decoration: underline; text-decoration-color: rgba(222, 203, 178, 0.4); text-underline-offset: 3px; font-weight: 500; font-size: 12px; display: inline-flex; align-items: center; gap: 4px; padding: 4px 10px; border-radius: 6px; background: rgba(255, 255, 255, 0.05); border: 1px solid rgba(255, 255, 255, 0.12); transition: all 0.2s ease;" onmouseover="this.style.color='#ffffff'; this.style.background='rgba(255,255,255,0.12)'; this.style.borderColor='rgba(255,255,255,0.25)';" onmouseout="this.style.color='#decbb2'; this.style.background='rgba(255,255,255,0.05)'; this.style.borderColor='rgba(255,255,255,0.12)';">
                    ${githubSvg} Repository
                </a>
                <a href="https://github.com/KOFiblto" target="_blank" rel="noopener noreferrer" style="color: #decbb2; text-decoration: underline; text-decoration-color: rgba(222, 203, 178, 0.4); text-underline-offset: 3px; font-weight: 500; font-size: 12px; display: inline-flex; align-items: center; gap: 4px; padding: 4px 10px; border-radius: 6px; background: rgba(255, 255, 255, 0.05); border: 1px solid rgba(255, 255, 255, 0.12); transition: all 0.2s ease;" onmouseover="this.style.color='#ffffff'; this.style.background='rgba(255,255,255,0.12)'; this.style.borderColor='rgba(255,255,255,0.25)';" onmouseout="this.style.color='#decbb2'; this.style.background='rgba(255,255,255,0.05)'; this.style.borderColor='rgba(255,255,255,0.12)';">
                    ${githubSvg} Author (@KOFiblto)
                </a>
                <a href="https://github.com/KOFiblto/ComfyUI-SaturnNodes#%EF%B8%8F-comfyui-settings-menu-reference" target="_blank" rel="noopener noreferrer" style="color: #decbb2; text-decoration: underline; text-decoration-color: rgba(222, 203, 178, 0.4); text-underline-offset: 3px; font-weight: 500; font-size: 12px; display: inline-flex; align-items: center; gap: 4px; padding: 4px 10px; border-radius: 6px; background: rgba(255, 255, 255, 0.05); border: 1px solid rgba(255, 255, 255, 0.12); transition: all 0.2s ease;" onmouseover="this.style.color='#ffffff'; this.style.background='rgba(255,255,255,0.12)'; this.style.borderColor='rgba(255,255,255,0.25)';" onmouseout="this.style.color='#decbb2'; this.style.background='rgba(255,255,255,0.05)'; this.style.borderColor='rgba(255,255,255,0.12)';">
                    <span>📖</span> Settings Guide
                </a>
            </div>
        `;
        container.appendChild(footer);
    }

    try {
        const observer = new MutationObserver(() => {
            injectFooterIfMissing();
        });
        observer.observe(document.body, { childList: true, subtree: true });
    } catch (_) {}

    setInterval(injectFooterIfMissing, 1000);
}

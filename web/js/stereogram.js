import { app } from "/scripts/app.js";

/**
 * 🪐 SaturnNodes — Stereoscopic 3D & Live Viewer Extension
 *
 * Implements:
 * 1. SaturnStereo3D: Static 3D stereogram generator node.
 * 2. SaturnStereo3DLive: Interactive live 3D viewer node.
 *    - 1s countdown timer on slider/control changes.
 *    - Moving controls while rendering immediately interrupts active execution and restarts 1s countdown.
 *    - When countdown finishes with no further changes, automatically renders the new image.
 *    - Uses native ComfyUI preview and native asset inspection without custom modal hijacking.
 */

const COUNTDOWN_DELAY_MS = 1000; // 1 second countdown

/**
 * Sends interrupt to server to immediately stop any active execution.
 */
function interruptRendering() {
    try {
        fetch("/interrupt", { method: "POST" }).catch(() => {});
        if (window.api && typeof window.api.interrupt === "function") {
            window.api.interrupt();
        }
    } catch (_) {}
}

/**
 * Handles slider / widget adjustments on SaturnStereo3DLive:
 * - If currently rendering: immediately stops rendering and restarts 1s countdown.
 * - Starts a 1s countdown.
 * - If another change happens within 1s, resets the countdown.
 * - When 1s expires with no further changes, triggers prompt execution.
 */
function handleLiveWidgetChange(node) {
    // 1. If currently rendering, immediately abort active generation
    if (node._stereoIsRendering) {
        interruptRendering();
        node._stereoIsRendering = false;
    }

    // 2. Clear any existing timer or visual countdown interval
    if (node._stereoTimer) {
        clearTimeout(node._stereoTimer);
        node._stereoTimer = null;
    }
    if (node._stereoInterval) {
        clearInterval(node._stereoInterval);
        node._stereoInterval = null;
    }

    // 3. Start 1-second countdown
    const startTime = Date.now();
    node._stereoCountdownMs = COUNTDOWN_DELAY_MS;
    node.setDirtyCanvas(true, true);

    node._stereoInterval = setInterval(() => {
        const elapsed = Date.now() - startTime;
        const remaining = Math.max(0, COUNTDOWN_DELAY_MS - elapsed);
        node._stereoCountdownMs = remaining;
        node.setDirtyCanvas(true, true);

        if (remaining <= 0) {
            clearInterval(node._stereoInterval);
            node._stereoInterval = null;
        }
    }, 100);

    node._stereoTimer = setTimeout(() => {
        node._stereoTimer = null;
        if (node._stereoInterval) {
            clearInterval(node._stereoInterval);
            node._stereoInterval = null;
        }
        node._stereoCountdownMs = 0;
        node._stereoIsRendering = true;
        node.setDirtyCanvas(true, true);

        // Queue prompt execution in ComfyUI
        if (app && typeof app.queuePrompt === "function") {
            app.queuePrompt(0).then(() => {
                node._stereoIsRendering = false;
                node.setDirtyCanvas(true, true);
            }).catch((err) => {
                console.warn("[SaturnStereo3DLive] Execution notice:", err);
                node._stereoIsRendering = false;
                node.setDirtyCanvas(true, true);
            });
        } else {
            node._stereoIsRendering = false;
            node.setDirtyCanvas(true, true);
        }
    }, COUNTDOWN_DELAY_MS);
}

// Register the extension with ComfyUI
app.registerExtension({
    name: "ComfyUI.SaturnNodes.SaturnStereo3D",

    async beforeRegisterNodeDef(nodeType, nodeData) {
        const isStaticNode = nodeData.name === "SaturnStereo3D";
        const isLiveNode = nodeData.name === "SaturnStereo3DLive";

        if (!isStaticNode && !isLiveNode) return;

        const onNodeCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            if (onNodeCreated) onNodeCreated.apply(this, arguments);

            // Default dimensions
            if (!this.size || this.size[0] < 340) {
                this.size = isLiveNode ? [380, 560] : [360, 500];
            }

            // Only hook live debounced auto-rendering for SaturnStereo3DLive
            if (isLiveNode) {
                const targetWidgets = [
                    "depth_intensity",
                    "depth_gamma",
                    "invert_depth",
                    "convergence_plane",
                    "image_zoom",
                    "pan_horizontal",
                    "pan_vertical",
                    "gap_spacing",
                    "outer_border",
                    "alignment_dots",
                    "fill_method",
                    "mode",
                    "preview_zoom"
                ];

                const node = this;
                for (const wName of targetWidgets) {
                    const widget = this.widgets?.find(w => w.name === wName);
                    if (widget) {
                        const origCallback = widget.callback;
                        widget.callback = function (value, ...args) {
                            // Ensure numeric and boolean values are preserved without corruption
                            if (value !== undefined && !Number.isNaN(value)) {
                                this.value = value;
                            }
                            if (origCallback) {
                                origCallback.call(this, value, ...args);
                            }
                            node.setDirtyCanvas(true, true);
                            handleLiveWidgetChange(node);
                        };
                    }
                }
            }
        };

        // When node finishes execution in ComfyUI, reset rendering status
        const onExecuted = nodeType.prototype.onExecuted;
        nodeType.prototype.onExecuted = function (message) {
            if (onExecuted) onExecuted.apply(this, arguments);
            this._stereoIsRendering = false;
            this._stereoCountdownMs = 0;
            if (this._stereoInterval) {
                clearInterval(this._stereoInterval);
                this._stereoInterval = null;
            }
            this.setDirtyCanvas(true, true);
        };

        // Canvas foreground overlay: draw clean countdown & rendering badges
        const onDrawForeground = nodeType.prototype.onDrawForeground;
        nodeType.prototype.onDrawForeground = function (ctx) {
            if (onDrawForeground) onDrawForeground.apply(this, arguments);
            if (this.flags?.collapsed) return;

            if (isLiveNode) {
                ctx.save();
                ctx.font = "bold 11px Inter, system-ui, sans-serif";
                ctx.textAlign = "right";

                if (this._stereoCountdownMs > 0) {
                    const sec = (this._stereoCountdownMs / 1000).toFixed(1);
                    ctx.fillStyle = "#f59e0b"; // warm amber
                    ctx.fillText(`⏳ Re-rendering in ${sec}s...`, this.size[0] - 12, this.size[1] - 12);
                } else if (this._stereoIsRendering) {
                    ctx.fillStyle = "#38bdf8"; // bright sky blue
                    ctx.fillText("🔄 Rendering 3D...", this.size[0] - 12, this.size[1] - 12);
                }

                ctx.restore();
            }
        };
    }
});

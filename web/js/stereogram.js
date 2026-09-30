import { app } from "/scripts/app.js";

/**
 * 🪐 SaturnNodes — Stereoscopic 3D & Live Viewer Extension
 *
 * Implements:
 * 1. SaturnStereo3D: Static high-precision 3D stereogram generator.
 * 2. SaturnStereo3DLive: Interactive 3D viewer featuring:
 *    - 500ms (0.5s) debounced auto-rendering on slider/widget changes.
 *    - ComfyUI native lightbox inspect modal (~80% fullscreen).
 *    - In-modal live sliders, cross-eye alignment guides, and mode swap.
 *    - Downstream IMAGE tensor output.
 */

const DEBOUNCE_DELAY_MS = 500; // 0.5s debounce of no changes before rendering

// Track active lightbox modal instance
let activeLightboxOverlay = null;

/**
 * Helper to obtain the current preview image source URL from a node.
 */
function getNodeImageSrc(node) {
    if (!node) return null;

    // 1. Direct LiteGraph imgs cache
    if (node.imgs && node.imgs.length > 0) {
        const idx = node.imageIndex ?? 0;
        const img = node.imgs[idx] || node.imgs[0];
        if (img && img.src) return img.src;
    }

    // 2. DOM inspection for ComfyUI Frontend V2 elements
    if (node.id !== undefined) {
        const domNode = document.querySelector(`[data-node-id="${node.id}"]`);
        if (domNode) {
            const img = domNode.querySelector("img");
            if (img && img.src) return img.src;
        }
    }

    return null;
}

/**
 * Opens the native-styled ~80% fullscreen Lightbox Modal for stereoscopic viewing.
 */
function openStereoLightbox(node) {
    if (activeLightboxOverlay) {
        closeStereoLightbox();
    }

    const currentSrc = getNodeImageSrc(node);
    const modeWidget = node.widgets?.find(w => w.name === "mode");
    const mode = modeWidget ? modeWidget.value : "Cross-Eye";

    // Overlay backdrop
    const overlay = document.createElement("div");
    overlay.className = "saturn-stereo-lightbox-overlay";
    overlay.style.cssText = `
        position: fixed;
        inset: 0;
        background: rgba(0, 0, 0, 0.88);
        backdrop-filter: blur(12px);
        -webkit-backdrop-filter: blur(12px);
        z-index: 100000;
        display: flex;
        align-items: center;
        justify-content: center;
        opacity: 0;
        transition: opacity 0.2s ease-out;
        font-family: Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        color: #f4f4f5;
        user-select: none;
    `;

    // Modal dialog container (~80-85% of viewport)
    const modal = document.createElement("div");
    modal.className = "saturn-stereo-lightbox-modal p-dialog comfy-modal";
    modal.style.cssText = `
        width: 85vw;
        height: 85vh;
        max-width: 1600px;
        max-height: 980px;
        background: #121215;
        border: 1px solid rgba(222, 203, 178, 0.25);
        border-radius: 14px;
        box-shadow: 0 25px 60px rgba(0, 0, 0, 0.85), 0 0 35px rgba(222, 203, 178, 0.08);
        display: flex;
        flex-direction: column;
        overflow: hidden;
        transform: scale(0.97);
        transition: transform 0.2s cubic-bezier(0.16, 1, 0.3, 1);
    `;

    // Header bar
    const header = document.createElement("div");
    header.style.cssText = `
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 12px 18px;
        background: rgba(24, 24, 28, 0.95);
        border-bottom: 1px solid rgba(255, 255, 255, 0.08);
        gap: 12px;
        flex-shrink: 0;
    `;

    const titleGroup = document.createElement("div");
    titleGroup.style.cssText = "display: flex; align-items: center; gap: 10px;";

    const titleText = document.createElement("span");
    titleText.textContent = "🪐 SaturnNodes — Stereoscopic 3D Lightbox";
    titleText.style.cssText = "font-weight: 600; font-size: 14px; color: #decbb2;";

    const modeBadge = document.createElement("span");
    modeBadge.textContent = mode;
    modeBadge.style.cssText = `
        font-size: 11px;
        font-weight: 500;
        padding: 3px 8px;
        border-radius: 9999px;
        background: rgba(222, 203, 178, 0.15);
        color: #e4d5c3;
        border: 1px solid rgba(222, 203, 178, 0.3);
    `;

    const statusBadge = document.createElement("span");
    statusBadge.className = "saturn-lightbox-status";
    statusBadge.textContent = "";
    statusBadge.style.cssText = "font-size: 11px; color: #a1a1aa; margin-left: 6px;";

    titleGroup.appendChild(titleText);
    titleGroup.appendChild(modeBadge);
    titleGroup.appendChild(statusBadge);

    // Actions in Header
    const actionGroup = document.createElement("div");
    actionGroup.style.cssText = "display: flex; align-items: center; gap: 8px;";

    const swapBtn = document.createElement("button");
    swapBtn.textContent = "🔀 Swap Mode";
    swapBtn.title = "Toggle Cross-Eye / Parallel View";
    swapBtn.style.cssText = `
        padding: 6px 12px;
        font-size: 12px;
        font-weight: 500;
        background: rgba(255, 255, 255, 0.08);
        color: #f4f4f5;
        border: 1px solid rgba(255, 255, 255, 0.15);
        border-radius: 6px;
        cursor: pointer;
        transition: all 0.15s ease;
    `;
    swapBtn.onmouseover = () => swapBtn.style.background = "rgba(255, 255, 255, 0.15)";
    swapBtn.onmouseout = () => swapBtn.style.background = "rgba(255, 255, 255, 0.08)";
    swapBtn.onclick = () => {
        if (modeWidget) {
            if (modeWidget.value === "Cross-Eye") {
                modeWidget.value = "Parallel (Wall-Eyed)";
            } else if (modeWidget.value === "Parallel (Wall-Eyed)") {
                modeWidget.value = "Cross-Eye";
            }
            modeBadge.textContent = modeWidget.value;
            node.setDirtyCanvas(true, true);
            triggerDebouncedRender(node, statusBadge);
        }
    };

    const invertBtn = document.createElement("button");
    invertBtn.textContent = "🔄 Invert Depth";
    invertBtn.title = "Invert Near and Far disparity";
    invertBtn.style.cssText = swapBtn.style.cssText;
    invertBtn.onmouseover = () => invertBtn.style.background = "rgba(255, 255, 255, 0.15)";
    invertBtn.onmouseout = () => invertBtn.style.background = "rgba(255, 255, 255, 0.08)";
    invertBtn.onclick = () => {
        const invWidget = node.widgets?.find(w => w.name === "invert_depth");
        if (invWidget) {
            invWidget.value = !invWidget.value;
            node.setDirtyCanvas(true, true);
            triggerDebouncedRender(node, statusBadge);
        }
    };

    const fsBtn = document.createElement("button");
    fsBtn.textContent = "⛶ Fullscreen";
    fsBtn.title = "Toggle True Fullscreen View";
    fsBtn.style.cssText = swapBtn.style.cssText;
    fsBtn.onmouseover = () => fsBtn.style.background = "rgba(255, 255, 255, 0.15)";
    fsBtn.onmouseout = () => fsBtn.style.background = "rgba(255, 255, 255, 0.08)";
    fsBtn.onclick = () => {
        if (!document.fullscreenElement) {
            modal.requestFullscreen?.().catch(() => {});
        } else {
            document.exitFullscreen?.().catch(() => {});
        }
    };

    const closeBtn = document.createElement("button");
    closeBtn.textContent = "✕";
    closeBtn.title = "Close (Esc)";
    closeBtn.style.cssText = `
        padding: 5px 10px;
        font-size: 15px;
        font-weight: 600;
        background: transparent;
        color: #a1a1aa;
        border: none;
        border-radius: 6px;
        cursor: pointer;
        transition: color 0.15s ease, background 0.15s ease;
    `;
    closeBtn.onmouseover = () => {
        closeBtn.style.color = "#ffffff";
        closeBtn.style.background = "rgba(239, 68, 68, 0.25)";
    };
    closeBtn.onmouseout = () => {
        closeBtn.style.color = "#a1a1aa";
        closeBtn.style.background = "transparent";
    };
    closeBtn.onclick = closeStereoLightbox;

    actionGroup.appendChild(swapBtn);
    actionGroup.appendChild(invertBtn);
    actionGroup.appendChild(fsBtn);
    actionGroup.appendChild(closeBtn);

    header.appendChild(titleGroup);
    header.appendChild(actionGroup);

    // Main viewing area (image container)
    const imageContainer = document.createElement("div");
    imageContainer.className = "saturn-lightbox-img-container";
    imageContainer.style.cssText = `
        flex: 1;
        min-height: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        background: #09090b;
        position: relative;
        padding: 16px;
        overflow: hidden;
    `;

    const imgEl = document.createElement("img");
    imgEl.className = "saturn-lightbox-img";
    imgEl.style.cssText = `
        max-width: 100%;
        max-height: 100%;
        object-fit: contain;
        border-radius: 4px;
        box-shadow: 0 10px 30px rgba(0, 0, 0, 0.6);
        image-rendering: high-quality;
        display: ${currentSrc ? "block" : "none"};
    `;
    if (currentSrc) imgEl.src = currentSrc;

    const placeholder = document.createElement("div");
    placeholder.style.cssText = `
        display: ${currentSrc ? "none" : "flex"};
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 12px;
        color: #71717a;
        font-size: 14px;
    `;
    placeholder.innerHTML = `
        <span style="font-size: 36px;">👓</span>
        <span>No stereogram rendered yet.</span>
        <span style="font-size: 12px; color: #52525b;">Run the queue or adjust a slider to generate the 3D preview.</span>
    `;

    imageContainer.appendChild(imgEl);
    imageContainer.appendChild(placeholder);

    // Interactive slider dock at the bottom of the lightbox
    const controlDock = document.createElement("div");
    controlDock.style.cssText = `
        padding: 12px 20px;
        background: rgba(18, 18, 22, 0.98);
        border-top: 1px solid rgba(255, 255, 255, 0.08);
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: space-between;
        gap: 16px;
        flex-shrink: 0;
    `;

    // Sliders container
    const slidersWrap = document.createElement("div");
    slidersWrap.style.cssText = "display: flex; flex-wrap: wrap; align-items: center; gap: 20px;";

    function createDockSlider(label, widgetName, min, max, step, formatFn) {
        const widget = node.widgets?.find(w => w.name === widgetName);
        if (!widget) return null;

        const group = document.createElement("div");
        group.style.cssText = "display: flex; align-items: center; gap: 8px; font-size: 12px;";

        const lbl = document.createElement("span");
        lbl.textContent = label;
        lbl.style.cssText = "color: #a1a1aa; font-weight: 500;";

        const slider = document.createElement("input");
        slider.type = "range";
        slider.min = min;
        slider.max = max;
        slider.step = step;
        slider.value = widget.value;
        slider.style.cssText = `
            width: 110px;
            accent-color: #decbb2;
            cursor: pointer;
        `;

        const valSpan = document.createElement("span");
        valSpan.textContent = formatFn ? formatFn(slider.value) : slider.value;
        valSpan.style.cssText = "color: #f4f4f5; font-family: monospace; min-width: 32px;";

        slider.oninput = () => {
            const numVal = parseFloat(slider.value);
            widget.value = numVal;
            valSpan.textContent = formatFn ? formatFn(slider.value) : slider.value;
            node.setDirtyCanvas(true, true);
            triggerDebouncedRender(node, statusBadge);
        };

        group.appendChild(lbl);
        group.appendChild(slider);
        group.appendChild(valSpan);
        return group;
    }

    const intensitySlider = createDockSlider("Depth", "depth_intensity", 0, 100, 1, v => `${v}%`);
    const gammaSlider = createDockSlider("Gamma", "depth_gamma", 0.1, 2.0, 0.05, v => parseFloat(v).toFixed(2));
    const gapSlider = createDockSlider("Gap", "gap_spacing", 0, 200, 2, v => `${v}px`);
    const zoomSlider = createDockSlider("Zoom", "image_zoom", 50, 200, 5, v => `${v}%`);

    if (intensitySlider) slidersWrap.appendChild(intensitySlider);
    if (gammaSlider) slidersWrap.appendChild(gammaSlider);
    if (gapSlider) slidersWrap.appendChild(gapSlider);
    if (zoomSlider) slidersWrap.appendChild(zoomSlider);

    // Render Now button inside lightbox
    const renderNowBtn = document.createElement("button");
    renderNowBtn.textContent = "⚡ Render Now";
    renderNowBtn.title = "Immediately execute prompt without waiting";
    renderNowBtn.style.cssText = `
        padding: 6px 14px;
        font-size: 12px;
        font-weight: 600;
        background: #decbb2;
        color: #1c1917;
        border: none;
        border-radius: 6px;
        cursor: pointer;
        transition: opacity 0.15s ease;
    `;
    renderNowBtn.onmouseover = () => renderNowBtn.style.opacity = "0.9";
    renderNowBtn.onmouseout = () => renderNowBtn.style.opacity = "1.0";
    renderNowBtn.onclick = () => {
        if (app.queuePrompt) {
            statusBadge.textContent = "🔄 Rendering...";
            app.queuePrompt(0).finally(() => {
                setTimeout(() => {
                    statusBadge.textContent = "";
                    updateLightboxImage(node);
                }, 400);
            });
        }
    };

    controlDock.appendChild(slidersWrap);
    controlDock.appendChild(renderNowBtn);

    // Viewing tip footer
    const footer = document.createElement("div");
    footer.style.cssText = `
        padding: 6px 18px;
        background: #0d0d10;
        border-top: 1px solid rgba(255, 255, 255, 0.05);
        display: flex;
        justify-content: space-between;
        align-items: center;
        font-size: 11px;
        color: #71717a;
    `;
    footer.innerHTML = `
        <span>👁️ <strong>Cross-Eye Tip:</strong> Look gently cross-eyed until the two center panels overlap into a single 3D image. Relax your eyes.</span>
        <span>Esc or click backdrop to close</span>
    `;

    modal.appendChild(header);
    modal.appendChild(imageContainer);
    modal.appendChild(controlDock);
    modal.appendChild(footer);

    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    activeLightboxOverlay = overlay;

    // Fade-in transition
    requestAnimationFrame(() => {
        overlay.style.opacity = "1";
        modal.style.transform = "scale(1)";
    });

    // Close on backdrop click (outside modal)
    overlay.addEventListener("click", (e) => {
        if (e.target === overlay) {
            closeStereoLightbox();
        }
    });

    // Close on Escape key
    const onKeyDown = (e) => {
        if (e.key === "Escape") {
            closeStereoLightbox();
            document.removeEventListener("keydown", onKeyDown);
        }
    };
    document.addEventListener("keydown", onKeyDown);
}

/**
 * Closes the active Lightbox Modal with exit transition.
 */
function closeStereoLightbox() {
    if (!activeLightboxOverlay) return;
    const overlay = activeLightboxOverlay;
    activeLightboxOverlay = null;

    overlay.style.opacity = "0";
    const modal = overlay.querySelector(".saturn-stereo-lightbox-modal");
    if (modal) modal.style.transform = "scale(0.97)";

    setTimeout(() => {
        if (overlay.parentElement) {
            overlay.parentElement.removeChild(overlay);
        }
    }, 200);
}

/**
 * Updates the image inside an open Lightbox Modal when a new render completes.
 */
function updateLightboxImage(node) {
    if (!activeLightboxOverlay) return;
    const imgEl = activeLightboxOverlay.querySelector(".saturn-lightbox-img");
    const placeholder = activeLightboxOverlay.querySelector(".saturn-lightbox-img-container > div:last-child");
    const src = getNodeImageSrc(node);

    if (src && imgEl) {
        imgEl.src = src;
        imgEl.style.display = "block";
        if (placeholder) placeholder.style.display = "none";
    }
}

// Global debouncing timer for slider changes
let debounceTimer = null;

/**
 * Schedules a render after DEBOUNCE_DELAY_MS (500ms) of inactivity.
 */
function triggerDebouncedRender(node, statusTarget) {
    const autoWidget = node.widgets?.find(w => w.name === "live_auto_render");
    const isAutoEnabled = autoWidget ? autoWidget.value : true;

    if (debounceTimer) {
        clearTimeout(debounceTimer);
    }

    if (!isAutoEnabled) {
        if (statusTarget) statusTarget.textContent = "⏸️ Live auto-render paused";
        return;
    }

    if (statusTarget) {
        statusTarget.textContent = "⏳ Debouncing (0.5s)...";
    }
    node._isStereoDebouncing = true;
    node.setDirtyCanvas(true, true);

    debounceTimer = setTimeout(() => {
        debounceTimer = null;
        node._isStereoDebouncing = false;
        node._isStereoRendering = true;
        if (statusTarget) statusTarget.textContent = "🔄 Rendering...";
        node.setDirtyCanvas(true, true);

        if (app.queuePrompt) {
            app.queuePrompt(0).then(() => {
                node._isStereoRendering = false;
                node.setDirtyCanvas(true, true);
                if (statusTarget) statusTarget.textContent = "✅ Updated";
                setTimeout(() => {
                    if (statusTarget && statusTarget.textContent === "✅ Updated") {
                        statusTarget.textContent = "";
                    }
                }, 2000);
                updateLightboxImage(node);
            }).catch((err) => {
                console.warn("[SaturnStereo3D] Auto-render notice:", err);
                node._isStereoRendering = false;
                if (statusTarget) statusTarget.textContent = "❌ Error";
                node.setDirtyCanvas(true, true);
            });
        }
    }, DEBOUNCE_DELAY_MS);
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
                this.size = isLiveNode ? [380, 620] : [360, 560];
            }

            // 1. Button: Open in Native-styled Lightbox Modal (~80% fullscreen)
            const lightboxBtn = this.addWidget("button", "🔍 Open in Lightbox (~80%)", null, () => {
                openStereoLightbox(this);
            });
            lightboxBtn.serialize = false;

            // 2. Button: Swap Cross-Eye <-> Parallel (Wall-Eyed)
            const swapBtn = this.addWidget("button", "🔀 Swap Cross-Eye / Parallel", null, () => {
                const modeWidget = this.widgets?.find(w => w.name === "mode");
                if (modeWidget) {
                    if (modeWidget.value === "Cross-Eye") {
                        modeWidget.value = "Parallel (Wall-Eyed)";
                    } else if (modeWidget.value === "Parallel (Wall-Eyed)") {
                        modeWidget.value = "Cross-Eye";
                    }
                    this.setDirtyCanvas(true, true);
                    if (isLiveNode) triggerDebouncedRender(this);
                }
            });
            swapBtn.serialize = false;

            // 3. Button: Invert Depth quick toggle
            const invertBtn = this.addWidget("button", "🔄 Invert Near / Far Depth", null, () => {
                const invWidget = this.widgets?.find(w => w.name === "invert_depth");
                if (invWidget) {
                    invWidget.value = !invWidget.value;
                    this.setDirtyCanvas(true, true);
                    if (isLiveNode) triggerDebouncedRender(this);
                }
            });
            invertBtn.serialize = false;

            // 4. For Live node: Immediate Render Now button
            if (isLiveNode) {
                const renderBtn = this.addWidget("button", "⚡ Render Now", null, () => {
                    if (app.queuePrompt) {
                        this._isStereoRendering = true;
                        this.setDirtyCanvas(true, true);
                        app.queuePrompt(0).finally(() => {
                            this._isStereoRendering = false;
                            this.setDirtyCanvas(true, true);
                            updateLightboxImage(this);
                        });
                    }
                });
                renderBtn.serialize = false;

                // Hook slider widgets for 500ms debounced live rendering
                const targetWidgets = [
                    "depth_intensity",
                    "depth_gamma",
                    "convergence_plane",
                    "image_zoom",
                    "pan_horizontal",
                    "pan_vertical",
                    "gap_spacing",
                    "outer_border",
                    "alignment_dots",
                    "fill_method",
                    "mode",
                    "invert_depth"
                ];

                for (const wName of targetWidgets) {
                    const widget = this.widgets?.find(w => w.name === wName);
                    if (widget) {
                        const origCallback = widget.callback;
                        widget.callback = (val) => {
                            if (origCallback) origCallback.apply(widget, arguments);
                            this.setDirtyCanvas(true, true);
                            triggerDebouncedRender(this);
                        };
                    }
                }
            }
        };

        // Double-click on node opens the Lightbox Modal (~80% fullscreen)
        const onDblClick = nodeType.prototype.onDblClick;
        nodeType.prototype.onDblClick = function (e, pos) {
            if (onDblClick) onDblClick.apply(this, arguments);
            openStereoLightbox(this);
        };

        // When node finishes execution in ComfyUI, update lightbox if open
        const onExecuted = nodeType.prototype.onExecuted;
        nodeType.prototype.onExecuted = function (message) {
            if (onExecuted) onExecuted.apply(this, arguments);
            this._isStereoRendering = false;
            this.setDirtyCanvas(true, true);
            updateLightboxImage(this);
        };

        // Canvas foreground overlay: draw status badges & viewing mode hints
        const onDrawForeground = nodeType.prototype.onDrawForeground;
        nodeType.prototype.onDrawForeground = function (ctx) {
            if (onDrawForeground) onDrawForeground.apply(this, arguments);
            if (this.flags?.collapsed) return;

            const modeWidget = this.widgets?.find(w => w.name === "mode");
            const mode = modeWidget ? modeWidget.value : "Cross-Eye";

            ctx.save();
            ctx.font = "10px Inter, system-ui, sans-serif";
            ctx.textAlign = "right";

            // If debouncing or rendering, draw visual badge in amber/cyan
            if (this._isStereoDebouncing) {
                ctx.fillStyle = "rgba(251, 191, 36, 0.9)";
                ctx.fillText("⏳ Debouncing (0.5s)...", this.size[0] - 12, this.size[1] - 22);
            } else if (this._isStereoRendering) {
                ctx.fillStyle = "rgba(56, 189, 248, 0.9)";
                ctx.fillText("🔄 Rendering 3D...", this.size[0] - 12, this.size[1] - 22);
            }

            // Mode hint
            ctx.fillStyle = "rgba(222, 203, 178, 0.45)";
            let hint = "👁️ Cross-Eye (Left looks at Right)";
            if (mode === "Parallel (Wall-Eyed)" || mode === "Side-by-Side (Parallel)") {
                hint = "👀 Parallel View (Left looks at Left)";
            } else if (mode === "Red-Cyan Anaglyph") {
                hint = "🕶️ Red-Cyan 3D Glasses";
            } else if (mode === "Top-Bottom (Over-Under)") {
                hint = "↕️ Over / Under (3D TV / VR)";
            }

            ctx.fillText(hint, this.size[0] - 12, this.size[1] - 8);
            ctx.restore();
        };
    }
});

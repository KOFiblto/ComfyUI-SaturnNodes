import { app } from "/scripts/app.js";
import { api } from "/scripts/api.js";

app.registerExtension({
    name: "ComfyUI.LeafFlow.PreviewImageSizeAspectRatio",

    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name !== "PreviewImageSizeAspectRatio" && nodeData.name !== "TextAspectRatioFinder") return;

        if (nodeData.name === "PreviewImageSizeAspectRatio") {
            const onNodeCreated = nodeType.prototype.onNodeCreated;
            nodeType.prototype.onNodeCreated = function() {
                if (onNodeCreated) onNodeCreated.apply(this, arguments);

                // STRICTLY REMOVE ALL OUTPUT SLOTS (Once on node creation)
                this.outputs = [];
                if (this.outputs) this.outputs.length = 0;

                this.aspect_ratio_data = {
                    ratio: 1.0,
                    display_text: "1 x 1"
                };

                // Minimum size set to [230, 160] to accommodate 5-digit labels on left and right margins cleanly
                this.size = [240, 240];
                this.min_size = [230, 160];
                this.resizable = true;

                // PERMANENTLY UNLOCK ASPECT RATIO RESIZING
                Object.defineProperty(this, "aspect_ratio", {
                    get() { return false; },
                    set(v) {},
                    configurable: true
                });

                // DOM Container for ComfyUI V2 Vue UI
                const viewContainer = document.createElement("div");
                viewContainer.className = "leafflow-ar-preview-container";
                viewContainer.style.width = "100%";
                viewContainer.style.height = "calc(100% - 110px)";
                viewContainer.style.minHeight = "80px";
                viewContainer.style.display = "flex";
                viewContainer.style.alignItems = "center";
                viewContainer.style.justifyContent = "center";
                // Equal 65px left and right padding for horizontal balance
                viewContainer.style.padding = "10px 65px 35px 65px";
                viewContainer.style.boxSizing = "border-box";
                viewContainer.style.pointerEvents = "none";
                viewContainer.style.position = "relative";
                viewContainer.style.overflow = "hidden";

                viewContainer.innerHTML = `
                    <div class="ar-box-wrapper" style="position: relative; display: flex; align-items: center; justify-content: center; width: 50px; height: 50px; transition: none !important;">
                        <svg class="ar-box-svg" style="position: absolute; top: 0; left: 0; display: block; overflow: visible; pointer-events: none; transition: none !important;" width="50" height="50" viewBox="0 0 50 50">
                            <path class="ar-crop-path" d="" stroke="#ffffff" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round" fill="none" style="transition: none !important;"/>
                        </svg>
                        <div class="ar-label-height" style="position: absolute; right: 100%; margin-right: 8px; top: 50%; transform: translateY(-50%); font-size: 13px; font-weight: 700; color: #ffffff; font-family: Inter, system-ui, sans-serif; white-space: nowrap;">1</div>
                        <div class="ar-label-width" style="position: absolute; top: 100%; margin-top: 8px; left: 50%; transform: translateX(-50%); font-size: 13px; font-weight: 700; color: #ffffff; font-family: Inter, system-ui, sans-serif; white-space: nowrap;">1</div>
                    </div>
                `;

                this._last_render_cache = "";

                this.updateDomPreview = function() {
                    if (!viewContainer) return;
                    const data = this.aspect_ratio_data || { ratio: 1.0, display_text: "1 x 1" };
                    const ratio = Math.max(0.05, Math.min(20.0, data.ratio || 1.0));

                    let partW = "1";
                    let partH = "1";

                    if (data.display_text) {
                        const str = String(data.display_text).trim();
                        if (str.includes(" x ")) {
                            const parts = str.split(" x ");
                            partW = parts[0];
                            partH = parts[1] || "";
                        } else if (str.includes("x")) {
                            const parts = str.split("x");
                            partW = parts[0];
                            partH = parts[1] || "";
                        } else if (str.includes(":")) {
                            const parts = str.split(":");
                            partW = parts[0];
                            partH = parts[1] || "";
                        } else {
                            partW = str;
                            partH = "";
                        }
                    }

                    const widthEl = viewContainer.querySelector(".ar-label-width");
                    const heightEl = viewContainer.querySelector(".ar-label-height");
                    const boxWrapper = viewContainer.querySelector(".ar-box-wrapper");
                    const svgEl = viewContainer.querySelector(".ar-box-svg");
                    const pathEl = viewContainer.querySelector(".ar-crop-path");

                    if (widthEl) widthEl.innerText = partW;
                    if (heightEl) heightEl.innerText = partH;

                    if (boxWrapper && svgEl && pathEl) {
                        const availW = Math.max(20, (this.size[0] || 240) - 130);
                        const availH = Math.max(20, (this.size[1] || 240) - 150);

                        let w, h;
                        if (ratio >= availW / availH) {
                            w = availW;
                            h = availW / ratio;
                        } else {
                            h = availH;
                            w = availH * ratio;
                        }

                        w = Math.round(w);
                        h = Math.round(h);

                        const cacheKey = `${w}_${h}_${partW}_${partH}`;
                        if (this._last_render_cache === cacheKey) return;
                        this._last_render_cache = cacheKey;

                        boxWrapper.style.width = `${w}px`;
                        boxWrapper.style.height = `${h}px`;

                        svgEl.setAttribute("width", w);
                        svgEl.setAttribute("height", h);
                        svgEl.setAttribute("viewBox", `0 0 ${w} ${h}`);

                        const cX = w * 0.20;
                        const cY = h * 0.20;
                        const r = Math.min(12, Math.min(cX, cY) * 0.5);

                        const d = `M 0,${cY} L 0,${r} A ${r} ${r} 0 0 1 ${r},0 L ${cX},0 ` +
                                `M ${w - cX},0 L ${w - r},0 A ${r} ${r} 0 0 1 ${w},${r} L ${w},${cY} ` +
                                `M 0,${h - cY} L 0,${h - r} A ${r} ${r} 0 0 0 ${r},${h} L ${cX},${h} ` +
                                `M ${w - cX},${h} L ${w - r},${h} A ${r} ${r} 0 0 0 ${w},${h - r} L ${w},${h - cY} ` +
                                `M ${w * 0.40},0 L ${w * 0.60},0 ` +
                                `M ${w * 0.40},${h} L ${w * 0.60},${h} ` +
                                `M 0,${h * 0.40} L 0,${h * 0.60} ` +
                                `M ${w},${h * 0.40} L ${w},${h * 0.60}`;

                        pathEl.setAttribute("d", d);
                    }
                };

                this.addDOMWidget("ar_preview_display", "HTML", viewContainer, {
                    getValue() { return ""; },
                    setValue(val) {},
                    serialize: false,
                    computeSize() { return [100, 80]; }
                });

                // Canvas drawing fallback for LiteGraph (Classic V1)
                const origOnDrawForeground = this.onDrawForeground;
                this.onDrawForeground = function(ctx) {
                    if (origOnDrawForeground) origOnDrawForeground.apply(this, arguments);
                    if (this.flags?.collapsed) return;

                    // HIGH-PERFORMANCE OPTIMIZATION:
                    // If HTML DOM widget is active in document (Vue UI / V2), skip duplicate canvas drawing!
                    if (viewContainer && viewContainer.isConnected && viewContainer.offsetParent !== null) {
                        return;
                    }

                    const data = this.aspect_ratio_data || { ratio: 1.0, display_text: "1 x 1" };
                    const ratio = Math.max(0.05, Math.min(20.0, data.ratio || 1.0));

                    let partW = "1";
                    let partH = "1";
                    if (data.display_text) {
                        const str = String(data.display_text).trim();
                        if (str.includes(" x ")) {
                            const parts = str.split(" x ");
                            partW = parts[0];
                            partH = parts[1] || "";
                        } else if (str.includes("x")) {
                            const parts = str.split("x");
                            partW = parts[0];
                            partH = parts[1] || "";
                        } else if (str.includes(":")) {
                            const parts = str.split(":");
                            partW = parts[0];
                            partH = parts[1] || "";
                        } else {
                            partW = str;
                            partH = "";
                        }
                    }

                    ctx.save();

                    const startY = 30 + (this.inputs ? this.inputs.length * 20 : 80);

                    const marginLeft = 65;
                    const marginRight = 65;
                    const marginTop = startY + 10;
                    const marginBottom = 35;

                    const availW = Math.max(20, this.size[0] - marginLeft - marginRight);
                    const availH = Math.max(20, this.size[1] - marginTop - marginBottom);

                    let boxW, boxH;
                    if (ratio >= availW / availH) {
                        boxW = availW;
                        boxH = availW / ratio;
                    } else {
                        boxH = availH;
                        boxW = availH * ratio;
                    }

                    const boxX = marginLeft + (availW - boxW) / 2;
                    const boxY = marginTop + (availH - boxH) / 2;

                    const cX = boxW * 0.20;
                    const cY = boxH * 0.20;
                    const r = Math.min(12, Math.min(cX, cY) * 0.5);

                    ctx.strokeStyle = "#ffffff";
                    ctx.lineWidth = 2.8;
                    ctx.lineCap = "round";
                    ctx.lineJoin = "round";
                    ctx.beginPath();

                    // Top-Left Corner
                    ctx.moveTo(boxX, boxY + cY);
                    ctx.lineTo(boxX, boxY + r);
                    ctx.arcTo(boxX, boxY, boxX + r, boxY, r);
                    ctx.lineTo(boxX + cX, boxY);

                    // Top-Right Corner
                    ctx.moveTo(boxX + boxW - cX, boxY);
                    ctx.lineTo(boxX + boxW - r, boxY);
                    ctx.arcTo(boxX + boxW, boxY, boxX + boxW, boxY + r, r);
                    ctx.lineTo(boxX + boxW, boxY + cY);

                    // Bottom-Left Corner
                    ctx.moveTo(boxX, boxY + boxH - cY);
                    ctx.lineTo(boxX, boxY + boxH - r);
                    ctx.arcTo(boxX, boxY + boxH, boxX + r, boxY + boxH, r);
                    ctx.lineTo(boxX + cX, boxY + boxH);

                    // Bottom-Right Corner
                    ctx.moveTo(boxX + boxW - cX, boxY + boxH);
                    ctx.lineTo(boxX + boxW - r, boxY + boxH);
                    ctx.arcTo(boxX + boxW, boxY + boxH, boxX + boxW, boxY + boxH - r, r);
                    ctx.lineTo(boxX + boxW, boxY + boxH - cY);

                    // Top Center Handle
                    ctx.moveTo(boxX + boxW * 0.40, boxY);
                    ctx.lineTo(boxX + boxW * 0.60, boxY);

                    // Bottom Center Handle
                    ctx.moveTo(boxX + boxW * 0.40, boxY + boxH);
                    ctx.lineTo(boxX + boxW * 0.60, boxY + boxH);

                    // Left Center Handle
                    ctx.moveTo(boxX, boxY + boxH * 0.40);
                    ctx.lineTo(boxX, boxY + boxH * 0.60);

                    // Right Center Handle
                    ctx.moveTo(boxX + boxW, boxY + boxH * 0.40);
                    ctx.lineTo(boxX + boxW, boxY + boxH * 0.60);

                    ctx.stroke();

                    ctx.fillStyle = "#ffffff";
                    ctx.font = "bold 13px Inter, -apple-system, sans-serif";

                    if (partH) {
                        ctx.textAlign = "right";
                        ctx.textBaseline = "middle";
                        ctx.fillText(partH, boxX - 8, boxY + boxH / 2);
                    }

                    if (partW) {
                        ctx.textAlign = "center";
                        ctx.textBaseline = "top";
                        ctx.fillText(partW, boxX + boxW / 2, boxY + boxH + 8);
                    }

                    ctx.restore();
                };

                nodeType.prototype.computeSize = function() {
                    return [230, 160];
                };

                nodeType.prototype.onResize = function(size) {
                    this.size[0] = Math.max(230, size[0]);
                    this.size[1] = Math.max(160, size[1]);
                    if (typeof this.updateDomPreview === "function") {
                        this.updateDomPreview();
                    }
                };
            };
        }
    }
});

api.addEventListener("saturnnodes_update_preview_aspect_ratio", (event) => {
    const detail = event.detail;
    if (!detail || !detail.node_id) return;

    const node = app.graph.getNodeById(detail.node_id);
    if (node && (node.type === "PreviewImageSizeAspectRatio" || node.type === "TextAspectRatioFinder")) {
        node.aspect_ratio_data = {
            ratio: detail.ratio,
            display_text: detail.display_text
        };
        if (typeof node.updateDomPreview === "function") {
            node.updateDomPreview();
        }
        app.graph.setDirtyCanvas(true, true);
    }
});

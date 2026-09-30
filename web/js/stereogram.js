import { app } from "/scripts/app.js";

app.registerExtension({
    name: "ComfyUI.SaturnNodes.SaturnStereo3D",

    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name !== "SaturnStereo3D") return;

        const onNodeCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            if (onNodeCreated) onNodeCreated.apply(this, arguments);

            // Good default dimensions for comfortably viewing side-by-side stereograms
            if (!this.size || this.size[0] < 340) {
                this.size = [360, 560];
            }

            // Quick Toggle Button: Swap Cross-Eye <-> Parallel (Wall-Eyed)
            const swapBtn = this.addWidget("button", "🔀 Swap Cross-Eye / Parallel", null, () => {
                const modeWidget = this.widgets?.find(w => w.name === "mode");
                if (modeWidget) {
                    if (modeWidget.value === "Cross-Eye") {
                        modeWidget.value = "Parallel (Wall-Eyed)";
                    } else if (modeWidget.value === "Parallel (Wall-Eyed)") {
                        modeWidget.value = "Cross-Eye";
                    }
                    this.setDirtyCanvas(true, true);
                }
            });
            swapBtn.serialize = false;

            // Invert Depth quick button
            const invertBtn = this.addWidget("button", "🔄 Invert Near / Far Depth", null, () => {
                const invWidget = this.widgets?.find(w => w.name === "invert_depth");
                if (invWidget) {
                    invWidget.value = !invWidget.value;
                    this.setDirtyCanvas(true, true);
                }
            });
            invertBtn.serialize = false;

            // Listen to preview_zoom widget changes to adjust canvas preview scaling
            const zoomWidget = this.widgets?.find(w => w.name === "preview_zoom");
            if (zoomWidget) {
                const origCallback = zoomWidget.callback;
                zoomWidget.callback = (val) => {
                    if (origCallback) origCallback.apply(zoomWidget, arguments);
                    this.setDirtyCanvas(true, true);
                };
            }
        };

        // Custom canvas draw for focus guide or status hint
        const onDrawForeground = nodeType.prototype.onDrawForeground;
        nodeType.prototype.onDrawForeground = function (ctx) {
            if (onDrawForeground) onDrawForeground.apply(this, arguments);

            if (this.flags?.collapsed) return;

            const modeWidget = this.widgets?.find(w => w.name === "mode");
            const mode = modeWidget ? modeWidget.value : "Cross-Eye";

            // If Cross-Eye or Parallel, draw subtle visual mode indicator at the bottom
            ctx.save();
            ctx.font = "10px Inter, system-ui, sans-serif";
            ctx.fillStyle = "rgba(222, 203, 178, 0.45)";
            ctx.textAlign = "right";

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

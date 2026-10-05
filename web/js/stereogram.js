import { app } from "/scripts/app.js";

/**
 * 🪐 SaturnNodes — Stereoscopic 3D Extension
 *
 * Configures the static 3D stereogram generator node (SaturnStereo3D).
 */

app.registerExtension({
    name: "ComfyUI.SaturnNodes.SaturnStereo3D",

    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name !== "SaturnStereo3D") return;

        const onNodeCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            if (onNodeCreated) onNodeCreated.apply(this, arguments);

            if (!this.size || this.size[0] < 340) {
                this.size = [360, 500];
            }
        };
    }
});


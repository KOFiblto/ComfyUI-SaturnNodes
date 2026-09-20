import { app } from "/scripts/app.js";

// LeafFlow Local File Runner Security & Disarm Extension
app.registerExtension({
    name: "LeafFlow.LocalRunner.Security",
    async nodeCreated(node) {
        if (node.comfyClass !== "RunLocalFileNode") return;

        // Locate security_consent widget
        const consentWidget = node.widgets?.find(w => w.name === "security_consent");
        const filePathWidget = node.widgets?.find(w => w.name === "file_path");

        // Helper to update node visual status indicator
        const updateVisualStatus = () => {
            const isArmed = consentWidget ? Boolean(consentWidget.value) : false;
            
            if (isArmed) {
                node.title = "🍃 ⚡ Run Local File [ARMED]";
                node.color = "#047857";
                node.bgcolor = "#064e3b";
            } else {
                node.title = "🍃 ⚡ Run Local File [DISARMED]";
                node.color = "#7f1d1d";
                node.bgcolor = "#18181b";
            }
            node.setDirtyCanvas(true, true);
        };

        if (consentWidget) {
            const origCallback = consentWidget.callback;
            consentWidget.callback = function(val) {
                if (val === true) {
                    console.log("[LeafFlow Security] Local runner manually armed by user.");
                    if (app.extensionManager?.toast?.add) {
                        app.extensionManager.toast.add({
                            severity: "warn",
                            summary: "🍃 Local Runner Armed",
                            detail: "Execution consent verified. Running scripts can execute commands on your system.",
                            life: 4000
                        });
                    }
                }
                if (origCallback) origCallback.apply(this, arguments);
                updateVisualStatus();
            };
        }

        // Intercept workflow load / configuration: ALWAYS disarm on load!
        const origOnConfigure = node.onConfigure;
        node.onConfigure = function(info) {
            if (origOnConfigure) origOnConfigure.apply(this, arguments);
            // GUARANTEE: Never let imported workflow or image auto-run with consent pre-checked
            if (consentWidget) {
                consentWidget.value = false;
            }
            updateVisualStatus();
        };

        // Draw security alert ribbon on canvas if disarmed
        const origOnDrawForeground = node.onDrawForeground;
        node.onDrawForeground = function(ctx) {
            if (origOnDrawForeground) origOnDrawForeground.apply(this, arguments);
            if (node.flags?.collapsed) return;

            const isArmed = consentWidget ? Boolean(consentWidget.value) : false;
            if (!isArmed) {
                ctx.save();
                ctx.font = "bold 10px sans-serif";
                ctx.fillStyle = "#ef4444";
                ctx.textAlign = "center";
                ctx.fillText("🛡️ DISARMED: Check 'security_consent' to authorize", node.size[0] / 2, node.size[1] - 8);
                ctx.restore();
            }
        };

        updateVisualStatus();
    }
});

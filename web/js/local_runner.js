import { app } from "/scripts/app.js";
import { authenticatedFetch } from "./auth_helper.js";

// LeafFlow Local File Runner In-Memory Consent Gate Extension
app.registerExtension({
    name: "LeafFlow.LocalRunner.Security",
    async nodeCreated(node) {
        if (node.comfyClass !== "RunLocalFileNode") return;

        node._isAuthorized = false;
        node._authExpiresAt = 0;

        const filePathWidget = node.widgets?.find(w => w.name === "file_path");

        const updateVisualStatus = () => {
            const now = Date.now();
            const isArmed = Boolean(node._isAuthorized && node._authExpiresAt > now);

            if (isArmed) {
                const remainingSec = Math.max(0, Math.round((node._authExpiresAt - now) / 1000));
                const remainingMin = Math.ceil(remainingSec / 60);
                node.title = `🍃 ⚡ Run Local File [ARMED (${remainingMin}m)]`;
                node.color = "#047857";
                node.bgcolor = "#064e3b";
                if (authButton) {
                    authButton.name = `✅ Authorized (${remainingMin}m left)`;
                }
            } else {
                node._isAuthorized = false;
                node.title = "🍃 ⚡ Run Local File [DISARMED]";
                node.color = "#7f1d1d";
                node.bgcolor = "#18181b";
                if (authButton) {
                    authButton.name = "⚡ Authorize Run (5 min)";
                }
            }
            node.setDirtyCanvas(true, true);
        };

        // Add explicit interactive action button: "⚡ Authorize Run (5 min)"
        const authButton = node.addWidget(
            "button",
            "⚡ Authorize Run (5 min)",
            null,
            async () => {
                const scriptName = filePathWidget?.value?.trim() || "configured script";
                const confirmed = confirm(
                    "🍃 LeafFlow Security Verification\n\n" +
                    `Authorize a SINGLE run of local script:\n'${scriptName}'\n\n` +
                    "⚠️ Notice: Scripts can execute shell commands on your system.\n" +
                    "• The script must reside inside 'ComfyUI/scripts/'.\n" +
                    "• Authorization is temporary (expires in 5 minutes) and single-use.\n" +
                    "• External workflows can NEVER run scripts without your live authorization.\n\n" +
                    "Authorize this run now?"
                );

                if (!confirmed) return;

                try {
                    const resp = await authenticatedFetch("/leafflow/local_runner/authorize", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                            node_id: node.id,
                            file_path: filePathWidget?.value || ""
                        })
                    });

                    if (!resp.ok) {
                        const err = await resp.json().catch(() => ({}));
                        const errMsg = err.error || "Failed to authorize node run.";
                        if (app.extensionManager?.toast?.add) {
                            app.extensionManager.toast.add({
                                severity: "error",
                                summary: "🍃 Authorization Failed",
                                detail: errMsg,
                                life: 6000
                            });
                        } else {
                            alert("❌ " + errMsg);
                        }
                        return;
                    }

                    node._isAuthorized = true;
                    node._authExpiresAt = Date.now() + (300 * 1000);
                    updateVisualStatus();

                    if (app.extensionManager?.toast?.add) {
                        app.extensionManager.toast.add({
                            severity: "success",
                            summary: "⚡ Script Run Authorized",
                            detail: `Node ${node.id} authorized for 5 minutes. Single-use: will be consumed upon execution.`,
                            life: 5000
                        });
                    }
                } catch (e) {
                    console.error("[LeafFlow Security] Error authorizing script run:", e);
                    alert("❌ Error communicating with authorization service: " + e.message);
                }
            }
        );

        // Intercept workflow load / configuration: ALWAYS disarm on load!
        const origOnConfigure = node.onConfigure;
        node.onConfigure = function(info) {
            if (origOnConfigure) origOnConfigure.apply(this, arguments);
            // GUARANTEE: Never let imported workflow or image auto-run with consent pre-checked
            node._isAuthorized = false;
            node._authExpiresAt = 0;
            updateVisualStatus();
        };

        // If file path changes, invalidate existing authorization
        if (filePathWidget) {
            const origCallback = filePathWidget.callback;
            filePathWidget.callback = function(val) {
                node._isAuthorized = false;
                node._authExpiresAt = 0;
                updateVisualStatus();
                if (origCallback) origCallback.apply(this, arguments);
            };
        }

        // Draw security alert ribbon on canvas if disarmed
        const origOnDrawForeground = node.onDrawForeground;
        node.onDrawForeground = function(ctx) {
            if (origOnDrawForeground) origOnDrawForeground.apply(this, arguments);
            if (node.flags?.collapsed) return;

            const now = Date.now();
            const isArmed = Boolean(node._isAuthorized && node._authExpiresAt > now);

            ctx.save();
            ctx.font = "bold 10px sans-serif";
            ctx.textAlign = "center";
            if (!isArmed) {
                ctx.fillStyle = "#ef4444";
                ctx.fillText("🛡️ DISARMED: Click 'Authorize Run' to execute", node.size[0] / 2, node.size[1] - 8);
            } else {
                const rem = Math.max(0, Math.ceil((node._authExpiresAt - now) / 60000));
                ctx.fillStyle = "#10b981";
                ctx.fillText(`⚡ ARMED (${rem}m left) - Consumed on run`, node.size[0] / 2, node.size[1] - 8);
            }
            ctx.restore();
        };

        updateVisualStatus();
    }
});

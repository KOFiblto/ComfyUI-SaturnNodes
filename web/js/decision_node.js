import { app } from "/scripts/app.js";
import { api } from "/scripts/api.js";
import { authenticatedFetch } from "./auth_helper.js";

// Create global styles for the decision buttons
const styles = document.createElement("style");
styles.textContent = `
    .leafflow-decision-btn {
        margin: 4px;
        padding: 6px 12px;
        border: none;
        border-radius: 4px;
        font-weight: bold;
        cursor: pointer;
        color: white;
        transition: all 0.2s;
    }
    .leafflow-decision-btn:disabled {
        opacity: 0.3;
        cursor: not-allowed;
        filter: grayscale(100%);
    }
    .leafflow-btn-continue { background-color: #2e7d32; }
    .leafflow-btn-continue:hover:not(:disabled) { background-color: #388e3c; }
    .leafflow-btn-cancel { background-color: #f57c00; }
    .leafflow-btn-cancel:hover:not(:disabled) { background-color: #fb8c00; }
    .leafflow-btn-stop { background-color: #d32f2f; }
    .leafflow-btn-stop:hover:not(:disabled) { background-color: #f44336; }
    
    .leafflow-decision-container {
        display: flex;
        flex-direction: column;
        align-items: center;
        width: 100%;
        padding: 4px;
        box-sizing: border-box;
    }
`;
document.head.appendChild(styles);

app.registerExtension({
    name: "Comfy.SaturnNodesDecision",
    async setup() {
        const handleWaiting = (event) => {
            const data = event.detail;
            if (data && data.node_id) {
                const node = app.graph.getNodeById(data.node_id);
                if (node && node.enableDecisionButtons) {
                    node.enableDecisionButtons();
                }
            }
        };

        const handleResolved = (event) => {
            const data = event.detail;
            if (data && data.node_id) {
                const node = app.graph.getNodeById(data.node_id);
                if (node && node.disableDecisionButtons) {
                    node.disableDecisionButtons();
                }
            }
        };

        api.addEventListener("saturnnodes_decision_waiting", handleWaiting);
        api.addEventListener("leafflow_decision_waiting", handleWaiting);

        api.addEventListener("saturnnodes_decision_resolved", handleResolved);
        api.addEventListener("leafflow_decision_resolved", handleResolved);
    },
    async nodeCreated(node) {
        if (node.comfyClass === "SaturnDecision" || node.comfyClass === "LeafFlowDecision") {
            const container = document.createElement("div");
            container.className = "leafflow-decision-container";

            const btnContinue = document.createElement("button");
            btnContinue.className = "leafflow-decision-btn leafflow-btn-continue";
            btnContinue.innerText = "Continue Workflow";
            btnContinue.disabled = true;

            const btnCancel = document.createElement("button");
            btnCancel.className = "leafflow-decision-btn leafflow-btn-cancel";
            btnCancel.innerText = "Cancel (Return True)";
            btnCancel.disabled = true;

            const btnStop = document.createElement("button");
            btnStop.className = "leafflow-decision-btn leafflow-btn-stop";
            btnStop.innerText = "Stop Workflow";
            btnStop.disabled = true;

            container.appendChild(btnContinue);
            container.appendChild(btnCancel);
            container.appendChild(btnStop);

            const sendDecision = async (action) => {
                node.disableDecisionButtons();
                try {
                    let resp = await authenticatedFetch("/saturnnodes/decision", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                            node_id: node.id.toString(),
                            action: action
                        }),
                    });
                    if (!resp.ok) {
                        await authenticatedFetch("/leafflow/decision", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({
                                node_id: node.id.toString(),
                                action: action
                            }),
                        });
                    }
                } catch (e) {
                    console.error("[SaturnNodes] Failed to send decision:", e);
                }
            };

            btnContinue.addEventListener("click", () => sendDecision("continue"));
            btnCancel.addEventListener("click", () => sendDecision("cancel"));
            btnStop.addEventListener("click", () => sendDecision("stop"));

            const domWidget = node.addDOMWidget("decision_ui", "HTML", container, {
                serialize: false
            });
            
            // Adjust node size to fit buttons
            node.size = [300, 240];
            const originalComputeSize = node.computeSize;
            node.computeSize = function() {
                const sz = originalComputeSize ? originalComputeSize.apply(this, arguments) : [300, 240];
                return [Math.max(300, sz[0]), Math.max(240, sz[1])];
            };
            
            domWidget.computeSize = function() {
                return [node.size[0] - 20, 120];
            };

            node.enableDecisionButtons = () => {
                btnContinue.disabled = false;
                btnCancel.disabled = false;
                btnStop.disabled = false;
                node.color = "#3a4a15";
                node.bgcolor = "#4a6311";
                if (app.graph) app.graph.setDirtyCanvas(true, true);
            };

            node.disableDecisionButtons = () => {
                btnContinue.disabled = true;
                btnCancel.disabled = true;
                btnStop.disabled = true;
                node.color = "";
                node.bgcolor = "";
                if (app.graph) app.graph.setDirtyCanvas(true, true);
            };
        }
    }
});

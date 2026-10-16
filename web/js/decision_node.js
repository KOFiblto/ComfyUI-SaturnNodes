import { app } from "/scripts/app.js";
import { api } from "/scripts/api.js";
import { authenticatedFetch } from "./auth_helper.js";

// Create global styles for the decision buttons
const styles = document.createElement("style");
styles.textContent = `
    .saturnnodes-decision-btn {
        margin: 4px;
        padding: 6px 12px;
        border: none;
        border-radius: 4px;
        font-weight: bold;
        cursor: pointer;
        color: white;
        transition: all 0.2s;
    }
    .saturnnodes-decision-btn:disabled {
        opacity: 0.3;
        cursor: not-allowed;
        filter: grayscale(100%);
    }
    .saturnnodes-btn-continue { background-color: #2e7d32; }
    .saturnnodes-btn-continue:hover:not(:disabled) { background-color: #388e3c; }
    .saturnnodes-btn-cancel { background-color: #f57c00; }
    .saturnnodes-btn-cancel:hover:not(:disabled) { background-color: #fb8c00; }
    .saturnnodes-btn-stop { background-color: #d32f2f; }
    .saturnnodes-btn-stop:hover:not(:disabled) { background-color: #f44336; }
    
    .saturnnodes-decision-container {
        display: flex;
        flex-direction: column;
        align-items: center;
        width: 100%;
        padding: 4px;
        box-sizing: border-box;
    }
`;
document.head.appendChild(styles);

function findGraphNode(id) {
    if (!id && id !== 0) return null;
    const strId = String(id);
    const numId = Number(id);

    // 1. Direct root graph lookup
    let node = app.graph?.getNodeById?.(id) || app.graph?.getNodeById?.(numId) || app.graph?.getNodeById?.(strId);
    if (node) return node;

    // 2. Search root graph nodes and nested subgraphs
    if (app.graph && Array.isArray(app.graph._nodes)) {
        for (const n of app.graph._nodes) {
            if (String(n.id) === strId) return n;
            if (n.subgraph && typeof n.subgraph.getNodeById === "function") {
                const sub = n.subgraph.getNodeById(id) || n.subgraph.getNodeById(numId) || n.subgraph.getNodeById(strId);
                if (sub) return sub;
            }
        }
    }

    // 3. Search graph._subgraphs registry (v0.37+)
    if (app.graph && app.graph._subgraphs) {
        const subgraphs = Array.isArray(app.graph._subgraphs)
            ? app.graph._subgraphs
            : Object.values(app.graph._subgraphs);
        for (const sg of subgraphs) {
            if (sg && typeof sg.getNodeById === "function") {
                const sub = sg.getNodeById(id) || sg.getNodeById(numId) || sg.getNodeById(strId);
                if (sub) return sub;
            }
        }
    }
    return null;
}

app.registerExtension({
    name: "ComfyUI.SaturnNodes.Decision",
    async setup() {
        const handleWaiting = (event) => {
            const data = event.detail;
            if (data && data.node_id) {
                const node = findGraphNode(data.node_id);
                if (node && node.enableDecisionButtons) {
                    node.enableDecisionButtons();
                }
            }
        };

        const handleResolved = (event) => {
            const data = event.detail;
            if (data && data.node_id) {
                const node = findGraphNode(data.node_id);
                if (node && node.disableDecisionButtons) {
                    node.disableDecisionButtons();
                }
            }
        };

        api.addEventListener("saturnnodes_decision_waiting", handleWaiting);
        api.addEventListener("saturnnodes_decision_resolved", handleResolved);
    },
    async nodeCreated(node) {
        if (node.comfyClass === "SaturnDecision") {
            const container = document.createElement("div");
            container.className = "saturnnodes-decision-container";

            const btnContinue = document.createElement("button");
            btnContinue.className = "saturnnodes-decision-btn saturnnodes-btn-continue";
            btnContinue.innerText = "Continue Workflow";
            btnContinue.disabled = true;

            const btnCancel = document.createElement("button");
            btnCancel.className = "saturnnodes-decision-btn saturnnodes-btn-cancel";
            btnCancel.innerText = "Cancel (Return True)";
            btnCancel.disabled = true;

            const btnStop = document.createElement("button");
            btnStop.className = "saturnnodes-decision-btn saturnnodes-btn-stop";
            btnStop.innerText = "Stop Workflow";
            btnStop.disabled = true;

            container.appendChild(btnContinue);
            container.appendChild(btnCancel);
            container.appendChild(btnStop);

            const sendDecision = async (action) => {
                node.disableDecisionButtons();
                try {
                    await authenticatedFetch("/saturnnodes/decision", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                            node_id: node.id.toString(),
                            action: action
                        }),
                    });
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

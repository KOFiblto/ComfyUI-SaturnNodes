import { app } from "/scripts/app.js";
import { api } from "/scripts/api.js";
import { authenticatedFetch } from "./js/auth_helper.js";

app.registerExtension({
    name: "ComfyUI.LeafFlow.PersistentQueue",
    async setup() {
        const patchRgthree = async () => {
            try {
                const rgthree = await import("/extensions/rgthree-comfy/common/prompt_service.js");
                if (rgthree && rgthree.SERVICE) {
                    const queue = await api.getQueue();
                    const running = queue.queue_running || queue.Running || [];
                    const pending = queue.queue_pending || queue.Pending || [];
                    const allItems = [...running, ...pending];
                    let patched = false;
                    for (const item of allItems) {
                        const promptId = item[1];
                        const promptData = item[2];
                        if (promptId && promptData) {
                            const promptExecution = rgthree.SERVICE.getOrMakePrompt(promptId);
                            if (!promptExecution.totalNodes || !promptExecution.promptApi) {
                                promptExecution.setPrompt({ output: promptData });
                                if (rgthree.SERVICE.promptsMap) {
                                    rgthree.SERVICE.promptsMap.set(promptId, promptExecution);
                                }
                                patched = true;
                            }
                            if (running.some(r => r[1] === promptId)) {
                                if (!rgthree.SERVICE.currentExecution || !rgthree.SERVICE.currentExecution.totalNodes) {
                                    rgthree.SERVICE.currentExecution = promptExecution;
                                    patched = true;
                                }
                            }
                        }
                    }
                    if (patched) {
                        rgthree.SERVICE.dispatchProgressUpdate();
                        console.log("[LeafFlow] Synced recovered queue with rgthree-comfy progress bar.");
                    }
                }
            } catch (e) {
                // rgthree-comfy not installed or path changed, ignore
            }
        };

        const claimQueueOwnership = async () => {
            if (api && api.clientId) {
                try {
                    await authenticatedFetch("/persistent_queue/claim", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ client_id: api.clientId })
                    });
                    
                    // Wait for server to sync queue state back to clients, then patch rgthree
                    setTimeout(patchRgthree, 150);
                    setTimeout(patchRgthree, 600);
                } catch (e) {
                    console.error("[LeafFlow] Error claiming queue ownership:", e);
                }
            }
        };

        // Delay execution until after app & API client ID initialization
        setTimeout(claimQueueOwnership, 500);
        setTimeout(patchRgthree, 800);

        if (api && api.addEventListener) {
            api.addEventListener("status", () => {
                claimQueueOwnership();
                setTimeout(patchRgthree, 200);
            });
            
            api.addEventListener("execution_start", (e) => {
                setTimeout(patchRgthree, 50);
            });

            api.addEventListener("executing", (e) => {
                if (e && e.detail) {
                    patchRgthree();
                }
            });
        }
    }
});

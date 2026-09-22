import { app } from "/scripts/app.js";
import { api } from "/scripts/api.js";
import { authenticatedFetch } from "./js/auth_helper.js";

const stylePath = new URL('./pause_queue.css', import.meta.url).href;
if (!document.querySelector(`link[href="${stylePath}"]`)) {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.type = "text/css";
    link.href = stylePath;
    document.head.appendChild(link);
}

class PauseQueueUI {
    constructor() {
        this.state = {
            paused: true,
            mode: "after_finish",
            waiting: true
        };
        this.groupEl = null;
        this.menuEl = null;
        this.menuOpen = false;

        this.init();
    }

    init() {
        this.fetchStatus().catch(() => {});
        this.setupWebSocket();
        this.startObserver();
    }

    async fetchStatus() {
        try {
            const res = await api.fetchApi("/pause_queue/status");
            if (res.ok) {
                const data = await res.json();
                this.updateState(data);
            }
        } catch (e) {
            console.error("[LeafFlow] Error fetching status:", e);
        }
    }

    setupWebSocket() {
        api.addEventListener("pause_queue_status", (event) => {
            if (event.detail) {
                this.updateState(event.detail);
            }
        });
    }

    updateState(data) {
        this.state = { ...this.state, ...data };
        this.renderUI();
    }

    async togglePause(paused) {
        try {
            const res = await authenticatedFetch("/pause_queue/toggle", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ paused, mode: this.state.mode })
            });
            if (res.ok) {
                const data = await res.json();
                this.updateState(data);
            }
        } catch (e) {
            console.error("[LeafFlow] Error toggling pause:", e);
        }
    }

    async setMode(mode) {
        try {
            const res = await authenticatedFetch("/pause_queue/mode", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ mode })
            });
            if (res.ok) {
                const data = await res.json();
                this.updateState(data);
            }
        } catch (e) {
            console.error("[LeafFlow] Error setting mode:", e);
        }
    }

    async continueQueue() {
        try {
            const res = await authenticatedFetch("/pause_queue/continue", { method: "POST" });
            if (res.ok) {
                const data = await res.json();
                this.updateState(data);
            }
        } catch (e) {
            console.error("[LeafFlow] Error continuing queue:", e);
        }
    }

    startObserver() {
        this.injectUI();
        setInterval(() => {
            this.injectUI();
        }, 1000);
    }

    injectUI() {
        // Vue V2 UI Detection
        const queueGroup = document.querySelector(".queue-button-group") || 
                           document.querySelector('[data-testid="queue-button"]')?.closest(".queue-button-group");
                           
        if (queueGroup) {
            const parentDiv = queueGroup.parentElement;
            if (!parentDiv) return;

            // If it's already in the correct V2 container, do nothing
            if (this.groupEl && parentDiv.contains(this.groupEl)) return;
            
            if (!this.groupEl) this.buildElement();
            
            this.groupEl.classList.remove("litegraph-mode");

            const dragHandle = parentDiv.querySelector(".drag-handle");
            if (dragHandle && dragHandle.nextSibling) {
                parentDiv.insertBefore(this.groupEl, dragHandle.nextSibling);
            } else {
                parentDiv.insertBefore(this.groupEl, queueGroup);
            }
            this.renderUI();
            return;
        }

        // If we are definitely in V2, wait for V2 header to render
        const isV2 = !!document.querySelector('comfy-app') || !!document.querySelector('#app');
        if (isV2) return;

        // LiteGraph V1 UI Detection
        if (app.ui && app.ui.menuContainer) {
            if (this.groupEl && app.ui.menuContainer.contains(this.groupEl)) return;
            if (!this.groupEl) this.buildElement();

            this.groupEl.classList.add("litegraph-mode");
            const queueBtn = app.ui.menuContainer.querySelector(".comfy-queue-btn");
            if (queueBtn) {
                app.ui.menuContainer.insertBefore(this.groupEl, queueBtn.nextSibling);
            } else {
                app.ui.menuContainer.appendChild(this.groupEl);
            }
            this.renderUI();
        }
    }

    buildElement() {
        this.groupEl = document.createElement("div");
        this.groupEl.className = "pq-button-group";

        const mainBtn = document.createElement("button");
        mainBtn.type = "button";
        mainBtn.className = "pq-main-btn";
        mainBtn.setAttribute("data-pd-tooltip", "true");
        mainBtn.onclick = (e) => {
            e.stopPropagation();
            if (this.state.paused) {
                if (this.state.waiting) {
                    this.continueQueue();
                } else {
                    this.togglePause(false);
                }
            } else {
                this.togglePause(true);
            }
        };

        const iconContainer = document.createElement("span");
        iconContainer.className = "pq-icon-container inline-flex items-center justify-center";

        const btnText = document.createElement("span");
        btnText.className = "pq-btn-text";

        mainBtn.appendChild(iconContainer);
        mainBtn.appendChild(btnText);

        const dropBtn = document.createElement("button");
        dropBtn.type = "button";
        dropBtn.className = "pq-dropdown-btn";
        dropBtn.title = "Select Pause Mode";
        dropBtn.innerHTML = `<svg class="h-[5px] min-h-[5px] w-[8px] min-w-[8px]" xmlns="http://www.w3.org/2000/svg" width="8" height="5" viewBox="0 0 8 5" fill="none"><path d="M0.650391 0.649902L3.65039 3.6499L6.65039 0.649902" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"></path></svg>`;

        dropBtn.onclick = (e) => {
            e.stopPropagation();
            this.toggleDropdown();
        };

        this.menuEl = document.createElement("div");
        this.menuEl.className = "pq-dropdown-menu";

        this.groupEl.appendChild(mainBtn);
        this.groupEl.appendChild(dropBtn);

        document.addEventListener("click", (e) => {
            if (this.menuOpen && !this.groupEl.contains(e.target) && !this.menuEl.contains(e.target)) {
                this.closeDropdown();
            }
        });
    }

    toggleDropdown() {
        if (this.menuOpen) {
            this.closeDropdown();
        } else {
            this.openDropdown();
        }
    }

    openDropdown() {
        if (!this.groupEl) return;
        this.menuOpen = true;
        this.renderMenu();

        if (!document.body.contains(this.menuEl)) {
            document.body.appendChild(this.menuEl);
        }

        const rect = this.groupEl.getBoundingClientRect();
        this.menuEl.style.top = `${rect.bottom + 4}px`;
        this.menuEl.style.left = `${rect.left}px`;

        this.menuEl.classList.add("pq-open");
    }

    closeDropdown() {
        this.menuOpen = false;
        if (this.menuEl) {
            this.menuEl.classList.remove("pq-open");
            if (document.body.contains(this.menuEl)) {
                document.body.removeChild(this.menuEl);
            }
        }
    }

    renderMenu() {
        const isAfterFinish = this.state.mode === "after_finish";
        const isInstantly = this.state.mode === "instantly";

        this.menuEl.innerHTML = `
            <div class="pq-menu-item ${isAfterFinish ? 'active' : ''}" id="pq-mode-after-finish">
                <span class="pq-check-icon w-4">${isAfterFinish ? '✓' : ''}</span>
                <div class="pq-menu-item-text">
                    <span class="pq-menu-item-title">Pause (Finish)</span>
                    <span class="pq-menu-item-desc">Finish current workflow, pause before next</span>
                </div>
            </div>
            <div class="pq-divider"></div>
            <div class="pq-menu-item ${isInstantly ? 'active' : ''}" id="pq-mode-instantly">
                <span class="pq-check-icon w-4">${isInstantly ? '✓' : ''}</span>
                <div class="pq-menu-item-text">
                    <span class="pq-menu-item-title">Pause (Instant)</span>
                    <span class="pq-menu-item-desc">Pause immediately at current step (resume later)</span>
                </div>
            </div>
        `;

        const afterFinishItem = this.menuEl.querySelector("#pq-mode-after-finish");
        if (afterFinishItem) {
            afterFinishItem.onclick = (e) => {
                e.stopPropagation();
                this.closeDropdown();
                this.setMode("after_finish");
            };
        }

        const instantlyItem = this.menuEl.querySelector("#pq-mode-instantly");
        if (instantlyItem) {
            instantlyItem.onclick = (e) => {
                e.stopPropagation();
                this.closeDropdown();
                this.setMode("instantly");
            };
        }
    }

    renderUI() {
        if (!this.groupEl) return;

        const mainBtn = this.groupEl.querySelector(".pq-main-btn");
        const iconContainer = this.groupEl.querySelector(".pq-icon-container");
        const btnText = this.groupEl.querySelector(".pq-btn-text");

        if (!mainBtn || !iconContainer || !btnText) return;

        this.groupEl.classList.remove("pq-state-paused");

        if (this.state.paused) {
            this.groupEl.classList.add("pq-state-paused");

            if (this.state.waiting) {
                btnText.textContent = "Continue";
                mainBtn.title = "Queue/Workflow is paused. Click to continue execution.";
                iconContainer.innerHTML = `<i class="icon-[lucide--play] size-4 w-4 h-4 flex items-center justify-center"><svg class="w-4 h-4" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"></path></svg></i>`;
            } else {
                const pausingLabel = this.state.mode === "instantly" 
                    ? "Pausing (Instant)..." 
                    : "Pausing (Finish)...";
                btnText.textContent = pausingLabel;
                mainBtn.title = "Pause requested. Waiting for active workflow/node to complete before pausing...";
                iconContainer.innerHTML = `<i class="icon-[lucide--pause] size-4 w-4 h-4 flex items-center justify-center"><svg class="w-4 h-4" viewBox="0 0 24 24" fill="currentColor"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"></path></svg></i>`;
            }
        } else {
            const modeLabel = this.state.mode === "instantly" ? "Pause (Instant)" : "Pause (Finish)";
            btnText.textContent = modeLabel;
            mainBtn.title = this.state.mode === "instantly" 
                ? "Pause workflow instantly at current step" 
                : "Pause queue after current workflow finishes";
            iconContainer.innerHTML = `<i class="icon-[lucide--pause] size-4 w-4 h-4 flex items-center justify-center"><svg class="w-4 h-4" viewBox="0 0 24 24" fill="currentColor"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"></path></svg></i>`;
        }
    }
}

app.registerExtension({
    name: "ComfyUI.LeafFlow.PauseQueue",
    async setup() {
        new PauseQueueUI();
    }
});

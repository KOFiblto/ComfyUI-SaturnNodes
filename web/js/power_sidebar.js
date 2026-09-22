import { app } from "/scripts/app.js";
import { api } from "/scripts/api.js";
import { authenticatedFetch } from "./auth_helper.js";

const EXTENSION_NAME = "SaturnNodes.PowerControlSidebar";
const STYLE_ID = "leafflow-power-sidebar-styles";

let currentPowerState = {
    pending_action: null,
    armed_at: null,
    is_paused: false
};

let activePopup = null;

function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
        /* Power Sidebar Button Layout (Matching standard full-width sidebar button) */
        #leafflow-power-bottom-btn {
            width: 100% !important;
            height: auto !important;
            min-height: 48px !important;
            padding: 6px 4px !important;
            box-sizing: border-box !important;
            border-radius: 8px !important;
            align-self: stretch !important;
        }

        #leafflow-power-bottom-btn .side-bar-button-content {
            width: 100% !important;
            display: flex !important;
            flex-direction: column !important;
            align-items: center !important;
            gap: 4px !important;
        }

        /* Power Sidebar Button Armed Red Warning State */
        #leafflow-power-bottom-btn.leafflow-power-btn-armed,
        .comfy-power-btn.leafflow-power-btn-armed,
        .side-bar-button.leafflow-power-btn-armed,
        .side-bar-button:has(.leafflow-power-icon-armed),
        button[aria-label*="Power"].leafflow-power-btn-armed {
            background: linear-gradient(135deg, #dc2626 0%, #991b1b 100%) !important;
            color: #ffffff !important;
            border: 1px solid #f87171 !important;
            box-shadow: 0 0 14px rgba(239, 68, 68, 0.8) !important;
            animation: leafflow-power-pulse 1.8s infinite ease-in-out !important;
        }

        .leafflow-power-btn-armed svg,
        .leafflow-power-btn-armed .side-bar-button-icon,
        .leafflow-power-btn-armed span {
            color: #ffffff !important;
            stroke: #ffffff !important;
        }

        @keyframes leafflow-power-pulse {
            0% { box-shadow: 0 0 6px rgba(239, 68, 68, 0.5); transform: scale(1); }
            50% { box-shadow: 0 0 16px rgba(239, 68, 68, 0.95); transform: scale(1.03); }
            100% { box-shadow: 0 0 6px rgba(239, 68, 68, 0.5); transform: scale(1); }
        }

        /* Power Side Popup Menu (like Help Center popup) */
        .leafflow-power-popup {
            position: fixed;
            z-index: 10005;
            min-width: 250px;
            max-width: 320px;
            background: var(--comfy-menu-bg, #18181b);
            border: 1px solid var(--border-color, #27272a);
            border-radius: 12px;
            box-shadow: 0 12px 30px rgba(0, 0, 0, 0.6);
            padding: 8px;
            color: var(--fg-color, #f4f4f5);
            font-family: inherit;
            animation: leafflow-popup-fade 0.15s ease-out;
        }

        @keyframes leafflow-popup-fade {
            from { opacity: 0; transform: translateX(-6px); }
            to { opacity: 1; transform: translateX(0); }
        }

        .leafflow-power-popup .help-menu-item {
            display: flex;
            align-items: center;
            gap: 10px;
            width: 100%;
            padding: 8px 10px;
            border-radius: 8px;
            border: none;
            background: transparent;
            color: var(--fg-color, #f4f4f5);
            font-size: 13px;
            font-weight: 500;
            cursor: pointer;
            text-align: left;
            transition: background 0.15s ease, color 0.15s ease;
        }

        .leafflow-power-popup .help-menu-item:hover {
            background: var(--comfy-menu-secondary-bg, rgba(255, 255, 255, 0.08));
        }

        .leafflow-power-popup .help-menu-item.danger-item:hover {
            background: rgba(239, 68, 68, 0.15);
            color: #f87171;
        }

        .leafflow-power-popup .help-menu-item.armed-cancel-item {
            background: rgba(239, 68, 68, 0.85);
            color: #ffffff;
            font-weight: 600;
            margin-bottom: 6px;
        }

        .leafflow-power-popup .help-menu-item.armed-cancel-item:hover {
            background: #dc2626;
        }

        .leafflow-power-popup .help-menu-icon-container {
            display: flex;
            align-items: center;
            justify-content: center;
            width: 24px;
            height: 24px;
            flex-shrink: 0;
            color: var(--descrip-text, #a1a1aa);
        }

        .leafflow-power-popup .help-menu-item:hover .help-menu-icon-container {
            color: var(--fg-color, #f4f4f5);
        }

        .leafflow-power-popup .menu-label {
            flex: 1;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }

        .leafflow-power-popup .menu-divider {
            height: 1px;
            background: var(--border-color, #27272a);
            margin: 4px 0;
            width: 100%;
        }

        /* Power Confirm Modal */
        .leafflow-power-modal {
            display: flex;
            flex-direction: column;
            gap: 12px;
            padding: 18px;
            min-width: 330px;
            max-width: 440px;
            background: #18181b;
            color: #f4f4f5;
            border-radius: 12px;
            font-family: inherit;
        }
    `;
    document.head.appendChild(style);
}

function getPowerIconSvg(size = 18) {
    return `<svg class="size-4.5" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18.36 6.64a9 9 0 1 1-12.73 0"></path><line x1="12" y1="2" x2="12" y2="12"></line></svg>`;
}

function updateSidebarButtonVisuals() {
    const isArmed = Boolean(currentPowerState.pending_action);
    const btns = document.querySelectorAll('#leafflow-power-bottom-btn, .comfy-power-btn, [aria-label*="Power"], .side-bar-button:has(.pi-power)');
    btns.forEach(btn => {
        if (isArmed) {
            btn.classList.add("leafflow-power-btn-armed");
            const icon = btn.querySelector(".side-bar-button-icon, i, svg");
            if (icon) icon.classList.add("leafflow-power-icon-armed");
            btn.setAttribute("title", `⚠️ ComfyUI Power: Armed to ${currentPowerState.pending_action.toUpperCase()} after queue finish! Click to cancel.`);
        } else {
            btn.classList.remove("leafflow-power-btn-armed");
            const icon = btn.querySelector(".side-bar-button-icon, i, svg");
            if (icon) icon.classList.remove("leafflow-power-icon-armed");
            btn.setAttribute("title", "Power (Restart / Shutdown)");
        }
    });
}

async function fetchPowerStatus() {
    try {
        let resp = await api.fetchApi("/saturnnodes/power/status");
        if (!resp.ok) {
            resp = await api.fetchApi("/leafflow/power/status");
        }
        if (resp.ok) {
            currentPowerState = await resp.json();
            updateSidebarButtonVisuals();
        }
    } catch (_) {}
}

function openConfirmModal(title, message, onConfirm, isDanger = false) {
    const overlay = document.createElement("div");
    overlay.style.position = "fixed";
    overlay.style.inset = "0";
    overlay.style.backgroundColor = "rgba(0,0,0,0.75)";
    overlay.style.display = "flex";
    overlay.style.alignItems = "center";
    overlay.style.justifyContent = "center";
    overlay.style.zIndex = "10010";
    overlay.style.backdropFilter = "blur(3px)";

    const modal = document.createElement("div");
    modal.className = "leafflow-power-modal";
    modal.style.border = isDanger ? "1px solid rgba(239, 68, 68, 0.5)" : "1px solid rgba(59, 130, 246, 0.5)";
    modal.style.boxShadow = isDanger ? "0 0 25px rgba(239, 68, 68, 0.35)" : "0 0 25px rgba(59, 130, 246, 0.35)";

    const header = document.createElement("div");
    header.style.fontSize = "16px";
    header.style.fontWeight = "bold";
    header.style.display = "flex";
    header.style.alignItems = "center";
    header.style.gap = "8px";
    header.innerHTML = isDanger ? `⚠️ ${title}` : `ℹ️ ${title}`;

    const desc = document.createElement("div");
    desc.style.fontSize = "13px";
    desc.style.lineHeight = "1.5";
    desc.style.color = "#d4d4d8";
    desc.textContent = message;

    const btnRow = document.createElement("div");
    btnRow.style.display = "flex";
    btnRow.style.justifyContent = "flex-end";
    btnRow.style.gap = "8px";
    btnRow.style.marginTop = "8px";

    const cancelBtn = document.createElement("button");
    cancelBtn.textContent = onConfirm ? "Cancel" : "Close";
    cancelBtn.style.padding = "8px 16px";
    cancelBtn.style.borderRadius = "6px";
    cancelBtn.style.border = "1px solid #52525b";
    cancelBtn.style.background = "#27272a";
    cancelBtn.style.color = "#f4f4f5";
    cancelBtn.style.cursor = "pointer";
    cancelBtn.onclick = () => overlay.remove();

    if (onConfirm) {
        const confirmBtn = document.createElement("button");
        confirmBtn.textContent = "Confirm";
        confirmBtn.style.padding = "8px 16px";
        confirmBtn.style.borderRadius = "6px";
        confirmBtn.style.border = "none";
        confirmBtn.style.fontWeight = "600";
        confirmBtn.style.cursor = "pointer";
        if (isDanger) {
            confirmBtn.style.background = "#dc2626";
            confirmBtn.style.color = "#ffffff";
        } else {
            confirmBtn.style.background = "#2563eb";
            confirmBtn.style.color = "#ffffff";
        }

        confirmBtn.onclick = async () => {
            overlay.remove();
            await onConfirm();
        };

        btnRow.append(cancelBtn, confirmBtn);
    } else {
        btnRow.append(cancelBtn);
    }
    modal.append(header, desc, btnRow);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
}

function checkProcessManagementEnabled() {
    if (currentPowerState.enabled === false) {
        if (app.extensionManager?.toast?.add) {
            app.extensionManager.toast.add({
                severity: "warn",
                summary: "🪐 Process Management Disabled",
                detail: "Enable 'Allow Process Management' in SaturnNodes settings to restart or shut down ComfyUI.",
                life: 7000
            });
        }
        openConfirmModal(
            "Process Management Disabled",
            "Server restart and shutdown controls are currently disabled for security.\n\nTo enable them, go to ComfyUI Settings ⚙️ -> SaturnNodes -> Pause Controls -> Turn ON 'Allow Process Management (Restart / Shutdown)'.",
            null,
            false
        );
        return false;
    }
    return true;
}

function closePowerPopup() {
    if (activePopup) {
        activePopup.remove();
        activePopup = null;
    }
}

async function powerFetch(endpointSuffix, options = {}) {
    let resp = await authenticatedFetch(`/saturnnodes/power/${endpointSuffix}`, options);
    if (!resp.ok) {
        resp = await authenticatedFetch(`/leafflow/power/${endpointSuffix}`, options);
    }
    return resp;
}

function showPowerSidePopup(anchorElement) {
    if (activePopup) {
        closePowerPopup();
        return;
    }

    const popup = document.createElement("div");
    popup.className = "help-center-popup sidebar-left leafflow-power-popup";
    popup.setAttribute("data-testid", "power-popup");

    const rect = anchorElement.getBoundingClientRect();
    popup.style.left = `${Math.round(rect.right + 8)}px`;
    popup.style.bottom = `${Math.max(12, Math.round(window.innerHeight - rect.bottom))}px`;

    const menu = document.createElement("div");
    menu.className = "help-center-menu flex flex-col items-start gap-1";
    menu.setAttribute("role", "menu");
    menu.setAttribute("aria-label", "Power Menu");

    const wrap = document.createElement("div");
    wrap.className = "w-full";

    const nav = document.createElement("nav");
    nav.className = "flex w-full flex-col gap-1";
    nav.setAttribute("role", "menubar");

    // Cancel Armed Action Button (if armed)
    if (currentPowerState.pending_action) {
        const cancelBtn = document.createElement("button");
        cancelBtn.type = "button";
        cancelBtn.className = "help-menu-item armed-cancel-item";
        cancelBtn.setAttribute("role", "menuitem");
        cancelBtn.innerHTML = `
            <div class="help-menu-icon-container"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg></div>
            <span class="menu-label">Cancel ${currentPowerState.pending_action.toUpperCase()}</span>
        `;
        cancelBtn.onclick = async (e) => {
            e.stopPropagation();
            closePowerPopup();
            await powerFetch("arm", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: null })
            });
            await fetchPowerStatus();
            if (app.extensionManager?.toast?.add) {
                app.extensionManager.toast.add({
                    severity: "info",
                    summary: "🪐 SaturnNodes Power",
                    detail: "Scheduled power action has been cancelled.",
                    life: 3000
                });
            }
        };
        nav.appendChild(cancelBtn);
    }

    // 1. Restart Server (Immediate)
    const restartItem = document.createElement("button");
    restartItem.type = "button";
    restartItem.className = "help-menu-item";
    restartItem.setAttribute("role", "menuitem");
    restartItem.innerHTML = `
        <div class="help-menu-icon-container"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"></polyline><polyline points="1 20 1 14 7 14"></polyline><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path></svg></div>
        <span class="menu-label">Restart Server (Immediate)</span>
    `;
    restartItem.onclick = (e) => {
        e.stopPropagation();
        closePowerPopup();
        if (!checkProcessManagementEnabled()) return;
        openConfirmModal(
            "Restart ComfyUI Immediately?",
            "Are you sure you want to restart ComfyUI immediately? Any active prompt generation will be interrupted.",
            async () => {
                const tokenResp = await powerFetch("request_token", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ action: "restart" })
                });
                if (!tokenResp.ok) {
                    const err = await tokenResp.json().catch(() => ({}));
                    if (app.extensionManager?.toast?.add) {
                        app.extensionManager.toast.add({
                            severity: "error",
                            summary: "🪐 Restart Denied",
                            detail: err.error || "Failed to obtain power action ticket.",
                            life: 6000
                        });
                    }
                    return;
                }
                const tokenData = await tokenResp.json();
                const resp = await powerFetch("confirm_action", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ ticket: tokenData.ticket, action: "restart" })
                });
                if (!resp.ok) {
                    const err = await resp.json().catch(() => ({}));
                    if (app.extensionManager?.toast?.add) {
                        app.extensionManager.toast.add({
                            severity: "error",
                            summary: "🪐 Restart Failed",
                            detail: err.error || "Failed to trigger restart.",
                            life: 6000
                        });
                    }
                    return;
                }
                if (app.extensionManager?.toast?.add) {
                    app.extensionManager.toast.add({
                        severity: "warn",
                        summary: "🔄 Restarting ComfyUI",
                        detail: "The server process is restarting. The UI will reload shortly.",
                        life: 8000
                    });
                }
                setTimeout(() => window.location.reload(), 2500);
            },
            true
        );
    };
    nav.appendChild(restartItem);

    // 2. Shutdown Server (Immediate)
    const shutdownItem = document.createElement("button");
    shutdownItem.type = "button";
    shutdownItem.className = "help-menu-item danger-item";
    shutdownItem.setAttribute("role", "menuitem");
    shutdownItem.innerHTML = `
        <div class="help-menu-icon-container"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18.36 6.64a9 9 0 1 1-12.73 0"></path><line x1="12" y1="2" x2="12" y2="12"></line></svg></div>
        <span class="menu-label">Shutdown Server (Immediate)</span>
    `;
    shutdownItem.onclick = (e) => {
        e.stopPropagation();
        closePowerPopup();
        if (!checkProcessManagementEnabled()) return;
        openConfirmModal(
            "Shutdown ComfyUI Server?",
            "Are you sure you want to SHUT DOWN the ComfyUI server immediately? The process will exit.",
            async () => {
                const tokenResp = await powerFetch("request_token", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ action: "shutdown" })
                });
                if (!tokenResp.ok) {
                    const err = await tokenResp.json().catch(() => ({}));
                    if (app.extensionManager?.toast?.add) {
                        app.extensionManager.toast.add({
                            severity: "error",
                            summary: "🪐 Shutdown Denied",
                            detail: err.error || "Failed to obtain power action ticket.",
                            life: 6000
                        });
                    }
                    return;
                }
                const tokenData = await tokenResp.json();
                const resp = await powerFetch("confirm_action", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ ticket: tokenData.ticket, action: "shutdown" })
                });
                if (!resp.ok) {
                    const err = await resp.json().catch(() => ({}));
                    if (app.extensionManager?.toast?.add) {
                        app.extensionManager.toast.add({
                            severity: "error",
                            summary: "🪐 Shutdown Failed",
                            detail: err.error || "Failed to trigger shutdown.",
                            life: 6000
                        });
                    }
                    return;
                }
                if (app.extensionManager?.toast?.add) {
                    app.extensionManager.toast.add({
                        severity: "error",
                        summary: "🛑 ComfyUI Shutting Down",
                        detail: "The server process is terminating.",
                        life: 6000
                    });
                }
            },
            true
        );
    };
    nav.appendChild(shutdownItem);

    // Divider
    const divider = document.createElement("div");
    divider.className = "menu-divider";
    nav.appendChild(divider);

    // 3. Restart After Queue Finish
    const restartQueueItem = document.createElement("button");
    restartQueueItem.type = "button";
    restartQueueItem.className = "help-menu-item";
    restartQueueItem.setAttribute("role", "menuitem");
    restartQueueItem.innerHTML = `
        <div class="help-menu-icon-container"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg></div>
        <span class="menu-label">Restart After Queue Finish</span>
    `;
    restartQueueItem.onclick = (e) => {
        e.stopPropagation();
        closePowerPopup();
        if (!checkProcessManagementEnabled()) return;
        openConfirmModal(
            "Schedule Restart After Queue Finish?",
            "ComfyUI will wait until all remaining prompts in the queue finish and the system returns to idle before restarting. (Note: If queue is paused, it will not restart).",
            async () => {
                const resp = await powerFetch("arm", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ action: "restart" })
                });
                if (!resp.ok) {
                    const err = await resp.json().catch(() => ({}));
                    if (app.extensionManager?.toast?.add) {
                        app.extensionManager.toast.add({
                            severity: "error",
                            summary: "🪐 Scheduling Failed",
                            detail: err.error || "Failed to schedule restart.",
                            life: 6000
                        });
                    }
                    return;
                }
                await fetchPowerStatus();
                if (app.extensionManager?.toast?.add) {
                    app.extensionManager.toast.add({
                        severity: "warn",
                        summary: "⏳ Restart Scheduled",
                        detail: "ComfyUI will restart automatically when the queue finishes.",
                        life: 6000
                    });
                }
            }
        );
    };
    nav.appendChild(restartQueueItem);

    // 4. Shutdown After Queue Finish
    const shutdownQueueItem = document.createElement("button");
    shutdownQueueItem.type = "button";
    shutdownQueueItem.className = "help-menu-item danger-item";
    shutdownQueueItem.setAttribute("role", "menuitem");
    shutdownQueueItem.innerHTML = `
        <div class="help-menu-icon-container"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path></svg></div>
        <span class="menu-label">Shutdown After Queue Finish</span>
    `;
    shutdownQueueItem.onclick = (e) => {
        e.stopPropagation();
        closePowerPopup();
        if (!checkProcessManagementEnabled()) return;
        openConfirmModal(
            "Schedule Shutdown After Queue Finish?",
            "ComfyUI will wait until all queued prompts complete and the system returns to idle before shutting down completely.",
            async () => {
                const resp = await powerFetch("arm", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ action: "shutdown" })
                });
                if (!resp.ok) {
                    const err = await resp.json().catch(() => ({}));
                    if (app.extensionManager?.toast?.add) {
                        app.extensionManager.toast.add({
                            severity: "error",
                            summary: "🪐 Scheduling Failed",
                            detail: err.error || "Failed to schedule shutdown.",
                            life: 6000
                        });
                    }
                    return;
                }
                await fetchPowerStatus();
                if (app.extensionManager?.toast?.add) {
                    app.extensionManager.toast.add({
                        severity: "warn",
                        summary: "🌙 Shutdown Scheduled",
                        detail: "ComfyUI will shut down automatically when the queue finishes.",
                        life: 6000
                    });
                }
            }
        );
    };
    nav.appendChild(shutdownQueueItem);

    wrap.appendChild(nav);
    menu.appendChild(wrap);
    popup.appendChild(menu);
    document.body.appendChild(popup);
    activePopup = popup;

    // Close on click outside or escape
    const outsideListener = (e) => {
        if (popup && !popup.contains(e.target) && !anchorElement.contains(e.target)) {
            closePowerPopup();
            document.removeEventListener("pointerdown", outsideListener);
            document.removeEventListener("keydown", keyListener);
        }
    };
    const keyListener = (e) => {
        if (e.key === "Escape") {
            closePowerPopup();
            document.removeEventListener("pointerdown", outsideListener);
            document.removeEventListener("keydown", keyListener);
        }
    };
    setTimeout(() => {
        document.addEventListener("pointerdown", outsideListener);
        document.addEventListener("keydown", keyListener);
    }, 10);
}

function attachBottomSidebarButton() {
    const bottomGroup = document.querySelector(".sidebar-item-group.mt-auto, .side-bar .mt-auto, [data-testid='bottom-sidebar']");
    if (!bottomGroup) return;

    if (document.getElementById("leafflow-power-bottom-btn")) {
        updateSidebarButtonVisuals();
        return;
    }

    const btn = document.createElement("button");
    btn.id = "leafflow-power-bottom-btn";
    btn.type = "button";
    btn.className = "relative inline-flex items-center justify-center gap-2 touch-manipulation whitespace-nowrap appearance-none font-medium font-inter transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([width]):not([height])]:size-4 [&_svg]:shrink-0 bg-transparent text-muted-foreground hover:bg-secondary-background-hover h-8 rounded-lg p-2 text-xs side-bar-button cursor-pointer border-none comfy-power-btn";
    btn.setAttribute("aria-label", "Power");
    btn.setAttribute("data-testid", "power-button");
    btn.setAttribute("data-pd-tooltip", "true");
    btn.setAttribute("title", "Power (Restart / Shutdown)");

    btn.innerHTML = `
        <div class="side-bar-button-content flex flex-col items-center gap-2">
            <div class="sidebar-icon-wrapper relative">
                ${getPowerIconSvg(18)}
            </div>
            <span class="side-bar-button-label line-clamp-2 w-max max-w-[calc(var(--sidebar-width)-var(--sidebar-padding))] text-center text-2xs wrap-break-word whitespace-normal">Power</span>
        </div>
    `;

    btn.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        showPowerSidePopup(btn);
    };

    // Insert at the top of the bottom group (above Help Center)
    bottomGroup.insertBefore(btn, bottomGroup.firstChild);
    updateSidebarButtonVisuals();
}

app.registerExtension({
    name: EXTENSION_NAME,
    async setup() {
        injectStyles();
        await fetchPowerStatus();

        // 1. Attach native button in bottom sidebar
        attachBottomSidebarButton();
        const observer = new MutationObserver(() => attachBottomSidebarButton());
        observer.observe(document.body, { childList: true, subtree: true });

        // 2. Fallback listener on any matching button
        setTimeout(() => {
            const btns = document.querySelectorAll('.comfy-power-btn, [aria-label*="Power"], .side-bar-button:has(.pi-power)');
            btns.forEach(b => {
                b.addEventListener("click", (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    showPowerSidePopup(b);
                }, true);
            });
            updateSidebarButtonVisuals();
        }, 1000);

        try {
            const handlePowerStatus = (e) => {
                currentPowerState = e.detail || currentPowerState;
                updateSidebarButtonVisuals();
            };
            api.addEventListener("saturnnodes_power_status", handlePowerStatus);
            api.addEventListener("leafflow_power_status", handlePowerStatus);
        } catch (_) {}

        setInterval(fetchPowerStatus, 3000);
    }
});

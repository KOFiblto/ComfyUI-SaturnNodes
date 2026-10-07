import { app } from "/scripts/app.js";
import { api } from "/scripts/api.js";
import { PreviewManager } from "./js/preview_manager.js";

/**
 * 🪐 SaturnNodes — Floating Live Latent Preview Dock
 *
 * Features:
 * 1. Integrates a crisp vector SVG button directly into the bottom-right floating island (Canvas Toolbar).
 * 2. Dynamic positioning: Dynamically tracks the minimap state.
 *    - Sits at the absolute lowest point possible right above the toolbar when minimap is disabled (~54px).
 *    - Automatically slides up to sit right above the minimap when minimap is enabled (~260px).
 *    - Pinned fully to the right (8px).
 * 3. Takes the exact shape/aspect ratio of the latent being generated.
 * 4. Full pixel-quality rendering on high-DPI canvas without compression or blur.
 * 5. Configurable settings (enable/disable, max size, auto-hide when idle).
 */

const STORAGE_KEY_VISIBLE = "SaturnNodes.LivePreview.FloatingDockVisible";

class FloatingLatentDock {
    constructor() {
        this.dockEl = null;
        this.canvasEl = null;
        this.btnEl = null;
        this.aspectBadge = null;
        this.statusBadge = null;
        this.currentImg = null;
        this.isVisible = this.loadInitialVisibility();
        this.isGenerating = false;
        this.latestSamplerId = null;

        // Inspecting Lightbox state (matching ComfyUI core MediaLightbox)
        this.lightboxEl = null;
        this.lightboxImg = null;
        this.lightboxBadge = null;
        this.lightboxPrevActive = null;
        this._lightboxKeyDown = null;

        this.init();
    }

    loadInitialVisibility() {
        if (typeof localStorage !== "undefined") {
            try {
                const stored = localStorage.getItem(STORAGE_KEY_VISIBLE);
                if (stored !== null) return stored === "true";
            } catch (_) {}
        }
        return true; // Default visible
    }

    saveVisibility(val) {
        this.isVisible = val;
        if (typeof localStorage !== "undefined") {
            try {
                localStorage.setItem(STORAGE_KEY_VISIBLE, String(val));
            } catch (_) {}
        }
        this.updateVisibility();
    }

    getSetting(id, defaultVal) {
        if (app?.ui?.settings) {
            const val = app.ui.settings.getSettingValue(id);
            if (val !== undefined && val !== null) return val;
        }
        return defaultVal;
    }

    getMaxWidth() {
        const val = this.getSetting("SaturnNodes.👁️ Live Preview.02a_FloatingDockMaxWidth", "280px");
        const parsed = parseInt(String(val), 10);
        return isNaN(parsed) || parsed < 50 ? 280 : parsed;
    }

    getMaxHeight() {
        const val = this.getSetting("SaturnNodes.👁️ Live Preview.02b_FloatingDockMaxHeight", "280px");
        const parsed = parseInt(String(val), 10);
        return isNaN(parsed) || parsed < 50 ? 280 : parsed;
    }

    init() {
        this.injectStyles();
        this.buildDockElement();
        this.registerWithPreviewManager();
        this.setupExecutionListeners();
        this.setupPositionObserver();
        this.injectToolbarButtonLoop();
    }

    injectStyles() {
        if (document.getElementById("saturn-floating-dock-styles")) return;
        const style = document.createElement("style");
        style.id = "saturn-floating-dock-styles";
        style.textContent = `
            #saturn-latent-floating-dock {
                position: fixed;
                right: 8px;
                bottom: 54px;
                z-index: 1050;
                display: flex;
                flex-direction: column;
                box-sizing: border-box;
                background: #09090b;
                border: 1px solid rgba(255, 255, 255, 0.16);
                border-radius: 8px;
                box-shadow: 0 10px 30px rgba(0, 0, 0, 0.65), 0 0 1px rgba(255, 255, 255, 0.2);
                overflow: hidden;
                pointer-events: auto;
                user-select: none;
                transition: bottom 0.2s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.2s ease, transform 0.2s ease;
                transform-origin: bottom right;
            }

            #saturn-latent-floating-dock.saturn-dock-hidden {
                opacity: 0;
                pointer-events: none;
                transform: scale(0.92);
                visibility: hidden;
            }

            .saturn-dock-header {
                position: absolute;
                top: 0;
                left: 0;
                right: 0;
                box-sizing: border-box;
                display: flex;
                align-items: center;
                justify-content: space-between;
                padding: 4px 6px;
                background: linear-gradient(180deg, rgba(0, 0, 0, 0.75) 0%, rgba(0, 0, 0, 0) 100%);
                gap: 4px;
                font-family: Inter, system-ui, -apple-system, sans-serif;
                font-size: 10px;
                color: #decbb2;
                font-weight: 500;
                line-height: 1;
                overflow: hidden;
                z-index: 10;
                pointer-events: none;
                opacity: 0.85;
                transition: opacity 0.15s ease;
            }

            #saturn-latent-floating-dock:hover .saturn-dock-header {
                opacity: 1;
            }

            .saturn-dock-title-group {
                display: flex;
                align-items: center;
                gap: 4px;
                overflow: hidden;
                min-width: 0;
            }

            .saturn-dock-icon {
                color: #f59e0b;
                display: flex;
                align-items: center;
                flex-shrink: 0;
            }

            .saturn-dock-badge {
                font-size: 9px;
                padding: 1px 4px;
                border-radius: 3px;
                background: rgba(0, 0, 0, 0.55);
                border: 1px solid rgba(255, 255, 255, 0.15);
                color: #e4e4e7;
                font-variant-numeric: tabular-nums;
                white-space: nowrap;
                flex-shrink: 0;
            }

            .saturn-dock-badge.generating {
                background: rgba(245, 158, 11, 0.3);
                color: #fcd34d;
                border: 1px solid rgba(245, 158, 11, 0.45);
            }

            .saturn-dock-btn {
                pointer-events: auto;
                background: rgba(0, 0, 0, 0.5);
                border: 1px solid rgba(255, 255, 255, 0.15);
                color: #a1a1aa;
                cursor: pointer;
                padding: 2px;
                border-radius: 4px;
                display: flex;
                align-items: center;
                justify-content: center;
                flex-shrink: 0;
                transition: color 0.15s, background 0.15s;
            }

            .saturn-dock-inspect-btn:hover {
                color: #38bdf8;
                background: rgba(56, 189, 248, 0.25);
            }

            .saturn-dock-close-btn:hover {
                color: #f43f5e;
                background: rgba(244, 63, 94, 0.25);
            }

            .saturn-dock-body {
                position: relative;
                width: 100%;
                height: 100%;
                box-sizing: border-box;
                display: flex;
                align-items: center;
                justify-content: center;
                background: #09090b;
                overflow: hidden;
            }

            .saturn-dock-canvas {
                display: block;
                width: 100%;
                height: 100%;
                object-fit: contain;
                image-rendering: -webkit-optimize-contrast;
                image-rendering: crisp-edges;
                cursor: pointer;
                transition: filter 0.15s ease;
            }

            .saturn-dock-canvas:hover {
                filter: brightness(1.08);
            }

            .saturn-dock-placeholder {
                display: flex;
                flex-direction: column;
                align-items: center;
                justify-content: center;
                gap: 6px;
                padding: 16px;
                color: #52525b;
                font-family: Inter, system-ui, sans-serif;
                font-size: 11px;
                text-align: center;
                width: 160px;
                height: 110px;
                cursor: pointer;
            }

            @keyframes saturn-lightbox-fade-in {
                from { opacity: 0; }
                to { opacity: 1; }
            }

            #saturn-latent-lightbox {
                animation: saturn-lightbox-fade-in 0.15s ease-out;
            }

            /* Toolbar button active highlight */
            .saturn-floating-dock-btn.saturn-dock-btn-active {
                color: #f59e0b !important;
                background: rgba(245, 158, 11, 0.15) !important;
                border-color: rgba(245, 158, 11, 0.35) !important;
            }
        `;
        document.head.appendChild(style);
    }

    buildDockElement() {
        if (document.getElementById("saturn-latent-floating-dock")) return;

        this.dockEl = document.createElement("div");
        this.dockEl.id = "saturn-latent-floating-dock";

        // Header
        const header = document.createElement("div");
        header.className = "saturn-dock-header";

        const titleGroup = document.createElement("div");
        titleGroup.className = "saturn-dock-title-group";

        const iconSpan = document.createElement("span");
        iconSpan.className = "saturn-dock-icon";
        iconSpan.innerHTML = `
            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                <rect width="18" height="18" x="3" y="3" rx="2" ry="2"/>
                <circle cx="12" cy="12" r="3"/>
                <path d="M7 12h.01M17 12h.01"/>
            </svg>
        `;

        const titleText = document.createElement("span");
        titleText.textContent = "Live Latent";
        this.titleTextEl = titleText;

        this.statusBadge = null;

        this.aspectBadge = document.createElement("span");
        this.aspectBadge.className = "saturn-dock-badge";
        this.aspectBadge.textContent = "--";

        titleGroup.appendChild(iconSpan);
        titleGroup.appendChild(titleText);
        titleGroup.appendChild(this.aspectBadge);

        const actionsGroup = document.createElement("div");
        actionsGroup.className = "saturn-dock-actions-group";
        actionsGroup.style.cssText = "display: flex; align-items: center; gap: 4px; pointer-events: auto;";

        const inspectBtn = document.createElement("button");
        inspectBtn.className = "saturn-dock-inspect-btn saturn-dock-btn";
        inspectBtn.title = "Inspect Latent in Lightbox";
        inspectBtn.type = "button";
        inspectBtn.innerHTML = `
            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="11" cy="11" r="8"/>
                <line x1="21" y1="21" x2="16.65" y2="16.65"/>
                <line x1="11" y1="8" x2="11" y2="14"/>
                <line x1="8" y1="11" x2="14" y2="11"/>
            </svg>
        `;
        inspectBtn.onclick = (e) => {
            e.stopPropagation();
            this.openLightbox();
        };

        const closeBtn = document.createElement("button");
        closeBtn.className = "saturn-dock-close-btn saturn-dock-btn";
        closeBtn.title = "Hide Floating Latent Dock";
        closeBtn.type = "button";
        closeBtn.innerHTML = `
            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M18 6 6 18M6 6l12 12"/>
            </svg>
        `;
        closeBtn.onclick = (e) => {
            e.stopPropagation();
            this.saveVisibility(false);
        };

        actionsGroup.appendChild(inspectBtn);
        actionsGroup.appendChild(closeBtn);

        header.appendChild(titleGroup);
        header.appendChild(actionsGroup);

        // Body with canvas
        const body = document.createElement("div");
        body.className = "saturn-dock-body";

        this.canvasEl = document.createElement("canvas");
        this.canvasEl.className = "saturn-dock-canvas";
        this.canvasEl.style.display = "none";
        this.canvasEl.title = "Click to inspect in Lightbox";
        this.canvasEl.onclick = (e) => {
            e.stopPropagation();
            this.openLightbox();
        };

        this.placeholderEl = document.createElement("div");
        this.placeholderEl.className = "saturn-dock-placeholder";
        this.placeholderEl.title = "Click to inspect in Lightbox";
        this.placeholderEl.onclick = (e) => {
            e.stopPropagation();
            this.openLightbox();
        };
        this.placeholderEl.innerHTML = `
            <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" style="opacity: 0.5;">
                <rect width="18" height="18" x="3" y="3" rx="2" ry="2"/>
                <circle cx="9" cy="9" r="2"/>
                <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>
            </svg>
            <span>Live Latent Preview</span>
        `;

        body.appendChild(this.canvasEl);
        body.appendChild(this.placeholderEl);

        this.dockEl.appendChild(header);
        this.dockEl.appendChild(body);

        document.body.appendChild(this.dockEl);
        this.updateVisibility();
        this.updatePosition();
    }

    openLightbox() {
        if (this.lightboxEl) {
            this.updateLightbox();
            return;
        }

        const prevActive = document.activeElement;

        // Container matching ComfyUI core MediaLightbox dialog:
        // role="dialog" aria-modal="true" aria-label="Gallery" data-mask tabindex="-1"
        const overlay = document.createElement("div");
        overlay.id = "saturn-latent-lightbox";
        overlay.setAttribute("role", "dialog");
        overlay.setAttribute("aria-modal", "true");
        overlay.setAttribute("aria-label", "Gallery");
        overlay.setAttribute("data-mask", "");
        overlay.setAttribute("tabindex", "-1");
        overlay.className = "comfy-media-lightbox fixed inset-0 z-9999 flex items-center justify-center bg-black/90 outline-none select-none";
        overlay.style.cssText = `
            position: fixed;
            inset: 0;
            z-index: 99999;
            display: flex;
            align-items: center;
            justify-content: center;
            background-color: rgba(0, 0, 0, 0.9);
            outline: none;
            user-select: none;
        `;

        // Close button: ComfyUI round icon button
        const closeBtn = document.createElement("button");
        closeBtn.type = "button";
        closeBtn.setAttribute("aria-label", "Close");
        closeBtn.title = "Close Lightbox (Esc)";
        closeBtn.className = "absolute top-4 right-4 z-10 rounded-full cursor-pointer";
        closeBtn.style.cssText = `
            position: absolute;
            top: 16px;
            right: 16px;
            z-index: 10;
            width: 36px;
            height: 36px;
            border-radius: 9999px;
            background: rgba(255, 255, 255, 0.12);
            color: #ffffff;
            border: 1px solid rgba(255, 255, 255, 0.15);
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: background 0.15s ease, transform 0.15s ease;
        `;
        closeBtn.innerHTML = `
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M18 6 6 18M6 6l12 12"/>
            </svg>
        `;
        closeBtn.onmouseenter = () => {
            closeBtn.style.background = "rgba(255, 255, 255, 0.25)";
            closeBtn.style.transform = "scale(1.05)";
        };
        closeBtn.onmouseleave = () => {
            closeBtn.style.background = "rgba(255, 255, 255, 0.12)";
            closeBtn.style.transform = "scale(1)";
        };
        closeBtn.onclick = (e) => {
            e.stopPropagation();
            this.closeLightbox();
        };

        // Center Image Wrapper
        const imgWrap = document.createElement("div");
        imgWrap.className = "relative flex max-h-[90vh] max-w-[90vw] items-center justify-center";
        imgWrap.style.cssText = `
            position: relative;
            display: flex;
            max-height: 90vh;
            max-width: 90vw;
            align-items: center;
            justify-content: center;
            pointer-events: auto;
        `;

        const lightboxImg = document.createElement("img");
        lightboxImg.className = "size-auto max-h-[90vh] max-w-[90vw] object-contain shadow-2xl rounded-sm pointer-events-auto";
        lightboxImg.alt = "Live Latent Preview";
        lightboxImg.style.cssText = `
            max-height: 90vh;
            max-width: 90vw;
            width: auto;
            height: auto;
            object-fit: contain;
            border-radius: 4px;
            box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.8);
            pointer-events: auto;
        `;

        // Dimensions / Status badge at bottom center matching ComfyUI pill style
        const badge = document.createElement("div");
        badge.className = "absolute bottom-4 left-1/2 -translate-x-1/2 z-10 px-3 py-1 rounded-full text-xs font-mono text-zinc-300 bg-black/60 border border-white/10 backdrop-blur-sm pointer-events-none";
        badge.style.cssText = `
            position: absolute;
            bottom: 16px;
            left: 50%;
            transform: translateX(-50%);
            z-index: 10;
            padding: 4px 12px;
            border-radius: 9999px;
            font-size: 11px;
            font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
            color: #d4d4d8;
            background: rgba(0, 0, 0, 0.65);
            border: 1px solid rgba(255, 255, 255, 0.12);
            backdrop-filter: blur(8px);
            pointer-events: none;
            display: flex;
            align-items: center;
            gap: 6px;
        `;

        imgWrap.appendChild(lightboxImg);
        overlay.appendChild(closeBtn);
        overlay.appendChild(imgWrap);
        overlay.appendChild(badge);

        this.lightboxEl = overlay;
        this.lightboxImg = lightboxImg;
        this.lightboxBadge = badge;
        this.lightboxPrevActive = prevActive;

        // Mask mousedown/mouseup logic (exact ComfyUI core MediaLightbox behavior)
        let maskTarget = null;
        overlay.onmousedown = (e) => {
            maskTarget = e.target;
        };
        overlay.onmouseup = (e) => {
            if (maskTarget === e.target && e.target.hasAttribute("data-mask")) {
                this.closeLightbox();
            }
        };

        // Keydown listener for Escape
        this._lightboxKeyDown = (e) => {
            if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                this.closeLightbox();
            }
        };
        window.addEventListener("keydown", this._lightboxKeyDown, true);

        document.body.appendChild(overlay);
        overlay.focus();

        this.updateLightbox();
    }

    updateLightbox() {
        if (!this.lightboxEl || !this.lightboxImg) return;

        const img = this.currentImg || PreviewManager.latestImage;
        let nw = 0;
        let nh = 0;

        if (img && (img.src || img.naturalWidth)) {
            if (this.lightboxImg.src !== img.src) {
                this.lightboxImg.src = img.src;
            }
            nw = img.naturalWidth || img.width || 0;
            nh = img.naturalHeight || img.height || 0;
            this.lightboxImg.style.display = "block";
        } else if (this.canvasEl && this.canvasEl.width > 0) {
            try {
                const dataUrl = this.canvasEl.toDataURL("image/png");
                if (this.lightboxImg.src !== dataUrl) {
                    this.lightboxImg.src = dataUrl;
                }
                nw = this.canvasEl.width;
                nh = this.canvasEl.height;
                this.lightboxImg.style.display = "block";
            } catch (_) {}
        } else {
            this.lightboxImg.style.display = "none";
        }

        if (this.lightboxBadge) {
            const statusText = this.isGenerating ? "● Sampling" : "● Live Latent";
            const dimsText = (nw && nh) ? `${nw}×${nh}` : "";
            this.lightboxBadge.innerHTML = `
                <span style="color: ${this.isGenerating ? '#f59e0b' : '#10b981'}; font-weight: 600;">${statusText}</span>
                ${dimsText ? `<span style="opacity: 0.5;">|</span><span>${dimsText}</span>` : ""}
            `;
        }
    }

    closeLightbox() {
        if (this._lightboxKeyDown) {
            window.removeEventListener("keydown", this._lightboxKeyDown, true);
            this._lightboxKeyDown = null;
        }
        if (this.lightboxEl) {
            this.lightboxEl.remove();
            this.lightboxEl = null;
            this.lightboxImg = null;
            this.lightboxBadge = null;
        }
        if (this.lightboxPrevActive && typeof this.lightboxPrevActive.focus === "function") {
            try {
                this.lightboxPrevActive.focus();
            } catch (_) {}
            this.lightboxPrevActive = null;
        }
    }

    registerWithPreviewManager() {
        const listener = {
            onNewPreview: (img, samplerId) => {
                this.onNewPreview(img, samplerId);
            }
        };
        PreviewManager.registerNode(listener);

        if (PreviewManager.latestImage) {
            this.onNewPreview(PreviewManager.latestImage, PreviewManager.latestSamplerId);
        }
    }

    setupExecutionListeners() {
        if (!api) return;

        api.addEventListener("execution_start", () => {
            this.isGenerating = true;
            if (this.statusBadge) {
                this.statusBadge.textContent = "Sampling";
                this.statusBadge.classList.add("generating");
            }
            if (this.getSetting("SaturnNodes.👁️ Live Preview.03_AutoHideWhenIdle", false) && this.isVisible) {
                this.dockEl?.classList.remove("saturn-dock-hidden");
            }
            if (this.lightboxEl) {
                this.updateLightbox();
            }
        });

        const handleExecutionEnd = () => {
            this.isGenerating = false;
            if (this.statusBadge) {
                this.statusBadge.textContent = "Done";
                this.statusBadge.classList.remove("generating");
            }
            if (this.getSetting("SaturnNodes.👁️ Live Preview.03_AutoHideWhenIdle", false)) {
                this.dockEl?.classList.add("saturn-dock-hidden");
            }
            if (this.lightboxEl) {
                this.updateLightbox();
            }
        };

        api.addEventListener("status", (e) => {
            const queueRemaining = e.detail?.exec_info?.queue_remaining ?? 0;
            if (queueRemaining === 0) {
                handleExecutionEnd();
            }
        });

        api.addEventListener("execution_interrupted", handleExecutionEnd);
        api.addEventListener("execution_error", handleExecutionEnd);
    }

    onNewPreview(img, samplerId) {
        if (!img || !this.canvasEl) return;
        this.currentImg = img;
        this.latestSamplerId = samplerId;

        const nw = img.naturalWidth || img.width;
        const nh = img.naturalHeight || img.height;
        if (!nw || !nh) return;

        const maxW = this.getMaxWidth();
        const maxH = this.getMaxHeight();
        const scale = Math.min(maxW / nw, maxH / nh);
        const tw = Math.max(1, Math.round(nw * scale));
        const th = Math.max(1, Math.round(nh * scale));

        // Full pixel quality rendering on native resolution
        this.canvasEl.width = nw;
        this.canvasEl.height = nh;
        this.canvasEl.style.width = `${tw}px`;
        this.canvasEl.style.height = `${th}px`;
        this.canvasEl.style.display = "block";

        if (this.dockEl) {
            this.dockEl.style.width = `${tw}px`;
            this.dockEl.style.height = `${th}px`;
            this.dockEl.style.minWidth = `${tw}px`;
            this.dockEl.style.maxWidth = `${tw}px`;
            this.dockEl.style.minHeight = `${th}px`;
            this.dockEl.style.maxHeight = `${th}px`;
        }
        if (this.titleTextEl) {
            this.titleTextEl.style.display = tw < 140 ? "none" : "inline";
        }
        if (this.statusBadge) {
            this.statusBadge.style.display = tw < 170 ? "none" : "inline";
        }
        if (this.aspectBadge) {
            this.aspectBadge.textContent = `${nw}×${nh}`;
            this.aspectBadge.style.display = tw < 100 ? "none" : "inline";
        }

        if (this.placeholderEl) {
            this.placeholderEl.style.display = "none";
        }

        const ctx = this.canvasEl.getContext("2d");
        if (ctx) {
            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = "high";
            ctx.drawImage(img, 0, 0, nw, nh);
        }

        if (this.lightboxEl) {
            this.updateLightbox();
        }

        this.requestPositionUpdate();
    }

    updateVisibility() {
        const isMasterEnabled = this.getSetting("SaturnNodes.👁️ Live Preview.01_EnableFloatingDock", true);
        const shouldShow = isMasterEnabled && this.isVisible;

        if (this.dockEl) {
            if (shouldShow) {
                this.dockEl.classList.remove("saturn-dock-hidden");
                this.updatePosition();
            } else {
                this.dockEl.classList.add("saturn-dock-hidden");
            }
        }

        if (this.btnEl) {
            if (isMasterEnabled) {
                this.btnEl.style.display = "inline-flex";
            } else {
                this.btnEl.style.display = "none";
            }

            if (this.isVisible && isMasterEnabled) {
                this.btnEl.classList.add("saturn-dock-btn-active");
            } else {
                this.btnEl.classList.remove("saturn-dock-btn-active");
            }
        }
    }

    updatePosition() {
        if (!this.dockEl) return;

        // 1. Detect if Minimap is currently present and visible in DOM
        const minimap = document.querySelector(".minimap-main-container, .litegraph-minimap");
        const isMinimapVisible = !!(
            minimap &&
            minimap.offsetParent !== null &&
            window.getComputedStyle(minimap).display !== "none" &&
            window.getComputedStyle(minimap).visibility !== "hidden" &&
            minimap.getBoundingClientRect().height > 20
        );

        // 2. Detect Bottom-Right Canvas Toolbar specifically
        let toolbar = null;
        if (this.btnEl && this.btnEl.isConnected && this.btnEl.parentElement) {
            toolbar = this.btnEl.parentElement;
        } else {
            // Find toolbar located in the bottom portion of viewport
            const candidates = document.querySelectorAll(
                '[role="toolbar"][aria-label*="canvasToolbar" i], [role="toolbar"][aria-label*="Canvas Toolbar" i], [role="toolbar"], .graph-canvas-menu, .canvas-toolbar'
            );
            for (const cand of candidates) {
                const r = cand.getBoundingClientRect();
                // Strictly bottom half of viewport (never top menu)
                if (r.top > window.innerHeight / 2 && r.height > 10) {
                    toolbar = cand;
                    break;
                }
            }
        }

        let bottomGap = 54; // clean fallback above bottom edge

        if (isMinimapVisible) {
            const mRect = minimap.getBoundingClientRect();
            if (mRect.top > 0 && mRect.top < window.innerHeight) {
                // Place dock flush 8px above the top of the minimap
                bottomGap = Math.round(window.innerHeight - mRect.top + 8);
            }
        } else if (toolbar) {
            const tRect = toolbar.getBoundingClientRect();
            // Ensure toolbar is actually in the bottom half of viewport
            if (tRect.top > window.innerHeight / 2 && tRect.top < window.innerHeight) {
                // Place dock flush 8px above the top of the bottom toolbar
                bottomGap = Math.round(window.innerHeight - tRect.top + 8);
            }
        }

        // Safety clamp: bottomGap must never push dock beyond upper half of screen
        bottomGap = Math.max(54, Math.min(bottomGap, Math.round(window.innerHeight * 0.75)));

        this.dockEl.style.bottom = `${bottomGap}px`;
        this.dockEl.style.right = "8px";
    }

    requestPositionUpdate() {
        if (!this.dockEl || this.dockEl.classList.contains("saturn-dock-hidden") || !this.isVisible) return;
        if (this._posUpdatePending) return;
        this._posUpdatePending = true;
        requestAnimationFrame(() => {
            this._posUpdatePending = false;
            this.updatePosition();
        });
    }

    setupPositionObserver() {
        // Track window resize (debounced via rAF)
        window.addEventListener("resize", () => this.requestPositionUpdate(), { passive: true });

        // Observe DOM structural changes only (minimap toggle / toolbar mount) without watching every subtree attribute
        const observer = new MutationObserver(() => {
            this.requestPositionUpdate();
        });

        observer.observe(document.body, {
            childList: true,
            subtree: false
        });
    }

    injectToolbarButtonLoop() {
        const tryInject = () => {
            if (this.btnEl && document.body.contains(this.btnEl)) return;

            const toolbar = document.querySelector(
                '[role="toolbar"][aria-label*="canvasToolbar" i], [role="toolbar"][aria-label*="Canvas Toolbar" i], .graph-canvas-menu, .canvas-toolbar'
            );
            if (!toolbar) return;

            this.createToolbarButton();

            // Find Minimap button or FitView button in the toolbar to place alongside it
            const minimapBtn = toolbar.querySelector('button[aria-label*="minimap" i], button[aria-label*="Minimap" i]');
            if (minimapBtn && minimapBtn.parentElement === toolbar) {
                toolbar.insertBefore(this.btnEl, minimapBtn.nextSibling);
            } else {
                toolbar.appendChild(this.btnEl);
            }

            this.updateVisibility();
            this.updatePosition();
        };

        tryInject();
        setInterval(tryInject, 1000);
    }

    createToolbarButton() {
        if (this.btnEl) return;

        this.btnEl = document.createElement("button");
        this.btnEl.id = "saturn-floating-dock-btn";
        this.btnEl.type = "button";
        this.btnEl.className = "saturn-floating-dock-btn size-8 bg-comfy-menu-bg p-0 hover:bg-interface-button-hover-surface! rounded-sm border border-transparent cursor-pointer flex items-center justify-center text-text-primary transition-colors";
        this.btnEl.title = "Toggle Live Latent Dock (SaturnNodes)";
        this.btnEl.setAttribute("aria-label", "Toggle Live Latent Dock");

        // Crisp vector SVG icon (No emoji)
        this.btnEl.innerHTML = `
            <svg class="w-4 h-4 text-neutral-300" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <rect width="18" height="18" x="3" y="3" rx="2" ry="2"/>
                <circle cx="12" cy="12" r="3"/>
                <path d="M7 12h.01M17 12h.01"/>
            </svg>
        `;

        this.btnEl.onclick = (e) => {
            e.stopPropagation();
            this.saveVisibility(!this.isVisible);
        };
    }
}

// Register extension
app.registerExtension({
    name: "ComfyUI.SaturnNodes.FloatingLatentDock",
    async setup() {
        // Initialize floating dock on client startup
        new FloatingLatentDock();
    }
});

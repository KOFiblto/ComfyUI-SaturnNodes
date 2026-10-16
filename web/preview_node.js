import { app } from "/scripts/app.js";
import { api } from "/scripts/api.js";
import { PreviewManager } from "./js/preview_manager.js";

// Global CSS injection to guarantee zero-expansion in Vue Node 2.0 and LiteGraph
if (typeof document !== "undefined") {
    const styleId = "saturnnodes-live-preview-styles";
    if (!document.getElementById(styleId)) {
        const style = document.createElement("style");
        style.id = styleId;
        style.textContent = `
            .saturnnodes-live-preview-container {
                position: absolute !important;
                inset: 0 !important;
                top: 70px !important;
                bottom: 40px !important;
                left: 8px !important;
                right: 8px !important;
                width: auto !important;
                height: auto !important;
                min-width: 0 !important;
                min-height: 0 !important;
                max-width: none !important;
                max-height: none !important;
                display: flex !important;
                align-items: center !important;
                justify-content: center !important;
                overflow: hidden !important;
                box-sizing: border-box !important;
                pointer-events: none !important;
            }
            .saturnnodes-live-preview-img {
                position: absolute !important;
                top: 0 !important;
                left: 0 !important;
                width: 100% !important;
                height: 100% !important;
                max-width: 100% !important;
                max-height: 100% !important;
                min-width: 0 !important;
                min-height: 0 !important;
                object-fit: contain !important;
                object-position: center !important;
                display: none;
                pointer-events: none !important;
            }
            [node-type="PreviewLatentLive"] {
                min-height: 0 !important;
                min-width: 0 !important;
            }
            [node-type="PreviewLatentLive"] .saturnnodes-live-preview-container {
                position: absolute !important;
            }
        `;
        document.head.appendChild(style);
    }
}

function isSamplerNode(type = "", title = "") {
    const lowerType = String(type).toLowerCase();
    const lowerTitle = String(title).toLowerCase();
    return lowerType.includes("sampler") || lowerType.includes("ksampler") || lowerType.includes("sample") || lowerType.includes("denoise") ||
           lowerTitle.includes("sampler") || lowerTitle.includes("ksampler") || lowerTitle.includes("sample") || lowerTitle.includes("denoise");
}

function getKSamplerNodes() {
    const samplers = [];
    const visitedNodes = new Set();

    const checkNode = (node, prefix = "") => {
        if (!node) return;
        const idStr = String(node.id ?? "");
        if (!idStr || visitedNodes.has(idStr)) return;

        const type = node.type || node.comfyClass || "";
        const title = node.title || node.type || `Node ${idStr}`;

        if (isSamplerNode(type, title)) {
            visitedNodes.add(idStr);
            const displayTitle = prefix ? `${prefix} > ${title}` : title;
            samplers.push({
                id: idStr,
                title: displayTitle
            });
        }

        // Deep subgraph / group exploration
        const sub = node.subgraph || node.inner_graph || (typeof node.getInnerGraph === "function" ? node.getInnerGraph() : null) || node.sub_nodes || node.nodes;
        if (sub) {
            traverseGraph(sub, title);
        }
    };

    const traverseGraph = (graph, prefix = "") => {
        if (!graph) return;
        let nodesList = [];
        if (Array.isArray(graph._nodes)) {
            nodesList = graph._nodes;
        } else if (Array.isArray(graph.nodes)) {
            nodesList = graph.nodes;
        } else if (graph._nodes_by_id) {
            nodesList = Object.values(graph._nodes_by_id);
        } else if (typeof graph.values === "function") {
            nodesList = Array.from(graph.values());
        }

        for (const node of nodesList) {
            checkNode(node, prefix);
        }
    };

    if (app) {
        if (app.graph) traverseGraph(app.graph);
        if (app.rootGraph && app.rootGraph !== app.graph) traverseGraph(app.rootGraph);
        if (app.canvas?.graph && app.canvas.graph !== app.graph) traverseGraph(app.canvas.graph);
    }

    // Comprehensive DOM search for any rendered nodes in canvas (Vue Node 2.0 and LiteGraph)
    if (typeof document !== "undefined") {
        document.querySelectorAll('[data-node-id], [data-widgets-grid-node-id], .lg-node, [node-id]').forEach(el => {
            const id = el.dataset.nodeId || el.dataset.widgetsGridNodeId || el.getAttribute('data-node-id') || el.getAttribute('node-id');
            if (!id || visitedNodes.has(String(id))) return;

            const headerEl = el.querySelector('[data-testid^="node-header-"], [data-testid="node-title"], .lg-node-header, .node-title');
            const text = (headerEl ? headerEl.innerText : el.innerText) || "";

            if (isSamplerNode("", text)) {
                visitedNodes.add(String(id));
                const titleMatch = text.match(/KSampler[^\n]*/i) || text.match(/Sampler[^\n]*/i) || text.match(/[^\n]+/);
                let title = titleMatch ? titleMatch[0].trim() : `Sampler (${id})`;
                if (title.length > 45) title = title.substring(0, 42) + "...";
                samplers.push({ id: String(id), title });
            }
        });
    }

    return samplers;
}

function updateAllPreviewNodeDropdowns() {
    if (!app || !app.graph) return;
    
    const previewNodes = [];
    const collectPreviewNodes = (g) => {
        if (!g) return;
        const list = g._nodes || g.nodes || (g._nodes_by_id ? Object.values(g._nodes_by_id) : []);
        if (Array.isArray(list)) {
            for (const n of list) {
                if (n && n.type === "PreviewLatentLive") previewNodes.push(n);
                if (n && n.subgraph) collectPreviewNodes(n.subgraph);
            }
        }
    };

    collectPreviewNodes(app.graph);
    if (app.rootGraph && app.rootGraph !== app.graph) collectPreviewNodes(app.rootGraph);

    const currentNodes = getKSamplerNodes();
    const currentValues = ["Auto", ...currentNodes.map(n => `${n.title} (${n.id})`)];
    
    for (const node of previewNodes) {
        const widget = node.widgets?.find(w => w.name === "Source");
        if (widget) {
            const currentVal = widget.value;
            widget.options = widget.options || {};
            widget.options.values = [...currentValues];
            
            if (currentVal && currentVal !== "Auto" && !currentValues.includes(currentVal)) {
                widget.options.values.push(currentVal);
            }
            if (typeof node.setDirtyCanvas === "function") {
                node.setDirtyCanvas(true, true);
            }
        }
    }
}

app.registerExtension({
    name: "ComfyUI.SaturnNodes.PreviewLatentLive",
    async setup() {
        PreviewManager.init(app, api);
        
        api.addEventListener("status", () => {
            updateAllPreviewNodeDropdowns();
        });

        if (typeof document !== "undefined") {
            document.addEventListener("pointerdown", (e) => {
                if (e.target && (e.target.closest?.('[data-testid="widget-select-default-trigger"]') || e.target.closest?.('.lg-node') || e.target.closest?.('[data-node-id]'))) {
                    updateAllPreviewNodeDropdowns();
                }
            }, { passive: true });
        }
    },
    async loadedGraph() {
        setTimeout(updateAllPreviewNodeDropdowns, 200);
        setTimeout(updateAllPreviewNodeDropdowns, 1000);
    },
    async nodeCreated(node) {
        if (node && node.type === "PreviewLatentLive") {
            setTimeout(updateAllPreviewNodeDropdowns, 100);
        }
    },
    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name === "PreviewLatentLive") {
            const onNodeCreated = nodeType.prototype.onNodeCreated;
            nodeType.prototype.onNodeCreated = function() {
                if (onNodeCreated) {
                    onNodeCreated.apply(this, arguments);
                }
                
                let widget = this.widgets?.find(w => w.name === "Source");
                if (!widget) {
                    widget = this.addWidget("combo", "Source", "Auto", (value) => {}, { values: ["Auto"] });
                }
                
                widget.callback = function() {
                    updateAllPreviewNodeDropdowns();
                };
                
                this.size = [200, 200];
                this.min_size = [80, 80];
                this.resizable = true;
                
                // Disallow automatic image aspect ratio resizing
                this.setSizeForImage = function() {};
                Object.defineProperty(this, "aspect_ratio", {
                    get() { return false; },
                    set(v) {},
                    configurable: true
                });

                this.imgs = [];
                this.imageIndex = 0;
                
                const viewContainer = document.createElement("div");
                viewContainer.className = "saturnnodes-live-preview-container";
                viewContainer.style.position = "absolute";
                viewContainer.style.inset = "0";
                viewContainer.style.top = "70px";
                viewContainer.style.bottom = "40px";
                viewContainer.style.left = "8px";
                viewContainer.style.right = "8px";
                viewContainer.style.display = "flex";
                viewContainer.style.alignItems = "center";
                viewContainer.style.justifyContent = "center";
                viewContainer.style.backgroundColor = "transparent";
                viewContainer.style.color = "#888";
                viewContainer.style.fontFamily = "Inter, sans-serif";
                viewContainer.style.fontSize = "13px";
                viewContainer.style.overflow = "hidden";
                viewContainer.style.boxSizing = "border-box";
                viewContainer.style.pointerEvents = "none";
                
                const fallbackText = document.createElement("div");
                fallbackText.className = "saturnnodes-live-preview-fallback";
                fallbackText.innerText = "Waiting for live preview...";
                viewContainer.appendChild(fallbackText);
                
                const imgElement = document.createElement("img");
                imgElement.className = "saturnnodes-live-preview-img";
                imgElement.style.position = "absolute";
                imgElement.style.top = "0";
                imgElement.style.left = "0";
                imgElement.style.width = "100%";
                imgElement.style.height = "100%";
                imgElement.style.maxWidth = "100%";
                imgElement.style.maxHeight = "100%";
                imgElement.style.minWidth = "0";
                imgElement.style.minHeight = "0";
                imgElement.style.objectFit = "contain";
                imgElement.style.objectPosition = "center";
                imgElement.style.display = "none";
                imgElement.style.pointerEvents = "none";
                viewContainer.appendChild(imgElement);
                
                this.previewImgElement = imgElement;
                this.previewFallbackText = fallbackText;
                
                this.addDOMWidget("preview_display", "HTML", viewContainer, {
                    getValue() { return ""; },
                    setValue(val) {},
                    serialize: false,
                    computeSize() { return [0, 0]; }
                });
                
                PreviewManager.registerNode(this);
                setTimeout(updateAllPreviewNodeDropdowns, 100);
            };

            nodeType.prototype.computeSize = function() {
                return [80, 80];
            };

            nodeType.prototype.setSizeForImage = function() {};

            nodeType.prototype.onResize = function(size) {
                if (size) {
                    this.size[0] = Math.max(80, size[0]);
                    this.size[1] = Math.max(80, size[1]);
                }
            };

            nodeType.prototype.onDrawBackground = function(ctx) {
                if (this.flags.collapsed) return;
                if (this.imgs && this.imgs.length) {
                    const img = this.imgs[this.imageIndex || 0];
                    if (!img || !img.complete || (img.naturalWidth === 0 && img.width === 0)) return;
                    
                    const margin = 8;
                    const topY = 50;
                    const maxW = Math.max(10, this.size[0] - margin * 2);
                    const maxH = Math.max(10, this.size[1] - topY - margin);
                    if (maxW <= 0 || maxH <= 0) return;
                    
                    const w = img.naturalWidth || img.width;
                    const h = img.naturalHeight || img.height;
                    const imgAspect = w / h;
                    
                    let drawW = maxW;
                    let drawH = maxW / imgAspect;
                    if (drawH > maxH) {
                        drawH = maxH;
                        drawW = maxH * imgAspect;
                    }
                    
                    const drawX = margin + (maxW - drawW) / 2;
                    const drawY = topY + (maxH - drawH) / 2;
                    
                    ctx.drawImage(img, drawX, drawY, drawW, drawH);
                }
            };

            const onRemoved = nodeType.prototype.onRemoved;
            nodeType.prototype.onRemoved = function() {
                if (onRemoved) {
                    onRemoved.apply(this, arguments);
                }
                PreviewManager.unregisterNode(this);
            };

            nodeType.prototype.onNewPreview = function(img, samplerId) {
                updateAllPreviewNodeDropdowns();
                const sourceWidget = this.widgets?.find(w => w.name === "Source");
                const selectedSource = sourceWidget ? sourceWidget.value : "Auto";
                
                if (selectedSource !== "Auto") {
                    const match = selectedSource.match(/\(([^)]+)\)$/);
                    if (match) {
                        const targetId = match[1];
                        if (samplerId && String(samplerId) !== String(targetId)) {
                            return;
                        }
                    }
                }
                
                this.imgs = [img];
                this.imageIndex = 0;
                
                if (typeof document !== "undefined") {
                    const domImgs = document.querySelectorAll(`[data-node-id="${this.id}"] .saturnnodes-live-preview-img, [data-widgets-grid-node-id="${this.id}"] .saturnnodes-live-preview-img`);
                    if (domImgs.length > 0) {
                        domImgs.forEach(imgEl => {
                            imgEl.src = img.src;
                            imgEl.style.display = "block";
                            const fallback = imgEl.parentElement?.querySelector(".saturnnodes-live-preview-fallback");
                            if (fallback) fallback.style.display = "none";
                        });
                    }
                }
                
                if (this.previewImgElement && this.previewFallbackText && img && img.src) {
                    this.previewFallbackText.style.display = "none";
                    this.previewImgElement.src = img.src;
                    this.previewImgElement.style.display = "block";
                }
                
                if (app.graph && typeof app.graph.setDirtyCanvas === "function") {
                    app.graph.setDirtyCanvas(true, true);
                }
            };
        }
    }
});

import { app } from "/scripts/app.js";
import { api } from "/scripts/api.js";

// Custom styles for the visual image picker
const visualStyles = document.createElement("style");
visualStyles.textContent = `
    .img-visual-container {
        width: 100%;
        display: flex;
        flex-direction: column;
        gap: 8px;
        padding: 8px;
        background: #111;
        border: 1px solid #222;
        border-radius: 6px;
        box-sizing: border-box;
        height: 100%;
        min-height: 0;
        max-height: 100%;
        overflow-y: hidden;
    }
    .img-visual-container::-webkit-scrollbar {
        width: 6px;
    }
    .img-visual-container::-webkit-scrollbar-track {
        background: rgba(0,0,0,0.1);
        border-radius: 4px;
    }
    .img-visual-container::-webkit-scrollbar-thumb {
        background: rgba(255,255,255,0.15);
        border-radius: 4px;
    }
    .img-visual-container::-webkit-scrollbar-thumb:hover {
        background: rgba(255,255,255,0.3);
    }
    .img-control-bar {
        display: flex;
        flex-direction: column;
        gap: 6px;
        margin-bottom: 8px;
        width: 100%;
        box-sizing: border-box;
    }
    .img-search-bar {
        width: 100%;
        padding: 6px 10px;
        background: #1c1c1c;
        border: 1px solid #333;
        border-radius: 4px;
        color: #fff;
        font-size: 11px;
        box-sizing: border-box;
    }
    .img-search-bar:focus {
        border-color: #007acc;
        outline: none;
    }
    .img-grid-container {
        flex: 1 1 0px;

        min-height: 0;
        max-height: 100%;
        overflow-y: auto;
        display: flex;
        flex-direction: column;
        gap: 8px;
        width: 100%;
        box-sizing: border-box;
        padding-right: 4px;
    }
    /* Webkit Scrollbar */
    .img-grid-container::-webkit-scrollbar {
        width: 6px;
    }
    .img-grid-container::-webkit-scrollbar-track {
        background: rgba(0,0,0,0.1);
    }
    .img-grid-container::-webkit-scrollbar-thumb {
        background: rgba(255,255,255,0.15);
        border-radius: 4px;
    }
    .img-grid-container::-webkit-scrollbar-thumb:hover {
        background: rgba(255,255,255,0.3);
    }

    .img-folder-container {
        display: flex;
        flex-direction: column;
        gap: 6px;
        width: 100%;
    }
    .img-folder-header {
        display: flex;
        align-items: center;
        padding: 5px 8px;
        background: linear-gradient(90deg, #1d1d1d, #141414);
        border: 1px solid #262626;
        border-radius: 4px;
        cursor: pointer;
        user-select: none;
        transition: background 0.15s, border-color 0.15s;
    }
    .img-folder-header:hover {
        background: linear-gradient(90deg, #242424, #1a1a1a);
        border-color: #383838;
    }
    .img-folder-toggle {
        font-size: 8px;
        color: #888;
        margin-right: 6px;
        transition: transform 0.2s ease-in-out;
    }
    .img-folder-header.collapsed .img-folder-toggle {
        transform: rotate(-90deg);
    }
    .img-folder-name {
        font-size: 11px;
        font-weight: bold;
        color: #d1d1d1;
        flex-grow: 1;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }
    .img-folder-count {
        font-size: 10px;
        color: #666;
    }
    .img-folder-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(var(--img-tile-size, 80px), 1fr));
        gap: 8px;
        padding: 4px 2px;
    }
    .img-folder-container.collapsed .img-folder-grid {
        display: none !important;
    }

    .img-tile {
        aspect-ratio: 1/1;
        background: #1a1a1a;
        border: 2px solid #333;
        border-radius: 6px;
        cursor: pointer;
        overflow: hidden;
        position: relative;
        box-sizing: border-box;
        transition: all 0.15s ease-in-out;
    }
    .img-tile:hover {
        border-color: #007acc;
        transform: scale(1.04);
    }
    .img-tile.selected {
        border-color: #00ff66 !important;
        border-width: 3px !important;
        box-shadow: 0 0 10px rgba(0, 255, 102, 0.4);
    }
    .img-tile img {
        width: 100%;
        height: 100%;
        object-fit: cover;
        position: absolute;
        top: 0;
        left: 0;
        opacity: 0;
        transition: opacity 0.2s ease-in-out;
    }
    .img-tile img.loaded {
        opacity: 1;
    }
    .img-tile-fallback {
        width: 100%;
        height: 100%;
        display: flex;
        align-items: center;
        justify-content: center;
        background: linear-gradient(135deg, #222, #111);
        color: #666;
        font-size: 9px;
        text-align: center;
        padding: 6px;
        box-sizing: border-box;
        word-break: break-all;
    }
    .img-tile-label {
        position: absolute;
        bottom: 0;
        width: 100%;
        background: rgba(0, 0, 0, 0.75);
        color: #ccc;
        font-size: 8px;
        padding: 2px;
        text-align: center;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        pointer-events: none;
    }
`;
document.head.appendChild(visualStyles);

app.registerExtension({
    name: "Comfy.ImageLoaderCustom",
    async nodeCreated(node) {
        const isVisualImageLoader = [
            "VisualImageLoader",
            "ImageLoaderVisualPrettyV2",
            "ImageLoaderCustom",
        ].includes(node.comfyClass) || [
            "VisualImageLoader",
            "ImageLoaderVisualPrettyV2",
            "ImageLoaderCustom",
        ].includes(node.type);

        if (isVisualImageLoader) {
            node.size = [380, 480];

            const folderWidget = node.widgets ? node.widgets.find(w => w.name === "folder_path") : null;

            const getHiddenWidget = (name, defaultVal) => {
                const widgets = node.widgets.filter(w => w.name === name);
                if (widgets.length > 1) {
                    for (let i = 1; i < widgets.length; i++) {
                        node.widgets.splice(node.widgets.indexOf(widgets[i]), 1);
                    }
                }
                if (widgets.length === 1) {
                    widgets[0].type = "hidden";
                    widgets[0].hidden = true;
                    widgets[0].computeSize = () => [0, 0];
                    return widgets[0];
                }
                const w = node.addWidget("text", name, defaultVal, () => {}, { serialize: true });
                w.type = "hidden";
                w.hidden = true;
                w.computeSize = () => [0, 0];
                return w;
            };
            const hiddenWidget = getHiddenWidget("_selected_image", "");

            // Create Visual HTML DOM Layout
            const viewContainer = document.createElement("div");
            viewContainer.className = "img-visual-container";

            // Isolate mouse wheel scroll events from triggering canvas zooming/panning
            viewContainer.addEventListener("wheel", (e) => {
                e.stopPropagation();
            });

            const controlBar = document.createElement("div");
            controlBar.className = "img-control-bar";
            controlBar.style.display = "flex";
            controlBar.style.flexDirection = "row";
            controlBar.style.gap = "6px";
            
            const refreshBtn = document.createElement("button");
            refreshBtn.innerHTML = "↻";
            refreshBtn.title = "Refresh Images";
            refreshBtn.style.background = "#1c1c1c";
            refreshBtn.style.border = "1px solid #333";
            refreshBtn.style.borderRadius = "4px";
            refreshBtn.style.color = "#fff";
            refreshBtn.style.cursor = "pointer";
            refreshBtn.style.padding = "4px 8px";
            refreshBtn.style.fontSize = "14px";
            refreshBtn.onmouseover = () => refreshBtn.style.background = "#333";
            refreshBtn.onmouseout = () => refreshBtn.style.background = "#1c1c1c";
            controlBar.appendChild(refreshBtn);

            const searchBar = document.createElement("input");
            searchBar.type = "text";
            searchBar.className = "img-search-bar";
            searchBar.placeholder = "Search images or positive prompts...";
            searchBar.style.flex = "1";
            controlBar.appendChild(searchBar);
            viewContainer.appendChild(controlBar);

            const gridContainer = document.createElement("div");
            gridContainer.className = "img-grid-container";
            viewContainer.appendChild(gridContainer);

            let userSavedHeight = 480;

            const applyDisplayMode = (mode) => {
                const isShowAll = mode === "Show All";
                if (isShowAll) {
                    viewContainer.style.setProperty("height", "auto", "important");
                    viewContainer.style.setProperty("max-height", "none", "important");
                    viewContainer.style.setProperty("overflow-y", "visible", "important");

                    gridContainer.style.setProperty("height", "auto", "important");
                    gridContainer.style.setProperty("max-height", "none", "important");
                    gridContainer.style.setProperty("overflow-y", "visible", "important");
                    gridContainer.style.setProperty("flex", "none", "important");

                    setTimeout(() => {
                        const contentH = gridContainer.scrollHeight || 0;
                        const neededHeight = contentH + 160;
                        node.setSize([node.size[0], Math.max(420, neededHeight)]);
                        if (app.graph) app.graph.setDirtyCanvas(true, true);
                    }, 50);
                } else {
                    viewContainer.classList.remove("show-all-mode");
                    viewContainer.classList.add("scrollable-mode");
                    const restoredH = node.userCustomHeight || userSavedHeight || 480;
                    const containerH = Math.max(180, restoredH - 150);
                    
                    viewContainer.style.setProperty("height", `${containerH}px`, "important");
                    viewContainer.style.setProperty("max-height", `${containerH}px`, "important");
                    viewContainer.style.setProperty("overflow-y", "hidden", "important");

                    gridContainer.style.setProperty("height", "100%", "important");
                    gridContainer.style.setProperty("max-height", "100%", "important");
                    gridContainer.style.setProperty("overflow-y", "auto", "important");
                    gridContainer.style.setProperty("flex", "1 1 0px", "important");

                    node.setSize([node.size[0], Math.max(420, restoredH)]);
                    if (app.graph) app.graph.setDirtyCanvas(true, true);
                }
            };

            node.computeSize = function() {
                const displayModeWidget = node.widgets ? node.widgets.find(w => w.name === "display_mode") : null;
                if (displayModeWidget && displayModeWidget.value === "Show All" && gridContainer) {
                    return [Math.max(380, node.size[0]), Math.max(420, (gridContainer.scrollHeight || 0) + 160)];
                }
                return [Math.max(380, node.size[0]), 420];
            };

            const updateNodeSize = () => {
                const displayModeWidget = node.widgets ? node.widgets.find(w => w.name === "display_mode") : null;
                const mode = displayModeWidget ? displayModeWidget.value : "Scrollable";
                applyDisplayMode(mode);
            };

            node.properties = node.properties || {};
            const initialZoom = node.properties["tile_size"] != null
                ? node.properties["tile_size"]
                : (localStorage.getItem("comfy_img_picker_zoom") || "80");
            node.properties["tile_size"] = parseInt(initialZoom);
            viewContainer.style.setProperty("--img-tile-size", `${initialZoom}px`);

            // Embed DOM Widget inside the node container
            const domWidget = node.addDOMWidget("img_visual_picker", "HTML", viewContainer, {
                getValue() { return getHiddenWidget("_selected_image", "").value; },
                setValue(val) { getHiddenWidget("_selected_image", "").value = val; },
                serialize: false,
                getMinHeight() { return 180; }
            });

            // In ComfyUI LiteGraph (V1), computeLayoutSize handles dynamic widget space distribution.
            // Removing computeSize avoids an infinite expansion loop in _arrangeWidgets.
            delete domWidget.computeSize;

            const onResize = node.onResize;
            node.onResize = function(size) {
                if (onResize) onResize.apply(this, arguments);
                const displayModeWidget = node.widgets ? node.widgets.find(w => w.name === "display_mode") : null;
                const isShowAll = displayModeWidget && displayModeWidget.value === "Show All";
                if (!isShowAll && size) {
                    node.userCustomHeight = size[1];
                    userSavedHeight = size[1];
                    if (viewContainer && viewContainer.style) {
                        const h = Math.max(180, size[1] - 150);
                        viewContainer.style.setProperty("height", `${h}px`, "important");
                        viewContainer.style.setProperty("max-height", `${h}px`, "important");
                    }
                }
            };

            // Zoom Slider Widget
            const zoomWidget = node.addWidget(
                "slider",
                "tile_size",
                parseInt(initialZoom),
                (val) => {
                    node.properties = node.properties || {};
                    node.properties["tile_size"] = val;
                    viewContainer.style.setProperty("--img-tile-size", `${val}px`);
                    if (app.graph) app.graph.setDirtyCanvas(true, true);
                },
                { min: 50, max: 200, step: 1 }
            );
            zoomWidget.serialize = false;

            let activeRequest = null;
            let debounceTimer = null;
            let imagesData = { names: [], mapping: {}, prompts: {} };
            let searchQuery = "";

            // Setup Intersection Observer for lazy loading image thumbnails
            const lazyObserver = new IntersectionObserver((entries) => {
                entries.forEach(entry => {
                    if (entry.isIntersecting) {
                        const tile = entry.target;
                        const img = tile.querySelector("img");
                        if (img && img.dataset.src) {
                            img.src = img.dataset.src;
                            img.removeAttribute("data-src");
                        }
                        lazyObserver.unobserve(tile);
                    }
                });
            }, { root: gridContainer, rootMargin: "200px 0px 200px 0px" });

            const renderGrid = () => {
                gridContainer.innerHTML = "";
                lazyObserver.disconnect();

                let folder = folderWidget ? (folderWidget.value || "") : "";
                const selectedVal = getHiddenWidget("_selected_image", "").value;

                // Group items by subfolder
                const foldersMap = {};
                foldersMap["Root"] = [];

                imagesData.names.forEach(relPath => {
                    const prompt = imagesData.prompts[relPath] || "";
                    
                    // Filter by search query if present (checks both path name and positive prompt text)
                    if (searchQuery) {
                        const query = searchQuery.toLowerCase();
                        const matchesPath = relPath.toLowerCase().includes(query);
                        const matchesPrompt = prompt.toLowerCase().includes(query);
                        
                        if (!matchesPath && !matchesPrompt) {
                            return;
                        }
                    }

                    const parts = relPath.split("/");
                    const subFolder = parts.length > 1 ? parts.slice(0, -1).join("/") : "Root";
                    const filename = parts[parts.length - 1];

                    if (!foldersMap[subFolder]) {
                        foldersMap[subFolder] = [];
                    }
                    foldersMap[subFolder].push({ relPath, filename });
                });

                // Sort folders: Root first, then alphabetically
                const sortedFolders = Object.keys(foldersMap).sort((a, b) => {
                    if (a === "Root") return -1;
                    if (b === "Root") return 1;
                    return a.localeCompare(b);
                });

                sortedFolders.forEach(subFolder => {
                    const items = foldersMap[subFolder];
                    if (items.length === 0) return;

                    const folderContainer = document.createElement("div");
                    folderContainer.className = "img-folder-container";
                    const isCollapsed = localStorage.getItem(`comfy_img_folder_collapsed_${subFolder}`) === "true";
                    if (isCollapsed) {
                        folderContainer.classList.add("collapsed");
                    }

                    // Folder Header
                    const header = document.createElement("div");
                    header.className = "img-folder-header";
                    if (isCollapsed) {
                        header.classList.add("collapsed");
                    }

                    const toggle = document.createElement("span");
                    toggle.className = "img-folder-toggle";
                    toggle.innerText = "▼";
                    header.appendChild(toggle);

                    const nameSpan = document.createElement("span");
                    nameSpan.className = "img-folder-name";
                    nameSpan.innerText = subFolder;
                    header.appendChild(nameSpan);

                    const countSpan = document.createElement("span");
                    countSpan.className = "img-folder-count";
                    countSpan.innerText = `(${items.length})`;
                    header.appendChild(countSpan);

                    header.addEventListener("click", () => {
                        const collapsed = folderContainer.classList.toggle("collapsed");
                        header.classList.toggle("collapsed", collapsed);
                        localStorage.setItem(`comfy_img_folder_collapsed_${subFolder}`, collapsed ? "true" : "false");
                        
                        // Populate grid nodes dynamically if expanded to save memory
                        if (!collapsed) {
                            populateGrid();
                        } else {
                            grid.innerHTML = "";
                        }
                    });

                    folderContainer.appendChild(header);

                    const grid = document.createElement("div");
                    grid.className = "img-folder-grid";
                    folderContainer.appendChild(grid);

                    const populateGrid = () => {
                        grid.innerHTML = "";
                        items.forEach(item => {
                            const tile = document.createElement("div");
                            tile.className = "img-tile";
                            tile.dataset.imagePath = item.relPath;

                            if (selectedVal === item.relPath) {
                                tile.classList.add("selected");
                            }

                            const img = document.createElement("img");
                            let fetchFolder = folder;
                            img.dataset.src = `/image_loader/get_thumbnail?folder=${encodeURIComponent(fetchFolder)}&image=${encodeURIComponent(item.relPath)}`;
                            img.onload = () => img.classList.add("loaded");
                            
                            img.onerror = () => {
                                img.remove();
                                const fallback = document.createElement("div");
                                fallback.className = "img-tile-fallback";
                                fallback.innerText = item.filename;
                                tile.prepend(fallback);
                            };
                            tile.appendChild(img);

                            const label = document.createElement("div");
                            label.className = "img-tile-label";
                            label.innerText = item.filename;
                            tile.appendChild(label);

                            tile.addEventListener("click", () => {
                                 const allTiles = gridContainer.querySelectorAll(".img-tile");
                                 allTiles.forEach(t => t.classList.remove("selected"));
                                 
                                 tile.classList.add("selected");
                                 const curWidget = getHiddenWidget("_selected_image", "");
                                 curWidget.value = item.relPath;
                                 if (curWidget.callback) curWidget.callback(item.relPath);
                                 
                                 // Mark the graph modified to force ComfyUI to re-run on selection change
                                 app.graph.change();
                                 node.triggerSlotEvent?.(0);
                             });

                            grid.appendChild(tile);
                            lazyObserver.observe(tile);
                        });
                    };

                    if (!isCollapsed) {
                        populateGrid();
                    }

                    gridContainer.appendChild(folderContainer);
                });
                setTimeout(() => updateNodeSize(), 50);
            };

            const updateImagesList = async () => {
                let folder = folderWidget ? (folderWidget.value || "") : "";
                const currentRequest = Symbol();
                activeRequest = currentRequest;

                try {
                    const response = await api.fetchApi(`/image_loader/get_images?folder=${encodeURIComponent(folder)}`);
                    if (activeRequest !== currentRequest) return;
                    
                    imagesData = await response.json();
                    renderGrid();
                } catch (e) {
                    console.error("Failed to load images", e);
                }
            };

            if (folderWidget) {
                folderWidget.callback = () => {
                    clearTimeout(debounceTimer);
                    debounceTimer = setTimeout(() => updateImagesList(), 350);
                };
            }
            
            refreshBtn.onclick = () => {
                refreshBtn.style.transform = "rotate(180deg)";
                refreshBtn.style.transition = "transform 0.3s";
                updateImagesList();
                setTimeout(() => {
                    refreshBtn.style.transform = "none";
                    refreshBtn.style.transition = "none";
                }, 300);
            };

            searchBar.addEventListener("input", () => {
                searchQuery = searchBar.value;
                clearTimeout(debounceTimer);
                debounceTimer = setTimeout(() => renderGrid(), 150);
            });

            const originalOnConfigure = node.onConfigure;
            node.onConfigure = function(config) {
                if (originalOnConfigure) originalOnConfigure.apply(this, arguments);

                const savedTileSize = (config && config.properties && config.properties["tile_size"] != null)
                    ? config.properties["tile_size"]
                    : (node.properties && node.properties["tile_size"] != null ? node.properties["tile_size"] : null);

                if (savedTileSize != null) {
                    node.properties = node.properties || {};
                    node.properties["tile_size"] = savedTileSize;
                    if (zoomWidget) {
                        zoomWidget.value = parseInt(savedTileSize);
                    }
                    if (viewContainer && viewContainer.style) {
                        viewContainer.style.setProperty("--img-tile-size", `${savedTileSize}px`);
                    }
                }

                const curWidget = getHiddenWidget("_selected_image", "");
                const widgetIndex = node.widgets.indexOf(curWidget);
                const savedValue = (config.widgets_values && widgetIndex !== -1) ? config.widgets_values[widgetIndex] : curWidget.value;
                if (savedValue) {
                    curWidget.value = savedValue;
                }
                setTimeout(() => updateImagesList(), 100);
            };

            setTimeout(() => {
                const displayModeWidget = node.widgets ? node.widgets.find(w => w.name === "display_mode") : null;
                if (displayModeWidget) {
                    const origCallback = displayModeWidget.callback;
                    displayModeWidget.callback = function(val) {
                        if (origCallback) origCallback.apply(this, arguments);
                        applyDisplayMode(val || displayModeWidget.value);
                    };
                    applyDisplayMode(displayModeWidget.value || "Scrollable");
                }
                updateImagesList();
            }, 100);
        }
    }
});

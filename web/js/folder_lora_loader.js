import { app } from "/scripts/app.js";
import { api } from "/scripts/api.js";

// Hash folder name to get a consistent color for the border
function getFolderBorderColor(folderName) {
    if (!folderName || folderName === "Root" || folderName === "[ NONE ]" || folderName === "[ RANDOM ]") return null;
    let hash = 5381;
    for (let i = 0; i < folderName.length; i++) {
        hash = ((hash << 5) + hash) + folderName.charCodeAt(i);
    }
    // Multiply by a large prime to distribute close values (like "1", "2", "3") widely across the 360 hue spectrum
    let h = Math.abs(hash * 2246822519) % 360;
    // Shift away from green spectrum (80-160) to avoid confusion with the selection highlight
    if (h >= 80 && h <= 160) {
        h = (h + 100) % 360;
    }
    return `hsl(${h}, 65%, 50%)`;
}

// Global CSS injection for the visual node styling
const visualStyles = document.createElement("style");
visualStyles.textContent = `
    .lora-visual-container.right-aligned-mode .lora-folder-grid,
    .lora-visual-container.right-aligned-mode .lora-none-container {
        display: flex !important;
        flex-wrap: wrap !important;
        justify-content: flex-end !important;
        gap: 8px !important;
    }
    .lora-visual-container .lora-folder-grid,
    .lora-visual-container .lora-none-container {
        display: flex !important;
        flex-wrap: wrap !important;
        justify-content: flex-start !important;
        gap: 8px !important;
    }
    .lora-visual-container .lora-tile {
        width: var(--lora-tile-size, 80px) !important;
        flex-shrink: 0 !important;
    }
    .lora-visual-container {
        width: 100%;
        display: flex;
        flex-direction: column;
        background: #111;
        border-radius: 8px;
        padding: 8px;
        box-sizing: border-box;
        height: 100%;
        min-height: 0;
        max-height: 100%;
        overflow-y: hidden;
    }
    .lora-grid-container {
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
    .lora-grid-container::-webkit-scrollbar {
        width: 6px;
    }
    .lora-grid-container::-webkit-scrollbar-track {
        background: rgba(0,0,0,0.1);
        border-radius: 4px;
    }
    .lora-grid-container::-webkit-scrollbar-thumb {
        background: rgba(255,255,255,0.15);
        border-radius: 4px;
    }
    .lora-grid-container::-webkit-scrollbar-thumb:hover {
        background: rgba(255,255,255,0.3);
    }
    .lora-visual-container.grid-layout {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(var(--lora-tile-size, 80px), 1fr));
    }
    .lora-visual-container.flex-layout {
        display: flex;
        flex-direction: column;
    }
    .lora-none-container {
        width: 100%;
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(var(--lora-tile-size, 80px), 1fr));
        margin-bottom: 10px;
    }
    .lora-control-bar {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 12px;
        padding: 4px 6px;
        background: #181818;
        border: 1px solid #282828;
        border-radius: 5px;
        margin-bottom: 8px;
        width: 100%;
        box-sizing: border-box;
    }
    .lora-toggle-container {
        display: flex;
        align-items: center;
        gap: 6px;
    }
    .lora-toggle-label {
        font-size: 10px;
        color: #888;
        font-weight: bold;
        margin-right: 4px;
    }
    .lora-toggle-btn {
        background: #252525;
        border: 1px solid #353535;
        color: #aaa;
        font-size: 9px;
        font-weight: bold;
        padding: 3px 8px;
        border-radius: 4px;
        cursor: pointer;
        transition: all 0.15s ease-in-out;
    }
    .lora-toggle-btn:hover {
        background: #303030;
        color: #fff;
    }
    .lora-toggle-btn.active {
        background: #007acc;
        border-color: #0098ff;
        color: #fff;
        box-shadow: 0 0 5px rgba(0, 122, 204, 0.4);
    }
    .lora-folder-container {
        display: flex;
        flex-direction: column;
        gap: 6px;
        margin-bottom: 12px;
        width: 100%;
    }
    .lora-folder-header {
        display: flex;
        align-items: center;
        padding: 6px 10px;
        background: linear-gradient(90deg, #1d1d1d, #141414);
        border: 1px solid #262626;
        border-radius: 5px;
        cursor: pointer;
        user-select: none;
        transition: background 0.15s, border-color 0.15s;
    }
    .lora-folder-header:hover {
        background: linear-gradient(90deg, #242424, #1a1a1a);
        border-color: #383838;
    }
    .lora-folder-toggle {
        font-size: 9px;
        color: #888;
        margin-right: 8px;
        transition: transform 0.2s ease-in-out;
    }
    .lora-folder-header.collapsed .lora-folder-toggle {
        transform: rotate(-90deg);
    }
    .lora-folder-name {
        font-size: 11px;
        font-weight: bold;
        color: #d1d1d1;
        flex-grow: 1;
    }
    .lora-folder-count {
        font-size: 10px;
        color: #555;
        margin-right: 10px;
    }
    .lora-folder-checkbox {
        cursor: pointer;
        width: 13px;
        height: 13px;
        accent-color: #007acc;
        margin: 0;
    }
    .lora-folder-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(var(--lora-tile-size, 80px), 1fr));
        gap: 8px;
        padding: 4px 2px;
    }
    .right-aligned-mode .lora-folder-grid {
        direction: rtl;
    }
    .right-aligned-mode .lora-tile {
        direction: ltr;
    }
    .right-aligned-mode .lora-folder-header {
        flex-direction: row-reverse;
    }
    .right-aligned-mode .lora-folder-toggle {
        margin-right: 0;
        margin-left: 8px;
    }
    .right-aligned-mode .lora-folder-count {
        margin-right: 0;
        margin-left: 10px;
    }
    .lora-folder-container.collapsed .lora-folder-grid {
        display: none !important;
    }
    .lora-tile {
        aspect-ratio: 3/4;
        background: #1a1a1a;
        border: 2px solid #333;
        border-radius: 6px;
        cursor: pointer;
        display: flex;
        flex-direction: column;
        justify-content: flex-end;
        align-items: center;
        overflow: hidden;
        position: relative;
        box-sizing: border-box;
        transition: all 0.15s ease-in-out;
    }
    .lora-tile:hover {
        border-color: #007acc;
        transform: scale(1.03);
    }
    .lora-tile.selected {
        border-color: #00ff66 !important;
        border-width: 4px !important;
        box-shadow: 0 0 12px rgba(0, 255, 102, 0.5);
    }
    .lora-tile img {
        width: 100%;
        height: 100%;
        object-fit: cover;
        position: absolute;
        top: 0;
        left: 0;
    }
    .lora-tile-fallback {
        width: 100%;
        height: 100%;
        display: flex;
        align-items: center;
        justify-content: center;
        background: linear-gradient(135deg, #222, #111);
        color: #888;
        font-size: 10px;
        text-align: center;
        padding: 10px;
        box-sizing: border-box;
    }
    .lora-tile-none {
        background: linear-gradient(135deg, #a80000, #3a0000) !important;
        color: #fff !important;
        font-weight: bold;
    }
    .lora-tile-random {
        background: linear-gradient(135deg, #a85500, #3a1a00) !important;
        color: #fff !important;
        font-weight: bold;
    }
    .lora-tile-label {
        position: absolute;
        bottom: 0;
        width: 100%;
        background: rgba(0, 0, 0, 0.85);
        color: #fff;
        font-size: 10px;
        padding: 4px 2px;
        text-align: center;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        border-top: 1px solid #222;
    }
    .lora-tile-badge {
        position: absolute;
        top: 4px;
        right: 4px;
        background: rgba(0, 122, 204, 0.85);
        color: #fff;
        font-size: 8px;
        font-weight: bold;
        padding: 1px 4px;
        border-radius: 8px;
        pointer-events: none;
        z-index: 2;
        border: 1px solid rgba(255, 255, 255, 0.1);
        box-shadow: 0 1px 3px rgba(0,0,0,0.3);
    }
    /* Top 3 Badges styling */
    .lora-tile-badge.rank-1 {
        background: linear-gradient(135deg, #ffd700, #ffaa00) !important;
        color: #000 !important;
        border: 1px solid #fff !important;
        box-shadow: 0 0 6px rgba(255, 215, 0, 0.8) !important;
    }
    .lora-tile-badge.rank-2 {
        background: linear-gradient(135deg, #e0e0e0, #9e9e9e) !important;
        color: #000 !important;
        border: 1px solid #fff !important;
        box-shadow: 0 0 6px rgba(224, 224, 224, 0.8) !important;
    }
    .lora-tile-badge.rank-3 {
        background: linear-gradient(135deg, #cd7f32, #8c521f) !important;
        color: #fff !important;
        border: 1px solid #fff !important;
        box-shadow: 0 0 6px rgba(205, 127, 50, 0.8) !important;
    }

    /* Over 100x Special Effects & Animations */
    @keyframes pulseGold100 {
        0% { box-shadow: 0 0 8px #ffd700, inset 0 0 4px #ffe600; border-color: #ffd700; }
        50% { box-shadow: 0 0 20px #ffaa00, inset 0 0 10px #ffea00; border-color: #ffffff; }
        100% { box-shadow: 0 0 8px #ffd700, inset 0 0 4px #ffe600; border-color: #ffd700; }
    }
    @keyframes pulseSilver100 {
        0% { box-shadow: 0 0 8px #e2e8f0, inset 0 0 4px #ffffff; border-color: #cbd5e1; }
        50% { box-shadow: 0 0 20px #ffffff, inset 0 0 10px #f8fafc; border-color: #ffffff; }
        100% { box-shadow: 0 0 8px #e2e8f0, inset 0 0 4px #ffffff; border-color: #cbd5e1; }
    }
    @keyframes pulseBronze100 {
        0% { box-shadow: 0 0 8px #cd7f32, inset 0 0 4px #d97706; border-color: #cd7f32; }
        50% { box-shadow: 0 0 20px #f59e0b, inset 0 0 10px #fbbf24; border-color: #ffedd5; }
        100% { box-shadow: 0 0 8px #cd7f32, inset 0 0 4px #d97706; border-color: #cd7f32; }
    }
    @keyframes pulseOver100 {
        0% { box-shadow: 0 0 6px #a855f7; border-color: #a855f7; }
        50% { box-shadow: 0 0 16px #c084fc; border-color: #e9d5ff; }
        100% { box-shadow: 0 0 6px #a855f7; border-color: #a855f7; }
    }

    .lora-tile.rank-1-100:not(.selected) {
        animation: pulseGold100 2s infinite ease-in-out !important;
    }
    .lora-tile.rank-2-100:not(.selected) {
        animation: pulseSilver100 2s infinite ease-in-out !important;
    }
    .lora-tile.rank-3-100:not(.selected) {
        animation: pulseBronze100 2s infinite ease-in-out !important;
    }
    .lora-tile.over-100:not(.selected) {
        animation: pulseOver100 2s infinite ease-in-out !important;
    }

    .lora-tile-badge.rank-1-100 {
        background: linear-gradient(135deg, #fff700, #ff8800) !important;
        color: #000 !important;
        border: 1.5px solid #ffffff !important;
        box-shadow: 0 0 10px #ffd700 !important;
        font-weight: 900 !important;
    }
    .lora-tile-badge.rank-2-100 {
        background: linear-gradient(135deg, #ffffff, #64748b) !important;
        color: #000 !important;
        border: 1.5px solid #ffffff !important;
        box-shadow: 0 0 10px #f8fafc !important;
        font-weight: 900 !important;
    }
    .lora-tile-badge.rank-3-100 {
        background: linear-gradient(135deg, #f59e0b, #78350f) !important;
        color: #fff !important;
        border: 1.5px solid #ffffff !important;
        box-shadow: 0 0 10px #f59e0b !important;
        font-weight: 900 !important;
    }
    .lora-tile-badge.over-100 {
        background: linear-gradient(135deg, #a855f7, #581c87) !important;
        color: #fff !important;
        border: 1.5px solid #f3e8ff !important;
        box-shadow: 0 0 10px #c084fc !important;
        font-weight: 900 !important;
    }

    /* Top 3 Glow styling for non-selected tiles */
    .lora-tile.rank-1:not(.selected) {
        border-color: #ffd700 !important;
        box-shadow: 0 0 8px rgba(255, 215, 0, 0.3) !important;
    }
    .lora-tile.rank-2:not(.selected) {
        border-color: #c0c0c0 !important;
        box-shadow: 0 0 8px rgba(192, 192, 192, 0.3) !important;
    }
    .lora-tile.rank-3:not(.selected) {
        border-color: #cd7f32 !important;
        box-shadow: 0 0 8px rgba(205, 127, 50, 0.3) !important;
    }
`;
document.head.appendChild(visualStyles);

app.registerExtension({
    name: "Comfy.FolderLoraLoader",
    async nodeCreated(node) {
        // --- 1. ORIGINAL DROPDOWN NODES ---
        if (node.comfyClass === "FolderLoraLoader" || node.comfyClass === "FolderLoraLoaderPretty" || node.type === "FolderLoraLoader" || node.type === "FolderLoraLoaderPretty") {
            const folderWidget = node.widgets.find(w => w.name === "folder");
            const loraWidget = node.widgets.find(w => w.name === "lora_name");
            
            let hiddenWidget = node.widgets.find(w => w.name === "_selected_lora");
            if (!hiddenWidget) {
                hiddenWidget = node.addWidget("text", "_selected_lora", "[ NONE ]", () => {}, { serialize: true });
            }
            hiddenWidget.type = "hidden";
            hiddenWidget.hidden = true;
            hiddenWidget.computeSize = () => [0, 0];

            if (folderWidget && loraWidget) {
                let activeRequest = null;
                let debounceTimer = null;

                const updateLoras = async (forceValue = null) => {
                    const folder = folderWidget.value || "";
                    const pretty = node.comfyClass === "FolderLoraLoaderPretty";
                    const currentRequest = Symbol();
                    activeRequest = currentRequest;

                    try {
                        const response = await api.fetchApi(`/folder_lora_loader/get_loras?folder=${encodeURIComponent(folder)}&pretty=${pretty}`);
                        if (activeRequest !== currentRequest) return;
                        const data = await response.json();
                        
                        let targetValue = forceValue !== null ? forceValue : (hiddenWidget.value || loraWidget.value);
                        loraWidget.options.values = data.names;

                        if (data.names.includes(targetValue)) {
                            loraWidget.value = targetValue;
                        } else {
                            let found = false;
                            for (const [displayName, systemPath] of Object.entries(data.mapping)) {
                                if (systemPath === targetValue || displayName === targetValue) {
                                    loraWidget.value = displayName;
                                    hiddenWidget.value = displayName;
                                    found = true;
                                    break;
                                }
                            }
                            if (!found) {
                                loraWidget.value = "[ NONE ]";
                                hiddenWidget.value = "[ NONE ]";
                            }
                        }
                        node.triggerSlotEvent?.(0);
                    } catch (e) {
                        console.error("Failed to fetch filtered LoRAs", e);
                    }
                };

                loraWidget.callback = function(value) {
                    hiddenWidget.value = value;
                };

                folderWidget.callback = () => {
                    clearTimeout(debounceTimer);
                    debounceTimer = setTimeout(() => updateLoras(), 350);
                };

                const originalOnConfigure = node.onConfigure;
                node.onConfigure = function(config) {
                    if (originalOnConfigure) originalOnConfigure.apply(this, arguments);
                    
                    const widgetIndex = node.widgets.indexOf(hiddenWidget);
                    const savedHiddenValue = (config.widgets_values && widgetIndex !== -1) ? config.widgets_values[widgetIndex] : hiddenWidget.value;
                    
                    if (savedHiddenValue) {
                        hiddenWidget.value = savedHiddenValue;
                        loraWidget.options.values = [savedHiddenValue, "[ NONE ]"];
                        loraWidget.value = savedHiddenValue;
                        setTimeout(() => updateLoras(savedHiddenValue), 100);
                    }
                };

                setTimeout(() => {
                    const initValue = hiddenWidget.value || loraWidget.value;
                    if (initValue && initValue !== "[ NONE ]") {
                        loraWidget.options.values = [initValue, "[ NONE ]"];
                        loraWidget.value = initValue;
                    }
                    updateLoras(initValue);
                }, 50);
            }
        }

        // --- 2. VISUAL PRETTY PICKER V1 ---
        if (node.comfyClass === "FolderLoraLoaderVisualPretty") {
            // Force node size to look wide and accommodate the visual picker viewport
            node.size = [380, 320];

            node.computeSize = function() {
                return [380, 320];
            };

            const folderWidget = node.widgets.find(w => w.name === "folder");
            
            const getHiddenWidget = (name, defaultVal) => {
                const widgets = node.widgets.filter(w => w.name === name);
                if (widgets.length > 1) {
                    for (let i = 1; i < widgets.length; i++) {
                        node.widgets.splice(node.widgets.indexOf(widgets[i]), 1);
                    }
                }
                if (widgets.length === 1) {
                    widgets[0].hidden = true;
                    widgets[0].computeSize = () => [0, 0];
                    return widgets[0];
                }
                const w = node.addWidget("text", name, defaultVal, () => {}, { serialize: true });
                w.hidden = true;
                w.computeSize = () => [0, 0];
                return w;
            };
            const hiddenWidget = getHiddenWidget("_selected_lora", "[ NONE ]");

            // Create Visual HTML DOM Element
            const viewContainer = document.createElement("div");
            viewContainer.className = "lora-visual-container grid-layout";
            node.properties = node.properties || {};
            const initialZoom = node.properties["tile_size"] != null
                ? node.properties["tile_size"]
                : (localStorage.getItem("comfy_lora_picker_zoom") || "80");
            node.properties["tile_size"] = parseInt(initialZoom);
            viewContainer.style.setProperty("--lora-tile-size", `${initialZoom}px`);

            // Embed DOM Widget inside the node container
            const domWidget = node.addDOMWidget("lora_visual_picker", "HTML", viewContainer, {
                getValue() { return getHiddenWidget().value; },
                setValue(val) { getHiddenWidget().value = val; },
                serialize: false
            });

            // Detect Vue UI vs LiteGraph by checking for the Vue container class eventually
            const isVueUI = !!document.querySelector(".lg-node");
            if (isVueUI) {
                viewContainer.classList.add("vue-mode");
                viewContainer.style.height = "160px";
            } else {
                viewContainer.classList.add("litegraph-mode");
                const onResize = node.onResize;
                node.onResize = function(size) {
                    if (onResize) onResize.apply(this, arguments);
                    if (viewContainer.style) {
                        viewContainer.style.height = `${size[1] - 160}px`;
                    }
                };
            }

            // Adjust sizing constraints dynamically
            domWidget.computeSize = function() {
                return [node.size[0] - 30, node.size[1] - 160];
            };

            // Add Zoom slider widget
            const zoomWidget = node.addWidget(
                "slider",
                "tile_size",
                parseInt(initialZoom),
                (val) => {
                    node.properties = node.properties || {};
                    node.properties["tile_size"] = val;
                    viewContainer.style.setProperty("--lora-tile-size", `${val}px`);
                    if (app.graph) app.graph.setDirtyCanvas(true, true);
                },
                { min: 50, max: 180, step: 1 }
            );
            zoomWidget.serialize = false;

            let activeRequest = null;
            let debounceTimer = null;

            const updateVisualGrid = async () => {
                const folder = folderWidget.value || "";
                const currentRequest = Symbol();
                activeRequest = currentRequest;

                try {
                    const response = await api.fetchApi(`/folder_lora_loader/get_loras?folder=${encodeURIComponent(folder)}&pretty=true`);
                    if (activeRequest !== currentRequest) return;
                    const data = await response.json();

                    viewContainer.innerHTML = "";

                    // Calculate Top 3 Ranks by versionless pretty name
                    const getTop3Ranks = () => {
                        const prettyCounts = {};
                        if (data.usage && data.mapping) {
                            Object.entries(data.mapping).forEach(([displayName, systemPath]) => {
                                const count = data.usage[systemPath] || 0;
                                if (count > 0) {
                                    let prettyName = displayName;
                                    if (prettyName.includes(" - ")) {
                                        prettyName = prettyName.split(" - ", 2)[1];
                                    }
                                    prettyName = prettyName.replace(/\s+V\d+(\.\d+)?$/i, "").trim();
                                    prettyCounts[prettyName] = Math.max(prettyCounts[prettyName] || 0, count);
                                }
                            });
                        }
                        
                        const sorted = Object.entries(prettyCounts)
                            .sort((a, b) => b[1] - a[1]);
                            
                        const ranks = { rank1: [], rank2: [], rank3: [] };
                        const uniqueCounts = [...new Set(sorted.map(x => x[1]))];
                        
                        sorted.forEach(([name, count]) => {
                            if (count === uniqueCounts[0]) ranks.rank1.push(name);
                            else if (count === uniqueCounts[1]) ranks.rank2.push(name);
                            else if (count === uniqueCounts[2]) ranks.rank3.push(name);
                        });
                        return ranks;
                    };
                    const ranks = getTop3Ranks();

                    // Helper to create special tiles (NONE and RANDOM)
                    const createSpecialTile = (name, labelText, borderCol, bgClass) => {
                        const tile = document.createElement("div");
                        tile.className = "lora-tile " + bgClass;
                        tile.dataset.loraName = name;
                        tile.style.borderColor = borderCol;
                        tile.dataset.folderColor = borderCol;

                        const curWidget = getHiddenWidget();
                        const hiddenVal = curWidget.value;
                        if (hiddenVal === name) {
                            tile.className += " selected";
                            tile.style.borderColor = "#00ff66";
                        }

                        const fallback = document.createElement("div");
                        fallback.className = "lora-tile-fallback " + bgClass;
                        fallback.innerText = labelText;
                        tile.appendChild(fallback);

                        const label = document.createElement("div");
                        label.className = "lora-tile-label";
                        label.innerText = labelText;
                        tile.appendChild(label);

                        tile.addEventListener("click", () => {
                            const siblings = viewContainer.querySelectorAll(".lora-tile");
                            siblings.forEach(s => {
                                s.classList.remove("selected");
                                if (s.dataset.folderColor) {
                                    s.style.borderColor = s.dataset.folderColor;
                                } else {
                                    s.style.borderColor = "";
                                }
                            });
                            tile.classList.add("selected");
                            tile.style.borderColor = "#00ff66";
                            
                            const w = getHiddenWidget();
                            w.value = name;
                            if (w.callback) w.callback(name);
                            node.triggerSlotEvent?.(0);
                        });

                        viewContainer.appendChild(tile);
                    };

                    // NONE and RANDOM tiles at the top
                    createSpecialTile("[ NONE ]", "NONE", "#ff3333", "lora-tile-none");
                    createSpecialTile("[ RANDOM ]", "RANDOM", "#ffaa00", "lora-tile-random");

                    data.names.forEach(loraName => {
                        if (loraName === "[ NONE ]" || loraName === "[ RANDOM ]") return;

                        const tile = document.createElement("div");
                        tile.className = "lora-tile";
                        tile.dataset.loraName = loraName;
                        
                        const subFolder = loraName.includes(" - ") ? loraName.split(" - ")[0] : "";
                        const borderCol = getFolderBorderColor(subFolder);
                        if (borderCol) {
                            tile.style.borderColor = borderCol;
                            tile.dataset.folderColor = borderCol;
                        }

                        const curWidget = getHiddenWidget();
                        if (curWidget.value === loraName) {
                            tile.className += " selected";
                            tile.style.borderColor = "#00ff66";
                        }

                        const img = document.createElement("img");
                        img.src = `/folder_lora_loader/get_preview?lora=${encodeURIComponent(loraName)}&folder=${encodeURIComponent(folder)}&pretty=true`;
                        
                        img.onerror = () => {
                            img.remove();
                            const fallback = document.createElement("div");
                            fallback.className = "lora-tile-fallback";
                            fallback.innerText = loraName;
                            tile.prepend(fallback);
                        };
                        tile.appendChild(img);

                        // Rank classification based on versionless pretty name
                        let tilePrettyName = loraName;
                        if (tilePrettyName.includes(" - ")) {
                            tilePrettyName = tilePrettyName.split(" - ", 2)[1];
                        }
                        tilePrettyName = tilePrettyName.replace(/\s+V\d+(\.\d+)?$/i, "").trim();

                        const systemPath = data.mapping[loraName];
                        const usageCount = (data.usage && systemPath) ? (data.usage[systemPath] || 0) : 0;
                        const isOver100 = usageCount >= 100;

                        let rankClass = "";
                        if (ranks.rank1.includes(tilePrettyName)) {
                            rankClass = isOver100 ? "rank-1-100" : "rank-1";
                        } else if (ranks.rank2.includes(tilePrettyName)) {
                            rankClass = isOver100 ? "rank-2-100" : "rank-2";
                        } else if (ranks.rank3.includes(tilePrettyName)) {
                            rankClass = isOver100 ? "rank-3-100" : "rank-3";
                        } else if (isOver100) {
                            rankClass = "over-100";
                        }

                        if (rankClass) {
                            tile.classList.add(rankClass);
                        }

                        if (usageCount > 0) {
                            const badge = document.createElement("div");
                            badge.className = "lora-tile-badge";
                            if (rankClass) badge.classList.add(rankClass);
                            badge.innerText = isOver100 ? `🔥 ${usageCount}` : usageCount;
                            tile.appendChild(badge);
                        }

                        // Add bottom caption label
                        const label = document.createElement("div");
                        label.className = "lora-tile-label";
                        label.innerText = loraName;
                        tile.appendChild(label);

                        // Trigger click selection
                        tile.addEventListener("click", () => {
                            const siblings = viewContainer.querySelectorAll(".lora-tile");
                            siblings.forEach(s => {
                                s.classList.remove("selected");
                                if (s.dataset.folderColor) {
                                    s.style.borderColor = s.dataset.folderColor;
                                } else {
                                    s.style.borderColor = "";
                                }
                            });
                            tile.classList.add("selected");
                            tile.style.borderColor = "#00ff66";
                            
                            const w = getHiddenWidget();
                            w.value = loraName;
                            if (w.callback) w.callback(loraName);
                            node.triggerSlotEvent?.(0);
                        });

                        viewContainer.appendChild(tile);
                    });
                } catch (e) {
                    console.error("Failed to build visual picker", e);
                }
            };

            folderWidget.callback = () => {
                clearTimeout(debounceTimer);
                debounceTimer = setTimeout(() => updateVisualGrid(), 350);
            };

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
                        viewContainer.style.setProperty("--lora-tile-size", `${savedTileSize}px`);
                    }
                }
                
                const curWidget = getHiddenWidget();
                const widgetIndex = node.widgets.indexOf(curWidget);
                const savedValue = (config.widgets_values && widgetIndex !== -1) ? config.widgets_values[widgetIndex] : curWidget.value;
                
                if (savedValue) {
                    curWidget.value = savedValue;
                    setTimeout(() => updateVisualGrid(), 100);
                }
            };

            setTimeout(() => updateVisualGrid(), 100);
        }

        // --- 3. VISUAL PRETTY PICKER V2 (Collapsible folders & Multi-selection) ---
        if (node.comfyClass === "FolderLoraLoaderVisualPrettyV2" || node.comfyClass === "VisualLoraLoader" || node.type === "FolderLoraLoaderVisualPrettyV2" || node.type === "VisualLoraLoader") {
            node.size = [380, 360];

            node.computeSize = function() {
                const displayModeWidget = node.widgets ? node.widgets.find(w => w.name === "display_mode") : null;
                if (displayModeWidget && displayModeWidget.value === "Show All") {
                    const viewContainer = document.querySelector(".lora-visual-container"); 
                }
                return [node.size[0], Math.max(360, node.size[1])];
            };

            const folderWidget = node.widgets.find(w => w.name === "folder");
            
            const getHiddenWidget = () => {
                const widgets = node.widgets.filter(w => w.name === "_selected_lora");
                if (widgets.length > 1) {
                    const keep = widgets.find(w => w.value && w.value !== "[ NONE ]" && w.value !== "[]") || widgets[0];
                    node.widgets = node.widgets.filter(w => w.name !== "_selected_lora" || w === keep);
                    keep.hidden = true;
                    return keep;
                }
                if (widgets.length === 1) {
                    widgets[0].hidden = true;
                    return widgets[0];
                }
                const w = node.addWidget("text", "_selected_lora", "[]", () => {}, { serialize: true });
                w.type = "hidden";
                w.hidden = true;
                w.computeSize = () => [0, 0];
                return w;
            };
            const hiddenWidget = getHiddenWidget();

            const getHiddenModeWidget = () => {
                const widgets = node.widgets.filter(w => w.name === "_selection_mode");
                if (widgets.length > 1) {
                    const keep = widgets.find(w => w.value && w.value !== "All") || widgets[0];
                    node.widgets = node.widgets.filter(w => w.name !== "_selection_mode" || w === keep);
                    keep.hidden = true;
                    return keep;
                }
                if (widgets.length === 1) {
                    widgets[0].hidden = true;
                    return widgets[0];
                }
                const w = node.addWidget("text", "_selection_mode", "Sequential", () => {}, { serialize: true });
                w.type = "hidden";
                w.hidden = true;
                w.computeSize = () => [0, 0];
                return w;
            };
            const hiddenModeWidget = getHiddenModeWidget();

            const getHiddenScrapeWidget = () => {
                const widgets = node.widgets.filter(w => w.name === "_scrape_on_new");
                if (widgets.length > 1) {
                    const keep = widgets.find(w => w.value && (w.value === "true" || w.value === "false")) || widgets[0];
                    node.widgets = node.widgets.filter(w => w.name !== "_scrape_on_new" || w === keep);
                    keep.hidden = true;
                    return keep;
                }
                if (widgets.length === 1) {
                    widgets[0].hidden = true;
                    return widgets[0];
                }
                const w = node.addWidget("text", "_scrape_on_new", "true", () => {}, { serialize: true });
                w.type = "hidden";
                w.hidden = true;
                w.computeSize = () => [0, 0];
                return w;
            };
            const hiddenScrapeWidget = getHiddenScrapeWidget();

            const viewContainer = document.createElement("div");
            viewContainer.className = "lora-visual-container flex-layout";
            node.properties = node.properties || {};
            const initialZoom = node.properties["tile_size"] != null
                ? node.properties["tile_size"]
                : (localStorage.getItem("comfy_lora_picker_zoom") || "80");
            node.properties["tile_size"] = parseInt(initialZoom);
            viewContainer.style.setProperty("--lora-tile-size", `${initialZoom}px`);

            const gridContainer = document.createElement("div");
            gridContainer.className = "lora-grid-container";

            // Isolate mouse wheel scroll events from triggering canvas zooming/panning
            viewContainer.addEventListener("wheel", (e) => {
                e.stopPropagation();
            });

            let userSavedHeight = 420;

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
                        node.setSize([node.size[0], Math.max(360, neededHeight)]);
                        if (app.graph) app.graph.setDirtyCanvas(true, true);
                    }, 50);
                } else {
                    viewContainer.classList.remove("show-all-mode");
                    viewContainer.classList.add("scrollable-mode");
                    const restoredH = node.userCustomHeight || userSavedHeight || 420;
                    const containerH = Math.max(200, restoredH - 100);
                    
                    viewContainer.style.setProperty("height", `${containerH}px`, "important");
                    viewContainer.style.setProperty("max-height", `${containerH}px`, "important");
                    viewContainer.style.setProperty("overflow-y", "hidden", "important");

                    gridContainer.style.setProperty("height", "100%", "important");
                    gridContainer.style.setProperty("max-height", "100%", "important");
                    gridContainer.style.setProperty("overflow-y", "auto", "important");
                    gridContainer.style.setProperty("flex", "1 1 0px", "important");

                    node.setSize([node.size[0], Math.max(360, restoredH)]);
                    if (app.graph) app.graph.setDirtyCanvas(true, true);
                }
            };

            node.computeSize = function() {
                const displayModeWidget = node.widgets ? node.widgets.find(w => w.name === "display_mode") : null;
                if (displayModeWidget && displayModeWidget.value === "Show All" && gridContainer) {
                    return [node.size[0], Math.max(360, (gridContainer.scrollHeight || 0) + 160)];
                }
                return [node.size[0], Math.max(360, node.size[1])];
            };

            const updateNodeSize = () => {
                const displayModeWidget = node.widgets ? node.widgets.find(w => w.name === "display_mode") : null;
                const mode = displayModeWidget ? displayModeWidget.value : "Scrollable";
                applyDisplayMode(mode);
            };

            // --- Control Bar for Mode Selector ---
            const controlBar = document.createElement("div");
            controlBar.className = "lora-control-bar";

            const toggleContainer = document.createElement("div");
            toggleContainer.className = "lora-toggle-container";

            const toggleLabel = document.createElement("span");
            toggleLabel.className = "lora-toggle-label";
            toggleLabel.innerText = "Mode:";
            toggleContainer.appendChild(toggleLabel);

            const modeSelect = document.createElement("select");
            modeSelect.className = "lora-mode-select";
            modeSelect.style.background = "#252525";
            modeSelect.style.border = "1px solid #353535";
            modeSelect.style.color = "#fff";
            modeSelect.style.fontSize = "10px";
            modeSelect.style.fontWeight = "bold";
            modeSelect.style.padding = "2px 4px";
            modeSelect.style.borderRadius = "4px";
            modeSelect.style.cursor = "pointer";

            const modes = [
                { value: "All", label: "All Loras" },
                { value: "Random", label: "Random (With Dupes)" },
                { value: "Sequential", label: "Sequential Cycle" },
                { value: "Random (No Replace)", label: "Random (No Dupes)" }
            ];

            modes.forEach(m => {
                const opt = document.createElement("option");
                opt.value = m.value;
                opt.innerText = m.label;
                modeSelect.appendChild(opt);
            });

            const syncModeToggleUI = () => {
                const curModeWidget = getHiddenModeWidget();
                if (curModeWidget.value && modes.some(m => m.value === curModeWidget.value)) {
                    modeSelect.value = curModeWidget.value;
                } else {
                    modeSelect.value = "Sequential";
                }
            };

            modeSelect.addEventListener("change", (e) => {
                getHiddenModeWidget().value = e.target.value;
                syncModeToggleUI();
                node.triggerSlotEvent?.(0);
            });

            toggleContainer.appendChild(modeSelect);
            controlBar.appendChild(toggleContainer);

            // Scrape Toggle Container
            const scrapeToggleContainer = document.createElement("div");
            scrapeToggleContainer.className = "lora-toggle-container";

            const scrapeLabel = document.createElement("span");
            scrapeLabel.className = "lora-toggle-label";
            scrapeLabel.innerText = "Scrape:";
            scrapeToggleContainer.appendChild(scrapeLabel);

            const scrapeOnBtn = document.createElement("button");
            scrapeOnBtn.className = "lora-toggle-btn active";
            scrapeOnBtn.innerText = "ON";

            const scrapeOffBtn = document.createElement("button");
            scrapeOffBtn.className = "lora-toggle-btn";
            scrapeOffBtn.innerText = "OFF";

            const syncScrapeToggleUI = () => {
                const curScrapeWidget = getHiddenScrapeWidget();
                if (curScrapeWidget.value === "false") {
                    scrapeOffBtn.classList.add("active");
                    scrapeOnBtn.classList.remove("active");
                } else {
                    scrapeOnBtn.classList.add("active");
                    scrapeOffBtn.classList.remove("active");
                }
            };

            scrapeOnBtn.addEventListener("click", () => {
                getHiddenScrapeWidget().value = "true";
                syncScrapeToggleUI();
                updateVisualGrid();
            });

            scrapeOffBtn.addEventListener("click", () => {
                getHiddenScrapeWidget().value = "false";
                syncScrapeToggleUI();
                updateVisualGrid();
            });

            scrapeToggleContainer.appendChild(scrapeOnBtn);
            scrapeToggleContainer.appendChild(scrapeOffBtn);
            controlBar.appendChild(scrapeToggleContainer);

            viewContainer.appendChild(controlBar);
            viewContainer.appendChild(gridContainer);

            const domWidget = node.addDOMWidget("lora_visual_picker", "HTML", viewContainer, {
                getValue() { return getHiddenWidget().value; },
                setValue(val) { getHiddenWidget().value = val; },
                serialize: false
            });

            domWidget.computeSize = function() {
                return [node.size[0] - 30, node.size[1] - 190];
            };

            const onResize = node.onResize;
            node.onResize = function(size) {
                if (onResize) onResize.apply(this, arguments);
                const displayModeWidget = node.widgets ? node.widgets.find(w => w.name === "display_mode") : null;
                const isShowAll = displayModeWidget && displayModeWidget.value === "Show All";
                if (!isShowAll && size) {
                    node.userCustomHeight = size[1];
                    userSavedHeight = size[1];
                    if (viewContainer && viewContainer.style) {
                        const h = Math.max(200, size[1] - 100);
                        viewContainer.style.setProperty("height", `${h}px`, "important");
                        viewContainer.style.setProperty("max-height", `${h}px`, "important");
                    }
                }
            };

            const zoomWidget = node.addWidget(
                "slider",
                "tile_size",
                parseInt(initialZoom),
                (val) => {
                    node.properties = node.properties || {};
                    node.properties["tile_size"] = val;
                    viewContainer.style.setProperty("--lora-tile-size", `${val}px`);
                    if (app.graph) app.graph.setDirtyCanvas(true, true);
                },
                { min: 50, max: 180, step: 1 }
            );
            zoomWidget.serialize = false;

            // Live Selected LoRAs Counter widget as a normal native widget (auto-scales with zoom)
            let loraCountWidget = node.widgets?.find(w => w.name === "Selected LoRAs" || w._isLoraCount);
            if (!loraCountWidget) {
                loraCountWidget = node.addWidget("button", "0 LoRAs Selected", "0 LoRAs Selected", () => {}, { serialize: false });
                loraCountWidget._isLoraCount = true;
            }

            let activeRequest = null;
            let debounceTimer = null;
            let foldersMap = {};

            const getSelectedLoras = () => {
                const curWidget = getHiddenWidget();
                let currentSelected = [];
                try {
                    currentSelected = JSON.parse(curWidget.value || "[]");
                    if (!Array.isArray(currentSelected)) {
                        currentSelected = [curWidget.value];
                    }
                } catch (e) {
                    if (curWidget.value && curWidget.value !== "[ NONE ]" && curWidget.value !== "[]") {
                        currentSelected = [curWidget.value];
                    } else {
                        currentSelected = [];
                    }
                }
                // Filter out "[ NONE ]"
                currentSelected = currentSelected.filter(n => n !== "[ NONE ]" && n);
                return currentSelected;
            };

            const updateLoraCountDisplay = () => {
                const count = getSelectedLoras().length;
                node._selectedLoraCount = count;
                const label = `${count} LoRA${count === 1 ? "" : "s"} Selected`;
                loraCountWidget.value = label;
                loraCountWidget.name = label;
                loraCountWidget.label = label;
                app.graph?.setDirtyCanvas(true, true);
            };

            const updateFolderCheckboxes = () => {
                const selectedList = getSelectedLoras();
                
                Object.keys(foldersMap).forEach(folder => {
                    const headerEl = viewContainer.querySelector(`.lora-folder-header[data-folder="${CSS.escape(folder)}"]`);
                    if (!headerEl) return;
                    const checkbox = headerEl.querySelector(".lora-folder-checkbox");
                    if (!checkbox) return;

                    const items = foldersMap[folder];
                    if (!items || items.length === 0) return;

                    const selectedCount = items.filter(item => selectedList.includes(item.loraName)).length;

                    if (selectedCount === items.length) {
                        checkbox.checked = true;
                        checkbox.indeterminate = false;
                    } else if (selectedCount > 0) {
                        checkbox.checked = false;
                        checkbox.indeterminate = true;
                    } else {
                        checkbox.checked = false;
                        checkbox.indeterminate = false;
                    }
                });
            };

            const updateSelection = (selectedList) => {
                // Filter out "[ NONE ]"
                selectedList = selectedList.filter(n => n !== "[ NONE ]" && n);

                const curWidget = getHiddenWidget();
                curWidget.value = JSON.stringify(selectedList);

                const tiles = viewContainer.querySelectorAll(".lora-tile");
                tiles.forEach(t => {
                    const name = t.dataset.loraName;
                    if (selectedList.includes(name)) {
                        t.classList.add("selected");
                        t.style.borderColor = "#00ff66";
                    } else {
                        t.classList.remove("selected");
                        if (t.dataset.folderColor) {
                            t.style.borderColor = t.dataset.folderColor;
                        } else {
                            t.style.borderColor = "";
                        }
                    }
                });

                updateFolderCheckboxes();
                updateLoraCountDisplay();
                node.triggerSlotEvent?.(0);
            };

            const updateVisualGrid = async () => {
                const folder = folderWidget.value || "";
                const scrapeOnNew = getHiddenScrapeWidget().value;
                const currentRequest = Symbol();
                activeRequest = currentRequest;

                try {
                    const response = await api.fetchApi(`/folder_lora_loader/get_loras?folder=${encodeURIComponent(folder)}&pretty=true&scrape_on_new=${encodeURIComponent(scrapeOnNew)}`);
                    if (activeRequest !== currentRequest) return;
                    const data = await response.json();

                    gridContainer.innerHTML = "";

                    foldersMap = {};
                    foldersMap["Root"] = [];

                    const selectedList = getSelectedLoras();

                    // Calculate Top 3 Ranks by versionless pretty name
                    const getTop3Ranks = () => {
                        const prettyCounts = {};
                        if (data.usage && data.mapping) {
                            Object.entries(data.mapping).forEach(([displayName, systemPath]) => {
                                const count = data.usage[systemPath] || 0;
                                if (count > 0) {
                                    let prettyName = displayName;
                                    if (prettyName.includes(" - ")) {
                                        prettyName = prettyName.split(" - ", 2)[1];
                                    }
                                    prettyName = prettyName.replace(/\s+V\d+(\.\d+)?$/i, "").trim();
                                    prettyCounts[prettyName] = Math.max(prettyCounts[prettyName] || 0, count);
                                }
                            });
                        }
                        
                        const sorted = Object.entries(prettyCounts)
                            .sort((a, b) => b[1] - a[1]);
                            
                        const ranks = { rank1: [], rank2: [], rank3: [] };
                        const uniqueCounts = [...new Set(sorted.map(x => x[1]))];
                        
                        sorted.forEach(([name, count]) => {
                            if (count === uniqueCounts[0]) ranks.rank1.push(name);
                            else if (count === uniqueCounts[1]) ranks.rank2.push(name);
                            else if (count === uniqueCounts[2]) ranks.rank3.push(name);
                        });
                        return ranks;
                    };
                    const ranks = getTop3Ranks();

                    // --- Group items by folder ---
                    const mtimeMap = data.mtime || {};
                    data.names.forEach(loraName => {
                        if (loraName === "[ NONE ]") return;
                        const parts = loraName.split(" - ");
                        const subFolder = parts.length > 1 ? parts[0] : "Root";
                        const prettyName = parts.length > 1 ? parts.slice(1).join(" - ") : loraName;
                        const systemPath = data.mapping[loraName];
                        const usageCount = (data.usage && systemPath) ? (data.usage[systemPath] || 0) : 0;

                        if (!foldersMap[subFolder]) {
                            foldersMap[subFolder] = [];
                        }
                        foldersMap[subFolder].push({ loraName, prettyName, usageCount, systemPath });
                    });

                    // Read sorting widgets
                    const getWidgetVal = (wName, defaultVal) => {
                        const w = node.widgets ? node.widgets.find(x => x.name === wName) : null;
                        return w ? w.value : defaultVal;
                    };
                    const sortLorasMode = getWidgetVal("sort_loras_by", "Name (A-Z)");
                    const sortFoldersMode = getWidgetVal("sort_folders_by", "Name (A-Z)");
                    const folderPosMode = getWidgetVal("folder_position", "Folders First");
                    const contentAlignMode = getWidgetVal("content_alignment", "Left Aligned");

                    if (contentAlignMode === "Right Aligned") {
                        viewContainer.classList.add("right-aligned-mode");
                    } else {
                        viewContainer.classList.remove("right-aligned-mode");
                    }

                    // Sort individual LoRAs inside each folder
                    Object.keys(foldersMap).forEach(subFolder => {
                        foldersMap[subFolder].sort((a, b) => {
                            if (sortLorasMode === "Name (Z-A)") {
                                return b.prettyName.localeCompare(a.prettyName);
                            } else if (sortLorasMode === "Usage (High to Low)") {
                                return (b.usageCount || 0) - (a.usageCount || 0) || a.prettyName.localeCompare(b.prettyName);
                            } else if (sortLorasMode === "Usage (Low to High)") {
                                return (a.usageCount || 0) - (b.usageCount || 0) || a.prettyName.localeCompare(b.prettyName);
                            } else if (sortLorasMode === "Date Modified (Newest First)") {
                                const timeA = mtimeMap[a.systemPath] || 0;
                                const timeB = mtimeMap[b.systemPath] || 0;
                                return timeB - timeA || a.prettyName.localeCompare(b.prettyName);
                            } else if (sortLorasMode === "Date Modified (Oldest First)") {
                                const timeA = mtimeMap[a.systemPath] || 0;
                                const timeB = mtimeMap[b.systemPath] || 0;
                                return timeA - timeB || a.prettyName.localeCompare(b.prettyName);
                            } else { // "Name (A-Z)" default
                                return a.prettyName.localeCompare(b.prettyName);
                            }
                        });
                    });

                    // Sort folders (excluding Root for position ordering)
                    const nonRootFolders = Object.keys(foldersMap).filter(f => f !== "Root").sort((a, b) => {
                        const itemsA = foldersMap[a] || [];
                        const itemsB = foldersMap[b] || [];
                        const totalA = itemsA.reduce((sum, i) => sum + (i.usageCount || 0), 0);
                        const totalB = itemsB.reduce((sum, i) => sum + (i.usageCount || 0), 0);
                        const avgA = itemsA.length > 0 ? totalA / itemsA.length : 0;
                        const avgB = itemsB.length > 0 ? totalB / itemsB.length : 0;

                        if (sortFoldersMode === "Name (Z-A)") {
                            return b.localeCompare(a);
                        } else if (sortFoldersMode === "Total Usage (High to Low)") {
                            return totalB - totalA || a.localeCompare(b);
                        } else if (sortFoldersMode === "Average Usage (High to Low)") {
                            return avgB - avgA || a.localeCompare(b);
                        } else if (sortFoldersMode === "Total LoRAs (Most First)") {
                            return itemsB.length - itemsA.length || a.localeCompare(b);
                        } else { // "Name (A-Z)" default
                            return a.localeCompare(b);
                        }
                    });

                    // Combine folder keys based on folder_position
                    let sortedFolders = [];
                    const hasRoot = foldersMap["Root"] && foldersMap["Root"].length > 0;
                    if (folderPosMode === "Root LoRAs First") {
                        if (hasRoot) sortedFolders.push("Root");
                        sortedFolders.push(...nonRootFolders);
                    } else {
                        sortedFolders.push(...nonRootFolders);
                        if (hasRoot) sortedFolders.push("Root");
                    }

                    // Atomic DOM Fragment construction for maximum performance
                    const fragment = document.createDocumentFragment();

                    // Setup IntersectionObserver for high-performance lazy image decoding
                    const imageObserver = new IntersectionObserver((entries, observer) => {
                        entries.forEach(entry => {
                            if (entry.isIntersecting) {
                                const img = entry.target;
                                if (img.dataset.src) {
                                    img.src = img.dataset.src;
                                    img.removeAttribute("data-src");
                                }
                                observer.unobserve(img);
                            }
                        });
                    }, { root: gridContainer, rootMargin: "150px" });

                    // --- Render folder groups ---
                    sortedFolders.forEach(subFolder => {
                        const items = foldersMap[subFolder];
                        if (items.length === 0) return;

                        const folderContainer = document.createElement("div");
                        folderContainer.className = "lora-folder-container";
                        const isCollapsed = localStorage.getItem(`comfy_lora_picker_folder_collapsed_${subFolder}`) === "true";
                        if (isCollapsed) {
                            folderContainer.classList.add("collapsed");
                        }

                        // Folder Header
                        const header = document.createElement("div");
                        header.className = "lora-folder-header";
                        header.dataset.folder = subFolder;
                        if (isCollapsed) {
                            header.classList.add("collapsed");
                        }

                        const toggle = document.createElement("span");
                        toggle.className = "lora-folder-toggle";
                        toggle.innerText = "▼";
                        header.appendChild(toggle);

                        const nameSpan = document.createElement("span");
                        nameSpan.className = "lora-folder-name";
                        nameSpan.innerText = subFolder;
                        header.appendChild(nameSpan);

                        const countSpan = document.createElement("span");
                        countSpan.className = "lora-folder-count";
                        countSpan.innerText = `(${items.length})`;
                        header.appendChild(countSpan);

                        const checkbox = document.createElement("input");
                        checkbox.type = "checkbox";
                        checkbox.className = "lora-folder-checkbox";
                        checkbox.title = "Select/Deselect all in folder";
                        
                        checkbox.addEventListener("click", (e) => {
                            e.stopPropagation();
                            const isChecked = checkbox.checked;
                            let currentSelected = getSelectedLoras();

                            items.forEach(item => {
                                if (isChecked) {
                                    if (!currentSelected.includes(item.loraName)) {
                                        currentSelected.push(item.loraName);
                                    }
                                } else {
                                    currentSelected = currentSelected.filter(n => n !== item.loraName);
                                }
                            });

                            updateSelection(currentSelected);
                        });

                        header.appendChild(checkbox);

                        header.addEventListener("click", () => {
                            const collapsed = folderContainer.classList.toggle("collapsed");
                            header.classList.toggle("collapsed", collapsed);
                            localStorage.setItem(`comfy_lora_picker_folder_collapsed_${subFolder}`, collapsed ? "true" : "false");
                        });

                        folderContainer.appendChild(header);

                        // Grid containing items of this folder
                        const grid = document.createElement("div");
                        grid.className = "lora-folder-grid";

                        items.forEach(item => {
                            const tile = document.createElement("div");
                            tile.className = "lora-tile";
                            tile.dataset.loraName = item.loraName;
                            
                            const borderCol = getFolderBorderColor(subFolder);
                            if (borderCol) {
                                tile.style.borderColor = borderCol;
                                tile.dataset.folderColor = borderCol;
                            }

                            if (selectedList.includes(item.loraName)) {
                                tile.className += " selected";
                                tile.style.borderColor = "#00ff66";
                            }

                            const img = document.createElement("img");
                            img.loading = "lazy";
                            img.dataset.src = `/folder_lora_loader/get_preview?system_path=${encodeURIComponent(item.systemPath)}`;
                            imageObserver.observe(img);
                            
                            img.onerror = () => {
                                img.remove();
                                const fallback = document.createElement("div");
                                fallback.className = "lora-tile-fallback";
                                fallback.innerText = item.prettyName;
                                tile.prepend(fallback);
                            };
                            tile.appendChild(img);

                            let tilePrettyName = item.prettyName.replace(/\s+V\d+(\.\d+)?$/i, "").trim();
                            const isOver100 = item.usageCount >= 100;

                            let rankClass = "";
                            if (ranks.rank1.includes(tilePrettyName)) {
                                rankClass = isOver100 ? "rank-1-100" : "rank-1";
                            } else if (ranks.rank2.includes(tilePrettyName)) {
                                rankClass = isOver100 ? "rank-2-100" : "rank-2";
                            } else if (ranks.rank3.includes(tilePrettyName)) {
                                rankClass = isOver100 ? "rank-3-100" : "rank-3";
                            } else if (isOver100) {
                                rankClass = "over-100";
                            }

                            if (rankClass) {
                                tile.classList.add(rankClass);
                            }

                            if (item.usageCount > 0) {
                                const badge = document.createElement("div");
                                badge.className = "lora-tile-badge";
                                if (rankClass) badge.classList.add(rankClass);
                                badge.innerText = isOver100 ? `🔥 ${item.usageCount}` : item.usageCount;
                                tile.appendChild(badge);
                            }

                            const label = document.createElement("div");
                            label.className = "lora-tile-label";
                            label.innerText = item.prettyName;
                            tile.appendChild(label);

                            tile.addEventListener("click", (e) => {
                                let currentSelected = getSelectedLoras();

                                if (e.ctrlKey || e.metaKey) {
                                    if (currentSelected.includes(item.loraName)) {
                                        currentSelected = currentSelected.filter(n => n !== item.loraName);
                                    } else {
                                        currentSelected.push(item.loraName);
                                    }
                                } else {
                                    if (currentSelected.length === 1 && currentSelected[0] === item.loraName) {
                                        currentSelected = [];
                                    } else {
                                        currentSelected = [item.loraName];
                                    }
                                }

                                updateSelection(currentSelected);
                            });

                            grid.appendChild(tile);
                        });

                        folderContainer.appendChild(grid);
                        fragment.appendChild(folderContainer);
                    });

                    // Append entire DocumentFragment to gridContainer
                    gridContainer.appendChild(fragment);

                    // Set initial checkboxes state
                    updateFolderCheckboxes();
                    setTimeout(() => updateNodeSize(), 50);
                } catch (e) {
                    console.error("Failed to build visual picker v2", e);
                }
            };

            folderWidget.callback = () => {
                clearTimeout(debounceTimer);
                debounceTimer = setTimeout(() => updateVisualGrid(), 350);
            };

            ["sort_loras_by", "sort_folders_by", "folder_position", "content_alignment"].forEach(wName => {
                const w = node.widgets ? node.widgets.find(x => x.name === wName) : null;
                if (w) {
                    const origCb = w.callback;
                    w.callback = function() {
                        if (origCb) origCb.apply(this, arguments);
                        updateVisualGrid();
                    };
                }
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
                        viewContainer.style.setProperty("--lora-tile-size", `${savedTileSize}px`);
                    }
                }

                const curWidget = getHiddenWidget();
                const widgetIndex = node.widgets.indexOf(curWidget);
                const savedValue = (config.widgets_values && widgetIndex !== -1) ? config.widgets_values[widgetIndex] : curWidget.value;
                if (savedValue) {
                    curWidget.value = savedValue;
                }

                const curModeWidget = getHiddenModeWidget();
                const modeIndex = node.widgets.indexOf(curModeWidget);
                const savedMode = (config.widgets_values && modeIndex !== -1) ? config.widgets_values[modeIndex] : curModeWidget.value;
                if (savedMode) {
                    curModeWidget.value = savedMode;
                }

                const curScrapeWidget = getHiddenScrapeWidget();
                const scrapeIndex = node.widgets.indexOf(curScrapeWidget);
                const savedScrape = (config.widgets_values && scrapeIndex !== -1) ? config.widgets_values[scrapeIndex] : curScrapeWidget.value;
                if (savedScrape) {
                    curScrapeWidget.value = savedScrape;
                }

                syncModeToggleUI();
                syncScrapeToggleUI();
                updateLoraCountDisplay();
                setTimeout(() => updateVisualGrid(), 100);
            };

            const origOnDrawForeground = node.onDrawForeground;
            node.onDrawForeground = function(ctx) {
                if (node.flags?.collapsed) {
                    const count = node._selectedLoraCount ?? getSelectedLoras().length;
                    const label = `${count} LoRA${count === 1 ? "" : "s"}`;
                    ctx.save();
                    ctx.font = "bold 11px Inter, system-ui, sans-serif";
                    const badgeText = label;
                    const tw = ctx.measureText(badgeText).width;
                    const bx = node.size[0] - tw - 16;
                    const by = -LiteGraph.NODE_TITLE_HEIGHT + 3;

                    ctx.fillStyle = count > 0 ? "rgba(180, 140, 95, 0.25)" : "rgba(255, 255, 255, 0.08)";
                    ctx.strokeStyle = count > 0 ? "rgba(180, 140, 95, 0.6)" : "rgba(255, 255, 255, 0.2)";
                    ctx.lineWidth = 1;
                    ctx.beginPath();
                    if (ctx.roundRect) {
                        ctx.roundRect(bx, by, tw + 10, 18, 4);
                    } else {
                        ctx.rect(bx, by, tw + 10, 18);
                    }
                    ctx.fill();
                    ctx.stroke();

                    ctx.fillStyle = count > 0 ? "#decbb2" : "#cbd5e1";
                    ctx.textAlign = "left";
                    ctx.textBaseline = "middle";
                    ctx.fillText(badgeText, bx + 5, by + 9);
                    ctx.restore();
                }
                if (origOnDrawForeground) origOnDrawForeground.apply(this, arguments);
            };

            syncModeToggleUI();
            syncScrapeToggleUI();

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
                updateVisualGrid();
                updateLoraCountDisplay();
            }, 100);
        }
    }
});
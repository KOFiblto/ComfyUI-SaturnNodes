import { app } from "/scripts/app.js";
import { api } from "/scripts/api.js";
import { authenticatedFetch } from "./auth_helper.js";

const NODE_TYPE = "CharacterPresetPicker";
const API_BASE = "/saturnnodes/character_presets";
const STYLE_ID = "saturn-character-presets-style";

const SELECTION_MODES = ["Sequential", "Random", "Random (No Replace)", "All", "None"];
const SORT_PRESETS = [
    "Name (A-Z)",
    "Name (Z-A)",
    "Usage (High to Low)",
    "Usage (Low to High)",
    "Date Modified (Newest First)",
    "Date Modified (Oldest First)",
];
const MATCH_MODES = ["Whole Word", "Contains", "Exact"];

const MODE_HINTS = {
    Sequential: "Cycles through the selected cards, one per run.",
    Random: "Picks one random card from the selection each run.",
    "Random (No Replace)": "Shuffles the selection and uses every card before repeating.",
    All: "Uses every selected card in a single run.",
    None: "Emits nothing. The card grid stays available for editing.",
};

const PICKER_CSS = `
.saturn-char-root {
    display: flex;
    flex-direction: column;
    gap: 6px;
    width: 100%;
    height: 100%;
    box-sizing: border-box;
    padding: 6px;
    color: #f2e6da;
    font-size: 12px;
    background: #2a1a10;
    border-radius: 6px;
    overflow: hidden;
}
.saturn-char-toolbar {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    align-items: center;
}
.saturn-char-toolbar select,
.saturn-char-toolbar input[type="text"] {
    background: #1b110a;
    color: #f2e6da;
    border: 1px solid #6a3f20;
    border-radius: 4px;
    padding: 2px 4px;
    font-size: 11px;
    min-width: 0;
}
.saturn-char-toolbar select { max-width: 130px; }
.saturn-char-toolbar input[type="text"] { flex: 1 1 90px; }
.saturn-char-btn {
    background: #3d2413;
    color: #f2e6da;
    border: 1px solid #6a3f20;
    border-radius: 4px;
    padding: 2px 7px;
    font-size: 11px;
    cursor: pointer;
    white-space: nowrap;
}
.saturn-char-btn:hover { background: #59331a; border-color: #b06a33; }
.saturn-char-btn:disabled { opacity: 0.45; cursor: default; }
.saturn-char-status {
    font-size: 10.5px;
    color: #c9b3a0;
    min-height: 13px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}
.saturn-char-status.warn { color: #ffcf70; }
.saturn-char-status.error { color: #ff8a8a; }
.saturn-char-status.ok { color: #6dff9a; }
.saturn-char-grid {
    flex: 1 1 auto;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(96px, 1fr));
    gap: 6px;
    align-content: start;
    overflow-y: auto;
    padding: 2px;
    border-radius: 6px;
    transition: background 0.15s ease, box-shadow 0.15s ease;
}
.saturn-char-grid.scrollable { max-height: 320px; }
.saturn-char-grid.show-all { max-height: none; }
.saturn-char-grid.detect-mode {
    background-image: linear-gradient(rgba(150, 150, 150, 0.09), rgba(150, 150, 150, 0.09));
    box-shadow: inset 0 0 0 2px rgba(150, 150, 150, 0.35);
}
.saturn-char-grid.detect-mode .saturn-char-tile { cursor: default; }
.saturn-char-grid.detect-mode .saturn-char-tile:hover {
    transform: none;
    border-color: #4a2c18;
}
.saturn-char-tile {
    position: relative;
    display: flex;
    flex-direction: column;
    background: #1b110a;
    border: 1px solid #4a2c18;
    border-radius: 6px;
    overflow: hidden;
    cursor: pointer;
    transition: border-color 0.12s ease, transform 0.12s ease, box-shadow 0.12s ease;
}
.saturn-char-tile:hover { transform: translateY(-1px); border-color: #b06a33; }
.saturn-char-tile.selected {
    border-color: #00ff66;
    box-shadow: 0 0 0 2px #00ff66, 0 0 10px rgba(0, 255, 102, 0.35);
}
.saturn-char-tile.used {
    animation: saturn-char-flash 1.2s ease-out 3;
}
@keyframes saturn-char-flash {
    0% { box-shadow: 0 0 0 3px rgba(255, 200, 90, 0.95), 0 0 16px rgba(255, 200, 90, 0.7); }
    100% { box-shadow: 0 0 0 0 rgba(255, 200, 90, 0); }
}
.saturn-char-thumb {
    position: relative;
    width: 100%;
    aspect-ratio: 1 / 1;
    background: #120b06;
    overflow: hidden;
}
.saturn-char-thumb img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
}
.saturn-char-fallback {
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 20px;
    font-weight: 700;
    color: #7d5a41;
    background: repeating-linear-gradient(45deg, #1a100a, #1a100a 6px, #150d08 6px, #150d08 12px);
}
.saturn-char-tile.matched .saturn-char-thumb::after {
    content: "";
    position: absolute;
    inset: 0;
    background: rgba(0, 255, 102, 0.22);
    box-shadow: inset 0 0 0 2px #00ff66;
    pointer-events: none;
}
.saturn-char-check {
    position: absolute;
    top: 3px;
    left: 3px;
    display: none;
    align-items: center;
    justify-content: center;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: #00ff66;
    color: #06240f;
    font-size: 11px;
    font-weight: 800;
    z-index: 2;
}
.saturn-char-tile.selected .saturn-char-check { display: flex; }
.saturn-char-match-pill {
    position: absolute;
    top: 3px;
    right: 3px;
    display: none;
    padding: 1px 5px;
    border-radius: 8px;
    background: #00ff66;
    color: #06240f;
    font-size: 8.5px;
    font-weight: 800;
    letter-spacing: 0.4px;
    z-index: 2;
}
.saturn-char-tile.matched .saturn-char-match-pill { display: block; }
.saturn-char-meta {
    padding: 3px 4px 4px;
    display: flex;
    flex-direction: column;
    gap: 1px;
}
.saturn-char-name {
    font-size: 10.5px;
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}
.saturn-char-trigger {
    font-size: 9.5px;
    color: #8fe3b0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}
.saturn-char-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 2px;
    margin-top: 1px;
}
.saturn-char-chip {
    font-size: 8.5px;
    padding: 0 3px;
    border-radius: 3px;
    background: #33200f;
    color: #c9b3a0;
}
.saturn-char-chip.missing { background: #4a1c1c; color: #ffb3b3; }
.saturn-char-actions {
    position: absolute;
    right: 2px;
    bottom: 2px;
    display: none;
    gap: 2px;
    z-index: 3;
}
.saturn-char-tile:hover .saturn-char-actions { display: flex; }
.saturn-char-actions button {
    width: 17px;
    height: 17px;
    padding: 0;
    border: 1px solid #6a3f20;
    border-radius: 3px;
    background: rgba(20, 12, 7, 0.92);
    color: #f2e6da;
    font-size: 9.5px;
    line-height: 1;
    cursor: pointer;
}
.saturn-char-actions button:hover { background: #59331a; }
.saturn-char-empty {
    grid-column: 1 / -1;
    padding: 14px 8px;
    text-align: center;
    color: #9c8471;
    font-size: 11px;
    line-height: 1.5;
}
.saturn-char-modal-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.62);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 100000;
}
.saturn-char-modal {
    width: min(720px, 94vw);
    max-height: 90vh;
    display: flex;
    flex-direction: column;
    background: #241509;
    color: #f2e6da;
    border: 1px solid #6a3f20;
    border-radius: 8px;
    box-shadow: 0 12px 40px rgba(0, 0, 0, 0.6);
    font-size: 12px;
}
.saturn-char-modal-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 12px;
    border-bottom: 1px solid #4a2c18;
    font-weight: 600;
}
.saturn-char-modal-body {
    padding: 10px 12px;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 8px;
}
.saturn-char-modal-foot {
    display: flex;
    gap: 6px;
    align-items: center;
    padding: 8px 12px;
    border-top: 1px solid #4a2c18;
}
.saturn-char-modal-foot .spacer { flex: 1 1 auto; }
.saturn-char-modal-foot .error { color: #ff8a8a; font-size: 11px; }
.saturn-char-field { display: flex; flex-direction: column; gap: 2px; }
.saturn-char-field > label { font-size: 10.5px; color: #c9b3a0; }
.saturn-char-field input[type="text"],
.saturn-char-field textarea,
.saturn-char-field select,
.saturn-char-lora-row select,
.saturn-char-lora-row input[type="number"] {
    background: #1b110a;
    color: #f2e6da;
    border: 1px solid #4a2c18;
    border-radius: 4px;
    padding: 4px 6px;
    font-size: 12px;
    font-family: inherit;
}
.saturn-char-field textarea { min-height: 52px; resize: vertical; }
.saturn-char-cols { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.saturn-char-lora-head,
.saturn-char-lora-row {
    display: grid;
    grid-template-columns: 1fr 62px 62px 34px 24px;
    gap: 4px;
    align-items: center;
}
.saturn-char-lora-head { font-size: 10px; color: #9c8471; }
.saturn-char-lora-row button {
    background: #3d2413;
    border: 1px solid #6a3f20;
    color: #f2e6da;
    border-radius: 4px;
    cursor: pointer;
    height: 24px;
}
.saturn-char-thumb-editor {
    display: flex;
    gap: 10px;
    align-items: flex-start;
    border: 1px solid #4a2c18;
    border-radius: 6px;
    padding: 8px;
}
.saturn-char-thumb-editor img {
    width: 96px;
    height: 96px;
    object-fit: cover;
    border-radius: 4px;
    background: #120b06;
}
.saturn-char-thumb-editor .no-image {
    width: 96px;
    height: 96px;
    border-radius: 4px;
    background: #120b06;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #6d5443;
    font-size: 10px;
}
.saturn-char-thumb-buttons { display: flex; flex-direction: column; gap: 5px; }
.saturn-char-thumb-buttons .saturn-char-btn { text-align: center; }
.saturn-char-hint { font-size: 10px; color: #9c8471; }
`;

function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = PICKER_CSS;
    document.head.appendChild(style);
}

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
}

function getWidget(node, name) {
    return (node.widgets || []).find((w) => w.name === name);
}

function normalizeCardId(value) {
    let text = String(value || "").replace(/\\/g, "/").trim().replace(/^\/+|\/+$/g, "");
    text = text.replace(/\/{2,}/g, "/");
    if (text.toLowerCase().endsWith(".json")) text = text.slice(0, -5);
    return text;
}

function isSafeCardId(value) {
    if (!value || value.length > 240) return false;
    if (value.includes(":") || value.includes("\u0000")) return false;
    return value.split("/").every((part) => part && part !== "." && part !== "..");
}

function readSelected(widget) {
    if (!widget) return [];
    try {
        const parsed = JSON.parse(widget.value || "[]");
        if (Array.isArray(parsed)) return parsed.map(String).filter(Boolean);
    } catch (_) {
        /* ignore malformed state */
    }
    return [];
}

function writeSelected(widget, ids) {
    if (!widget) return;
    widget.value = JSON.stringify(ids);
    if (widget.callback) widget.callback(widget.value);
}

function escapeRegExp(text) {
    return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function triggerIndex(text, trigger, mode, caseSensitive) {
    if (!trigger) return -1;
    const haystack = caseSensitive ? text : text.toLowerCase();
    const needle = caseSensitive ? trigger : trigger.toLowerCase();
    if (mode === "Exact") return haystack.trim() === needle ? 0 : -1;
    if (mode === "Whole Word") {
        const pattern = new RegExp(`(?<![0-9a-zA-Z_])${escapeRegExp(needle)}(?![0-9a-zA-Z_])`);
        const match = haystack.match(pattern);
        return match ? match.index : -1;
    }
    return haystack.indexOf(needle);
}

function computeMatches(cards, text, mode, caseSensitive, matchAll) {
    if (!text) return [];
    const hits = [];
    for (const card of cards) {
        const trigger = (card.trigger || "").trim();
        if (!trigger) continue;
        const index = triggerIndex(text, trigger, mode, caseSensitive);
        if (index >= 0) hits.push({ index, id: card.id, card });
    }
    hits.sort((a, b) => (a.index - b.index) || a.id.localeCompare(b.id));
    const ordered = hits.map((hit) => hit.card);
    if (!ordered.length) return [];
    return matchAll ? ordered : [ordered[0]];
}

function sortCards(cards, sortBy, folderPosition) {
    const byName = (a, b) => String(a.name).localeCompare(String(b.name), undefined, { numeric: true, sensitivity: "base" });
    let compare;
    switch (sortBy) {
        case "Name (Z-A)":
            compare = (a, b) => byName(b, a);
            break;
        case "Usage (High to Low)":
            compare = (a, b) => (b.usage || 0) - (a.usage || 0) || byName(a, b);
            break;
        case "Usage (Low to High)":
            compare = (a, b) => (a.usage || 0) - (b.usage || 0) || byName(a, b);
            break;
        case "Date Modified (Newest First)":
            compare = (a, b) => (b.mtime || 0) - (a.mtime || 0) || byName(a, b);
            break;
        case "Date Modified (Oldest First)":
            compare = (a, b) => (a.mtime || 0) - (b.mtime || 0) || byName(a, b);
            break;
        default:
            compare = byName;
    }
    const groupRank = (card) => {
        if (folderPosition === "Root Presets First") return card.folder ? 1 : 0;
        return card.folder ? 0 : 1;
    };
    return [...cards].sort((a, b) => (groupRank(a) - groupRank(b)) || compare(a, b));
}

function initials(name) {
    const cleaned = String(name || "?").replace(/[^\p{L}\p{N} ]/gu, " ").trim();
    if (!cleaned) return "?";
    const words = cleaned.split(/\s+/).filter(Boolean);
    if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
    return (words[0][0] + words[1][0]).toUpperCase();
}

function getLinkedText(node) {
    try {
        const input = (node.inputs || []).find((slot) => slot.name === "text");
        if (!input || input.link === null || input.link === undefined) return "";
        const graph = node.graph || app.graph;
        const links = graph?.links;
        let link = null;
        if (links) {
            link = Array.isArray(links) ? links.find((item) => item && item.id === input.link) : links[input.link];
        }
        if (!link) return "";
        const origin = graph.getNodeById?.(link.origin_id);
        if (!origin) return "";

        const named = (origin.widgets || []).find((w) =>
            ["text", "string", "value", "prompt"].includes(String(w.name).toLowerCase()) &&
            typeof w.value === "string"
        );
        if (named) return named.value;

        const widgetsValues = origin.widgets_values;
        if (Array.isArray(widgetsValues)) {
            const firstString = widgetsValues.find((value) => typeof value === "string");
            if (firstString) return firstString;
        }
        if (typeof widgetsValues === "string") return widgetsValues;
    } catch (_) {
        /* ignore graph lookup failures */
    }
    return "";
}

let loraCache = { at: 0, loras: [] };

async function fetchLoras(force = false) {
    const now = Date.now();
    if (!force && loraCache.loras.length && now - loraCache.at < 30000) return loraCache.loras;
    const response = await api.fetchApi(`${API_BASE}/get_loras`);
    if (!response.ok) throw new Error("Could not load the LoRA list");
    const data = await response.json();
    loraCache = { at: now, loras: Array.isArray(data.loras) ? data.loras : [] };
    return loraCache.loras;
}

async function postJson(path, body) {
    const response = await authenticatedFetch(`${API_BASE}/${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body || {}),
    });
    let data = null;
    try {
        data = await response.json();
    } catch (_) {
        data = null;
    }
    if (!response.ok) {
        throw new Error((data && data.error) || `Request failed (${response.status})`);
    }
    return data || {};
}

class CharacterPickerUI {
    constructor(node) {
        this.node = node;
        this.cards = [];
        this.folders = [];
        this.matchedIds = new Set();
        this.lastDetectSignature = null;
        this.search = "";
        this.destroyed = false;
        this.modal = null;

        this.folderWidget = getWidget(node, "folder");
        this.modeWidget = getWidget(node, "mode");
        this.selectionWidget = getWidget(node, "selection_mode");
        this.sortWidget = getWidget(node, "sort_presets_by");
        this.folderPositionWidget = getWidget(node, "folder_position");
        this.displayWidget = getWidget(node, "display_mode");
        this.matchModeWidget = getWidget(node, "match_mode");
        this.matchAllWidget = getWidget(node, "match_all");
        this.caseWidget = getWidget(node, "case_sensitive");
        this.includeDisabledWidget = getWidget(node, "include_disabled");
        this.hiddenWidget = this.ensureHiddenWidget();

        this.build();
        this.bindWidgets();
        this.refresh();
        this.startDetectWatcher();
    }

    ensureHiddenWidget() {
        let widget = getWidget(this.node, "_selected_presets");
        if (!widget) {
            widget = this.node.addWidget("text", "_selected_presets", "[]", () => {}, { serialize: true });
        }
        widget.hidden = true;
        widget.type = "hidden";
        widget.computeSize = () => [0, 0];
        return widget;
    }

    hideWidget(widget) {
        if (!widget) return;
        widget.hidden = true;
        widget.type = "hidden";
        widget.computeSize = () => [0, 0];
    }

    build() {
        injectStyles();
        const container = el("div", "saturn-char-root");

        const toolbar = el("div", "saturn-char-toolbar");
        this.folderSelect = el("select");
        this.folderSelect.title = "Character preset folder";
        this.folderSelect.addEventListener("change", () => {
            if (this.folderWidget) {
                this.folderWidget.value = this.folderSelect.value;
                if (this.folderWidget.callback) this.folderWidget.callback(this.folderWidget.value);
            }
            this.refresh();
        });

        this.searchInput = el("input");
        this.searchInput.type = "text";
        this.searchInput.placeholder = "Search name, trigger or tag";
        this.searchInput.addEventListener("input", () => {
            this.search = this.searchInput.value.trim().toLowerCase();
            this.render();
        });

        this.sortSelect = el("select");
        this.sortSelect.title = "Sort presets";
        SORT_PRESETS.forEach((option) => {
            const item = el("option", null, option);
            item.value = option;
            this.sortSelect.appendChild(item);
        });
        this.sortSelect.addEventListener("change", () => {
            if (this.sortWidget) this.sortWidget.value = this.sortSelect.value;
            this.render();
        });

        this.newButton = el("button", "saturn-char-btn", "New");
        this.newButton.title = "Create a new character preset card";
        this.newButton.addEventListener("click", () => this.openEditor(null));

        this.refreshButton = el("button", "saturn-char-btn", "Refresh");
        this.refreshButton.title = "Rescan the presets folder";
        this.refreshButton.addEventListener("click", () => this.refresh());

        this.openFolderButton = el("button", "saturn-char-btn", "Folder");
        this.openFolderButton.title = "Open the character presets folder";
        this.openFolderButton.addEventListener("click", async () => {
            try {
                await postJson("open_folder", {});
            } catch (error) {
                this.setStatus(String(error.message || error), "error");
            }
        });

        toolbar.append(
            this.folderSelect,
            this.searchInput,
            this.sortSelect,
            this.newButton,
            this.refreshButton,
            this.openFolderButton
        );

        this.statusEl = el("div", "saturn-char-status", "");
        this.grid = el("div", "saturn-char-grid scrollable");

        container.append(toolbar, this.statusEl, this.grid);

        this.domWidget = this.node.addDOMWidget("character_picker", "HTML", container, {
            getValue: () => (this.hiddenWidget ? this.hiddenWidget.value : "[]"),
            setValue: (value) => {
                if (this.hiddenWidget) this.hiddenWidget.value = value;
                this.updateSelectionStyles();
            },
            serialize: false,
        });

        this.domWidget.computeLayoutSize = () => ({ minHeight: 180, maxHeight: undefined, minWidth: 320 });
        delete this.domWidget.computeSize;

        this.container = container;
        this.hideWidget(this.folderWidget);
        this.hideWidget(getWidget(this.node, "separator"));
        this.applyDisplayMode();

        const originalResize = this.node.onResize;
        this.node.onResize = function () {
            if (originalResize) originalResize.apply(this, arguments);
        };
    }

    bindWidgets() {
        if (this.modeWidget) {
            this.modeWidget.callback = () => {
                this.lastDetectSignature = null;
                this.updateMode();
            };
        }
        if (this.selectionWidget) {
            this.selectionWidget.callback = () => this.updateMode();
        }
        if (this.sortWidget) {
            this.sortWidget.callback = () => {
                this.sortSelect.value = this.sortWidget.value;
                this.render();
            };
        }
        if (this.folderPositionWidget) {
            this.folderPositionWidget.callback = () => this.render();
        }
        if (this.displayWidget) {
            this.displayWidget.callback = () => this.applyDisplayMode();
        }
        [this.matchModeWidget, this.matchAllWidget, this.caseWidget].forEach((widget) => {
            if (widget) {
                widget.callback = () => {
                    this.lastDetectSignature = null;
                    this.updateDetectPreview();
                };
            }
        });
        if (this.includeDisabledWidget) {
            this.includeDisabledWidget.callback = () => this.refresh();
        }

        if (this.sortWidget) this.sortSelect.value = this.sortWidget.value || SORT_PRESETS[0];
        if (this.modeWidget) this.modeWidget.value = this.modeWidget.value || "Select";
        if (this.selectionWidget) this.selectionWidget.value = this.selectionWidget.value || "Sequential";
    }

    applyDisplayMode() {
        const showAll = (this.displayWidget?.value || "Scrollable") === "Show All";
        this.grid.classList.toggle("show-all", showAll);
        this.grid.classList.toggle("scrollable", !showAll);
        if (showAll) {
            const height = Math.min(920, 200 + this.cards.length * 4);
            this.node.setSize?.([this.node.size?.[0] || 420, height]);
        }
    }

    updateMode() {
        const detect = (this.modeWidget?.value || "Select") === "Detect";
        this.grid.classList.toggle("detect-mode", detect);
        this.lastDetectSignature = null;
        if (detect) {
            this.setStatus("Detect mode: triggers are matched inside the connected text input.", "warn");
        } else {
            const mode = this.selectionWidget?.value || "Sequential";
            this.setStatus(MODE_HINTS[mode] || "");
        }
        this.updateDetectPreview();
    }

    setStatus(text, kind) {
        this.statusEl.textContent = text || "";
        this.statusEl.className = "saturn-char-status" + (kind ? ` ${kind}` : "");
    }

    async refresh() {
        if (this.destroyed) return;
        const folder = this.folderWidget?.value || "";
        const includeDisabled = this.includeDisabledWidget?.value === true;
        try {
            const response = await api.fetchApi(
                `${API_BASE}/get_presets?folder=${encodeURIComponent(folder)}&include_disabled=${includeDisabled ? "true" : "false"}`
            );
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const data = await response.json();
            if (this.destroyed) return;
            this.cards = Array.isArray(data.cards) ? data.cards : [];
            this.folders = Array.isArray(data.folders) ? data.folders : [];
            this.rebuildFolderSelect(folder);
            this.render();
            this.updateMode();
        } catch (error) {
            this.setStatus(`Could not load character presets: ${error.message || error}`, "error");
        }
    }

    rebuildFolderSelect(current) {
        this.folderSelect.innerHTML = "";
        const rootOption = el("option", null, "All presets");
        rootOption.value = "";
        this.folderSelect.appendChild(rootOption);
        this.folders.forEach((folder) => {
            const option = el("option", null, folder);
            option.value = folder;
            this.folderSelect.appendChild(option);
        });
        this.folderSelect.value = this.folders.includes(current) ? current : "";
    }

    visibleCards() {
        let cards = this.cards;
        if (this.search) {
            const needle = this.search;
            cards = cards.filter((card) => {
                const haystack = [card.name, card.trigger, card.id, ...(card.tags || [])]
                    .join(" ")
                    .toLowerCase();
                return haystack.includes(needle);
            });
        }
        return sortCards(cards, this.sortWidget?.value || SORT_PRESETS[0], this.folderPositionWidget?.value);
    }

    render() {
        this.grid.innerHTML = "";
        const cards = this.visibleCards();
        this.renderedCards = cards;

        if (!cards.length) {
            const empty = el(
                "div",
                "saturn-char-empty",
                this.cards.length
                    ? "No presets match your search."
                    : "No character presets yet. Use New to create one, or drop <Name>.json cards into the presets folder."
            );
            this.grid.appendChild(empty);
            this.updateDetectPreview();
            return;
        }

        const selected = new Set(readSelected(this.hiddenWidget));
        const fragment = document.createDocumentFragment();
        cards.forEach((card) => fragment.appendChild(this.renderTile(card, selected)));
        this.grid.appendChild(fragment);
        this.updateDetectPreview();
    }

    renderTile(card, selected) {
        const tile = el("div", "saturn-char-tile");
        tile.dataset.cardId = card.id;
        tile.setAttribute("data-card-id", card.id);
        tile.title = `${card.name}${card.folder ? ` (${card.folder})` : ""}\nTrigger: ${card.trigger || "none"}\nDouble-click to edit`;

        const thumb = el("div", "saturn-char-thumb");
        if (card.has_preview) {
            const img = el("img");
            img.loading = "lazy";
            img.alt = card.name;
            img.src = `${API_BASE}/get_preview?id=${encodeURIComponent(card.id)}&v=${Math.round(card.mtime || 0)}`;
            img.addEventListener("error", () => {
                img.remove();
                thumb.insertBefore(el("div", "saturn-char-fallback", initials(card.name)), thumb.firstChild);
            });
            thumb.appendChild(img);
        } else {
            thumb.appendChild(el("div", "saturn-char-fallback", initials(card.name)));
        }
        thumb.appendChild(el("div", "saturn-char-check", "\u2713"));
        thumb.appendChild(el("div", "saturn-char-match-pill", "MATCH"));

        const meta = el("div", "saturn-char-meta");
        const name = el("div", "saturn-char-name", card.name);
        name.title = card.id;
        meta.appendChild(name);
        meta.appendChild(el("div", "saturn-char-trigger", card.trigger || "\u2014"));

        const chips = el("div", "saturn-char-chips");
        const loraCount = (card.loras || []).filter((entry) => entry.enabled !== false).length;
        if (loraCount) chips.appendChild(el("span", "saturn-char-chip", `${loraCount} LoRA${loraCount > 1 ? "s" : ""}`));
        if (card.usage) chips.appendChild(el("span", "saturn-char-chip", `used ${card.usage}`));
        if ((card.missing_loras || []).length) {
            const missing = el("span", "saturn-char-chip missing", `\u26a0 ${card.missing_loras.length} missing`);
            missing.title = card.missing_loras.join("\n");
            chips.appendChild(missing);
        }
        if (card.enabled === false) chips.appendChild(el("span", "saturn-char-chip", "disabled"));
        meta.appendChild(chips);

        const actions = el("div", "saturn-char-actions");
        const editButton = el("button", null, "\u270e");
        editButton.title = "Edit card";
        editButton.addEventListener("click", (event) => {
            event.stopPropagation();
            this.openEditor(card);
        });
        const duplicateButton = el("button", null, "\u29c9");
        duplicateButton.title = "Duplicate card";
        duplicateButton.addEventListener("click", (event) => {
            event.stopPropagation();
            this.duplicateCard(card);
        });
        const deleteButton = el("button", null, "\u2715");
        deleteButton.title = "Delete card";
        deleteButton.addEventListener("click", (event) => {
            event.stopPropagation();
            this.deleteCard(card);
        });
        actions.append(editButton, duplicateButton, deleteButton);

        tile.append(thumb, meta, actions);
        if (selected.has(card.id)) tile.classList.add("selected");
        if (this.matchedIds.has(card.id)) tile.classList.add("matched");

        tile.addEventListener("click", () => this.toggleSelection(card.id));
        tile.addEventListener("dblclick", (event) => {
            event.preventDefault();
            this.openEditor(card);
        });
        return tile;
    }

    toggleSelection(cardId) {
        if ((this.modeWidget?.value || "Select") === "Detect") {
            this.setStatus("Detect mode picks cards from the text input. Switch Mode to Select to click cards.", "warn");
            return;
        }
        const selected = readSelected(this.hiddenWidget);
        const index = selected.indexOf(cardId);
        if (index >= 0) selected.splice(index, 1);
        else selected.push(cardId);
        writeSelected(this.hiddenWidget, selected);
        this.updateSelectionStyles();
        this.node.triggerSlotEvent?.(0);
    }

    updateSelectionStyles() {
        if (!this.grid) return;
        const selected = new Set(readSelected(this.hiddenWidget));
        this.grid.querySelectorAll(".saturn-char-tile").forEach((tile) => {
            tile.classList.toggle("selected", selected.has(tile.getAttribute("data-card-id")));
        });
    }

    startDetectWatcher() {
        this.detectTimer = setInterval(() => {
            if (this.destroyed) return;
            if ((this.modeWidget?.value || "Select") !== "Detect") return;
            this.updateDetectPreview();
        }, 700);
    }

    updateDetectPreview() {
        if (!this.grid) return;
        const detect = (this.modeWidget?.value || "Select") === "Detect";
        if (!detect) {
            this.matchedIds = new Set();
            this.lastDetectSignature = null;
            this.grid.querySelectorAll(".saturn-char-tile.matched").forEach((tile) => tile.classList.remove("matched"));
            return;
        }

        const text = getLinkedText(this.node);
        const matchMode = this.matchModeWidget?.value || "Whole Word";
        const caseSensitive = this.caseWidget?.value === true;
        const matchAll = this.matchAllWidget?.value === true;
        const signature = JSON.stringify([text, matchMode, caseSensitive, matchAll, this.search]);
        if (signature === this.lastDetectSignature) return;
        this.lastDetectSignature = signature;

        const cards = this.renderedCards || this.visibleCards();
        const matched = computeMatches(cards, text, matchMode, caseSensitive, matchAll);
        this.matchedIds = new Set(matched.map((card) => card.id));

        this.grid.querySelectorAll(".saturn-char-tile").forEach((tile) => {
            tile.classList.toggle("matched", this.matchedIds.has(tile.getAttribute("data-card-id")));
        });

        if (!text.trim()) {
            this.setStatus("Detect mode needs text: connect a prompt to the text input.", "warn");
        } else if (!matched.length) {
            this.setStatus("No character trigger found in the connected text.", "warn");
        } else {
            const names = matched.map((card) => card.name).join(", ");
            this.setStatus(`Detected: ${names}`, "ok");
        }
    }

    async flashCards(cardIds, status) {
        if (!Array.isArray(cardIds) || !cardIds.length) {
            if (status === "no-match") this.setStatus("No character trigger matched the prompt text.", "warn");
            else if (status === "no-selection") this.setStatus("No card selected, nothing was applied.", "warn");
            return;
        }
        const detect = (this.modeWidget?.value || "Select") === "Detect";
        if (!detect) {
            // Refresh first so the flash lands on the freshly rendered tiles
            // (usage counters changed during the run).
            await this.refresh();
        }
        const names = [];
        cardIds.forEach((cardId) => {
            const tile = this.grid.querySelector(`.saturn-char-tile[data-card-id="${CSS.escape(cardId)}"]`);
            const card = this.cards.find((item) => item.id === cardId);
            if (card) names.push(card.name);
            if (!tile) return;
            tile.classList.remove("used");
            void tile.offsetWidth;
            tile.classList.add("used");
            setTimeout(() => tile.classList.remove("used"), 3600);
        });
        this.setStatus(`Used: ${names.join(", ") || cardIds.join(", ")}`, "ok");
    }

    async duplicateCard(card) {
        const suggested = `${card.id} Copy`;
        const newId = normalizeCardId(window.prompt("New card id (folders allowed)", suggested) || "");
        if (!newId) return;
        if (!isSafeCardId(newId)) {
            this.setStatus("That card id is not valid.", "error");
            return;
        }
        try {
            await postJson("duplicate", { id: card.id, new_id: newId });
            await this.refresh();
            this.setStatus(`Duplicated as ${newId}.`, "ok");
        } catch (error) {
            this.setStatus(String(error.message || error), "error");
        }
    }

    async deleteCard(card) {
        if (!window.confirm(`Delete the character preset "${card.name}"?\n\nThis removes the card and its thumbnail.`)) return;
        try {
            await postJson("delete", { id: card.id });
            const selected = readSelected(this.hiddenWidget).filter((id) => id !== card.id);
            writeSelected(this.hiddenWidget, selected);
            await this.refresh();
            this.setStatus(`Deleted ${card.name}.`, "ok");
        } catch (error) {
            this.setStatus(String(error.message || error), "error");
        }
    }

    async openEditor(card) {
        if (this.modal) return;
        if ((this.modeWidget?.value || "Select") === "Detect" && !card) {
            this.setStatus("Switch Mode to Select to create cards.", "warn");
            return;
        }

        const isNew = !card;
        const loraList = await fetchLoras().catch(() => []);
        const backdrop = el("div", "saturn-char-modal-backdrop");
        const modal = el("div", "saturn-char-modal");
        const head = el("div", "saturn-char-modal-head");
        head.appendChild(el("span", null, isNew ? "New character preset" : `Edit ${card.name}`));
        const closeButton = el("button", "saturn-char-btn", "Close");
        head.appendChild(closeButton);

        const body = el("div", "saturn-char-modal-body");

        const idField = el("div", "saturn-char-field");
        idField.appendChild(el("label", null, "Card id (use Folder/Name for categories)"));
        const idInput = el("input");
        idInput.type = "text";
        idInput.value = card ? card.id : (this.folderWidget?.value ? `${this.folderWidget.value}/New Character` : "New Character");
        idField.appendChild(idInput);

        const triggerField = el("div", "saturn-char-field");
        triggerField.appendChild(el("label", null, "Trigger word (matched in the prompt text)"));
        const triggerInput = el("input");
        triggerInput.type = "text";
        triggerInput.value = card?.trigger || "";
        triggerField.appendChild(triggerInput);

        const prompts = el("div", "saturn-char-cols");
        const positiveField = el("div", "saturn-char-field");
        positiveField.appendChild(el("label", null, "Positive prompt"));
        const positiveInput = el("textarea");
        positiveInput.value = card?.positive || "";
        positiveField.appendChild(positiveInput);

        const negativeField = el("div", "saturn-char-field");
        negativeField.appendChild(el("label", null, "Negative prompt"));
        const negativeInput = el("textarea");
        negativeInput.value = card?.negative || "";
        negativeField.appendChild(negativeInput);
        prompts.append(positiveField, negativeField);

        const tagsField = el("div", "saturn-char-field");
        tagsField.appendChild(el("label", null, "Tags (comma separated, used for search)"));
        const tagsInput = el("input");
        tagsInput.type = "text";
        tagsInput.value = (card?.tags || []).join(", ");
        tagsField.appendChild(tagsInput);

        const notesField = el("div", "saturn-char-field");
        notesField.appendChild(el("label", null, "Notes (optional)"));
        const notesInput = el("textarea");
        notesInput.value = card?.notes || "";
        notesField.appendChild(notesInput);

        const enabledField = el("div", "saturn-char-field");
        const enabledLabel = el("label");
        const enabledInput = el("input");
        enabledInput.type = "checkbox";
        enabledInput.checked = card ? card.enabled !== false : true;
        enabledLabel.append(enabledInput, document.createTextNode(" Enabled (visible to the picker)"));
        enabledField.appendChild(enabledLabel);

        const loraSection = el("div", "saturn-char-field");
        loraSection.appendChild(el("label", null, "LoRAs"));
        const loraHead = el("div", "saturn-char-lora-head");
        ["LoRA", "Model", "Clip", "On", ""].forEach((label) => loraHead.appendChild(el("span", null, label)));
        const loraRows = el("div");
        const addLoraButton = el("button", "saturn-char-btn", "+ Add LoRA");
        addLoraButton.style.alignSelf = "flex-start";
        loraSection.append(loraHead, loraRows, addLoraButton);

        const thumbSection = el("div", "saturn-char-thumb-editor");
        const thumbPreviewWrap = el("div");
        const thumbButtons = el("div", "saturn-char-thumb-buttons");
        const uploadLabel = el("label", "saturn-char-btn", "Upload image");
        const uploadInput = el("input");
        uploadInput.type = "file";
        uploadInput.accept = "image/png,image/jpeg,image/webp";
        uploadInput.style.display = "none";
        uploadLabel.appendChild(uploadInput);
        const useLoraButton = el("button", "saturn-char-btn", "Use LoRA preview");
        useLoraButton.title = "Copy the preview image of this card's single LoRA";
        const removeThumbButton = el("button", "saturn-char-btn", "Remove image");
        const thumbHint = el("div", "saturn-char-hint", "PNG, JPEG or WebP, max 12 MB.");
        thumbButtons.append(uploadLabel, useLoraButton, removeThumbButton, thumbHint);
        thumbSection.append(thumbPreviewWrap, thumbButtons);

        body.append(
            idField,
            triggerField,
            prompts,
            tagsField,
            notesField,
            enabledField,
            loraSection,
            thumbSection
        );

        const foot = el("div", "saturn-char-modal-foot");
        const errorEl = el("span", "error");
        const saveButton = el("button", "saturn-char-btn", "Save");
        const deleteButton = el("button", "saturn-char-btn", isNew ? "" : "Delete");
        const spacer = el("div", "spacer");
        if (isNew) deleteButton.style.display = "none";
        foot.append(errorEl, spacer, deleteButton, saveButton);

        modal.append(head, body, foot);
        backdrop.appendChild(modal);
        document.body.appendChild(backdrop);
        this.modal = backdrop;

        let pendingThumb = null;
        let removeThumb = false;

        const renderThumbPreview = (src) => {
            thumbPreviewWrap.innerHTML = "";
            if (src) {
                const img = el("img");
                img.src = src;
                thumbPreviewWrap.appendChild(img);
            } else {
                thumbPreviewWrap.appendChild(el("div", "no-image", "No image"));
            }
        };

        renderThumbPreview(
            card?.has_preview
                ? `${API_BASE}/get_preview?id=${encodeURIComponent(card.id)}&full=true&v=${Math.round(card.mtime || 0)}`
                : null
        );

        const close = () => {
            backdrop.remove();
            this.modal = null;
            document.removeEventListener("keydown", onKeyDown, true);
        };
        const onKeyDown = (event) => {
            if (event.key === "Escape") {
                event.stopPropagation();
                close();
            }
        };
        document.addEventListener("keydown", onKeyDown, true);
        backdrop.addEventListener("keydown", (event) => event.stopPropagation());
        backdrop.addEventListener("mousedown", (event) => {
            if (event.target === backdrop) close();
        });
        closeButton.addEventListener("click", close);

        const loraEntries = (card?.loras || []).map((entry) => ({ ...entry }));
        const addLoraRow = (entry) => {
            const row = el("div", "saturn-char-lora-row");
            const select = el("select");
            const known = new Set(loraList);
            const optionNames = [...loraList];
            if (entry.name && !known.has(entry.name)) optionNames.unshift(entry.name);
            const emptyOption = el("option", null, "\u2014 none \u2014");
            emptyOption.value = "";
            select.appendChild(emptyOption);
            optionNames.forEach((name) => {
                const option = el("option", null, entry.name && name === entry.name && !known.has(name) ? `${name} (missing)` : name);
                option.value = name;
                select.appendChild(option);
            });
            select.value = entry.name || "";

            const modelInput = el("input");
            modelInput.type = "number";
            modelInput.step = "0.05";
            modelInput.value = entry.strength_model ?? 1.0;

            const clipInput = el("input");
            clipInput.type = "number";
            clipInput.step = "0.05";
            clipInput.value = entry.strength_clip ?? 1.0;

            const enabled = el("input");
            enabled.type = "checkbox";
            enabled.checked = entry.enabled !== false;

            const remove = el("button", null, "\u2715");
            remove.title = "Remove this LoRA row";
            remove.addEventListener("click", () => row.remove());

            row.append(select, modelInput, clipInput, enabled, remove);
            row._read = () => ({
                name: select.value,
                strength_model: Number(modelInput.value) || 0,
                strength_clip: Number(clipInput.value) || 0,
                enabled: enabled.checked,
            });
            loraRows.appendChild(row);
        };

        loraEntries.forEach(addLoraRow);
        if (!loraEntries.length) addLoraRow({ name: "", strength_model: 1, strength_clip: 1, enabled: true });

        addLoraButton.addEventListener("click", () => addLoraRow({ name: "", strength_model: 1, strength_clip: 1, enabled: true }));

        uploadInput.addEventListener("change", () => {
            const file = uploadInput.files && uploadInput.files[0];
            if (!file) return;
            if (file.size > 12 * 1024 * 1024) {
                errorEl.textContent = "Image is too large (max 12 MB).";
                return;
            }
            const reader = new FileReader();
            reader.onload = () => {
                pendingThumb = String(reader.result || "");
                removeThumb = false;
                errorEl.textContent = "";
                renderThumbPreview(pendingThumb);
            };
            reader.readAsDataURL(file);
        });

        removeThumbButton.addEventListener("click", () => {
            pendingThumb = null;
            removeThumb = true;
            renderThumbPreview(null);
        });

        useLoraButton.addEventListener("click", async () => {
            if (!card) {
                errorEl.textContent = "Save the card first, then copy the LoRA preview.";
                return;
            }
            try {
                await postJson("use_lora_preview", { id: card.id });
                removeThumb = false;
                pendingThumb = null;
                await this.refresh();
                const updated = this.cards.find((item) => item.id === card.id);
                renderThumbPreview(
                    `${API_BASE}/get_preview?id=${encodeURIComponent(card.id)}&full=true&v=${Date.now()}`
                );
                if (!updated || !updated.has_preview) errorEl.textContent = "No preview was copied.";
                else errorEl.textContent = "";
            } catch (error) {
                errorEl.textContent = String(error.message || error);
            }
        });

        saveButton.addEventListener("click", async () => {
            const cardId = normalizeCardId(idInput.value);
            if (!cardId) {
                errorEl.textContent = "A card id is required.";
                return;
            }
            if (!isSafeCardId(cardId)) {
                errorEl.textContent = "The card id cannot contain '..', ':' or empty segments.";
                return;
            }
            const loras = Array.from(loraRows.children)
                .map((row) => row._read())
                .filter((entry) => entry.name);
            const payload = {
                id: cardId,
                original_id: card ? card.id : cardId,
                card: {
                    name: cardId.split("/").pop(),
                    trigger: triggerInput.value.trim(),
                    positive: positiveInput.value,
                    negative: negativeInput.value,
                    tags: tagsInput.value,
                    notes: notesInput.value,
                    enabled: enabledInput.checked,
                    loras,
                },
                thumbnail_data_url: pendingThumb || null,
                remove_thumbnail: removeThumb,
            };
            saveButton.disabled = true;
            try {
                const result = await postJson("save", payload);
                if (result.thumbnail_error) {
                    errorEl.textContent = `Saved, but the image failed: ${result.thumbnail_error}`;
                }
                const selected = readSelected(this.hiddenWidget);
                if (card && card.id !== cardId) {
                    const index = selected.indexOf(card.id);
                    if (index >= 0) selected[index] = cardId;
                    writeSelected(this.hiddenWidget, selected);
                }
                close();
                await this.refresh();
                this.flashSaved(cardId);
                if ((result.missing_loras || []).length) {
                    this.setStatus(`Saved. Missing LoRA file(s): ${result.missing_loras.join(", ")}`, "warn");
                } else {
                    this.setStatus(`Saved ${cardId}.`, "ok");
                }
            } catch (error) {
                errorEl.textContent = String(error.message || error);
            } finally {
                saveButton.disabled = false;
            }
        });

        deleteButton.addEventListener("click", async () => {
            if (!card) return;
            if (!window.confirm(`Delete the character preset "${card.name}"?`)) return;
            try {
                await postJson("delete", { id: card.id });
                const selected = readSelected(this.hiddenWidget).filter((id) => id !== card.id);
                writeSelected(this.hiddenWidget, selected);
                close();
                await this.refresh();
                this.setStatus(`Deleted ${card.name}.`, "ok");
            } catch (error) {
                errorEl.textContent = String(error.message || error);
            }
        });

        setTimeout(() => idInput.focus(), 30);
    }

    flashSaved(cardId) {
        const tile = this.grid.querySelector(`.saturn-char-tile[data-card-id="${CSS.escape(cardId)}"]`);
        if (!tile) return;
        tile.classList.add("used");
        setTimeout(() => tile.classList.remove("used"), 3000);
    }

    destroy() {
        this.destroyed = true;
        if (this.detectTimer) clearInterval(this.detectTimer);
        if (this.modal) {
            this.modal.remove();
            this.modal = null;
        }
    }
}

function isCharacterPicker(node) {
    return node?.comfyClass === NODE_TYPE || node?.type === NODE_TYPE;
}

injectStyles();

app.registerExtension({
    name: "ComfyUI.SaturnNodes.CharacterPresets",
    async nodeCreated(node) {
        if (!isCharacterPicker(node)) return;

        node.size = [420, 540];
        node.computeSize = function () {
            return [420, 540];
        };

        const ui = new CharacterPickerUI(node);
        node._saturnCharacterPicker = ui;

        const originalRemoved = node.onRemoved;
        node.onRemoved = function () {
            ui.destroy();
            return originalRemoved ? originalRemoved.apply(this, arguments) : undefined;
        };
    },
});

api.addEventListener("saturnnodes_character_presets_selected", (event) => {
    const detail = event?.detail || {};
    const nodeId = String(detail.node_id ?? "");
    const nodes = app.graph?._nodes || [];
    for (const node of nodes) {
        if (!isCharacterPicker(node)) continue;
        if (String(node.id) !== nodeId) continue;
        node._saturnCharacterPicker?.flashCards(detail.cards || [], detail.status || "");
    }
});

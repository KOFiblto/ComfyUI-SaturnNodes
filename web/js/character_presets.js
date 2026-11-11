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
const SORT_FOLDERS = [
    "Name (A-Z)",
    "Name (Z-A)",
    "Total Usage (High to Low)",
    "Average Usage (High to Low)",
    "Total LoRAs (Most First)",
];
const MATCH_MODES = ["Whole Word", "Contains", "Exact"];
const ALIGN_MODES = ["Left Aligned", "Right Aligned"];
const RANK_BORDERS_SETTING = "SaturnNodes.🖼️ Visual Loaders.05b_CharacterRankBorders";

function getRankBordersEnabled() {
    try {
        const value = app?.ui?.settings?.getSettingValue?.(RANK_BORDERS_SETTING);
        if (typeof value === "boolean") return value;
    } catch (_) {}
    try {
        const raw = globalThis.localStorage?.getItem(`Comfy.Settings.${RANK_BORDERS_SETTING}`);
        if (raw !== null && raw !== undefined) return JSON.parse(raw) !== false;
    } catch (_) {}
    return true;
}

// The corner usage badge grows with the usage count. A logarithmic curve keeps
// low counts subtle while letting heavily used cards stand out, capped so the
// label never swallows the thumbnail.
function usageBadgeScale(usage) {
    const n = Math.max(0, Number(usage) || 0);
    if (n <= 0) return 1;
    return Math.min(2.1, 1 + Math.log10(n + 1) * 0.42);
}

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
    width: 100%;
    height: 100%;
    min-height: 0;
    max-height: 100%;
    box-sizing: border-box;
    padding: 8px;
    color: #f2e6da;
    font-size: 12px;
    background: #111;
    border-radius: 8px;
    overflow: hidden;
}
.saturn-char-control-bar {
    display: flex;
    justify-content: space-between;
    align-items: center;
    flex-wrap: wrap;
    gap: 12px;
    row-gap: 6px;
    padding: 4px 6px;
    background: #181818;
    border: 1px solid #282828;
    border-radius: 5px;
    margin-bottom: 6px;
    width: 100%;
    box-sizing: border-box;
}
.saturn-char-control-group {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
}
.saturn-char-control-label {
    font-size: 10px;
    color: #888;
    font-weight: bold;
    white-space: nowrap;
}
.saturn-char-control-bar select,
.saturn-char-control-bar input[type="text"] {
    background: #252525;
    border: 1px solid #353535;
    color: #fff;
    font-size: 10px;
    font-weight: bold;
    padding: 2px 4px;
    border-radius: 4px;
    min-width: 0;
    max-width: 150px;
    box-sizing: border-box;
}
.saturn-char-control-bar select { cursor: pointer; }
.saturn-char-control-bar input[type="text"] {
    flex: 1 1 90px;
    max-width: none;
    font-weight: normal;
    cursor: text;
}
.saturn-char-toggle-btn {
    background: #252525;
    border: 1px solid #353535;
    color: #aaa;
    /* 125% of the visual LoRA loader's .lora-toggle-btn (9px / 3px 8px). */
    font-size: 11.25px;
    font-weight: bold;
    padding: 3.75px 10px;
    border-radius: 4px;
    cursor: pointer;
    transition: all 0.15s ease-in-out;
    white-space: nowrap;
}
.saturn-char-toggle-btn:hover {
    background: #303030;
    color: #fff;
}
.saturn-char-toggle-btn.active {
    background: #007acc;
    border-color: #0098ff;
    color: #fff;
    box-shadow: 0 0 5px rgba(0, 122, 204, 0.4);
}
.saturn-char-toggle-btn:disabled { opacity: 0.45; cursor: default; }
.saturn-char-toggle-btn.icon {
    min-width: 30px;
    padding: 3.75px 8px;
    font-size: 13px;
}
.saturn-char-btn {
    background: #252525;
    border: 1px solid #353535;
    color: #ddd;
    border-radius: 4px;
    padding: 3px 9px;
    font-size: 10px;
    font-weight: bold;
    cursor: pointer;
    white-space: nowrap;
}
.saturn-char-btn:hover { background: #303030; color: #fff; }
.saturn-char-btn:disabled { opacity: 0.45; cursor: default; }
.saturn-char-status {
    font-size: 10.5px;
    color: #c9b3a0;
    min-height: 13px;
    margin-bottom: 4px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}
.saturn-char-status.warn { color: #ffcf70; }
.saturn-char-status.error { color: #ff8a8a; }
.saturn-char-status.ok { color: #6dff9a; }
.saturn-char-grid-container {
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
.saturn-char-grid-container::-webkit-scrollbar {
    width: 6px;
}
.saturn-char-grid-container::-webkit-scrollbar-track {
    background: rgba(0, 0, 0, 0.1);
    border-radius: 4px;
}
.saturn-char-grid-container::-webkit-scrollbar-thumb {
    background: rgba(255, 255, 255, 0.15);
    border-radius: 4px;
}
.saturn-char-grid-container::-webkit-scrollbar-thumb:hover {
    background: rgba(255, 255, 255, 0.3);
}
.saturn-char-root.show-all-mode {
    height: auto;
    max-height: none;
    overflow-y: visible;
}
.saturn-char-root.show-all-mode .saturn-char-grid-container {
    flex: 0 0 auto;
    height: auto;
    max-height: none;
    overflow-y: visible;
}
.saturn-char-grid-container.detect-mode {
    background-image: linear-gradient(rgba(150, 150, 150, 0.09), rgba(150, 150, 150, 0.09));
    box-shadow: inset 0 0 0 2px rgba(150, 150, 150, 0.35);
    border-radius: 6px;
}
.saturn-char-grid-container.detect-mode .saturn-char-tile { cursor: default; }
.saturn-char-grid-container.detect-mode .saturn-char-tile:hover {
    transform: none;
    border-color: #333;
}
.saturn-char-folder-container {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin-bottom: 12px;
    width: 100%;
}
.saturn-char-folder-header {
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
.saturn-char-folder-header:hover {
    background: linear-gradient(90deg, #242424, #1a1a1a);
    border-color: #383838;
}
.saturn-char-folder-toggle {
    font-size: 9px;
    color: #888;
    margin-right: 8px;
    transition: transform 0.2s ease-in-out;
}
.saturn-char-folder-header.collapsed .saturn-char-folder-toggle {
    transform: rotate(-90deg);
}
.saturn-char-folder-name {
    font-size: 11px;
    font-weight: bold;
    color: #d1d1d1;
    flex-grow: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.saturn-char-folder-count {
    font-size: 10px;
    color: #555;
    margin-right: 10px;
}
.saturn-char-folder-checkbox {
    cursor: pointer;
    width: 13px;
    height: 13px;
    accent-color: #007acc;
    margin: 0;
}
.saturn-char-folder-grid {
    display: flex;
    flex-wrap: wrap;
    align-content: flex-start;
    gap: 8px;
    padding: 4px 2px;
}
.saturn-char-right-aligned .saturn-char-folder-grid {
    justify-content: flex-end;
}
.saturn-char-right-aligned .saturn-char-folder-header {
    flex-direction: row-reverse;
}
.saturn-char-right-aligned .saturn-char-folder-toggle {
    margin-right: 0;
    margin-left: 8px;
}
.saturn-char-right-aligned .saturn-char-folder-count {
    margin-right: 0;
    margin-left: 10px;
}
.saturn-char-folder-container.collapsed .saturn-char-folder-grid {
    display: none !important;
}
.saturn-char-tile {
    width: var(--saturn-char-tile-size, 80px);
    flex: 0 0 auto;
    aspect-ratio: 3 / 4;
    position: relative;
    display: flex;
    flex-direction: column;
    justify-content: flex-end;
    align-items: center;
    background: #1a1a1a;
    border: 2px solid #333;
    border-radius: 6px;
    overflow: hidden;
    cursor: pointer;
    box-sizing: border-box;
    transition: all 0.15s ease-in-out;
}
.saturn-char-tile:hover {
    border-color: #007acc;
    transform: scale(1.03);
}
.saturn-char-tile.selected {
    border-color: #00ff66 !important;
    border-width: 4px !important;
    box-shadow: 0 0 12px rgba(0, 255, 102, 0.5);
}
.saturn-char-tile.used {
    animation: saturn-char-flash 1.2s ease-out 3;
}
@keyframes saturn-char-flash {
    0% { box-shadow: 0 0 0 3px rgba(255, 200, 90, 0.95), 0 0 16px rgba(255, 200, 90, 0.7); }
    100% { box-shadow: 0 0 0 0 rgba(255, 200, 90, 0); }
}
.saturn-char-thumb {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    background: #120b06;
    overflow: hidden;
    z-index: 0;
}
.saturn-char-thumb img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
    position: absolute;
    top: 0;
    left: 0;
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
.saturn-char-label {
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    z-index: 2;
    width: 100%;
    box-sizing: border-box;
    background: rgba(0, 0, 0, 0.85);
    border-top: 1px solid #222;
    padding: 4px 3px;
    text-align: center;
}
.saturn-char-name {
    font-size: 10px;
    font-weight: 600;
    color: #fff;
    line-height: 1.25;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}
.saturn-char-trigger {
    font-size: 8.5px;
    font-weight: 400;
    color: #8fe3b0;
    line-height: 1.25;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}
.saturn-char-check {
    position: absolute;
    top: 4px;
    left: 4px;
    display: none;
    align-items: center;
    justify-content: center;
    min-width: 16px;
    height: 16px;
    padding: 0 3px;
    box-sizing: border-box;
    border-radius: 8px;
    background: #00ff66;
    color: #06240f;
    font-size: 10px;
    font-weight: 800;
    line-height: 1;
    pointer-events: none;
    z-index: 3;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.45);
}
.saturn-char-tile.selected .saturn-char-check { display: flex; }
.saturn-char-match-pill {
    position: absolute;
    top: 4px;
    left: 50%;
    transform: translateX(-50%);
    display: none;
    padding: 1px 5px;
    border-radius: 8px;
    background: #00ff66;
    color: #06240f;
    font-size: 8px;
    font-weight: 800;
    letter-spacing: 0.4px;
    pointer-events: none;
    z-index: 3;
}
.saturn-char-tile.matched .saturn-char-match-pill { display: block; }
/* Usage badge: a corner flap flush with the top and right edges, rounded
   along the inner (bottom-left) edge. Its size grows with the usage count
   via the --usage-scale custom property. */
.saturn-char-badge {
    position: absolute;
    top: 0;
    right: 0;
    z-index: 2;
    padding: calc(2px * var(--usage-scale, 1)) calc(6px * var(--usage-scale, 1)) calc(3px * var(--usage-scale, 1)) calc(9px * var(--usage-scale, 1));
    border-radius: 0 0 0 calc(11px * var(--usage-scale, 1));
    background: rgba(0, 122, 204, 0.9);
    color: #fff;
    font-size: calc(8px * var(--usage-scale, 1));
    font-weight: bold;
    line-height: 1.15;
    pointer-events: none;
    box-shadow: -1px 1px 3px rgba(0, 0, 0, 0.35);
}
.saturn-char-badge.warn {
    --usage-scale: 1;
    background: rgba(168, 0, 0, 0.9);
}
/* Rank borders add gold / silver / bronze rings for the three most-used
   cards, plus an animated RGB ring at 1000+ uses. They are 150% of the
   normal tile border thickness (2px -> 3px). */
.saturn-char-tile.rank-1:not(.selected) {
    border-width: 3px !important;
    border-color: #ffd700 !important;
    box-shadow: 0 0 15px rgba(255, 215, 0, 0.55);
}
.saturn-char-tile.rank-2:not(.selected) {
    border-width: 3px !important;
    border-color: #d7dde6 !important;
    box-shadow: 0 0 15px rgba(215, 221, 230, 0.5);
}
.saturn-char-tile.rank-3:not(.selected) {
    border-width: 3px !important;
    border-color: #cd7f32 !important;
    box-shadow: 0 0 15px rgba(205, 127, 50, 0.5);
}
.saturn-char-tile.usage-1k:not(.selected) {
    border-width: 3px !important;
    border-color: #ff0055 !important;
    animation: saturn-char-rgb-border 4s linear infinite !important;
}
@keyframes saturn-char-rgb-border {
    0% { border-color: #ff0055 !important; box-shadow: 0 0 18px rgba(255, 0, 85, 0.8); }
    25% { border-color: #ffb300 !important; box-shadow: 0 0 18px rgba(255, 179, 0, 0.8); }
    50% { border-color: #19e68c !important; box-shadow: 0 0 18px rgba(25, 230, 140, 0.8); }
    75% { border-color: #00a3ff !important; box-shadow: 0 0 18px rgba(0, 163, 255, 0.8); }
    100% { border-color: #ff0055 !important; box-shadow: 0 0 18px rgba(255, 0, 85, 0.8); }
}
.saturn-char-selection-count {
    flex: 0 0 auto;
    padding: 4px 6px 0;
    color: #9c8471;
    font-size: 10.5px;
    font-weight: 600;
    text-align: right;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}
.saturn-char-empty {
    width: 100%;
    padding: 14px 8px;
    text-align: center;
    color: #9c8471;
    font-size: 11px;
    line-height: 1.5;
    box-sizing: border-box;
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
    width: min(1440px, 97vw);
    max-width: 97vw;
    max-height: 92vh;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    background: #111;
    color: #eee;
    border: 1px solid #2c2c2c;
    border-radius: 8px;
    box-shadow: 0 12px 40px rgba(0, 0, 0, 0.75);
    font-size: 12px;
}
.saturn-char-modal-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 14px;
    border-bottom: 1px solid #262626;
    font-size: 13px;
    font-weight: 600;
}
.saturn-char-modal-body {
    padding: 12px 14px;
    overflow-y: auto;
    overflow-x: hidden;
    display: flex;
    flex-direction: column;
    gap: 10px;
    min-width: 0;
}
.saturn-char-modal-foot {
    display: flex;
    gap: 8px;
    align-items: center;
    padding: 10px 14px;
    border-top: 1px solid #262626;
}
.saturn-char-modal-foot .spacer { flex: 1 1 auto; }
.saturn-char-modal-foot .error { color: #ff8a8a; font-size: 11px; }
.saturn-char-modal .saturn-char-btn {
    /* 150% of the picker's base .saturn-char-btn (10px / 3px 9px). */
    font-size: 15px;
    padding: 5px 14px;
}
.saturn-char-field { display: flex; flex-direction: column; gap: 3px; }
.saturn-char-field > label { font-size: 11px; color: #999; }
.saturn-char-field input[type="text"],
.saturn-char-field textarea,
.saturn-char-field select,
.saturn-char-lora-row select,
.saturn-char-lora-row input[type="number"] {
    background: #1b1b1b;
    color: #eee;
    border: 1px solid #333;
    border-radius: 4px;
    padding: 5px 7px;
    font-size: 12px;
    font-family: inherit;
    min-width: 0;
    width: 100%;
    box-sizing: border-box;
}
.saturn-char-field textarea { min-height: 56px; resize: vertical; }
.saturn-char-cols { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; min-width: 0; }
.saturn-char-editor-fields .saturn-char-cols { flex: 1; min-height: 150px; }
.saturn-char-cols .saturn-char-field { min-height: 0; }
.saturn-char-cols .saturn-char-field textarea {
    flex: 1;
    min-height: 0;
    resize: none;
}
.saturn-char-lora-head,
.saturn-char-lora-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 70px 70px 40px 30px;
    gap: 6px;
    align-items: center;
    min-width: 0;
}
.saturn-char-lora-head { font-size: 10.5px; color: #888; }
.saturn-char-lora-row select { width: 100%; min-width: 0; }
.saturn-char-lora-row button {
    background: #252525;
    border: 1px solid #353535;
    color: #ddd;
    border-radius: 4px;
    cursor: pointer;
    height: 28px;
}
.saturn-char-lora-row button:hover { background: #303030; color: #fff; }
.saturn-char-editor-top {
    display: grid;
    grid-template-columns: minmax(220px, 30%) minmax(0, 1fr);
    gap: 14px;
    align-items: stretch;
    min-width: 0;
}
.saturn-char-editor-fields {
    display: flex;
    flex-direction: column;
    gap: 10px;
    min-width: 0;
    height: 100%;
}
.saturn-char-thumb-editor {
    display: flex;
    flex-direction: column;
    gap: 8px;
    border: 1px solid #2c2c2c;
    border-radius: 6px;
    padding: 10px;
    min-width: 0;
}
.saturn-char-thumb-preview {
    position: relative;
    width: 100%;
    aspect-ratio: 3 / 4;
    border-radius: 4px;
    overflow: hidden;
    background: #1b1b1b;
}
.saturn-char-thumb-content { width: 100%; height: 100%; }
.saturn-char-thumb-preview img {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
    background: #1b1b1b;
}
.saturn-char-thumb-preview .no-image {
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #666;
    font-size: 11px;
}
.saturn-char-thumb-actions {
    position: absolute;
    top: 6px;
    right: 6px;
    display: flex;
    gap: 4px;
}
.saturn-char-icon-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 30px;
    height: 30px;
    padding: 0;
    border: 1px solid #3a3a3a;
    border-radius: 4px;
    background: rgba(20, 20, 20, 0.86);
    color: #fff;
    font-size: 15px;
    line-height: 1;
    cursor: pointer;
}
.saturn-char-icon-btn:hover { background: #007acc; border-color: #0098ff; }
.saturn-char-fetch-btn { width: 100%; text-align: center; }
.saturn-char-fetch-status { font-size: 10.5px; color: #888; }
.saturn-char-fetch-status:empty { display: none; }
.saturn-char-fetch-status.ok { color: #6dff9a; }
.saturn-char-fetch-status.warn { color: #ffcf70; }
.saturn-char-fetch-status.error { color: #ff8a8a; }
.saturn-char-hint { font-size: 10px; color: #888; }
.saturn-char-import-list {
    display: flex;
    flex-direction: column;
    gap: 3px;
    max-height: 46vh;
    overflow: auto;
    border: 1px solid #2c2c2c;
    border-radius: 6px;
    padding: 4px;
    background: #161616;
}
.saturn-char-import-row {
    display: grid;
    grid-template-columns: 18px 240px 1fr auto;
    align-items: center;
    gap: 8px;
    font-size: 11px;
    padding: 3px 4px;
    border-radius: 4px;
}
.saturn-char-import-row:hover { background: rgba(255, 255, 255, 0.05); }
.saturn-char-import-row input[type="text"] {
    background: #1b1b1b;
    color: #eee;
    border: 1px solid #333;
    border-radius: 4px;
    padding: 3px 6px;
    font-size: 11px;
    font-family: inherit;
    min-width: 0;
}
.saturn-char-import-row .tag { font-size: 9px; padding: 1px 5px; border-radius: 6px; background: rgba(0, 255, 102, 0.16); color: #7bffb0; }
.saturn-char-import-row.exists { opacity: 0.62; }
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

function normalizeLoraName(value) {
    return String(value || "").replace(/\\/g, "/").trim();
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

function cardTriggers(card) {
    if (!card) return [];
    if (Array.isArray(card.triggers)) {
        return card.triggers.map((value) => String(value || "").trim()).filter(Boolean);
    }
    const legacy = String(card.trigger || "").trim();
    return legacy ? [legacy] : [];
}

function computeMatches(cards, text, mode, caseSensitive, matchAll) {
    if (!text) return [];
    const hits = [];
    for (const card of cards) {
        let best = -1;
        for (const trigger of cardTriggers(card)) {
            const index = triggerIndex(text, trigger, mode, caseSensitive);
            if (index >= 0 && (best < 0 || index < best)) best = index;
        }
        if (best >= 0) hits.push({ index: best, id: card.id, card });
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

function readStoredValue(key) {
    try {
        if (typeof window !== "undefined" && window.localStorage) {
            return window.localStorage.getItem(key);
        }
    } catch (_) {
        /* storage can be blocked by privacy settings */
    }
    return null;
}

function writeStoredValue(key, value) {
    try {
        if (typeof window !== "undefined" && window.localStorage) {
            window.localStorage.setItem(key, value);
        }
    } catch (_) {
        /* storage can be blocked by privacy settings */
    }
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
        this.allCardIds = new Set();
        this.selectionAnchor = null;
        this.detectActive = false;
        this.lastDetectSignature = null;
        this.destroyed = false;
        this.modal = null;
        this.cacheBust = 0;

        this.folderWidget = getWidget(node, "folder");
        this.selectionWidget = getWidget(node, "selection_mode");
        this.sortWidget = getWidget(node, "sort_presets_by");
        this.sortFoldersWidget = getWidget(node, "sort_folders_by");
        this.contentAlignmentWidget = getWidget(node, "content_alignment");
        this.folderPositionWidget = getWidget(node, "folder_position");
        this.displayWidget = getWidget(node, "display_mode");
        this.matchModeWidget = getWidget(node, "match_mode");
        this.matchAllWidget = getWidget(node, "match_all");
        this.caseWidget = getWidget(node, "case_sensitive");
        this.includeDisabledWidget = getWidget(node, "include_disabled");
        this.hiddenWidget = this.ensureHiddenWidget();
        this.scrapeOnNewWidget = this.ensureHiddenWidget("_scrape_on_new", "true");

        this.normalizeWidgetValues();
        this.build();
        this.bindWidgets();
        this.updateSelectionHint();
        this.refresh();
        this.startDetectWatcher();
    }

    normalizeWidgetValues() {
        // Widget values are positional in saved workflows, so a workflow saved
        // with a mismatched widget list can carry e.g. "[]" into display_mode.
        // Repair every combo here before ComfyUI validates the prompt.
        const fix = (widget, allowed, fallback) => {
            if (widget && !allowed.includes(widget.value)) widget.value = fallback;
        };
        fix(this.displayWidget, ["Scrollable", "Show All"], "Scrollable");
        fix(this.selectionWidget, SELECTION_MODES, "Sequential");
        fix(this.sortWidget, SORT_PRESETS, SORT_PRESETS[0]);
        fix(this.sortFoldersWidget, SORT_FOLDERS, SORT_FOLDERS[0]);
        fix(this.folderPositionWidget, ["Folders First", "Root Presets First"], "Folders First");
        fix(this.matchModeWidget, MATCH_MODES, "Whole Word");
        fix(this.contentAlignmentWidget, ALIGN_MODES, "Left Aligned");
    }

    ensureHiddenWidget(name = "_selected_presets", defaultValue = "[]") {
        let widget = getWidget(this.node, name);
        if (!widget) {
            widget = this.node.addWidget("text", name, defaultValue, () => {}, { serialize: true });
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
        const ui = this;

        const controlBar = el("div", "saturn-char-control-bar");

        // Mode: drives the hidden selection_mode widget, like the LoRA loader's Mode select.
        const modeGroup = el("div", "saturn-char-control-group");
        modeGroup.appendChild(el("span", "saturn-char-control-label", "Mode:"));
        this.modeSelect = el("select");
        this.modeSelect.title = "How the selected cards are used on each run";
        SELECTION_MODES.forEach((mode) => {
            const option = el("option", null, mode);
            option.value = mode;
            this.modeSelect.appendChild(option);
        });
        this.modeSelect.addEventListener("change", () => {
            if (this.selectionWidget) {
                this.selectionWidget.value = this.modeSelect.value;
                if (this.selectionWidget.callback) this.selectionWidget.callback(this.modeSelect.value);
            }
            this.updateSelectionHint();
            this.node.triggerSlotEvent?.(0);
        });
        modeGroup.appendChild(this.modeSelect);
        controlBar.appendChild(modeGroup);

        // Sort: drives the hidden sort_presets_by widget.
        const sortGroup = el("div", "saturn-char-control-group");
        sortGroup.appendChild(el("span", "saturn-char-control-label", "Sort:"));
        this.sortSelect = el("select");
        this.sortSelect.title = "Sort presets inside each folder";
        SORT_PRESETS.forEach((option) => {
            const item = el("option", null, option);
            item.value = option;
            this.sortSelect.appendChild(item);
        });
        this.sortSelect.addEventListener("change", () => {
            if (this.sortWidget) this.sortWidget.value = this.sortSelect.value;
            this.render();
        });
        sortGroup.appendChild(this.sortSelect);
        controlBar.appendChild(sortGroup);

        // Sort folders: drives the hidden sort_folders_by widget, mirroring the
        // Visual LoRA Loader's folder ordering options.
        const folderSortGroup = el("div", "saturn-char-control-group");
        folderSortGroup.appendChild(el("span", "saturn-char-control-label", "Folders:"));
        this.sortFoldersSelect = el("select");
        this.sortFoldersSelect.title = "Sort folder groups";
        SORT_FOLDERS.forEach((option) => {
            const item = el("option", null, option);
            item.value = option;
            this.sortFoldersSelect.appendChild(item);
        });
        this.sortFoldersSelect.addEventListener("change", () => {
            if (this.sortFoldersWidget) this.sortFoldersWidget.value = this.sortFoldersSelect.value;
            this.render();
        });
        folderSortGroup.appendChild(this.sortFoldersSelect);
        controlBar.appendChild(folderSortGroup);

        // Alignment: drives the hidden content_alignment widget.
        const alignGroup = el("div", "saturn-char-control-group");
        alignGroup.appendChild(el("span", "saturn-char-control-label", "Align:"));
        this.leftAlignButton = el("button", "saturn-char-toggle-btn active", "Left");
        this.leftAlignButton.title = "Align folder contents to the left";
        this.leftAlignButton.addEventListener("click", () => this.setContentAlignment("Left Aligned"));
        this.rightAlignButton = el("button", "saturn-char-toggle-btn", "Right");
        this.rightAlignButton.title = "Align folder contents to the right";
        this.rightAlignButton.addEventListener("click", () => this.setContentAlignment("Right Aligned"));
        alignGroup.append(this.leftAlignButton, this.rightAlignButton);
        controlBar.appendChild(alignGroup);

        // View: drives the hidden display_mode widget.
        const viewGroup = el("div", "saturn-char-control-group");
        viewGroup.appendChild(el("span", "saturn-char-control-label", "View:"));
        this.scrollButton = el("button", "saturn-char-toggle-btn active", "Scroll");
        this.scrollButton.title = "Scroll inside the node";
        this.scrollButton.addEventListener("click", () => this.setDisplayMode("Scrollable"));
        this.showAllButton = el("button", "saturn-char-toggle-btn", "Show All");
        this.showAllButton.title = "Grow the node to fit every card";
        this.showAllButton.addEventListener("click", () => this.setDisplayMode("Show All"));
        viewGroup.append(this.scrollButton, this.showAllButton);
        controlBar.appendChild(viewGroup);

        // Maintenance: reset cycle counter, usage history and thumbnail cache.
        const maintenanceGroup = el("div", "saturn-char-control-group");
        maintenanceGroup.appendChild(el("span", "saturn-char-control-label", "Reset:"));
        this.cycleResetButton = el("button", "saturn-char-toggle-btn", "\u21ba Counter");
        this.cycleResetButton.title = "Reset this picker's Sequential/Random cycle counter";
        this.cycleResetButton.addEventListener("click", () => this.resetMaintenance("cycle"));
        this.usageResetButton = el("button", "saturn-char-toggle-btn", "\ud83e\uddf9 Usage");
        this.usageResetButton.title = "Reset all character usage counters and rank borders";
        this.usageResetButton.addEventListener("click", () => this.resetMaintenance("usage"));
        this.cacheResetButton = el("button", "saturn-char-toggle-btn", "\ud83d\uddd1 Cache");
        this.cacheResetButton.title = "Delete cached character thumbnails (regenerated automatically)";
        this.cacheResetButton.addEventListener("click", () => this.resetMaintenance("cache"));
        maintenanceGroup.append(this.cycleResetButton, this.usageResetButton, this.cacheResetButton);
        controlBar.appendChild(maintenanceGroup);

        const actionGroup = el("div", "saturn-char-control-group");
        this.newButton = el("button", "saturn-char-toggle-btn icon", "\uFF0B");
        this.newButton.title = "Create a new character preset card";
        this.newButton.setAttribute?.("aria-label", "New character preset");
        this.newButton.addEventListener("click", () => this.openEditor(null));

        this.refreshButton = el("button", "saturn-char-toggle-btn icon", "\u21BB");
        this.refreshButton.title = "Rescan the presets folder";
        this.refreshButton.setAttribute?.("aria-label", "Refresh presets");
        this.refreshButton.addEventListener("click", () => this.refresh());

        this.openFolderButton = el("button", "saturn-char-toggle-btn icon", "\uD83D\uDCC2");
        this.openFolderButton.title = "Open the character presets folder";
        this.openFolderButton.setAttribute?.("aria-label", "Open presets folder");
        this.openFolderButton.addEventListener("click", async () => {
            try {
                await postJson("open_folder", {});
            } catch (error) {
                this.setStatus(String(error.message || error), "error");
            }
        });

        // Card actions operate on the single selected card. They sit in the
        // top control bar and stay disabled unless exactly one card is
        // selected.
        this.editCardButton = el("button", "saturn-char-toggle-btn icon", "\u270e");
        this.editCardButton.title = "Edit the selected card (select exactly one card)";
        this.editCardButton.setAttribute?.("aria-label", "Edit selected card");
        this.editCardButton.disabled = true;
        this.editCardButton.addEventListener("click", () => {
            const card = this.getSingleSelectedCard();
            if (card) this.openEditor(card);
        });

        this.duplicateCardButton = el("button", "saturn-char-toggle-btn icon", "\u29c9");
        this.duplicateCardButton.title = "Duplicate the selected card (select exactly one card)";
        this.duplicateCardButton.setAttribute?.("aria-label", "Duplicate selected card");
        this.duplicateCardButton.disabled = true;
        this.duplicateCardButton.addEventListener("click", () => {
            const card = this.getSingleSelectedCard();
            if (card) this.duplicateCard(card);
        });

        this.deleteCardButton = el("button", "saturn-char-toggle-btn icon", "\u2715");
        this.deleteCardButton.title = "Delete the selected card (select exactly one card)";
        this.deleteCardButton.setAttribute?.("aria-label", "Delete selected card");
        this.deleteCardButton.disabled = true;
        this.deleteCardButton.addEventListener("click", () => {
            const card = this.getSingleSelectedCard();
            if (card) this.deleteCard(card);
        });

        actionGroup.append(
            this.newButton,
            this.refreshButton,
            this.openFolderButton,
            this.editCardButton,
            this.duplicateCardButton,
            this.deleteCardButton
        );
        controlBar.appendChild(actionGroup);

        this.statusEl = el("div", "saturn-char-status", "");
        this.grid = el("div", "saturn-char-grid-container scrollable");
        this.container = container;
        this.foldersMap = {};

        // Mirror the visual LoRA loader: the DOM widget must always fill the
        // node body, otherwise flex:1 grids collapse to their content height.
        container.style.setProperty("height", "100%", "important");
        container.style.setProperty("max-height", "100%", "important");
        container.style.setProperty("box-sizing", "border-box", "important");

        container.append(controlBar, this.statusEl, this.grid);
        this.selectionCountEl = el("div", "saturn-char-selection-count", "No cards selected");
        container.appendChild(this.selectionCountEl);

        // Tile size slider, added as a native ComfyUI widget like the visual
        // LoRA loader so it is saved per node and drawn under the node body.
        this.node.properties = this.node.properties || {};
        const storedTileSize = readStoredValue("saturn_char_picker_tile_size");
        const initialTileSize = parseInt(
            this.node.properties["tile_size"] != null
                ? this.node.properties["tile_size"]
                : (storedTileSize || "80"),
            10
        );
        const tileSize = Number.isFinite(initialTileSize) && initialTileSize > 0 ? initialTileSize : 80;
        this.node.properties["tile_size"] = tileSize;
        container.style.setProperty("--saturn-char-tile-size", `${tileSize}px`);

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

        // Add the slider after the DOM widget so it renders below the picker,
        // exactly like the Visual LoRA Loader's tile_size slider.
        if (typeof this.node.addWidget === "function") {
            this.tileWidget = this.node.addWidget(
                "slider",
                "tile_size",
                tileSize,
                (value) => {
                    const size = parseInt(value, 10) || 80;
                    this.node.properties["tile_size"] = size;
                    this.container?.style.setProperty("--saturn-char-tile-size", `${size}px`);
                    this.grid?.style.setProperty("--saturn-char-tile-size", `${size}px`);
                    writeStoredValue("saturn_char_picker_tile_size", String(size));
                    app.graph?.setDirtyCanvas?.(true, true);
                },
                { min: 50, max: 180, step: 1 }
            );
            this.tileWidget.serialize = false;
        }

        this.hideWidget(getWidget(this.node, "separator"));
        this.hideWidget(this.selectionWidget);
        this.hideWidget(this.sortWidget);
        this.hideWidget(this.sortFoldersWidget);
        this.hideWidget(this.contentAlignmentWidget);
        this.hideWidget(this.displayWidget);
        this.applyDisplayMode();
        this.applyContentAlignment();

        const originalResize = this.node.onResize;
        this.node.onResize = function (size) {
            if (originalResize) originalResize.apply(this, arguments);
            const showAll = (ui.displayWidget?.value || "Scrollable") === "Show All";
            if (!showAll && size) ui.node.userCustomHeight = size[1];
        };

        this.node.computeSize = function () {
            const width = Math.max(380, ui.node.size?.[0] || 420);
            const showAll = (ui.displayWidget?.value || "Scrollable") === "Show All";
            if (showAll && ui.grid) {
                return [width, Math.max(360, (ui.grid.scrollHeight || 0) + 160)];
            }
            return [width, Math.max(360, ui.node.size?.[1] || 540)];
        };

        // Widget values are applied *after* nodeCreated. Re-validate them once
        // the workflow/config has been loaded so a positional mismatch can
        // never leave display_mode or another combo with an unsupported value.
        const originalConfigure = this.node.onConfigure;
        this.node.onConfigure = function (info) {
            const result = originalConfigure ? originalConfigure.apply(this, arguments) : undefined;
            ui.normalizeWidgetValues();
            ui.syncControlBar();
            ui.updateSelectionHint();
            ui.refresh();
            return result;
        };
    }

    bindWidgets() {
        if (this.selectionWidget) {
            this.selectionWidget.callback = () => {
                if (this.modeSelect) this.modeSelect.value = this.selectionWidget.value || "Sequential";
                this.updateSelectionHint();
            };
        }
        if (this.sortWidget) {
            this.sortWidget.callback = () => {
                if (this.sortSelect) this.sortSelect.value = this.sortWidget.value;
                this.render();
            };
        }
        if (this.sortFoldersWidget) {
            this.sortFoldersWidget.callback = () => {
                if (this.sortFoldersSelect) this.sortFoldersSelect.value = this.sortFoldersWidget.value;
                this.render();
            };
        }
        if (this.folderPositionWidget) {
            this.folderPositionWidget.callback = () => this.render();
        }
        if (this.contentAlignmentWidget) {
            this.contentAlignmentWidget.callback = () => this.applyContentAlignment();
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
        if (this.folderWidget) {
            this.folderWidget.callback = () => this.refresh();
        }

        this.syncControlBar();
    }

    syncControlBar() {
        if (this.selectionWidget && this.modeSelect) {
            this.modeSelect.value = this.selectionWidget.value || "Sequential";
        }
        if (this.sortWidget && this.sortSelect) {
            this.sortSelect.value = this.sortWidget.value || SORT_PRESETS[0];
        }
        if (this.sortFoldersWidget && this.sortFoldersSelect) {
            this.sortFoldersSelect.value = this.sortFoldersWidget.value || SORT_FOLDERS[0];
        }
        this.applyDisplayMode();
        this.applyContentAlignment();
    }

    setDisplayMode(mode) {
        if (this.displayWidget) this.displayWidget.value = mode;
        this.applyDisplayMode();
    }

    applyDisplayMode() {
        if (!this.grid) return;
        const showAll = (this.displayWidget?.value || "Scrollable") === "Show All";
        this.container?.classList.toggle("show-all-mode", showAll);
        this.grid.classList.toggle("show-all", showAll);
        this.grid.classList.toggle("scrollable", !showAll);
        this.scrollButton?.classList.toggle("active", !showAll);
        this.showAllButton?.classList.toggle("active", showAll);

        if (this.container) {
            this.container.style.setProperty("height", showAll ? "auto" : "100%", "important");
            this.container.style.setProperty("max-height", showAll ? "none" : "100%", "important");
            this.container.style.setProperty("overflow-y", showAll ? "visible" : "hidden", "important");
        }
        this.grid.style.setProperty("height", showAll ? "auto" : "100%", "important");
        this.grid.style.setProperty("max-height", showAll ? "none" : "100%", "important");
        this.grid.style.setProperty("overflow-y", showAll ? "visible" : "auto", "important");
        this.grid.style.setProperty("flex", showAll ? "none" : "1 1 0px", "important");

        if (showAll) {
            setTimeout(() => {
                const contentH = this.grid?.scrollHeight || 0;
                const width = this.node.size?.[0] || 420;
                this.node.setSize?.([width, Math.max(360, contentH + 160)]);
                app.graph?.setDirtyCanvas?.(true, true);
            }, 50);
        } else if (this.node.userCustomHeight) {
            const width = this.node.size?.[0] || 420;
            this.node.setSize?.([width, Math.max(360, this.node.userCustomHeight)]);
            app.graph?.setDirtyCanvas?.(true, true);
        }
    }

    setContentAlignment(mode) {
        const value = ALIGN_MODES.includes(mode) ? mode : ALIGN_MODES[0];
        if (this.contentAlignmentWidget) this.contentAlignmentWidget.value = value;
        this.applyContentAlignment();
    }

    applyContentAlignment() {
        const mode = ALIGN_MODES.includes(this.contentAlignmentWidget?.value)
            ? this.contentAlignmentWidget.value
            : ALIGN_MODES[0];
        const right = mode === "Right Aligned";
        this.container?.classList.toggle("saturn-char-right-aligned", right);
        this.leftAlignButton?.classList.toggle("active", !right);
        this.rightAlignButton?.classList.toggle("active", right);
    }

    async resetMaintenance(kind) {
        const configs = {
            cycle: {
                path: "reset_cycle",
                message: "Reset this picker's Sequential/Random cycle counters?\n\nThe next run starts from the first card again.",
                success: "Cycle counters reset.",
            },
            usage: {
                path: "reset_usage",
                message: "Reset ALL character usage counters?\n\nUsage badges, rank borders and Usage sorting restart from zero. Character cards and LoRA files are not touched.",
                success: "Character usage counters reset.",
            },
            cache: {
                path: "clear_cache",
                message: "Delete the cached thumbnail images?\n\nThey are regenerated automatically the next time the picker renders.",
                success: "Thumbnail cache cleared.",
            },
        };
        const config = configs[kind];
        if (!config) return;
        if (typeof window !== "undefined" && typeof window.confirm === "function" && !window.confirm(config.message)) {
            return;
        }
        try {
            const body = kind === "cycle" ? { node_id: String(this.node.id ?? "") } : {};
            const result = await postJson(config.path, body);
            if (kind === "cache") this.cacheBust = Date.now();
            this.setStatus(config.success, "ok");
            if (kind === "usage" || kind === "cache") await this.refresh();
        } catch (error) {
            this.setStatus(`Reset failed: ${error.message || error}`, "error");
        }
    }

    computeTopUsageRanks(cards) {
        const counts = [...new Set((cards || []).map((card) => Number(card.usage) || 0).filter((count) => count > 0))]
            .sort((a, b) => b - a);
        const ranks = new Map();
        counts.slice(0, 3).forEach((count, index) => ranks.set(count, index + 1));
        return ranks;
    }

    refreshRankBorders() {
        if (!this.grid) return;
        const cards = this.renderedCards || this.visibleCards();
        const byId = new Map(cards.map((card) => [card.id, card]));
        const enabled = getRankBordersEnabled();
        const ranks = enabled ? this.computeTopUsageRanks(cards) : new Map();
        this.grid.querySelectorAll(".saturn-char-tile").forEach((tile) => {
            tile.classList.remove("rank-1", "rank-2", "rank-3", "usage-1k");
            if (!enabled) return;
            const card = byId.get(tile.getAttribute("data-card-id"));
            if (!card) return;
            const rank = ranks.get(Number(card.usage) || 0);
            if (rank) tile.classList.add(`rank-${rank}`);
            if ((Number(card.usage) || 0) >= 1000) tile.classList.add("usage-1k");
        });
    }

    getSingleSelectedCard() {
        const selected = readSelected(this.hiddenWidget);
        if (selected.length !== 1) return null;
        const pool = this.renderedCards || this.cards || [];
        return pool.find((card) => card.id === selected[0]) || null;
    }

    updateSelectionCount() {
        const selected = readSelected(this.hiddenWidget);
        const single = selected.length === 1 ? this.getSingleSelectedCard() : null;
        if (this.editCardButton) this.editCardButton.disabled = !single;
        if (this.duplicateCardButton) this.duplicateCardButton.disabled = !single;
        if (this.deleteCardButton) this.deleteCardButton.disabled = !single;
        if (!this.selectionCountEl) return;
        const count = selected.length;
        this.selectionCountEl.textContent = count === 0
            ? "No cards selected"
            : `${count} card${count === 1 ? "" : "s"} selected`;
    }

    updateSelectionHint() {
        if (this.detectActive) return;
        const mode = this.selectionWidget?.value || "Sequential";
        this.setStatus(MODE_HINTS[mode] || "");
    }

    setStatus(text, kind) {
        this.statusEl.textContent = text || "";
        this.statusEl.className = "saturn-char-status" + (kind ? ` ${kind}` : "");
    }

    async refresh() {
        if (this.destroyed) return;
        const folder = String(this.folderWidget?.value || "").replace(/\\/g, "/").trim();
        const includeDisabled = this.includeDisabledWidget?.value === true;
        try {
            const response = await api.fetchApi(
                `${API_BASE}/get_presets?folder=${encodeURIComponent(folder)}&include_disabled=${includeDisabled ? "true" : "false"}&scrape_on_new=${this.scrapeOnNewWidget?.value === "false" ? "false" : "true"}`
            );
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const data = await response.json();
            if (this.destroyed) return;
            this.cards = Array.isArray(data.cards) ? data.cards : [];
            this.folders = Array.isArray(data.folders) ? data.folders : [];
            const ids = Array.isArray(data.ids)
                ? data.ids.map(String)
                : this.cards.map((card) => card.id);
            this.allCardIds = new Set(ids);
            const removed = this.pruneSelection(this.allCardIds);
            this.render();
            if (removed) {
                this.setStatus(
                    `Removed ${removed} selection${removed === 1 ? "" : "s"} that no longer exist${removed === 1 ? "s" : ""}.`,
                    "warn"
                );
            }
        } catch (error) {
            this.setStatus(`Could not load character presets: ${error.message || error}`, "error");
        }
    }

    pruneSelection(validIds) {
        const selected = readSelected(this.hiddenWidget);
        const next = selected.filter((id) => validIds.has(id));
        if (next.length === selected.length) return 0;
        if (this.selectionAnchor && !validIds.has(this.selectionAnchor)) {
            this.selectionAnchor = null;
        }
        writeSelected(this.hiddenWidget, next);
        this.updateSelectionStyles();
        return selected.length - next.length;
    }

    visibleCards() {
        return sortCards(this.cards, this.sortWidget?.value || SORT_PRESETS[0], this.folderPositionWidget?.value);
    }

    groupCards(cards) {
        const sortBy = this.sortWidget?.value || SORT_PRESETS[0];
        const groups = new Map();
        cards.forEach((card) => {
            const folder = card.folder || "Root";
            if (!groups.has(folder)) groups.set(folder, []);
            groups.get(folder).push(card);
        });

        const folderSortBy = this.sortFoldersWidget?.value || SORT_FOLDERS[0];
        const folderStats = (folder) => {
            const items = groups.get(folder) || [];
            const totalUsage = items.reduce((sum, card) => sum + (card.usage || 0), 0);
            const loraCount = items.reduce(
                (sum, card) => sum + (card.loras || []).filter((entry) => entry.enabled !== false).length,
                0
            );
            return {
                totalUsage,
                loraCount,
                averageUsage: items.length ? totalUsage / items.length : 0,
            };
        };
        const byName = (a, b) =>
            a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
        const keys = [...groups.keys()].sort((a, b) => {
            const statsA = folderStats(a);
            const statsB = folderStats(b);
            switch (folderSortBy) {
                case "Name (Z-A)":
                    return byName(b, a);
                case "Total Usage (High to Low)":
                    return statsB.totalUsage - statsA.totalUsage || byName(a, b);
                case "Average Usage (High to Low)":
                    return statsB.averageUsage - statsA.averageUsage || byName(a, b);
                case "Total LoRAs (Most First)":
                    return statsB.loraCount - statsA.loraCount || byName(a, b);
                default:
                    return byName(a, b);
            }
        });
        const rootFirst = (this.folderPositionWidget?.value || "Folders First") === "Root Presets First";
        const rootIndex = keys.indexOf("Root");
        if (rootIndex >= 0) {
            keys.splice(rootIndex, 1);
            if (rootFirst) keys.unshift("Root");
            else keys.push("Root");
        }

        return keys.map((folder) => ({
            folder,
            cards: sortCards(groups.get(folder), sortBy),
        }));
    }

    folderStorageKey(folder) {
        return `saturn_char_picker_folder_collapsed_${folder}`;
    }

    isFolderCollapsed(folder) {
        return readStoredValue(this.folderStorageKey(folder)) === "true";
    }

    setFolderCollapsed(folder, collapsed) {
        writeStoredValue(this.folderStorageKey(folder), collapsed ? "true" : "false");
    }

    render() {
        if (!this.grid) return;
        this.grid.innerHTML = "";
        this.foldersMap = {};
        const cards = this.visibleCards();
        this.renderedCards = cards;

        if (!cards.length) {
            const empty = el(
                "div",
                "saturn-char-empty",
                "No character presets in this folder. Use the + button to create one, or clear the folder filter."
            );
            this.grid.appendChild(empty);
            this.refreshRankBorders();
            this.updateSelectionCount();
            this.updateDetectPreview();
            return;
        }

        const selectedIds = readSelected(this.hiddenWidget);
        const selected = new Set(selectedIds);
        const fragment = document.createDocumentFragment();
        this.groupCards(cards).forEach((group) => {
            this.foldersMap[group.folder] = group.cards;
            fragment.appendChild(this.renderFolderGroup(group, selected, selectedIds));
        });
        this.grid.appendChild(fragment);
        this.refreshRankBorders();
        this.updateSelectionCount();
        this.updateFolderCheckboxes();
        this.updateDetectPreview();
    }

    renderFolderGroup(group, selected, selectedIds) {
        const folder = group.folder;
        const container = el("div", "saturn-char-folder-container");
        const collapsed = this.isFolderCollapsed(folder);
        if (collapsed) container.classList.add("collapsed");

        const header = el("div", "saturn-char-folder-header");
        header.dataset.folder = folder;
        header.setAttribute("data-folder", folder);
        if (collapsed) header.classList.add("collapsed");

        header.appendChild(el("span", "saturn-char-folder-toggle", "\u25bc"));
        header.appendChild(el("span", "saturn-char-folder-name", folder));
        header.appendChild(el("span", "saturn-char-folder-count", `(${group.cards.length})`));

        const checkbox = el("input", "saturn-char-folder-checkbox");
        checkbox.type = "checkbox";
        checkbox.title = "Select/Deselect all in folder";
        checkbox.addEventListener("click", (event) => {
            event.stopPropagation();
            this.toggleFolderSelection(group.cards, checkbox.checked);
        });
        header.appendChild(checkbox);

        header.addEventListener("click", () => {
            const isCollapsed = container.classList.toggle("collapsed");
            header.classList.toggle("collapsed", isCollapsed);
            this.setFolderCollapsed(folder, isCollapsed);
        });
        container.appendChild(header);

        const folderGrid = el("div", "saturn-char-folder-grid");
        group.cards.forEach((card) => {
            folderGrid.appendChild(this.renderTile(card, selected, selectedIds));
        });
        container.appendChild(folderGrid);
        return container;
    }

    toggleFolderSelection(cards, checked) {
        if (this.detectActive) {
            this.setStatus("The connected text picks the cards. Disconnect it to click cards.", "warn");
            this.updateFolderCheckboxes();
            return;
        }
        let selected = readSelected(this.hiddenWidget);
        const ids = cards.map((card) => card.id);
        if (checked) {
            ids.forEach((id) => {
                if (!selected.includes(id)) selected.push(id);
            });
        } else {
            selected = selected.filter((id) => !ids.includes(id));
        }
        writeSelected(this.hiddenWidget, selected);
        this.updateSelectionStyles();
        this.node.triggerSlotEvent?.(0);
    }

    updateFolderCheckboxes() {
        if (!this.grid || !this.foldersMap) return;
        const selected = readSelected(this.hiddenWidget);
        this.grid.querySelectorAll(".saturn-char-folder-header").forEach((header) => {
            const folder = header.getAttribute("data-folder");
            const cards = this.foldersMap[folder] || [];
            const checkbox = header.querySelector(".saturn-char-folder-checkbox");
            if (!checkbox || !cards.length) return;
            const selectedCount = cards.filter((card) => selected.includes(card.id)).length;
            checkbox.checked = selectedCount === cards.length;
            checkbox.indeterminate = selectedCount > 0 && selectedCount < cards.length;
        });
    }

    renderTile(card, selected, selectedIds) {
        const tile = el("div", "saturn-char-tile");
        tile.dataset.cardId = card.id;
        tile.setAttribute("data-card-id", card.id);

        const loras = (card.loras || []).filter((entry) => entry.enabled !== false);
        const missing = card.missing_loras || [];
        const triggers = cardTriggers(card);
        const tooltip = [`${card.name}${card.folder ? ` (${card.folder})` : ""}`];
        if (triggers.length) tooltip.push(`Triggers: ${triggers.join(", ")}`);
        if (card.positive && card.positive !== card.name) tooltip.push(`Snippet: ${card.positive}`);
        if (loras.length) tooltip.push(`${loras.length} LoRA${loras.length > 1 ? "s" : ""}`);
        if (missing.length) tooltip.push(`Missing: ${missing.join(", ")}`);
        if (card.enabled === false) tooltip.push("Disabled");
        tooltip.push("Double-click to edit");
        tile.title = tooltip.join("\n");

        const thumb = el("div", "saturn-char-thumb");
        if (card.has_preview) {
            const img = el("img");
            img.loading = "lazy";
            img.alt = card.name;
            img.src = `${API_BASE}/get_preview?id=${encodeURIComponent(card.id)}&v=${Math.round(card.mtime || 0)}&cb=${this.cacheBust || 0}`;
            img.addEventListener("error", () => {
                img.remove();
                thumb.insertBefore(el("div", "saturn-char-fallback", initials(card.name)), thumb.firstChild);
            });
            thumb.appendChild(img);
        } else {
            thumb.appendChild(el("div", "saturn-char-fallback", initials(card.name)));
        }

        const order = selectedIds ? selectedIds.indexOf(card.id) : -1;
        const orderBadge = el("div", "saturn-char-check", order >= 0 ? String(order + 1) : "");
        orderBadge.title = "Selection order (used in this order by Sequential and All)";
        const matchPill = el("div", "saturn-char-match-pill", "MATCH");

        let badge = null;
        if (missing.length) {
            badge = el("div", "saturn-char-badge warn", `\u26a0 ${missing.length}`);
            badge.title = `Missing LoRA files:\n${missing.join("\n")}`;
        } else if (card.usage) {
            badge = el("div", "saturn-char-badge usage", String(card.usage));
            badge.style.setProperty("--usage-scale", String(usageBadgeScale(card.usage)));
            badge.title = `Used ${card.usage} time${card.usage === 1 ? "" : "s"}`;
        }

        const label = el("div", "saturn-char-label");
        label.appendChild(el("div", "saturn-char-name", card.name));

        tile.append(thumb, label, orderBadge, matchPill);
        if (badge) tile.appendChild(badge);

        if (selected.has(card.id)) tile.classList.add("selected");
        if (this.matchedIds.has(card.id)) tile.classList.add("matched");

        tile.addEventListener("click", (event) => this.handleCardClick(card.id, event));
        tile.addEventListener("dblclick", (event) => {
            event.preventDefault();
            this.openEditor(card);
        });
        return tile;
    }

    visualCardOrder() {
        if (!this.grid) return [];
        return Array.from(this.grid.querySelectorAll(".saturn-char-tile"))
            .map((tile) => tile.getAttribute("data-card-id"))
            .filter(Boolean);
    }

    handleCardClick(cardId, event = {}) {
        if (this.detectActive) {
            this.setStatus("The connected text picks the cards. Disconnect it to click cards.", "warn");
            return;
        }
        const selected = readSelected(this.hiddenWidget);
        const order = this.visualCardOrder();

        if (event.shiftKey) {
            const anchor = this.selectionAnchor && order.includes(this.selectionAnchor)
                ? this.selectionAnchor
                : null;
            const from = anchor ? order.indexOf(anchor) : -1;
            const to = order.indexOf(cardId);
            if (from < 0 || to < 0) {
                selected.length = 0;
                selected.push(cardId);
            } else {
                const range = order.slice(Math.min(from, to), Math.max(from, to) + 1);
                const existing = new Set(selected);
                range.forEach((id) => {
                    if (!existing.has(id)) {
                        selected.push(id);
                        existing.add(id);
                    }
                });
            }
            this.selectionAnchor = cardId;
        } else if (event.ctrlKey || event.metaKey) {
            const index = selected.indexOf(cardId);
            if (index >= 0) selected.splice(index, 1);
            else selected.push(cardId);
            this.selectionAnchor = cardId;
        } else {
            // Plain click always replaces the selection with this single card,
            // matching the Visual LoRA Loader. Clicking the only selected card
            // again clears the selection.
            if (selected.length === 1 && selected[0] === cardId) selected.length = 0;
            else {
                selected.length = 0;
                selected.push(cardId);
            }
            this.selectionAnchor = cardId;
        }

        writeSelected(this.hiddenWidget, selected);
        this.updateSelectionStyles();
        this.node.triggerSlotEvent?.(0);
    }

    updateSelectionStyles() {
        if (!this.grid) return;
        const selectedIds = readSelected(this.hiddenWidget);
        const selected = new Set(selectedIds);
        this.grid.querySelectorAll(".saturn-char-tile").forEach((tile) => {
            const cardId = tile.getAttribute("data-card-id");
            tile.classList.toggle("selected", selected.has(cardId));
            const badge = tile.querySelector(".saturn-char-check");
            if (badge) {
                const order = selectedIds.indexOf(cardId);
                badge.textContent = order >= 0 ? String(order + 1) : "";
            }
        });
        this.updateFolderCheckboxes();
        this.updateSelectionCount();
    }

    startDetectWatcher() {
        this.detectTimer = setInterval(() => {
            if (this.destroyed) return;
            this.updateDetectPreview();
        }, 700);
    }

    updateDetectPreview() {
        if (!this.grid) return;
        const text = getLinkedText(this.node);
        const detect = text.trim().length > 0;
        this.detectActive = detect;
        this.grid.classList.toggle("detect-mode", detect);

        if (!detect) {
            this.matchedIds = new Set();
            this.lastDetectSignature = null;
            this.grid.querySelectorAll(".saturn-char-tile.matched").forEach((tile) => tile.classList.remove("matched"));
            this.updateSelectionHint();
            return;
        }

        const matchMode = this.matchModeWidget?.value || "Whole Word";
        const caseSensitive = this.caseWidget?.value === true;
        const matchAll = this.matchAllWidget?.value === true;
        const signature = JSON.stringify([text, matchMode, caseSensitive, matchAll]);
        if (signature === this.lastDetectSignature) return;
        this.lastDetectSignature = signature;

        const cards = this.renderedCards || this.visibleCards();
        const matched = computeMatches(cards, text, matchMode, caseSensitive, matchAll);
        this.matchedIds = new Set(matched.map((card) => card.id));

        this.grid.querySelectorAll(".saturn-char-tile").forEach((tile) => {
            tile.classList.toggle("matched", this.matchedIds.has(tile.getAttribute("data-card-id")));
        });

        if (!matched.length) {
            this.setStatus("No character trigger found in the connected text.", "warn");
        } else {
            const names = matched.map((card) => card.name).join(", ");
            this.setStatus(`Detected from text: ${names}`, "ok");
        }
    }

    async flashCards(cardIds, status) {
        if (!Array.isArray(cardIds) || !cardIds.length) {
            if (status === "no-match") this.setStatus("No character trigger matched the prompt text.", "warn");
            else if (status === "no-selection") this.setStatus("No card selected, nothing was applied.", "warn");
            return;
        }
        // Refresh first so the flash lands on the freshly rendered tiles
        // (usage counters changed during the run).
        await this.refresh();
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

    suggestNewCardId() {
        const folder = normalizeCardId(this.folderWidget?.value || "");
        const base = folder ? `${folder}/New Character` : "New Character";
        const existing = new Set([...this.allCardIds].map((id) => id.toLowerCase()));
        let candidate = base;
        let suffix = 2;
        while (existing.has(candidate.toLowerCase())) {
            candidate = `${base} ${suffix}`;
            suffix += 1;
        }
        return candidate;
    }

    async duplicateCard(card) {
        // Open the editor prefilled with a copy instead of writing immediately,
        // so the duplicate can be renamed and tweaked before saving.
        const existing = new Set([...this.allCardIds, ...this.cards.map((item) => item.id)]
            .map((id) => String(id).toLowerCase()));
        let suffix = 1;
        let newId = `${card.id} (${suffix})`;
        while (existing.has(newId.toLowerCase())) {
            suffix += 1;
            newId = `${card.id} (${suffix})`;
        }
        const copy = {
            ...card,
            id: newId,
            name: newId.split("/").pop(),
            has_preview: false,
            mtime: 0,
            usage: 0,
            missing_loras: [],
            loras: (card.loras || []).map((entry) => ({ ...entry })),
            triggers: cardTriggers(card),
            tags: [...(card.tags || [])],
        };
        this.openEditor(copy, { duplicate: true, sourceName: card.name });
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

    async openImportModal() {
        if (this.modal) return;

        const backdrop = el("div", "saturn-char-modal-backdrop");
        const modal = el("div", "saturn-char-modal");
        const head = el("div", "saturn-char-modal-head");
        head.appendChild(el("span", null, "Import LoRAs as cards"));
        const closeButton = el("button", "saturn-char-btn", "Close");
        head.appendChild(closeButton);

        const body = el("div", "saturn-char-modal-body");

        const folderField = el("div", "saturn-char-field");
        folderField.appendChild(el("label", null, "LoRA folder (relative to the ComfyUI loras directory, wildcards allowed)"));
        const folderInput = el("input");
        folderInput.type = "text";
        folderInput.placeholder = "e.g. krea2/* or krea2/Celebrity";
        folderField.appendChild(folderInput);
        folderField.appendChild(el("div", "saturn-char-hint", "Use krea2/* to include every subfolder of krea2."));

        const targetField = el("div", "saturn-char-field");
        targetField.appendChild(el("label", null, "Card folder (prefix for the imported cards)"));
        const targetInput = el("input");
        targetInput.type = "text";
        targetInput.placeholder = "e.g. Celebrity";
        targetField.appendChild(targetInput);

        folderInput.addEventListener("input", () => {
            if (targetInput.dataset.touched === "true") return;
            const parts = folderInput.value.replace(/\\/g, "/").split("/").filter(Boolean);
            targetInput.value = parts.length ? parts[parts.length - 1] : "";
        });
        targetInput.addEventListener("input", () => {
            targetInput.dataset.touched = "true";
        });

        const options = el("div", "saturn-char-cols");
        const triggerField = el("div", "saturn-char-field");
        triggerField.appendChild(el("label", null, "Trigger word"));
        const triggerSelect = el("select");
        [
            ["name", "From the file name"],
            ["metadata", "From LoRA metadata"],
            ["none", "None"],
        ].forEach(([value, text]) => {
            const option = el("option", null, text);
            option.value = value;
            triggerSelect.appendChild(option);
        });
        triggerField.appendChild(triggerSelect);

        const overwriteField = el("div", "saturn-char-field");
        const overwriteLabel = el("label");
        const overwriteInput = el("input");
        overwriteInput.type = "checkbox";
        overwriteLabel.append(overwriteInput, document.createTextNode(" Overwrite existing cards (keeps their prompts)"));
        overwriteField.appendChild(overwriteLabel);
        options.append(triggerField, overwriteField);

        const summaryEl = el("div", "saturn-char-hint", "Scan a folder to preview the cards that would be created.");
        const listEl = el("div", "saturn-char-import-list");
        listEl.style.display = "none";

        body.append(folderField, targetField, options, summaryEl, listEl);

        const foot = el("div", "saturn-char-modal-foot");
        const errorEl = el("span", "error");
        const spacer = el("div", "spacer");
        const scanButton = el("button", "saturn-char-btn", "Scan");
        const importButton = el("button", "saturn-char-btn", "Import");
        importButton.disabled = true;
        foot.append(errorEl, spacer, scanButton, importButton);

        modal.append(head, body, foot);
        backdrop.appendChild(modal);
        document.body.appendChild(backdrop);
        this.modal = backdrop;

        let candidates = [];
        let rows = [];

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

        const updateImportState = () => {
            const checked = rows.filter((row) => row.checkbox.checked).length;
            importButton.disabled = checked === 0;
            importButton.textContent = checked ? `Import ${checked}` : "Import";
        };

        const renderCandidates = () => {
            listEl.innerHTML = "";
            rows = [];
            listEl.style.display = candidates.length ? "flex" : "none";
            candidates.forEach((entry) => {
                const row = el("div", "saturn-char-import-row");
                if (entry.exists) row.classList.add("exists");
                row.title = entry.lora;
                const checkbox = el("input");
                checkbox.type = "checkbox";
                checkbox.checked = !entry.exists || overwriteInput.checked;
                checkbox.addEventListener("change", updateImportState);
                const nameInput = el("input");
                nameInput.type = "text";
                nameInput.value = entry.name || "";
                nameInput.placeholder = "Card name";
                nameInput.title = "Card name (edit before importing)";
                const snippetInput = el("input");
                snippetInput.type = "text";
                snippetInput.value = entry.snippet || entry.name || "";
                snippetInput.placeholder = "Prompt snippet";
                snippetInput.title = "Prompt snippet emitted by this card";
                row.append(checkbox, nameInput, snippetInput);
                if (entry.exists) row.appendChild(el("span", "tag", "exists"));
                else if (entry.has_preview) row.appendChild(el("span", "tag", "preview"));
                listEl.appendChild(row);
                rows.push({ checkbox, entry, nameInput, snippetInput });
            });
            updateImportState();
        };

        scanButton.addEventListener("click", async () => {
            const folder = folderInput.value.trim();
            if (!folder) {
                errorEl.textContent = "Enter the LoRA folder to scan.";
                return;
            }
            errorEl.textContent = "";
            scanButton.disabled = true;
            summaryEl.textContent = "Scanning...";
            try {
                const data = await postJson("import_scan", {
                    folder,
                    target_folder: targetInput.value.trim(),
                    trigger_mode: triggerSelect.value,
                    overwrite: overwriteInput.checked,
                });
                candidates = Array.isArray(data.candidates) ? data.candidates : [];
                renderCandidates();
                const withPreview = candidates.filter((entry) => entry.has_preview).length;
                const existing = candidates.filter((entry) => entry.exists).length;
                summaryEl.textContent = candidates.length
                    ? `${candidates.length} LoRA(s) found under ${data.root || folder} · ${withPreview} with a preview image · ${existing} already imported`
                    : `No LoRA files found under ${data.root || folder}.`;
            } catch (error) {
                candidates = [];
                rows = [];
                listEl.innerHTML = "";
                listEl.style.display = "none";
                summaryEl.textContent = "";
                errorEl.textContent = String(error.message || error);
            } finally {
                scanButton.disabled = false;
                updateImportState();
            }
        });

        importButton.addEventListener("click", async () => {
            const chosen = rows.filter((row) => row.checkbox.checked);
            if (!chosen.length) {
                errorEl.textContent = "Select at least one LoRA to import.";
                return;
            }
            const triggerMode = triggerSelect.value;
            const overrides = chosen.map((row) => {
                const name = row.nameInput.value.trim() || row.entry.name;
                const triggers = triggerMode === "none"
                    ? []
                    : triggerMode === "metadata" && row.entry.trigger
                        ? [row.entry.trigger]
                        : [name];
                return {
                    lora: row.entry.lora,
                    name,
                    triggers,
                    snippet: row.snippetInput.value,
                };
            });
            errorEl.textContent = "";
            importButton.disabled = true;
            try {
                const data = await postJson("import_loras", {
                    folder: folderInput.value.trim(),
                    target_folder: targetInput.value.trim(),
                    trigger_mode: triggerMode,
                    overwrite: overwriteInput.checked,
                    loras: chosen.map((row) => row.entry.lora),
                    overrides,
                    scrape_on_new: this.scrapeOnNewWidget?.value !== "false",
                });
                const created = Array.isArray(data.created) ? data.created.length : 0;
                const failed = Array.isArray(data.failed) ? data.failed.length : 0;
                close();
                await this.refresh();
                const parts = [`Imported ${created} card${created === 1 ? "" : "s"}`];
                if (failed) parts.push(`${failed} failed`);
                this.setStatus(parts.join(" · "), failed ? "warn" : "ok");
            } catch (error) {
                errorEl.textContent = String(error.message || error);
            } finally {
                importButton.disabled = false;
                updateImportState();
            }
        });
    }

    async openEditor(card, options = {}) {
        if (this.modal) return;

        const isNew = !card || options.duplicate === true;
        const loraList = await fetchLoras().catch(() => []);
        const backdrop = el("div", "saturn-char-modal-backdrop");
        const modal = el("div", "saturn-char-modal");
        const head = el("div", "saturn-char-modal-head");
        const title = options.duplicate ? `Duplicate of ${options.sourceName || card.name}` : (isNew ? "New character preset" : `Edit ${card.name}`);
        head.appendChild(el("span", null, title));
        const closeButton = el("button", "saturn-char-btn", "Close");
        head.appendChild(closeButton);

        const body = el("div", "saturn-char-modal-body");

        const idField = el("div", "saturn-char-field");
        idField.appendChild(el("label", null, "Card id (use Folder/Name for categories)"));
        const idInput = el("input");
        idInput.type = "text";
        idInput.value = card ? card.id : this.suggestNewCardId();
        idField.appendChild(idInput);

        const nameField = el("div", "saturn-char-field");
        nameField.appendChild(el("label", null, "Display name (shown on the node)"));
        const nameInput = el("input");
        nameInput.type = "text";
        nameInput.value = card?.name || (idInput.value.split("/").pop() || "");
        nameInput.placeholder = "e.g. Madison Beer";
        nameField.appendChild(nameInput);

        const triggerField = el("div", "saturn-char-field");
        triggerField.appendChild(el("label", null, "Triggers (comma separated, matched in the prompt text)"));
        const triggerInput = el("input");
        triggerInput.type = "text";
        triggerInput.value = cardTriggers(card).join(", ");
        triggerInput.placeholder = "e.g. Madison Beer, madison_beer";
        triggerField.appendChild(triggerInput);

        // Keep the default display name in sync with the card id until the user
        // types a custom name.
        let nameTouched = Boolean(card?.name);
        nameInput.addEventListener("input", () => {
            nameTouched = nameInput.value.trim() !== "";
        });
        idInput.addEventListener("input", () => {
            if (nameTouched) return;
            nameInput.value = normalizeCardId(idInput.value).split("/").pop() || "";
        });

        const prompts = el("div", "saturn-char-cols");
        const positiveField = el("div", "saturn-char-field");
        positiveField.appendChild(el("label", null, "Prompt snippet (emitted as the positive output)"));
        const positiveInput = el("textarea");
        positiveInput.value = card?.positive || "";
        positiveField.appendChild(positiveInput);

        const negativeField = el("div", "saturn-char-field");
        negativeField.appendChild(el("label", null, "Negative prompt"));
        const negativeInput = el("textarea");
        negativeInput.value = card?.negative || "";
        negativeField.appendChild(negativeInput);
        prompts.append(positiveField, negativeField);

        const loraSection = el("div", "saturn-char-field");
        const loraHead = el("div", "saturn-char-lora-head");
        ["LoRA", "Model", "Clip", "On", ""].forEach((label) => loraHead.appendChild(el("span", null, label)));
        const loraRows = el("div");
        const addLoraButton = el("button", "saturn-char-btn", "+ Add LoRA");
        addLoraButton.style.alignSelf = "flex-start";
        loraSection.append(loraHead, loraRows, addLoraButton);

        const thumbSection = el("div", "saturn-char-thumb-editor");
        const thumbFrame = el("div", "saturn-char-thumb-preview");
        const thumbPreviewWrap = el("div", "saturn-char-thumb-content");
        const thumbActions = el("div", "saturn-char-thumb-actions");

        const uploadLabel = el("label", "saturn-char-icon-btn", "\u2B06");
        uploadLabel.title = "Upload image";
        uploadLabel.setAttribute?.("aria-label", "Upload image");
        const uploadInput = el("input");
        uploadInput.type = "file";
        uploadInput.accept = "image/png,image/jpeg,image/webp";
        uploadInput.style.display = "none";
        uploadLabel.appendChild(uploadInput);

        const removeThumbButton = el("button", "saturn-char-icon-btn", "\u2715");
        removeThumbButton.title = "Remove image";
        removeThumbButton.setAttribute?.("aria-label", "Remove image");

        thumbActions.append(uploadLabel, removeThumbButton);
        thumbFrame.append(thumbPreviewWrap, thumbActions);

        const fetchButton = el("button", "saturn-char-btn saturn-char-fetch-btn", "Fetch CivitAI Image");
        fetchButton.title = "Copy the CivitAI preview image of this card's single LoRA";
        const fetchStatus = el("div", "saturn-char-fetch-status");
        const thumbHint = el("div", "saturn-char-hint", "PNG, JPEG or WebP, max 12 MB.");

        thumbSection.append(thumbFrame, fetchButton, fetchStatus, thumbHint);

        const editorFields = el("div", "saturn-char-editor-fields");
        editorFields.append(idField, nameField, triggerField, prompts);

        const editorTop = el("div", "saturn-char-editor-top");
        editorTop.append(thumbSection, editorFields);

        body.append(editorTop, loraSection);

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

        const setFetchStatus = (text, kind) => {
            fetchStatus.textContent = text || "";
            fetchStatus.className = "saturn-char-fetch-status" + (kind ? ` ${kind}` : "");
        };

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
            // Card LoRA names are stored with forward slashes while the server
            // also normalizes them; compare case-insensitively on that form so
            // Windows entries with "\" are not flagged as missing.
            const known = new Set(loraList.map((name) => normalizeLoraName(name).toLowerCase()));
            const optionNames = [];
            const seen = new Set();
            loraList.forEach((name) => {
                const normalized = normalizeLoraName(name);
                const key = normalized.toLowerCase();
                if (!normalized || seen.has(key)) return;
                seen.add(key);
                optionNames.push(normalized);
            });
            const entryName = normalizeLoraName(entry.name);
            const entryKey = entryName.toLowerCase();
            if (entryName && !known.has(entryKey)) {
                optionNames.unshift(entryName);
                seen.add(entryKey);
            }
            const emptyOption = el("option", null, "\u2014 none \u2014");
            emptyOption.value = "";
            select.appendChild(emptyOption);
            optionNames.forEach((name) => {
                const key = name.toLowerCase();
                const missing = entryKey && key === entryKey && !known.has(key);
                const option = el("option", null, missing ? `${name} (missing)` : name);
                option.value = name;
                select.appendChild(option);
            });
            select.value = entryName;

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
            setFetchStatus("Image removed. Save to apply.", "warn");
        });

        fetchButton.addEventListener("click", async () => {
            if (!card) {
                setFetchStatus("Save the card first, then fetch its LoRA image.", "warn");
                return;
            }
            setFetchStatus("Fetching LoRA image\u2026");
            fetchButton.disabled = true;
            try {
                await postJson("use_lora_preview", { id: card.id });
                removeThumb = false;
                pendingThumb = null;
                await this.refresh();
                const updated = this.cards.find((item) => item.id === card.id);
                if (!updated || !updated.has_preview) {
                    setFetchStatus("Image not found.", "warn");
                    return;
                }
                renderThumbPreview(
                    `${API_BASE}/get_preview?id=${encodeURIComponent(card.id)}&full=true&v=${Date.now()}`
                );
                setFetchStatus("Image applied!", "ok");
            } catch (error) {
                const message = String(error.message || error);
                const lower = message.toLowerCase();
                if (lower.includes("lora not found")) {
                    setFetchStatus("LoRA not found.", "error");
                } else if (lower.includes("no preview") || lower.includes("image not found")) {
                    setFetchStatus("Image not found.", "error");
                } else if (lower.includes("exactly one lora")) {
                    setFetchStatus("Add exactly one LoRA to fetch its image.", "warn");
                } else {
                    setFetchStatus(message, "error");
                }
            } finally {
                fetchButton.disabled = false;
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
            const triggers = triggerInput.value
                .split(",")
                .map((value) => value.trim())
                .filter(Boolean);
            const payload = {
                id: cardId,
                original_id: card ? card.id : cardId,
                card: {
                    name: nameInput.value.trim() || cardId.split("/").pop(),
                    triggers,
                    positive: positiveInput.value,
                    negative: negativeInput.value,
                    tags: [],
                    notes: "",
                    enabled: true,
                    loras,
                },
                thumbnail_data_url: pendingThumb || null,
                remove_thumbnail: removeThumb,
                scrape_on_new: this.scrapeOnNewWidget?.value !== "false",
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

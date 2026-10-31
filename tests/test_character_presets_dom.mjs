import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { FakeElement, createDocument, sleep, stripImports } from "./fake_dom.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");

const document = createDocument();
// The character picker renders through a document fragment and uses variadic
// Element.append(); both are trivial to model on top of the shared fake DOM.
document.createDocumentFragment = () => new FakeElement("fragment", document);
FakeElement.prototype.append = function append(...nodes) {
    for (const node of nodes) this.appendChild(node);
};

const CARDS = [
    {
        id: "char1",
        name: "Char1",
        folder: "",
        trigger: "Char1",
        positive: "red hair",
        negative: "",
        loras: [{ name: "chey.safetensors", strength_model: 1, strength_clip: 1, enabled: true }],
        tags: ["red"],
        enabled: true,
        usage: 0,
        has_preview: false,
        missing_loras: [],
        mtime: 1,
    },
    {
        id: "char2",
        name: "Char2",
        folder: "",
        trigger: "Char2",
        positive: "blue hair",
        negative: "",
        loras: [],
        tags: [],
        enabled: true,
        usage: 3,
        has_preview: false,
        missing_loras: ["gone.safetensors"],
        mtime: 2,
    },
    {
        id: "folder/char3",
        name: "Char3",
        folder: "folder",
        trigger: "Char3",
        positive: "green hair",
        negative: "",
        loras: [],
        tags: ["green"],
        enabled: true,
        usage: 0,
        has_preview: false,
        missing_loras: [],
        mtime: 3,
    },
];

const handlers = {};
const api = {
    async fetchApi(url) {
        if (url.includes("/character_presets/get_presets")) {
            return { ok: true, status: 200, json: async () => ({ cards: CARDS, folders: ["folder"], root: "" }) };
        }
        if (url.includes("/character_presets/get_loras")) {
            return { ok: true, status: 200, json: async () => ({ loras: ["chey.safetensors"] }) };
        }
        return { ok: true, status: 200, json: async () => ({}) };
    },
    addEventListener(name, callback) {
        handlers[name] = callback;
    },
};

const extension = { name: "", nodeCreated: null };
const app = {
    registerExtension(candidate) {
        extension.name = candidate.name;
        extension.nodeCreated = candidate.nodeCreated;
    },
    graph: { _nodes: [], links: {}, getNodeById: () => null, setDirtyCanvas() {} },
};

const intervals = [];
const context = vm.createContext({
    console,
    document,
    app,
    api,
    authenticatedFetch: async () => ({ ok: true, status: 200, json: async () => ({}) }),
    window: { prompt: () => null, confirm: () => true },
    CSS: { escape: (value) => String(value).replace(/["\\]/g, "\\$&") },
    setInterval: (callback) => {
        intervals.push(callback);
        return intervals.length;
    },
    clearInterval: () => {},
    setTimeout: () => 0,
    clearTimeout: () => {},
    FileReader: class {
        readAsDataURL() {}
    },
});

const source = stripImports(
    fs.readFileSync(path.join(repoRoot, "web", "js", "character_presets.js"), "utf8")
);
vm.runInContext(source, context, { filename: "character_presets.js" });

assert.equal(extension.name, "ComfyUI.SaturnNodes.CharacterPresets");
assert.equal(typeof extension.nodeCreated, "function");
assert.equal(typeof handlers["saturnnodes_character_presets_selected"], "function");

function makeNode() {
    const widgets = [];
    const node = {
        id: 3,
        type: "CharacterPresetPicker",
        comfyClass: "CharacterPresetPicker",
        size: [420, 540],
        widgets,
        inputs: [],
        graph: app.graph,
        setSize(size) {
            node.size = size;
        },
        triggerSlotEvent() {},
        onResize: null,
        addWidget(type, name, value, callback, options) {
            const widget = { type, name, value, callback, options: options || {} };
            widgets.push(widget);
            return widget;
        },
        addDOMWidget(name, type, element, options) {
            const widget = { name, type, element, ...options };
            widgets.push(widget);
            return widget;
        },
    };
    const specs = [
        ["folder", ""],
        ["selection_mode", "Sequential"],
        ["separator", ", "],
        ["match_mode", "Whole Word"],
        ["match_all", false],
        ["case_sensitive", false],
        ["include_disabled", false],
        ["sort_presets_by", "Name (A-Z)"],
        ["folder_position", "Folders First"],
        ["display_mode", "Scrollable"],
    ];
    specs.forEach(([name, value]) => node.addWidget(typeof value === "boolean" ? "toggle" : "text", name, value));
    return node;
}

const node = makeNode();
app.graph._nodes = [node];

await extension.nodeCreated(node);
await sleep(40);

const ui = node._saturnCharacterPicker;
assert.ok(ui, "the picker UI must attach to the node");

const hidden = node.widgets.find((widget) => widget.name === "_selected_presets");
assert.ok(hidden, "the hidden selection widget must exist");
assert.equal(hidden.value, "[]");
assert.ok(hidden.hidden, "the selection widget must stay hidden");

// The original folder widget is replaced by the picker toolbar.
assert.ok(node.widgets.find((widget) => widget.name === "folder").hidden, "the folder widget is hidden");

const tiles = ui.grid.querySelectorAll(".saturn-char-tile");
assert.equal(tiles.length, 3, "every card renders a tile");
assert.ok(ui.grid.classList.contains("scrollable"), "default display mode scrolls");

// Manual selection: click toggles the card and the hidden widget.
const char1Tile = ui.grid.querySelector('[data-card-id="char1"]');
char1Tile.click();
assert.deepEqual(JSON.parse(hidden.value), ["char1"], "clicking a tile stores the card id");
assert.ok(char1Tile.classList.contains("selected"), "selected tiles get the green ring state");
assert.equal(
    char1Tile.querySelector(".saturn-char-check").textContent,
    "1",
    "the badge shows the selection order"
);

const char3Tile = ui.grid.querySelector('[data-card-id="folder/char3"]');
char3Tile.click();
assert.deepEqual(JSON.parse(hidden.value), ["char1", "folder/char3"], "cards keep click order");
assert.equal(char1Tile.querySelector(".saturn-char-check").textContent, "1", "first pick stays 1");
assert.equal(char3Tile.querySelector(".saturn-char-check").textContent, "2", "second pick becomes 2");

char3Tile.click();
assert.equal(char3Tile.querySelector(".saturn-char-check").textContent, "", "deselecting clears the badge");

char1Tile.click();
assert.deepEqual(JSON.parse(hidden.value), [], "clicking again deselects");
assert.equal(char1Tile.querySelector(".saturn-char-check").textContent, "", "the badge clears on deselect");

// Sorting: usage sort puts the most used card first (within the root group).
node.widgets.find((widget) => widget.name === "folder_position").value = "Root Presets First";
node.widgets.find((widget) => widget.name === "sort_presets_by").value = "Usage (High to Low)";
ui.render();
assert.equal(
    ui.grid.querySelectorAll(".saturn-char-tile")[0].getAttribute("data-card-id"),
    "char2",
    "usage sort orders tiles"
);
node.widgets.find((widget) => widget.name === "folder_position").value = "Folders First";
node.widgets.find((widget) => widget.name === "sort_presets_by").value = "Name (A-Z)";
ui.render();
assert.equal(
    ui.grid.querySelectorAll(".saturn-char-tile")[0].getAttribute("data-card-id"),
    "folder/char3",
    "folders-first grouping puts folder cards on top"
);

// Connected text: the grid is disabled for clicking and the first trigger wins.
app.graph.links = { 1: { id: 1, origin_id: 9, origin_slot: 0 } };
node.inputs = [{ name: "text", link: 1 }];
const origin = { id: 9, widgets: [{ name: "text", value: "I am Char2 and Char1" }] };
app.graph.getNodeById = (id) => (String(id) === "9" ? origin : null);

ui.updateDetectPreview();
assert.ok(ui.detectActive, "a non-empty text input activates detection");
assert.ok(ui.grid.classList.contains("detect-mode"), "detection greys out the grid");

const before = hidden.value;
ui.grid.querySelector('[data-card-id="char1"]').click();
assert.equal(hidden.value, before, "detection ignores tile clicks");

ui.lastDetectSignature = null;
ui.updateDetectPreview();
assert.ok(
    ui.grid.querySelector('[data-card-id="char2"]').classList.contains("matched"),
    "the first trigger in the text is highlighted"
);
assert.ok(
    !ui.grid.querySelector('[data-card-id="char1"]').classList.contains("matched"),
    "later triggers stay unhighlighted when match_all is off"
);

node.widgets.find((widget) => widget.name === "match_all").value = true;
ui.lastDetectSignature = null;
ui.updateDetectPreview();
assert.ok(
    ui.grid.querySelector('[data-card-id="char1"]').classList.contains("matched"),
    "match_all highlights every trigger in the text"
);

node.widgets.find((widget) => widget.name === "match_all").value = false;
ui.lastDetectSignature = null;
ui.updateDetectPreview();

// Upstream text changes are picked up by the watcher.
origin.widgets[0].value = "Only Char1 here";
ui.updateDetectPreview();
assert.ok(
    ui.grid.querySelector('[data-card-id="char1"]').classList.contains("matched"),
    "the detect preview follows upstream text changes"
);

// An empty text falls back to manual selection.
origin.widgets[0].value = "";
ui.updateDetectPreview();
assert.ok(!ui.detectActive, "an empty text input disables detection");
assert.ok(!ui.grid.classList.contains("detect-mode"), "the grid becomes clickable again");
ui.grid.querySelector('[data-card-id="char2"]').click();
assert.deepEqual(JSON.parse(hidden.value), ["char2"], "clicks select cards again once text is empty");
assert.equal(
    ui.grid.querySelector('[data-card-id="char2"]').querySelector(".saturn-char-check").textContent,
    "1",
    "manual numbering resumes after detection ends"
);

// Post-run feedback: the used card flashes.
await handlers["saturnnodes_character_presets_selected"]({
    detail: { node_id: "3", cards: ["char1"], status: "" },
});
await sleep(40);
assert.ok(
    ui.grid.querySelector('[data-card-id="char1"]').classList.contains("used"),
    "the card used by the last run flashes"
);
assert.match(ui.statusEl.textContent, /Used: Char1/);

// No-match feedback.
await handlers["saturnnodes_character_presets_selected"]({
    detail: { node_id: "3", cards: [], status: "no-match" },
});
assert.match(ui.statusEl.textContent, /No character trigger matched/);

// Another node id must not touch this picker.
ui.setStatus("idle");
await handlers["saturnnodes_character_presets_selected"]({
    detail: { node_id: "99", cards: ["char2"], status: "" },
});
assert.equal(ui.statusEl.textContent, "idle");

ui.destroy();
assert.equal(intervals.length, 1, "the detect watcher is registered once");

console.log("character presets DOM tests passed");

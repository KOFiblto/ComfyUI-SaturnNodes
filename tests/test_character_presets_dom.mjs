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

const storage = new Map();
const window = {
    prompt: () => null,
    confirm: () => true,
    localStorage: {
        getItem: (key) => (storage.has(key) ? storage.get(key) : null),
        setItem: (key, value) => storage.set(key, String(value)),
        removeItem: (key) => storage.delete(key),
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

const importCalls = [];
const intervals = [];
const context = vm.createContext({
    console,
    document,
    app,
    api,
    authenticatedFetch: async (url, options = {}) => {
        const body = options.body ? JSON.parse(options.body) : null;
        importCalls.push({ url: String(url), body });
        if (String(url).includes("import_scan")) {
            return {
                ok: true,
                status: 200,
                json: async () => ({
                    status: "ok",
                    root: "V:/models/loras/krea2/Celebrity",
                    candidates: [
                        {
                            lora: "krea2/Celebrity/Men/krea2_Hero.safetensors",
                            id: "Celebrity/Hero",
                            name: "Hero",
                            folder: "Celebrity",
                            trigger: "Hero",
                            has_preview: true,
                            exists: false,
                        },
                        {
                            lora: "krea2/Celebrity/Men/krea2_Villain.safetensors",
                            id: "Celebrity/Villain",
                            name: "Villain",
                            folder: "Celebrity",
                            trigger: "Villain",
                            has_preview: false,
                            exists: true,
                        },
                    ],
                }),
            };
        }
        if (String(url).includes("import_loras")) {
            return {
                ok: true,
                status: 200,
                json: async () => ({
                    status: "ok",
                    created: [{ id: "Celebrity/Hero", name: "Hero" }],
                    skipped: [],
                    failed: [],
                    total: 1,
                }),
            };
        }
        return { ok: true, status: 200, json: async () => ({}) };
    },
    window,
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
        ["sort_folders_by", "Name (A-Z)"],
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

// Shifted workflow widget values (e.g. a positional mismatch) must be repaired
// before ComfyUI validates the prompt, otherwise display_mode errors out.
node.widgets.find((widget) => widget.name === "display_mode").value = "[]";
ui.normalizeWidgetValues();
assert.equal(
    node.widgets.find((widget) => widget.name === "display_mode").value,
    "Scrollable",
    "invalid display_mode values self-heal to the default"
);

// The folder filter is a native widget, matching the visual LoRA loader.
const folderWidget = node.widgets.find((widget) => widget.name === "folder");
assert.ok(folderWidget && !folderWidget.hidden, "the folder widget stays visible");
assert.equal(ui.folderWidget, folderWidget, "the picker drives the native folder widget");

// The tile size slider is a native widget too.
assert.ok(node.widgets.find((widget) => widget.name === "tile_size"), "the picker adds a tile_size slider");

const tiles = ui.grid.querySelectorAll(".saturn-char-tile");
assert.equal(tiles.length, 3, "every card renders a tile");
assert.equal(ui.grid.querySelectorAll(".saturn-char-trigger").length, 0, "tiles no longer show a trigger line");
assert.ok(tiles[0].querySelector(".saturn-char-actions"), "tile actions live in the top overlay");
assert.ok(ui.grid.classList.contains("scrollable"), "default display mode scrolls");
assert.equal(ui.grid.querySelectorAll(".saturn-char-folder-grid").length, 2, "tiles live in folder groups");

// The picker mirrors the visual LoRA loader: one compact control bar and
// fixed-size tiles instead of a width-stretched CSS grid.
const controlLabels = ui.container
    .querySelectorAll(".saturn-char-control-label")
    .map((node) => node.textContent);
assert.deepEqual(controlLabels, ["Mode:", "Sort:", "Folders:", "View:"], "the control bar exposes the loader-style controls");
const toggleLabels = ui.container
    .querySelectorAll(".saturn-char-toggle-btn")
    .map((node) => node.textContent);
assert.deepEqual(
    toggleLabels,
    ["Scroll", "Show All", "\uFF0B", "\u21BB", "\uD83D\uDCC2"],
    "the extra picker actions use icon buttons"
);
["selection_mode", "sort_presets_by", "sort_folders_by", "display_mode"].forEach((name) => {
    const widget = node.widgets.find((item) => item.name === name);
    assert.ok(widget.hidden, `${name} is replaced by the in-node control bar`);
});

const styleText = document.getElementById("saturn-character-presets-style").textContent;
assert.match(styleText, /width:\s*var\(--saturn-char-tile-size, 80px\)/, "tiles use a fixed width");
assert.match(styleText, /aspect-ratio:\s*3 \/ 4/, "tiles keep the LoRA loader card ratio");
assert.match(
    styleText,
    /\.saturn-char-thumb-preview \{[^}]*aspect-ratio:\s*3 \/ 4/s,
    "the editor preview uses the same 3:4 ratio as the tiles"
);
assert.match(
    styleText,
    /\.saturn-char-editor-fields \.saturn-char-cols \{[^}]*flex:\s*1/s,
    "the prompt fields grow into the remaining editor height"
);
assert.doesNotMatch(styleText, /minmax\(96px/, "the width-stretched grid is gone");

// Manual selection mirrors the Visual LoRA Loader: a plain click selects only
// that card, Ctrl/Cmd toggles, and Shift selects the visual range.
const clickCard = (cardId, init = {}) =>
    ui.grid
        .querySelector(`[data-card-id="${cardId}"]`)
        .dispatchEvent({ type: "click", preventDefault() {}, stopPropagation() {}, ...init });

clickCard("char1");
assert.deepEqual(JSON.parse(hidden.value), ["char1"], "a plain click selects the card");
assert.ok(
    ui.grid.querySelector('[data-card-id="char1"]').classList.contains("selected"),
    "selected tiles get the green ring state"
);
assert.equal(
    ui.grid.querySelector('[data-card-id="char1"] .saturn-char-check').textContent,
    "1",
    "the badge shows the selection order"
);

clickCard("folder/char3", { ctrlKey: true });
assert.deepEqual(JSON.parse(hidden.value), ["char1", "folder/char3"], "Ctrl-click adds a card");
assert.equal(
    ui.grid.querySelector('[data-card-id="char1"] .saturn-char-check').textContent,
    "1",
    "first pick stays 1"
);
assert.equal(
    ui.grid.querySelector('[data-card-id="folder/char3"] .saturn-char-check').textContent,
    "2",
    "second pick becomes 2"
);

clickCard("folder/char3", { ctrlKey: true });
assert.deepEqual(JSON.parse(hidden.value), ["char1"], "Ctrl-clicking a selected card removes it");
assert.equal(
    ui.grid.querySelector('[data-card-id="folder/char3"] .saturn-char-check').textContent,
    "",
    "Ctrl-deselecting clears the badge"
);

clickCard("char1");
assert.deepEqual(JSON.parse(hidden.value), [], "clicking the only selected card clears the selection");
assert.equal(
    ui.grid.querySelector('[data-card-id="char1"] .saturn-char-check').textContent,
    "",
    "the badge clears on deselect"
);

clickCard("char1");
clickCard("char2", { shiftKey: true });
assert.deepEqual(
    JSON.parse(hidden.value),
    ["char1", "char2"],
    "Shift-click adds every card visually between the anchor and the click"
);

clickCard("char2");
assert.deepEqual(JSON.parse(hidden.value), ["char2"], "a plain click replaces a multi-selection");
clickCard("char2");
assert.deepEqual(JSON.parse(hidden.value), [], "plain click clears the only selected card again");

// Stale selections from deleted or moved cards are pruned on refresh.
hidden.value = JSON.stringify(["char1", "ghost"]);
assert.equal(ui.pruneSelection(new Set(["char1"])), 1, "pruneSelection reports removed ids");
assert.deepEqual(JSON.parse(hidden.value), ["char1"], "only surviving cards stay selected");
hidden.value = "[]";

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

// Folder sorting: the folder-level sort reorders groups independently of the
// per-card sort, matching the Visual LoRA Loader's sort_folders_by options.
const originalCards = ui.cards;
ui.cards = [
    ...originalCards,
    { id: "zebra/char4", name: "Char4", folder: "zebra", loras: [], usage: 50, mtime: 4 },
];
node.widgets.find((widget) => widget.name === "sort_folders_by").value = "Total Usage (High to Low)";
ui.render();
const sortedHeaders = ui.grid.querySelectorAll(".saturn-char-folder-header");
assert.equal(
    sortedHeaders[0].getAttribute("data-folder"),
    "zebra",
    "total usage folder sort puts the busiest folder first"
);
node.widgets.find((widget) => widget.name === "sort_folders_by").value = "Name (A-Z)";
ui.cards = originalCards;
ui.render();

// Folder groups: headers, counts, collapse state and select-all.
const rootHeader = ui.grid.querySelector('.saturn-char-folder-header[data-folder="Root"]');
const folderHeader = ui.grid.querySelector('.saturn-char-folder-header[data-folder="folder"]');
assert.ok(rootHeader, "unfiled cards get a Root group");
assert.ok(folderHeader, "folder cards get their own group");
const rootGroup = rootHeader.parentElement;
assert.equal(rootGroup.querySelectorAll(".saturn-char-tile").length, 2, "the Root group holds both unfiled cards");
assert.equal(folderHeader.parentElement.querySelectorAll(".saturn-char-tile").length, 1, "the folder group holds its card");
assert.equal(rootHeader.querySelector(".saturn-char-folder-count").textContent, "(2)", "the header shows the card count");

rootHeader.click();
assert.ok(rootGroup.classList.contains("collapsed"), "clicking a header collapses its group");
assert.ok(rootHeader.classList.contains("collapsed"), "the header arrow flips when collapsed");
assert.equal(window.localStorage.getItem(ui.folderStorageKey("Root")), "true", "collapse state is persisted");
rootHeader.click();
assert.ok(!rootGroup.classList.contains("collapsed"), "clicking again expands the group");
assert.equal(window.localStorage.getItem(ui.folderStorageKey("Root")), "false", "expanded state is persisted");

const rootCheckbox = rootHeader.querySelector(".saturn-char-folder-checkbox");
rootCheckbox.checked = true;
rootCheckbox.click();
assert.deepEqual(JSON.parse(hidden.value).sort(), ["char1", "char2"], "the folder checkbox selects every card in the group");
assert.ok(rootCheckbox.checked, "the folder checkbox stays ticked when the whole group is selected");
rootCheckbox.checked = false;
rootCheckbox.click();
assert.deepEqual(JSON.parse(hidden.value), [], "unticking the folder clears its cards");

// Mode and view controls drive the hidden native widgets.
ui.modeSelect.value = "Random";
ui.modeSelect.dispatchEvent({ type: "change" });
assert.equal(node.widgets.find((widget) => widget.name === "selection_mode").value, "Random", "Mode updates selection_mode");
assert.match(ui.statusEl.textContent, /random/i, "Mode updates the hint line");
ui.modeSelect.value = "Sequential";
ui.modeSelect.dispatchEvent({ type: "change" });

ui.showAllButton.click();
assert.equal(node.widgets.find((widget) => widget.name === "display_mode").value, "Show All", "View updates display_mode");
assert.ok(ui.grid.classList.contains("show-all"), "Show All removes the scroll container");
assert.ok(!ui.grid.classList.contains("scrollable"), "the grid stops scrolling in Show All");
ui.scrollButton.click();
assert.equal(node.widgets.find((widget) => widget.name === "display_mode").value, "Scrollable", "Scroll restores display_mode");
assert.ok(ui.grid.classList.contains("scrollable"), "the grid scrolls again");

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

// Import modal: scanning lists LoRA candidates and imports only the ticked ones.
await ui.openImportModal();
assert.ok(ui.modal, "the import modal opens");

const importModal = ui.modal;
const modalInputs = importModal
    .querySelectorAll("input")
    .filter((input) => input.type === "text");
assert.equal(modalInputs.length, 2, "the import modal has a LoRA folder and a card folder field");

const folderInput = modalInputs[0];
const targetInput = modalInputs[1];
folderInput.value = "krea2/Celebrity";
folderInput.dispatchEvent({ type: "input", target: folderInput });
assert.equal(targetInput.value, "Celebrity", "the card folder is prefilled from the LoRA folder");

// The fake DOM does not auto-select the first <option>, so mirror the browser.
importModal.querySelectorAll("select")[0].value = "name";

const findModalButton = (label) =>
    importModal.querySelectorAll("button").find((button) => button.textContent === label);

const scanButton = findModalButton("Scan");
assert.ok(scanButton, "the import modal exposes a Scan button");
scanButton.click();
await sleep(40);

const scanCall = importCalls.find((call) => call.url.includes("import_scan"));
assert.deepEqual(
    scanCall.body,
    { folder: "krea2/Celebrity", target_folder: "Celebrity", trigger_mode: "name", overwrite: false },
    "the scan sends the folder, card folder and trigger mode"
);

const rows = importModal.querySelectorAll(".saturn-char-import-row");
assert.equal(rows.length, 2, "the scan lists every candidate");
const checkboxIn = (row) => row.querySelectorAll("input").find((input) => input.type === "checkbox");
assert.ok(checkboxIn(rows[0]).checked, "new candidates are ticked by default");
assert.ok(!checkboxIn(rows[1]).checked, "already imported cards stay unticked");
assert.ok(rows[1].classList.contains("exists"), "existing cards are marked in the list");
assert.match(
    importModal.querySelectorAll(".saturn-char-hint").map((node) => node.textContent).join(" "),
    /2 LoRA\(s\) found/,
    "the summary reports how many candidates were found"
);

// Names and snippets can be edited per row before importing.
const firstRowInputs = rows[0].querySelectorAll("input").filter((input) => input.type === "text");
assert.equal(firstRowInputs.length, 2, "import rows expose editable name and snippet fields");
firstRowInputs[0].value = "Hero Renamed";
firstRowInputs[1].value = "a custom hero snippet";

const importAction = findModalButton("Import 1");
assert.ok(importAction, "the import button counts the ticked candidates");
importAction.click();
await sleep(40);

const importCall = importCalls.find((call) => call.url.includes("import_loras"));
assert.deepEqual(
    importCall.body.loras,
    ["krea2/Celebrity/Men/krea2_Hero.safetensors"],
    "only the ticked LoRA is imported"
);
assert.deepEqual(
    importCall.body.overrides,
    [{
        lora: "krea2/Celebrity/Men/krea2_Hero.safetensors",
        name: "Hero Renamed",
        triggers: ["Hero Renamed"],
        snippet: "a custom hero snippet",
    }],
    "per-row names, triggers and snippets are sent to the importer"
);
assert.equal(ui.modal, null, "the modal closes after importing");
assert.match(ui.statusEl.textContent, /Imported 1 card/, "the picker reports the import result");

// Card editor: wide two-column top row with the image on the left, id, name,
// triggers and prompts beside it, icon image actions and an inline fetch status.
await ui.openEditor(null);
assert.ok(ui.modal, "the card editor opens");
assert.ok(ui.modal.querySelector(".saturn-char-editor-top"), "the editor uses the two-column top row");
const editorFields = ui.modal.querySelector(".saturn-char-editor-fields");
assert.ok(editorFields, "id and triggers sit beside the image");
const editorFieldInputs = editorFields.querySelectorAll("input");
const editorIdInput = editorFieldInputs[0];
const editorNameInput = editorFieldInputs[1];
const editorTriggerInput = editorFieldInputs[2];
assert.equal(editorIdInput.value, "New Character", "new cards get a normalized default id");
assert.equal(editorNameInput.value, "New Character", "the display name follows the card id by default");
assert.equal(editorFieldInputs.length, 3, "the editor exposes id, display name and triggers");
assert.equal(
    editorFields.querySelectorAll(".saturn-char-cols").length,
    1,
    "the prompt and negative prompt sit under the triggers beside the image"
);
assert.equal(
    ui.modal.querySelectorAll(".saturn-char-icon-btn").length,
    2,
    "upload and remove are icon buttons"
);
const fetchStatus = ui.modal.querySelector(".saturn-char-fetch-status");
assert.ok(fetchStatus, "the fetch action has an inline status element");
const fetchButton = ui.modal.querySelector(".saturn-char-fetch-btn");
assert.equal(fetchButton.textContent, "Fetch CivitAI Image", "the fetch action keeps its label");
fetchButton.click();
assert.match(fetchStatus.textContent, /Save the card first/, "fetching before saving reports a hint");

editorIdInput.value = "Krea2/Hero";
editorIdInput.dispatchEvent({ type: "input" });
assert.equal(editorNameInput.value, "Hero", "the display name follows id edits until it is customized");
editorNameInput.value = "Hero Display";
editorNameInput.dispatchEvent({ type: "input" });
editorTriggerInput.value = "Hero";
editorIdInput.value = "Krea2/Hero Display";
editorIdInput.dispatchEvent({ type: "input" });
assert.equal(editorNameInput.value, "Hero Display", "a custom display name survives later id edits");

const editorSave = ui.modal
    .querySelectorAll("button")
    .find((button) => button.textContent === "Save");
editorSave.click();
await sleep(40);
const saveCall = importCalls.find((call) => call.url.includes("/character_presets/save"));
assert.ok(saveCall, "saving posts the card");
assert.equal(saveCall.body.card.name, "Hero Display", "the display name is saved separately from the card id");
assert.equal(saveCall.body.id, "Krea2/Hero Display", "the card id is saved from the id field");
assert.equal(ui.modal, null, "the editor closes after saving");

ui.allCardIds.add("New Character");
assert.equal(ui.suggestNewCardId(), "New Character 2", "repeated new cards get a unique id");
ui.folderWidget.value = "Krea2\\";
assert.equal(ui.suggestNewCardId(), "Krea2/New Character", "new ids normalize the folder slashes");

ui.destroy();
assert.equal(intervals.length, 1, "the detect watcher is registered once");

console.log("character presets DOM tests passed");

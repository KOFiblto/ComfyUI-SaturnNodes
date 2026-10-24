import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
    createDocument,
    createWindow,
    stripImports,
} from "./fake_dom.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");
const sourcePath = path.join(repoRoot, "web", "saturnnodes_settings.js");

const document = createDocument();
const window = createWindow(document);

const extension = { name: "", setup: null };
const app = {
    registerExtension(candidate) {
        extension.name = candidate.name;
        extension.setup = candidate.setup;
    },
    ui: { settings: { addSetting() {}, get: () => undefined, getSettingValue: () => undefined } },
    extensionManager: { toast: { add() {} } },
    graph: { setDirtyCanvas() {} },
};

let source = stripImports(fs.readFileSync(sourcePath, "utf8"));
source += "\nglobalThis.__settingsTest = { reapplyQueueHeightToMountedLists };\n";

const context = vm.createContext({
    console,
    document,
    window,
    app,
    api: { addEventListener() {} },
    authenticatedFetch: async () => null,
    updateAllSaturnNodeColors() {},
    localStorage: { getItem: () => null, setItem() {} },
    fetch: async () => ({ ok: false, json: async () => ({}) }),
    MutationObserver: class { observe() {} disconnect() {} },
    setTimeout,
    clearTimeout,
    setInterval: () => 0,
    clearInterval: () => {},
    requestAnimationFrame: window.requestAnimationFrame,
    cancelAnimationFrame: window.cancelAnimationFrame,
    Math,
    JSON,
    String,
    Number,
    Object,
    Array,
    Map,
    Set,
    Promise,
    Date,
    parseInt,
    parseFloat,
    isNaN,
    Infinity,
});
vm.runInContext(source, context, { filename: sourcePath });

assert.equal(typeof extension.setup, "function", "settings extension must register");
const { reapplyQueueHeightToMountedLists } = context.__settingsTest;

const overlay = document.createElement("div");
overlay.setAttribute("data-testid", "queue-progress-overlay");
document.body.appendChild(overlay);

const firstList = document.createElement("div");
firstList.className = "comfy-list";
overlay.appendChild(firstList);

const applied = [];
const applyHeight = height => {
    applied.push(height);
    // Mirrors applyQueueOverlayHeight(): every processed list gets the marker.
    for (const list of overlay.querySelectorAll(".comfy-list")) {
        list.dataset.saturnQueueHeight = String(height);
    }
};

assert.equal(
    reapplyQueueHeightToMountedLists(overlay, 360, applyHeight),
    true,
    "a freshly mounted list must trigger a re-apply"
);
assert.deepEqual(applied, [360], "the saved height must be applied");

assert.equal(
    reapplyQueueHeightToMountedLists(overlay, 360, applyHeight),
    false,
    "an already-styled list must not be rewritten on every mutation"
);
assert.deepEqual(applied, [360], "no duplicate apply");

const secondList = document.createElement("div");
secondList.className = "comfy-list";
overlay.appendChild(secondList);

assert.equal(
    reapplyQueueHeightToMountedLists(overlay, 360, applyHeight),
    true,
    "a second list mounting later must also be styled"
);
assert.deepEqual(applied, [360, 360], "re-apply covers the new list");

assert.equal(
    reapplyQueueHeightToMountedLists(overlay, 0, applyHeight),
    false,
    "Native height (0) must not force a max-height"
);
assert.equal(
    reapplyQueueHeightToMountedLists(document.createElement("div"), 360, applyHeight),
    false,
    "overlays without legacy lists must be ignored"
);

console.log("queue height DOM regression test passed");

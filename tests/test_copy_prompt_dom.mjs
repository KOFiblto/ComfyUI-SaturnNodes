import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
    FakeMutationObserver,
    createDocument,
    createWindow,
    stripImports,
} from "./fake_dom.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");
const sourcePath = path.join(repoRoot, "web", "js", "copy_prompt.js");

const document = createDocument();
const window = createWindow(document);

const extension = { name: "", beforeRegisterNodeDef: null };
const app = {
    registerExtension(candidate) {
        extension.name = candidate.name;
        extension.beforeRegisterNodeDef = candidate.beforeRegisterNodeDef;
    },
    extensionManager: {
        setting: { get: () => true },
        toast: { add() {} },
    },
    ui: { settings: { get: () => undefined, getSettingValue: () => undefined } },
    graph: { setDirtyCanvas() {} },
};

let source = stripImports(fs.readFileSync(sourcePath, "utf8"));
source += `
globalThis.__copyTest = {
    registerAssetInteraction,
    getActiveImageSrc,
    injectHoverCopyAction,
    setCopyImagePrompt: (fn) => { copyImagePrompt = fn; },
    getLastCard: () => lastInteractedAssetCard,
};
`;

const copied = [];
const context = vm.createContext({
    console,
    document,
    window,
    navigator: {},
    app,
    api: { addEventListener() {}, fetchApi: async () => null },
    MutationObserver: FakeMutationObserver,
    setTimeout: () => 0,
    clearTimeout: () => {},
    setInterval: () => 0,
    clearInterval: () => {},
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
    isNaN,
    Infinity,
    Node: { ELEMENT_NODE: 1 },
    MouseEvent: class MouseEvent {
        constructor(type, init = {}) {
            this.type = type;
            this.bubbles = !!init.bubbles;
            this.cancelable = !!init.cancelable;
        }
    },
});
vm.runInContext(source, context, { filename: sourcePath });

assert.equal(typeof extension.beforeRegisterNodeDef, "function", "copy prompt extension must register");

const {
    registerAssetInteraction,
    getActiveImageSrc,
    injectHoverCopyAction,
    setCopyImagePrompt,
    getLastCard,
} = context.__copyTest;

setCopyImagePrompt(async src => {
    copied.push(src);
    return true;
});

function makeCard(assetId, src) {
    const card = document.createElement("div");
    card.setAttribute("data-asset-id", assetId);
    const img = document.createElement("img");
    img.src = src;
    card.appendChild(img);
    document.body.appendChild(card);
    return { card, img };
}

// 1. A fresh interaction resolves the current asset.
const first = makeCard("asset-1", "a.png");
registerAssetInteraction(first.img);
assert.equal(getActiveImageSrc(), "a.png", "fresh card interaction must resolve its image");

// 2. The virtual grid recycles the same element for another asset. The stale
//    pointer must not silently copy the new asset.
first.card.setAttribute("data-asset-id", "asset-2");
first.img.src = "b.png";
assert.equal(getActiveImageSrc(), null, "recycled card must not resolve a different asset");
assert.equal(getLastCard(), null, "recycled card must be discarded");

// 3. A detached card is discarded as well.
registerAssetInteraction(first.img);
first.card.remove();
assert.equal(getActiveImageSrc(), null, "detached card must not resolve an image");
assert.equal(getLastCard(), null, "detached card must be cleared");

// 4. Legacy hover overlay: the injected button must follow the asset that is
//    currently displayed instead of keeping a closure over the old <img>.
const legacy = makeCard("asset-3", "c.png");
const overlay = document.createElement("div");
overlay.className = "asset-card-overlay";
legacy.card.appendChild(overlay);

injectHoverCopyAction(overlay);
const oldButton = overlay.querySelector(".saturnnodes-hover-copy");
assert.ok(oldButton, "legacy overlay must receive a copy button");
assert.equal(oldButton.dataset.saturnnodesAssetKey, "asset:asset-3", "button is bound to the current asset");

await oldButton.onclick({ preventDefault() {}, stopPropagation() {} });
assert.deepEqual(copied, ["c.png"], "legacy button must copy the displayed image");

// Recycle the same overlay for another asset. The old button must be replaced,
// not left bound to c.png.
legacy.card.setAttribute("data-asset-id", "asset-4");
legacy.img.src = "d.png";
injectHoverCopyAction(overlay);
const newButton = overlay.querySelector(".saturnnodes-hover-copy");
assert.ok(newButton, "recycled overlay must still have a copy button");
assert.notEqual(newButton, oldButton, "recycled overlay must rebind the copy button");
assert.equal(newButton.dataset.saturnnodesAssetKey, "asset:asset-4", "button is rebound to the new asset");

await newButton.onclick({ preventDefault() {}, stopPropagation() {} });
assert.deepEqual(copied, ["c.png", "d.png"], "rebound button must copy the new image");

// 5. Re-injecting for the same asset must not churn the button.
injectHoverCopyAction(overlay);
assert.equal(overlay.querySelector(".saturnnodes-hover-copy"), newButton, "same asset must keep the existing button");

console.log("copy prompt DOM regression test passed");

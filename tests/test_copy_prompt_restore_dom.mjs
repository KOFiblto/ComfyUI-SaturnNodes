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
    injectCopyPromptNextToDownload,
    injectContextMenuCopy,
    injectHoverCopyAction,
    registerAssetInteraction,
    getActiveImageSrc,
    scanAndInject,
    setCopyImagePrompt: (fn) => { copyImagePrompt = fn; },
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

const copyTest = context.__copyTest;
copyTest.setCopyImagePrompt(async src => {
    copied.push(src);
    return true;
});

const observer = FakeMutationObserver.instances.find(
    item => item.target === document.body && item.options?.childList
);
assert.ok(observer, "copy prompt extension must observe restored DOM insertions");

function makeCard(assetId, src, { queue = false, icon = false, attach = true } = {}) {
    const card = document.createElement("div");
    card.className = "asset-card";
    if (assetId) card.setAttribute("data-asset-id", assetId);
    if (queue) card.setAttribute("data-job-id", "job-1");
    const img = document.createElement("img");
    img.src = src;
    if (icon) img.classList.add("size-8");
    card.appendChild(img);

    const bar = document.createElement("div");
    const download = document.createElement("button");
    download.setAttribute("aria-label", "Download");
    bar.appendChild(download);
    card.appendChild(bar);

    if (attach) document.body.appendChild(card);
    return { card, img, bar, download };
}

function insertRestored(card) {
    observer.emit([{ type: "childList", target: document.body, addedNodes: [card], removedNodes: [] }]);
}

// 1. A restored asset card inserted after page load receives a copy button
//    through the MutationObserver path (not only through the periodic scan).
const restored = makeCard("restored-1", "restored.png", { attach: false });
insertRestored(restored.card);
const restoredButton = restored.bar.querySelector(".saturnnodes-hover-copy");
assert.ok(restoredButton, "restored card must receive a copy button");
await restoredButton.onclick({ preventDefault() {}, stopPropagation() {} });
assert.deepEqual(copied, ["restored.png"], "restored copy button must copy the restored image");

// 2. Restored queue rows must never receive asset-card buttons.
const queueRow = makeCard("queue-1", "queued.png", { queue: true, attach: false });
insertRestored(queueRow.card);
assert.equal(
    queueRow.bar.querySelector(".saturnnodes-hover-copy"),
    null,
    "restored queue rows must not receive asset copy buttons"
);

// 3. Tiny icon images (download/status icons) must not be treated as assets.
const iconCard = makeCard("icon-1", "icon.png", { icon: true, attach: false });
insertRestored(iconCard.card);
assert.equal(
    iconCard.bar.querySelector(".saturnnodes-hover-copy"),
    null,
    "icon-sized images must not receive asset copy buttons"
);

// 4. A restored card reused for another asset must copy the asset currently
//    displayed, not the one captured when the button was injected.
const recycled = makeCard("recycled-1", "first.png", { attach: false });
insertRestored(recycled.card);
const recycledButton = recycled.bar.querySelector(".saturnnodes-hover-copy");
assert.ok(recycledButton, "recycled card must start with a copy button");

recycled.card.setAttribute("data-asset-id", "recycled-2");
recycled.img.src = "second.png";
await recycledButton.onclick({ preventDefault() {}, stopPropagation() {} });
assert.deepEqual(copied, ["restored.png", "second.png"], "reused button must copy the live image");

// 5. Re-injecting for the same restored card must not duplicate the button.
copyTest.injectCopyPromptNextToDownload(recycled.download);
assert.equal(
    recycled.bar.querySelectorAll(".saturnnodes-hover-copy").length,
    1,
    "restored card must keep exactly one copy button"
);

// 6. Context menus attached to restored cards inject one copy item and copy
//    the currently interacted asset.
const menuCard = makeCard("menu-1", "menu-image.png");
copyTest.registerAssetInteraction(menuCard.img);
const menu = document.createElement("div");
menu.className = "p-contextmenu";
const downloadItem = document.createElement("li");
downloadItem.setAttribute("role", "menuitem");
downloadItem.setAttribute("aria-label", "Download");
const downloadButton = document.createElement("button");
downloadItem.appendChild(downloadButton);
menu.appendChild(downloadItem);
document.body.appendChild(menu);

copyTest.injectContextMenuCopy(menu);
const copyItem = menu.querySelector(".saturnnodes-contextmenu-copy");
assert.ok(copyItem, "restored context menu must receive a copy item");
assert.equal(
    menu.querySelectorAll(".saturnnodes-contextmenu-copy").length,
    1,
    "context menu injection must be idempotent"
);

const beforeMenuClick = copied.length;
copyItem.dispatchEvent({ type: "click", preventDefault() {}, stopPropagation() {} });
await Promise.resolve();
await Promise.resolve();
assert.deepEqual(copied.slice(beforeMenuClick), ["menu-image.png"], "menu must copy the active asset");

// 7. A restored card without an asset id but with a stable image URL still
//    resolves its image for menu actions.
const srcCard = makeCard(null, "src-only.png");
copyTest.registerAssetInteraction(srcCard.img);
assert.equal(copyTest.getActiveImageSrc(), "src-only.png");

// 8. The periodic scanner must inject into restored cards even when no
//    mutation was observed for them (e.g. restored before the observer ran).
const scanned = makeCard("scanned-1", "scanned.png");
copyTest.scanAndInject();
assert.ok(
    scanned.bar.querySelector(".saturnnodes-hover-copy"),
    "periodic scan must cover restored cards"
);

console.log("copy prompt restore DOM regression test passed");

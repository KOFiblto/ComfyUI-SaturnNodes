import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
    FakeMutationObserver,
    createDocument,
    createWindow,
    sleep,
    stripImports,
} from "./fake_dom.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");
const sourcePath = path.join(repoRoot, "web", "js", "power_sidebar.js");

const document = createDocument();
const window = createWindow(document);

const extension = { name: "", setup: null };
const app = {
    registerExtension(candidate) {
        extension.name = candidate.name;
        extension.setup = candidate.setup;
    },
    extensionManager: {
        setting: { get: () => true },
        toast: { add() {} },
    },
    ui: { settings: { get: () => undefined, getSettingValue: () => undefined } },
};

let source = stripImports(fs.readFileSync(sourcePath, "utf8"));
source += `
globalThis.__powerTest = {
    showPowerSidePopup,
    closePowerPopup,
    getActivePopup: () => activePopup,
    hasCleanup: () => typeof activePopupCleanup === "function",
};
`;

const context = vm.createContext({
    console,
    document,
    window,
    app,
    api: { addEventListener() {}, fetchApi: async () => null },
    authenticatedFetch: async () => null,
    localStorage: { getItem: () => null, setItem() {} },
    MutationObserver: FakeMutationObserver,
    setTimeout,
    clearTimeout,
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
});
vm.runInContext(source, context, { filename: sourcePath });

assert.equal(typeof extension.setup, "function", "power sidebar extension must register");

const { showPowerSidePopup, closePowerPopup, getActivePopup, hasCleanup } = context.__powerTest;

const anchor = document.createElement("button");
anchor.id = "power-anchor";
anchor.setRect({ left: 20, top: 850, right: 60, bottom: 890, width: 40, height: 40 });
document.body.appendChild(anchor);

function pointerDown(target) {
    document.dispatchEvent({
        type: "pointerdown",
        target,
        preventDefault() {},
        stopPropagation() {},
    });
}

// 1. Opening arms the outside-click listener exactly once.
showPowerSidePopup(anchor);
await sleep(25);
const popupA = getActivePopup();
assert.ok(popupA && popupA.isConnected, "first popup must be mounted");
assert.equal(document.listenerCount("pointerdown"), 1, "one outside listener after opening");

// 2. Closing via a menu item must also remove its document listeners.
closePowerPopup();
assert.equal(getActivePopup(), null, "popup must be removed");
assert.equal(document.listenerCount("pointerdown"), 0, "outside listener must be removed on close");
assert.equal(document.listenerCount("keydown"), 0, "keydown listener must be removed on close");
assert.equal(hasCleanup(), false, "cleanup reference must be cleared");

// 3. Reopen and click an item: the stale listener from popup A must not
//    close popup B before its item click runs.
showPowerSidePopup(anchor);
await sleep(25);
const popupB = getActivePopup();
assert.ok(popupB && popupB.isConnected, "second popup must be mounted");

const item = document.createElement("button");
popupB.appendChild(item);
pointerDown(item);
assert.equal(getActivePopup(), popupB, "first click inside a reopened popup must keep it open");

// 4. A genuine outside click still closes it and cleans up.
const outside = document.createElement("div");
document.body.appendChild(outside);
pointerDown(outside);
assert.equal(getActivePopup(), null, "outside click must close the popup");
assert.equal(document.listenerCount("pointerdown"), 0, "outside listener must be removed after closing");
assert.equal(document.listenerCount("keydown"), 0, "keydown listener must be removed after closing");

// 5. Escape closes and cleans up too.
showPowerSidePopup(anchor);
await sleep(25);
assert.equal(document.listenerCount("keydown"), 1, "keydown listener armed");
document.dispatchEvent({ type: "keydown", key: "Escape", target: document.body });
assert.equal(getActivePopup(), null, "Escape must close the popup");
assert.equal(document.listenerCount("keydown"), 0, "Escape must remove the listener");

// 6. A popup detached by a DOM swap must not block reopening (toggle path).
showPowerSidePopup(anchor);
await sleep(25);
const detached = getActivePopup();
detached.remove();
assert.equal(detached.isConnected, false, "popup is detached");
showPowerSidePopup(anchor);
await sleep(25);
const reopened = getActivePopup();
assert.ok(reopened && reopened.isConnected, "a detached popup must not swallow the reopen");
closePowerPopup();

console.log("power popup DOM regression test passed");

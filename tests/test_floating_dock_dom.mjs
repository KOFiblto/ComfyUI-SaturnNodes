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
const sourcePath = path.join(repoRoot, "web", "floating_latent_dock.js");

const document = createDocument();
const window = createWindow(document);

const extension = { name: "", setup: null };
const app = {
    registerExtension(candidate) {
        extension.name = candidate.name;
        extension.setup = candidate.setup;
    },
    ui: { settings: { get: () => undefined, getSettingValue: () => undefined } },
    graph: { setDirtyCanvas() {} },
};

let source = stripImports(fs.readFileSync(sourcePath, "utf8"));
source += "\nglobalThis.__dockTest = { FloatingLatentDock };\n";

const context = vm.createContext({
    console,
    document,
    window,
    app,
    api: { addEventListener() {} },
    localStorage: { getItem: () => null, setItem() {} },
    MutationObserver: FakeMutationObserver,
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
    isNaN,
    Infinity,
});
vm.runInContext(source, context, { filename: sourcePath });

assert.equal(typeof extension.setup, "function", "floating dock extension must register");
const { FloatingLatentDock } = context.__dockTest;

const dock = {
    dockEl: document.createElement("div"),
    btnEl: null,
    updates: 0,
    requestPositionUpdate() {
        this.updates++;
    },
};
document.body.appendChild(dock.dockEl);

// 1. No minimap and no toolbar: dock sits at the fallback offset.
FloatingLatentDock.prototype.updatePosition.call(dock);
assert.equal(dock.dockEl.style.bottom, "54px", "fallback dock offset");

// 2. A minimap mounted deep in the tree moves the dock above it.
const minimap = document.createElement("div");
minimap.className = "minimap-main-container";
minimap.setRect({ top: 700, height: 150, bottom: 850 });
minimap.offsetParent = {};
document.body.appendChild(minimap);

FloatingLatentDock.prototype.updatePosition.call(dock);
assert.equal(dock.dockEl.style.bottom, "208px", "dock must sit 8px above the minimap");

// 3. The observer must react to a deep minimap insertion/removal, not only to
//    direct children of <body>.
FloatingLatentDock.prototype.setupPositionObserver.call(dock);
const observer = FakeMutationObserver.instances.find(
    item => item.options?.childList && item.options?.subtree
);
assert.ok(observer, "dock observer must watch the whole subtree");

observer.emit([{
    type: "childList",
    target: document.body,
    addedNodes: [minimap],
    removedNodes: [],
}]);
assert.equal(dock.updates, 1, "minimap insertion must request a position update");

observer.emit([{
    type: "childList",
    target: document.body,
    addedNodes: [document.createElement("div")],
    removedNodes: [],
}]);
assert.equal(dock.updates, 1, "unrelated DOM insertions must not request updates");

observer.emit([{
    type: "childList",
    target: document.body,
    addedNodes: [],
    removedNodes: [minimap],
}]);
assert.equal(dock.updates, 2, "minimap removal must request a position update");

// 4. Removing the minimap restores the toolbar-based offset.
minimap.remove();
const toolbar = document.createElement("div");
toolbar.setAttribute("role", "toolbar");
toolbar.setAttribute("aria-label", "Canvas Toolbar");
toolbar.setRect({ top: 820, height: 40, bottom: 860 });
document.body.appendChild(toolbar);

FloatingLatentDock.prototype.updatePosition.call(dock);
assert.equal(dock.dockEl.style.bottom, "88px", "dock must sit 8px above the canvas toolbar");

// 5. Idle dock modes: Auto-Hide and View Image start hidden and only show
//    once a fresh latent arrives; Keep Dock Visible always shows. View Image
//    additionally stays up when a decoded final image is displayed.
let apiHandlers = {};
const makeModeDock = (mode) => {
    const dockEl = document.createElement("div");
    dockEl.classList.add("saturn-dock-hidden");
    const settings = {
        "03_DockModeWhenIdle": mode,
        "01_EnableFloatingDock": true,
    };
    return {
        dockEl,
        btnEl: null,
        isVisible: true,
        isGenerating: false,
        idleHidden: true,
        runSawLatent: false,
        displayedFinalImage: false,
        pendingFinalImage: false,
        statusBadge: null,
        lightboxEl: null,
        getSetting(id, fallback) {
            const key = Object.keys(settings).find(name => id.includes(name));
            return key ? settings[key] : fallback;
        },
        updateVisibility: FloatingLatentDock.prototype.updateVisibility,
        requestPositionUpdate() {},
        updatePosition() {},
        applyDockMode: FloatingLatentDock.prototype.applyDockMode,
        getDockMode: FloatingLatentDock.prototype.getDockMode,
        onExecuted: FloatingLatentDock.prototype.onExecuted,
    };
};
const registerHandlers = (target) => {
    apiHandlers = {};
    context.api.addEventListener = (name, callback) => {
        apiHandlers[name] = callback;
    };
    FloatingLatentDock.prototype.setupExecutionListeners.call(target);
};

const autoDock = makeModeDock("Auto-Hide");
autoDock.applyDockMode();
assert.ok(autoDock.dockEl.classList.contains("saturn-dock-hidden"), "Auto-Hide starts hidden");

registerHandlers(autoDock);
assert.equal(typeof apiHandlers.execution_start, "function", "execution_start handler must register");
assert.equal(typeof apiHandlers.executed, "function", "executed handler must register");

apiHandlers.execution_start();
assert.ok(
    autoDock.dockEl.classList.contains("saturn-dock-hidden"),
    "execution_start must keep Auto-Hide hidden until the first fresh latent"
);

// Simulate the first fresh latent of the run.
autoDock.runSawLatent = true;
autoDock.idleHidden = false;
autoDock.updateVisibility();
assert.ok(!autoDock.dockEl.classList.contains("saturn-dock-hidden"), "first latent reveals Auto-Hide");

apiHandlers.status({ detail: { exec_info: { queue_remaining: 0 } } });
assert.ok(autoDock.dockEl.classList.contains("saturn-dock-hidden"), "Auto-Hide hides when the queue finishes");

const keepDock = makeModeDock("Keep Dock Visible");
keepDock.applyDockMode();
assert.ok(!keepDock.dockEl.classList.contains("saturn-dock-hidden"), "Keep Dock Visible starts shown");
registerHandlers(keepDock);
apiHandlers.execution_start();
assert.ok(!keepDock.dockEl.classList.contains("saturn-dock-hidden"), "Keep Dock Visible never auto-hides");

const viewDock = makeModeDock("View Image");
viewDock.applyDockMode();
assert.ok(viewDock.dockEl.classList.contains("saturn-dock-hidden"), "View Image starts hidden");

viewDock.displayedFinalImage = true;
viewDock.isGenerating = false;
viewDock.applyDockMode();
assert.ok(!viewDock.dockEl.classList.contains("saturn-dock-hidden"), "View Image shows a decoded final image while idle");

viewDock.displayedFinalImage = false;
viewDock.idleHidden = true;
viewDock.isGenerating = false;
viewDock.updateVisibility();
registerHandlers(viewDock);
apiHandlers.execution_start();
assert.ok(
    viewDock.dockEl.classList.contains("saturn-dock-hidden"),
    "View Image stays hidden until the next run's first latent when no final image is shown"
);

console.log("floating dock DOM regression test passed");

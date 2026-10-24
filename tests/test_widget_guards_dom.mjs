import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
    createDocument,
    stripImports,
} from "./fake_dom.mjs";
import { resolveLiveElement, resolveLiveWidgetElement } from "../web/js/live_dom.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");

// 1. Resolver behavior in isolation.
{
    const document = createDocument();
    // live_dom.js is a real ES module and resolves `document` from globalThis.
    globalThis.document = document;
    const stale = document.createElement("div");
    const fresh = document.createElement("div");
    fresh.setAttribute("data-node-id", "7");
    const widget = document.createElement("div");
    widget.setAttribute("data-widget-name", "prompt_count_preview");
    fresh.appendChild(widget);
    document.body.appendChild(fresh);

    assert.equal(
        resolveLiveWidgetElement(stale, 7, "prompt_count_preview"),
        widget,
        "detached cache must re-resolve to the remounted widget"
    );

    const live = document.createElement("div");
    document.body.appendChild(live);
    let findCalls = 0;
    assert.equal(
        resolveLiveElement(live, () => { findCalls++; return fresh; }),
        live,
        "live cache must be used as-is"
    );
    assert.equal(findCalls, 0, "live cache must not trigger a DOM lookup");

    let missingCalls = 0;
    assert.equal(
        resolveLiveElement(stale, () => { missingCalls++; return null; }),
        stale,
        "pre-mount writes must keep using the cached element"
    );
    assert.equal(missingCalls, 1, "a lookup is attempted once before falling back");
}

// 2. Prompt counter: a remounted badge must receive the next update.
const document = createDocument();
globalThis.document = document;
const extension = { name: "", nodeCreated: null };
const app = {
    registerExtension(candidate) {
        extension.name = candidate.name;
        extension.nodeCreated = candidate.nodeCreated;
    },
    graph: { setDirtyCanvas() {} },
};

let source = stripImports(
    fs.readFileSync(path.join(repoRoot, "web", "js", "prompt_counter.js"), "utf8")
);
const context = vm.createContext({
    console,
    document,
    app,
    isSaturnColorsEnabled: () => false,
    resolveLiveElement,
    resolveLiveWidgetElement,
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
vm.runInContext(source, context, { filename: "prompt_counter.js" });

assert.equal(typeof extension.nodeCreated, "function", "prompt counter extension must register");

const node = {
    id: 7,
    comfyClass: "PromptCounter",
    type: "PromptCounter",
    size: [240, 120],
    flags: {},
    widgets: [
        { name: "text", value: "a\n\nb", callback: null, inputEl: null },
        { name: "separator", value: ">1 Empty Line", callback: null },
        { name: "custom_regex", value: "", callback: null },
    ],
    addDOMWidget(name, type, element) {
        const widget = { name, type, element, value: "" };
        this.widgets.push(widget);
        return widget;
    },
};

await extension.nodeCreated(node);

const staleSpan = node._promptBadgeSpan;
assert.ok(staleSpan, "badge span must be created");
assert.equal(staleSpan.textContent, "0 Prompts", "initial badge label");

// Simulate the Vue renderer remounting the DOM widget with a fresh subtree.
const wrapper = document.createElement("div");
wrapper.setAttribute("data-node-id", "7");
const freshBadge = document.createElement("div");
freshBadge.setAttribute("data-widget-name", "prompt_count_preview");
const freshSpan = document.createElement("span");
freshSpan.textContent = "0 Prompts";
freshBadge.appendChild(freshSpan);
wrapper.appendChild(freshBadge);
document.body.appendChild(wrapper);

const textWidget = node.widgets.find(w => w.name === "text");
textWidget.callback();

assert.equal(node._promptBadgeSpan, freshSpan, "cache must point at the remounted span");
assert.equal(freshSpan.textContent, "2 Prompts", "remounted badge must receive the new count");
assert.equal(staleSpan.textContent, "0 Prompts", "detached span must not be treated as visible");

console.log("widget guard DOM regression test passed");

import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");
const sourcePath = path.join(repoRoot, "web", "batch_queue.js");

class FakeElement {
    constructor(tagName) {
        this.tagName = String(tagName).toUpperCase();
        this.nodeType = 1;
        this.attributes = new Map();
        this.children = [];
        this.parentNode = null;
        this.className = "";
        this.id = "";
        this.innerHTML = "";
        this.style = {};
        this.dataset = {};
    }

    setAttribute(name, value) {
        this.attributes.set(String(name), String(value));
    }

    getAttribute(name) {
        return this.attributes.has(String(name)) ? this.attributes.get(String(name)) : null;
    }

    appendChild(child) {
        child.parentNode = this;
        this.children.push(child);
        return child;
    }

    remove() {
        if (!this.parentNode) return;
        const index = this.parentNode.children.indexOf(this);
        if (index >= 0) this.parentNode.children.splice(index, 1);
        this.parentNode = null;
    }

    querySelector(selector) {
        if (selector === ".saturnnodes-batch-line-wrap") {
            return this.children.find(child => child.className === "saturnnodes-batch-line-wrap") || null;
        }
        return null;
    }

    matches(selector) {
        return String(selector).split(",").some(rawPart => {
            const part = rawPart.trim();
            if (part === "[data-job-id]") return this.attributes.has("data-job-id");
            if (part === '[data-testid="job-assets-list"]') {
                return this.getAttribute("data-testid") === "job-assets-list";
            }
            if (part === ".comfy-table") {
                return this.className.split(/\s+/).includes("comfy-table");
            }
            if (part === "tr") return this.tagName === "TR";
            if (part === ".comfy-table tr[data-job-id]") {
                return this.tagName === "TR" && this.attributes.has("data-job-id");
            }
            return false;
        });
    }

    closest(selector) {
        let node = this;
        while (node) {
            if (node.matches?.(selector)) return node;
            node = node.parentNode;
        }
        return null;
    }
}

class FakeMutationObserver {
    constructor(callback) {
        this.callback = callback;
        this.target = null;
        this.options = null;
        FakeMutationObserver.instances.push(this);
    }

    observe(target, options) {
        this.target = target;
        this.options = options;
    }
}
FakeMutationObserver.instances = [];

let clock = 1_000_000;
let timerId = 0;
const timers = [];

function fakeSetTimeout(callback, delay = 0) {
    const timer = {
        id: ++timerId,
        at: clock + Math.max(0, Number(delay) || 0),
        callback,
    };
    timers.push(timer);
    return timer.id;
}

function fakeClearTimeout(id) {
    const index = timers.findIndex(timer => timer.id === id);
    if (index >= 0) timers.splice(index, 1);
}

function advance(ms) {
    const end = clock + Math.max(0, Number(ms) || 0);
    while (true) {
        let nextIndex = -1;
        for (let i = 0; i < timers.length; i++) {
            if (timers[i].at <= end && (nextIndex < 0 || timers[i].at < timers[nextIndex].at)) {
                nextIndex = i;
            }
        }
        if (nextIndex < 0) break;
        const [timer] = timers.splice(nextIndex, 1);
        clock = Math.max(clock, timer.at);
        timer.callback();
    }
    clock = end;
}

const queueRoot = new FakeElement("div");
queueRoot.setAttribute("data-testid", "job-assets-list");
const activeCard = new FakeElement("div");
activeCard.setAttribute("data-job-id", "pid-a");
const pendingCard = new FakeElement("div");
pendingCard.setAttribute("data-job-id", "pid-b");
queueRoot.appendChild(activeCard);
queueRoot.appendChild(pendingCard);

// Legacy v1 rows are inserted separately by the test.
const v1Rows = [];

const document = {
    body: new FakeElement("body"),
    head: new FakeElement("head"),
    getElementById(id) {
        const find = node => {
            if (node.id === id) return node;
            for (const child of node.children) {
                const found = find(child);
                if (found) return found;
            }
            return null;
        };
        return find(this.body) || find(this.head);
    },
    createElement(tagName) {
        return new FakeElement(tagName);
    },
    querySelectorAll(selector) {
        if (selector.includes(".comfy-table")) {
            return [activeCard, pendingCard, ...v1Rows];
        }
        if (selector.includes("[data-job-id]")) {
            return [activeCard, pendingCard];
        }
        if (selector === ".saturnnodes-batch-line-wrap") {
            const wraps = [];
            const find = node => {
                for (const child of node.children) {
                    if (child.className === "saturnnodes-batch-line-wrap") wraps.push(child);
                    find(child);
                }
            };
            find(this.body);
            return wraps;
        }
        return [];
    },
};
document.body.appendChild(queueRoot);

const storage = new Map();
const localStorage = {
    getItem(key) {
        return storage.has(key) ? storage.get(key) : null;
    },
    setItem(key, value) {
        storage.set(key, String(value));
    },
};

function batchInfo(promptId, batchId, color, itemIndex, batchCount = 2) {
    return {
        prompt_id: promptId,
        batchId,
        batchNumber: 1,
        batchCount,
        itemIndex,
        color,
        colorIndex: 0,
        queuedAt: clock,
    };
}

const oldBatch = "batch_old";
const newBatch = "batch_new";
storage.set(
    "saturnnodes_batch_queue_meta",
    JSON.stringify([
        batchInfo("pid-a", oldBatch, "#4ade80", 0, 1),
        batchInfo("pid-b", newBatch, "#fbbf24", 1, 2),
        batchInfo("pid-c", newBatch, "#fbbf24", 0, 2),
        batchInfo("pid-d", newBatch, "#fbbf24", 1, 2),
    ])
);

const extension = {
    name: "test",
    setup: null,
};
const app = {
    queuePrompt: async () => true,
    extensionManager: {
        setting: {
            get: () => true,
        },
    },
    registerExtension(candidate) {
        extension.name = candidate.name;
        extension.setup = candidate.setup;
    },
};
const apiEvents = new Map();
const api = {
    queuePrompt: async () => ({ prompt_id: "queued" }),
    fetchApi: async () => null,
    addEventListener(name, callback) {
        if (!apiEvents.has(name)) apiEvents.set(name, []);
        apiEvents.get(name).push(callback);
    },
};

const source = fs
    .readFileSync(sourcePath, "utf8")
    .replace(/^import .*$/gm, "")
    .replace(/export \{[^}]*\};?\s*$/m, "");

const context = vm.createContext({
    console,
    app,
    api,
    authenticatedFetch: async () => null,
    document,
    localStorage,
    MutationObserver: FakeMutationObserver,
    setTimeout: fakeSetTimeout,
    clearTimeout: fakeClearTimeout,
    Date: { now: () => clock },
    Math,
    JSON,
    String,
    Number,
    Object,
    Array,
    Map,
    Set,
    Promise,
    parseInt,
    isNaN,
    Infinity,
});
vm.runInContext(source, context, { filename: sourcePath });

assert.equal(typeof extension.setup, "function", "batch queue extension must register");
await extension.setup();
advance(100);

const activeLine = activeCard.querySelector(".saturnnodes-batch-line-wrap");
assert.ok(activeLine, "active card must have a batch line");
assert.match(activeLine.innerHTML, /#4ade80/, "initial active line must use its own batch color");

const observer = FakeMutationObserver.instances.find(
    item => item.options && item.options.attributes && item.options.attributeFilter?.includes("data-job-id")
);
assert.ok(observer, "queue observer must watch data-job-id attribute changes");

// Simulate Vue reusing the running card for the first item of the next batch.
// The old green SVG remains in the DOM until the attribute mutation is handled.
activeCard.setAttribute("data-job-id", "pid-c");
observer.callback([{ target: activeCard, type: "attributes", attributeName: "data-job-id" }]);
advance(100);

assert.match(
    activeCard.querySelector(".saturnnodes-batch-line-wrap").innerHTML,
    /#fbbf24/,
    "reused active card must repaint with the new batch color"
);
assert.doesNotMatch(
    activeCard.querySelector(".saturnnodes-batch-line-wrap").innerHTML,
    /#4ade80/,
    "stale batch color must not survive a data-job-id change"
);

// The new batch's pending item and active item must share the same color.
const pendingLine = pendingCard.querySelector(".saturnnodes-batch-line-wrap");
assert.ok(pendingLine, "pending card must have a batch line");
assert.match(pendingLine.innerHTML, /#fbbf24/, "pending item must use the new batch color");

// 4. Legacy v1: a table can be inserted with its rows already built, so the
//    mutation target is the new parent and the table only appears in addedNodes.
const table = new FakeElement("table");
table.className = "comfy-table";
const v1Row = new FakeElement("tr");
v1Row.setAttribute("data-job-id", "pid-d");
table.appendChild(v1Row);
const tableWrapper = new FakeElement("div");
document.body.appendChild(tableWrapper);
tableWrapper.appendChild(table);
v1Rows.push(v1Row);

observer.callback([{
    type: "childList",
    target: tableWrapper,
    addedNodes: [table],
    removedNodes: [],
}]);
advance(100);

const v1Line = v1Row.querySelector(".saturnnodes-batch-line-wrap");
assert.ok(v1Line, "a v1 table inserted with rows must get a batch line");
assert.match(v1Line.innerHTML, /#fbbf24/, "v1 row must use the batch color");

// 5. Duplicate data-job-id rows must not skew batch grouping or paint twice.
const duplicateRow = new FakeElement("tr");
duplicateRow.setAttribute("data-job-id", "pid-b");
// Simulate a line left over from an earlier render on the duplicate.
const staleDuplicateLine = new FakeElement("div");
staleDuplicateLine.className = "saturnnodes-batch-line-wrap";
duplicateRow.appendChild(staleDuplicateLine);
table.appendChild(duplicateRow);
v1Rows.push(duplicateRow);

observer.callback([{
    type: "childList",
    target: table,
    addedNodes: [duplicateRow],
    removedNodes: [],
}]);
advance(100);

assert.equal(
    duplicateRow.querySelector(".saturnnodes-batch-line-wrap"),
    null,
    "duplicate job row must be ignored"
);
assert.ok(
    pendingCard.querySelector(".saturnnodes-batch-line-wrap"),
    "the first occurrence of the job id keeps its batch line"
);

console.log("batch queue DOM regression test passed");

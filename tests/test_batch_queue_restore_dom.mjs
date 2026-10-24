import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { FakeMutationObserver, createDocument, stripImports } from "./fake_dom.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");
const sourcePath = path.join(repoRoot, "web", "batch_queue.js");

let source = stripImports(fs.readFileSync(sourcePath, "utf8"));
source += `
globalThis.__batchTest = {
    updateQueueBatchVisuals,
    normalizeBatchColor,
    normalizeSegmentType,
    buildSvgPath,
    getBatchRegistry: () => batchRegistry,
};
`;

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

const document = createDocument();
const queueRoot = document.createElement("div");
queueRoot.setAttribute("data-testid", "job-assets-list");
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

function info(promptId, batchId, color, itemIndex, batchCount, queuedAt) {
    return {
        prompt_id: promptId,
        batchId,
        batchNumber: 1,
        batchCount,
        itemIndex,
        color,
        colorIndex: 0,
        queuedAt,
    };
}

const seeded = [];
for (let index = 0; index < 260; index++) {
    seeded.push(info(`old-${index}`, `old-batch-${index}`, "#10b981", 0, 1, index + 1));
}
seeded.push(info("evil-a", "batch-evil", '#fff" onload="alert(1)', 0, 2, 1000));
seeded.push(info("evil-b", "batch-evil", "</style><script>alert(1)</script>", 1, 2, 1001));
seeded.push(info("bad-count", "batch-bad", "#123456", "not-an-int", -5, 1002));
seeded.push(info("evil-c", "batch-evil-c", '#fff" onload="alert(1)', 0, 1, 1003));
storage.set("saturnnodes_batch_queue_meta", JSON.stringify(seeded));
storage.set("saturnnodes_batch_counter", "-12");

const serverBatchData = {
    // Older server data must not replace newer local metadata.
    "old-0": info("old-0", "old-batch-0", "#10b981", 0, 1, 0),
    // Newer server data must replace older local metadata.
    "old-1": info("old-1", "old-batch-1", "#10b981", 0, 1, 9999),
    "server-only": info("server-only", "server-batch", "#3b82f6", 0, 1, 2000),
};

const apiEvents = new Map();
const deferred = [];
let nextPid = 0;
const api = {
    clientId: "client-test",
    queuePrompt: () => new Promise(resolve => {
        deferred.push(() => resolve({ prompt_id: `conc-${++nextPid}` }));
    }),
    fetchApi: async url => {
        if (url === "/saturnnodes/batch_queue/data") {
            return { ok: true, json: async () => serverBatchData };
        }
        return null;
    },
    addEventListener(name, callback) {
        if (!apiEvents.has(name)) apiEvents.set(name, []);
        apiEvents.get(name).push(callback);
    },
};

const extension = { name: "", setup: null };
const app = {
    extensionManager: { setting: { get: () => true } },
    registerExtension(candidate) {
        extension.name = candidate.name;
        extension.setup = candidate.setup;
    },
    async queuePrompt(number, batchCount, queueNodeIds) {
        // Both submissions start before either response arrives. This is the
        // concurrency window that used to race on prompts.length.
        const first = api.queuePrompt(number, { output: {} }, queueNodeIds);
        const second = api.queuePrompt(number, { output: {} }, queueNodeIds);
        return await Promise.all([first, second]);
    },
};

const mathStub = Object.create(Math);
let randomSeed = 0;
mathStub.random = () => ((++randomSeed * 0.6180339887) % 1);

const context = vm.createContext({
    console,
    app,
    api,
    authenticatedFetch: async () => ({ ok: true }),
    document,
    localStorage,
    MutationObserver: FakeMutationObserver,
    setTimeout: fakeSetTimeout,
    clearTimeout: fakeClearTimeout,
    Date: { now: () => clock },
    Math: mathStub,
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
const batchTest = context.__batchTest;

assert.equal(typeof extension.setup, "function", "batch queue extension must register");
await extension.setup();
await new Promise(resolve => setImmediate(resolve));
advance(100);

// ---------------------------------------------------------------------------
// Restored storage is pruned by queuedAt, not by Map insertion order.
// ---------------------------------------------------------------------------
const savedAfterLoad = JSON.parse(storage.get("saturnnodes_batch_queue_meta"));
assert.equal(savedAfterLoad.length, 250, "restored metadata must be pruned to 250 entries");
const savedIds = new Set(savedAfterLoad.map(entry => entry.prompt_id));
assert.equal(savedIds.has("old-0"), false, "oldest restored metadata must be pruned");
assert.equal(savedIds.has("old-259"), true, "newest restored metadata must be kept");
assert.equal(savedIds.has("evil-a"), true, "malicious-color entries must not be dropped");
assert.equal(savedIds.has("server-only"), true, "newer server metadata must be merged");

const registry = batchTest.getBatchRegistry();
assert.equal(registry.get("old-0").queuedAt, 1, "older server snapshot must not overwrite local metadata");
assert.equal(registry.get("old-1").queuedAt, 9999, "newer server snapshot must replace local metadata");

// ---------------------------------------------------------------------------
// Restored rows with injected color strings must render safe hex colors only.
// ---------------------------------------------------------------------------
function makeRow(promptId) {
    const row = document.createElement("div");
    row.setAttribute("data-job-id", promptId);
    queueRoot.appendChild(row);
    return row;
}

const evilA = makeRow("evil-a");
const evilB = makeRow("evil-b");
const badCount = makeRow("bad-count");
const duplicateEvilA = makeRow("evil-a");

await batchTest.updateQueueBatchVisuals();

const evilALine = evilA.querySelector(".saturnnodes-batch-line-wrap");
const evilBLine = evilB.querySelector(".saturnnodes-batch-line-wrap");
assert.ok(evilALine, "restored row must receive a batch line");
assert.ok(evilBLine, "restored row must receive a batch line");
assert.match(evilALine.innerHTML, /#10b981/, "invalid color must fall back to the default hex color");
assert.doesNotMatch(evilALine.innerHTML, /alert|onload|<script/i, "color injection must never reach innerHTML");
assert.match(evilBLine.innerHTML, /#10b981/, "markup color must fall back to the default hex color");
assert.doesNotMatch(evilBLine.innerHTML, /alert|<script|<\/style/i, "markup color must never reach innerHTML");
assert.match(
    evilALine.innerHTML,
    /M 9,6 Q 2,6 2,16 L 2,48/,
    "the first visible item of a restored batch must draw the first segment"
);
assert.match(
    evilBLine.innerHTML,
    /M 2,0 L 2,32 Q 2,42 9,42/,
    "the last visible item of a restored batch must draw the last segment"
);
assert.equal(
    duplicateEvilA.querySelector(".saturnnodes-batch-line-wrap"),
    null,
    "a duplicate restored row must not receive a second line"
);

const badLine = badCount.querySelector(".saturnnodes-batch-line-wrap");
assert.ok(badLine, "invalid batch counters must still render a line");
assert.match(badLine.innerHTML, /#123456/, "valid custom hex colors must be preserved");
assert.match(
    badLine.innerHTML,
    /M 9,6 Q 2,6 2,16 L 2,32 Q 2,42 9,42/,
    "negative batchCount and non-integer itemIndex must clamp to a single segment"
);

// Direct sanitizer checks.
assert.equal(batchTest.normalizeBatchColor("#ABC"), "#ABC");
assert.equal(batchTest.normalizeBatchColor("#12345678"), "#12345678");
assert.equal(batchTest.normalizeBatchColor(" #10b981 "), "#10b981");
assert.equal(batchTest.normalizeBatchColor("red"), "#10b981");
assert.equal(batchTest.normalizeBatchColor("url(javascript:alert(1))"), "#10b981");
assert.equal(batchTest.normalizeSegmentType("bogus"), "single");
assert.equal(batchTest.buildSvgPath("bogus"), batchTest.buildSvgPath("single"));

// ---------------------------------------------------------------------------
// A negative persisted counter must clamp to a valid BATCH_COLORS index.
// ---------------------------------------------------------------------------
const submission = app.queuePrompt(-1, 2, null);
await Promise.resolve();
await Promise.resolve();
assert.equal(deferred.length, 2, "both concurrent submissions must reserve an item index");
deferred.shift()();
deferred.shift()();
await submission;

const afterBatch = JSON.parse(storage.get("saturnnodes_batch_queue_meta"));
const concOne = afterBatch.find(entry => entry.prompt_id === "conc-1");
const concTwo = afterBatch.find(entry => entry.prompt_id === "conc-2");
assert.ok(concOne && concTwo, "both concurrent prompts must be recorded");
assert.equal(concOne.batchId, concTwo.batchId, "concurrent prompts must share one batch");
assert.deepEqual(
    [concOne.itemIndex, concTwo.itemIndex].sort((a, b) => a - b),
    [0, 1],
    "concurrent submissions must reserve unique item indexes"
);
assert.equal(concOne.color, "#10b981", "a negative persisted counter must clamp to color index 0");
assert.equal(concOne.colorIndex, 0);
assert.equal(concTwo.batchCount, 2);

// The completed batch must release the active context, so the next standalone
// submission starts a fresh single-item batch.
const standalone = api.queuePrompt(0, { output: {} }, null);
await Promise.resolve();
await Promise.resolve();
assert.equal(deferred.length, 1, "standalone submission must reach the queue hook");
deferred.shift()();
await standalone;

const afterStandalone = JSON.parse(storage.get("saturnnodes_batch_queue_meta"));
const concThree = afterStandalone.find(entry => entry.prompt_id === "conc-3");
assert.ok(concThree, "standalone prompt must be recorded");
assert.notEqual(concThree.batchId, concOne.batchId, "completed batch context must be cleared");
assert.equal(concThree.batchCount, 1);
assert.equal(concThree.color, "#3b82f6", "the next batch must advance the color counter");

// ---------------------------------------------------------------------------
// Reused restored cards repaint after Vue changes data-job-id.
// ---------------------------------------------------------------------------
const observer = FakeMutationObserver.instances.find(
    item => item.target === document.body && item.options?.attributes
);
assert.ok(observer, "queue observer must watch attribute changes");
const reused = makeRow("old-259");
await batchTest.updateQueueBatchVisuals();
assert.ok(reused.querySelector(".saturnnodes-batch-line-wrap"), "reused card must get a line");

reused.setAttribute("data-job-id", "evil-c");
observer.emit([{ target: reused, type: "attributes", attributeName: "data-job-id" }]);
advance(100);
assert.match(
    reused.querySelector(".saturnnodes-batch-line-wrap").innerHTML,
    /#10b981/,
    "reused card must repaint with the new job's safe batch color"
);

console.log("batch queue restore DOM regression test passed");

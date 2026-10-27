import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Regression coverage for the queue-path bleed reported in the LoRA loader
// audit follow-up:
//
//   Queue prompt 1, then queue prompt 2 while prompt 1 is still being
//   submitted, then edit the canvas. ComfyUI serializes prompt 2 only after
//   prompt 1's submission turn finishes, so without a click-time snapshot the
//   edited text/LoRA selection bleeds into prompt 2.
//
// The fake ComfyUI queue below mirrors the real `app.queuePrompt` loop: it
// pushes items, returns early while `processingQueue` is true, and calls
// `graphToPrompt()` freshly for every submitted item.

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");
const sourcePath = path.join(repoRoot, "web", "batch_queue.js");

class FakeStyleElement {
    constructor() {
        this.textContent = "";
        this.id = "";
        this.children = [];
    }
    remove() {}
    appendChild(child) {
        this.children.push(child);
        return child;
    }
    querySelector() {
        return null;
    }
    querySelectorAll() {
        return [];
    }
}

const document = {
    body: new FakeStyleElement(),
    head: new FakeStyleElement(),
    getElementById() {
        return null;
    },
    createElement() {
        return new FakeStyleElement();
    },
    querySelector() {
        return null;
    },
    querySelectorAll() {
        return [];
    },
};

const storage = new Map();
const localStorage = {
    getItem(key) {
        return storage.has(key) ? storage.get(key) : null;
    },
    setItem(key, value) {
        storage.set(key, String(value));
    },
};

class FakeMutationObserver {
    constructor(callback) {
        this.callback = callback;
    }
    observe() {}
    disconnect() {}
}

// --- Fake ComfyUI canvas + queue ---------------------------------------------

const canvas = { text: "", lora: "[]", seed: 1 };
const submissions = [];
const pendingResponses = [];
let graphToPromptCalls = 0;
let nextPromptId = 0;

async function graphToPrompt() {
    graphToPromptCalls++;
    // Read values synchronously, like the real serializer does.
    return {
        output: {
            "10": {
                inputs: {
                    text: canvas.text,
                    _selected_lora: canvas.lora,
                    seed: canvas.seed,
                },
            },
        },
        workflow: { nodes: [] },
    };
}

async function apiQueuePrompt(number, prompt) {
    // Copy the prompt exactly as it will be sent to the server.
    submissions.push(JSON.parse(JSON.stringify(prompt)));
    await new Promise(resolve => pendingResponses.push(resolve));
    nextPromptId++;
    return { prompt_id: `pid-${nextPromptId}` };
}

async function comfyQueuePrompt(number, batchCount = 1) {
    this.queueItems.push({ number, batchCount });
    if (this.processingQueue) return false;
    this.processingQueue = true;
    try {
        while (this.queueItems.length) {
            const item = this.queueItems.pop();
            for (let r = 0; r < item.batchCount; r++) {
                const prompt = await this.graphToPrompt(this.rootGraph);
                await api.queuePrompt(item.number, prompt);
            }
        }
    } finally {
        this.processingQueue = false;
    }
    return true;
}

const extension = { setup: null };
const app = {
    queuePrompt: comfyQueuePrompt,
    graphToPrompt,
    graph: { getNodeById: () => null },
    queueItems: [],
    processingQueue: false,
    extensionManager: { setting: { get: () => true } },
    registerExtension(candidate) {
        extension.setup = candidate.setup;
    },
    setDirtyCanvas() {},
};

const api = {
    queuePrompt: apiQueuePrompt,
    fetchApi: async () => null,
    addEventListener() {},
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
    setTimeout: (callback) => setTimeout(callback, 0),
    clearTimeout,
    Date,
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

const flush = async () => {
    for (let i = 0; i < 50; i++) await Promise.resolve();
};
const resolveNext = async () => {
    const resolve = pendingResponses.shift();
    assert.ok(resolve, "expected a pending API submission");
    resolve();
    await flush();
};
const resetCanvas = (text, lora = "[]", seed = 1) => {
    canvas.text = text;
    canvas.lora = lora;
    canvas.seed = seed;
};
const promptText = index => submissions[index].output["10"].inputs.text;
const promptLora = index => submissions[index].output["10"].inputs._selected_lora;
const promptSeed = index => submissions[index].output["10"].inputs.seed;

// --- Scenario 1: queued prompt must keep the text/LoRA shown at click time ---

resetCanvas("prompt one text", '["LoRA_A.safetensors"]');
graphToPromptCalls = 0;

// First click starts submission immediately (no extra snapshot needed).
const first = app.queuePrompt(0, 1);
await flush();
assert.equal(app.processingQueue, true, "first submission must be in flight");
assert.equal(graphToPromptCalls, 1, "an idle click must not serialize twice");

// The user immediately clicks Queue again, then keeps editing the canvas
// while the first prompt is still being submitted.
const second = app.queuePrompt(0, 1);
assert.equal(
    graphToPromptCalls,
    2,
    "a queued click during an in-flight submission must snapshot the graph at click time"
);

canvas.text = "prompt two text";                 // edited after both clicks
canvas.lora = '["LoRA_B.safetensors"]';
canvas.seed = 2;

await resolveNext(); // finish prompt one
await resolveNext(); // finish prompt two
await Promise.all([first, second]);
await flush();

assert.equal(submissions.length, 2, "both queued prompts must be submitted");
assert.equal(promptText(0), "prompt one text");
assert.equal(promptLora(0), '["LoRA_A.safetensors"]');
assert.equal(
    promptText(1),
    "prompt one text",
    "canvas text edited after the click must not bleed into the queued prompt"
);
assert.equal(
    promptLora(1),
    '["LoRA_A.safetensors"]',
    "LoRA selection edited after the click must not bleed into the queued prompt"
);

// --- Scenario 2: a multi-item batch stays frozen at click time --------------

submissions.length = 0;
resetCanvas("batch base text", '["LoRA_C.safetensors"]', 3);
app.queueItems.length = 0;

const batch = app.queuePrompt(0, 3);
await flush(); // item 0 in flight

canvas.text = "edited mid batch";                 // must not leak into items 2/3
canvas.lora = '["LoRA_D.safetensors"]';
canvas.seed = 99;

await resolveNext(); // item 0
await resolveNext(); // item 1
await resolveNext(); // item 2
await batch;
await flush();

assert.equal(submissions.length, 3);
for (let i = 0; i < 3; i++) {
    assert.equal(promptText(i), "batch base text", `batch item ${i + 1} text must stay frozen`);
    assert.equal(
        promptLora(i),
        '["LoRA_C.safetensors"]',
        `batch item ${i + 1} LoRA must stay frozen`
    );
}

// --- Scenario 3: dynamic seeds still follow the live prompt -----------------

submissions.length = 0;
resetCanvas("blocker", "[]", 10);
const blocker = app.queuePrompt(0, 1);
await flush(); // blocker in flight so the next click has a submission backlog

resetCanvas("seed batch", "[]", 11);
const seeded = app.queuePrompt(0, 2);
await flush();
canvas.seed = 12; // simulates the seed widget randomizing before submission
await resolveNext(); // blocker
await resolveNext(); // seeded item 0
await resolveNext(); // seeded item 1
await blocker;
await seeded;
await flush();

assert.equal(submissions.length, 3);
assert.equal(promptSeed(1), 12, "item 0 must use the seed the live prompt queued");
assert.equal(promptSeed(2), 12, "item 1 must use the live seed after merging");
assert.equal(promptText(1), "seed batch");
assert.equal(promptText(2), "seed batch");

// --- Scenario 4: idle clicks keep serializing once and never double-queue ---

submissions.length = 0;
resetCanvas("solo", "[]", 20);
const solo = app.queuePrompt(0, 1);
await flush();
assert.equal(graphToPromptCalls > 0, true);
await resolveNext();
await solo;

assert.equal(submissions.length, 1);
assert.equal(promptText(0), "solo");

console.log("batch queue click-time snapshot DOM test passed");

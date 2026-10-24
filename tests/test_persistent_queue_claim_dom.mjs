import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { stripImports } from "./fake_dom.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");
const sourcePath = path.join(repoRoot, "web", "persistent_queue.js");

let clock = 0;
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

async function flush() {
    for (let i = 0; i < 5; i++) await Promise.resolve();
}

const apiEvents = new Map();
const fetchCalls = [];
let fetchImpl = async (url, options) => {
    fetchCalls.push({ url, options });
    return { ok: true };
};

const api = {
    clientId: "client-abc",
    addEventListener(name, callback) {
        if (!apiEvents.has(name)) apiEvents.set(name, []);
        apiEvents.get(name).push(callback);
    },
};

const extension = { name: "", setup: null };
const app = {
    registerExtension(candidate) {
        extension.name = candidate.name;
        extension.setup = candidate.setup;
    },
};

const context = vm.createContext({
    console,
    app,
    api,
    authenticatedFetch: (url, options) => fetchImpl(url, options),
    setTimeout: fakeSetTimeout,
    clearTimeout: () => {},
    JSON,
    Promise,
    String,
    Object,
    Error,
});

const source = stripImports(fs.readFileSync(sourcePath, "utf8"));
vm.runInContext(source, context, { filename: sourcePath });

assert.equal(typeof extension.setup, "function", "persistent queue extension must register");
await extension.setup();

assert.deepEqual(
    [...apiEvents.keys()].sort(),
    ["executing", "execution_start", "status"],
    "persistent queue must listen for queue status events"
);

// No claim before the 500ms startup delay.
advance(499);
await flush();
assert.equal(fetchCalls.length, 0, "queue ownership must not be claimed before startup settles");

advance(1);
await flush();
assert.equal(fetchCalls.length, 1, "queue ownership must be claimed after startup");
assert.equal(fetchCalls[0].url, "/saturnnodes/persistent_queue/claim");
assert.equal(fetchCalls[0].options.method, "POST");
assert.equal(fetchCalls[0].options.headers["Content-Type"], "application/json");
assert.deepEqual(
    JSON.parse(fetchCalls[0].options.body),
    { client_id: "client-abc" },
    "claim body must carry the API client id"
);

// Status events re-claim ownership (a reconnecting tab takes over recovery).
apiEvents.get("status")[0]();
await flush();
assert.equal(fetchCalls.length, 2, "status events must re-claim queue ownership");
assert.deepEqual(JSON.parse(fetchCalls[1].options.body), { client_id: "client-abc" });

// A client without an id must not send a claim.
api.clientId = "";
apiEvents.get("status")[0]();
await flush();
assert.equal(fetchCalls.length, 2, "clients without a client id must not claim ownership");

// A failed claim is contained and must not break later events.
api.clientId = "client-xyz";
fetchImpl = async () => {
    throw new Error("network unavailable");
};
apiEvents.get("status")[0]();
await flush();
assert.equal(fetchCalls.length, 2, "failed claim must not record a successful request");

// Restore a working transport and verify execution events do not throw when
// rgthree-comfy is not installed (the dynamic import is caught internally).
fetchImpl = async (url, options) => {
    fetchCalls.push({ url, options });
    return { ok: true };
};
apiEvents.get("execution_start")[0]({ detail: {} });
apiEvents.get("executing")[0]({ detail: { prompt_id: "p1" } });
await flush();
advance(1200);
await flush();

assert.equal(fetchCalls.length, 2, "execution events must not claim ownership");
console.log("persistent queue claim DOM regression test passed");

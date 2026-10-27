# 🔍 Visual LoRA Loader & Batch Queue Logic Audit
## Root Causes 1–5: Defect Analysis, Locations & Mechanics

> **Status:** Validated against `v2.6.3`. Root Causes **1** and **5** were genuine
> defects and are now fixed. Root Cause **2** is intended persistent-cycle
> behavior and is documented rather than changed. Root Causes **3** and **4** do
> not reproduce with the current submission queue and were corrected below.

---

## Executive Overview of Observed Defects

When a user selects one or more LoRAs, queues a batch of 5, and while they are being queued selects different LoRA(s) and queues a batch of 10, the following symptoms occur:
1. **LoRAs mixing together**: Prompts in Batch 2 receive LoRAs from Batch 1, or prompts in Batch 1 switch to LoRAs from Batch 2 mid-execution.
2. **Duplicate generations**: A LoRA generates twice in a row when sequential single-generation was expected.
3. **Missing LoRAs**: A LoRA that was explicitly selected is skipped and never generated.
4. **Capture bypass**: The previous "workflow capture" (`Batch Graph Snapshot Guard`) failed to prevent these issues.

The audit identified **five candidate root causes**. Validation shows that the
repeat/skip symptoms are explained by Root Causes **1** and **5**, while Root
Cause **2** is by-design cycling; Root Causes **3** and **4** do not produce the
described failures in the current code.

---

## 📌 Root Cause 1: Deterministic Hash Sorting vs. Unsorted Array Indexing

- **File**: [`nodes/lora_loader.py`](nodes/lora_loader.py)
- **Functions**: `select_a_lora(...)`
- **Verdict**: ✅ **Confirmed and fixed**
- **Symptom Produced**: **Same LoRA generated twice; other selected LoRA skipped entirely.**

### What Is Happening
In `select_a_lora`, the persistent state key on disk uses a SHA-256 hash calculated over the **alphabetically sorted** list of choices:

```python
choices_hash = hashlib.sha256(
    json.dumps(sorted(valid_choices), ensure_ascii=False).encode("utf-8")
).hexdigest()[:16]

state_key = f"{prefix}_{unique_id}_{choices_hash}"
```

However, the selection indexes into the **unsorted** live list, whose order is
the click/toggle order stored by the frontend (`web/js/folder_lora_loader.js`,
`updateSelection`). Deselecting and reselecting a tile, or using a folder
checkbox, changes that order without changing the hash.

### Failure Scenario:
1. User selects **LoRA A**, then **LoRA B**:
   - `valid_choices` = `["A", "B"]`, `sorted(...)` = `["A", "B"]` → `choices_hash` = `H1`.
   - Prompt 1 executes at `index = 0` → **A**; saved `index = 1`.
2. The user reorders the selection to **B**, then **A**:
   - `valid_choices` = `["B", "A"]`, sorted still `["A", "B"]` → same `H1`, so `index = 1` is loaded.
   - `valid_choices[1]` is **A** → **A generated twice, B skipped.**

### Fix Applied
Sequential state now stores the order observed when the cycle started and
indexes into that stored order. Reordering the selection can no longer move the
index onto a different LoRA, so picks are never duplicated or skipped:

```python
new_entry["index"] = index
new_entry["order"] = order
```

The index is also normalized (`index %= len(order)`), which keeps long-lived
state bounded.

---

## 📌 Root Cause 2: Perpetual Inter-Batch Cycle Continuation

- **File**: [`nodes/lora_loader.py`](nodes/lora_loader.py)
- **State**: `user/default/SaturnNodes/lora_loader_state.json`
- **Verdict**: ✅ **Confirmed, but by design — documented, not changed**
- **Symptom Produced**: **Batches starting on arbitrary mid-cycle LoRAs; leftover pools continuing across sessions.**

### What Is Happening
`state_key` is keyed by `(mode, node_id, choices_hash)`; there is **no batch
boundary, run ID, or queue session**. The `index` counter (Sequential) and the
remaining `pool` (Random No-Replace) persist across batches, restarts, and days.
Global state is pruned only by recency (100 most recent buckets).

### Failure Scenario:
1. Three LoRAs (`[A, B, C]`), batch of 5 → A, B, C, A, B; saved `index = 5`.
2. A later batch of 2 resumes at `5 % 3 = 2` → **C, A** instead of A, B.
3. In **Random (No Replace)**, unpopped items from the previous run are consumed
   first, so a new batch can start on leftovers from the old pool.

### Why This Is Not Changed
Continuous cycling is the documented "Sequential Cycle" / "Random (No Dupes)"
contract, and `tests/test_lora_loader.py` asserts it across prompts. The suite
already ships a manual `↺ Counter` reset and a per-node prompt→LoRA assignment
map for retries. Resetting automatically per batch would silently change the
documented cycling behavior, so this is treated as expected behavior with the
reset control as the escape hatch.

---

## 📌 Root Cause 3: Premature Snapshot Guard Teardown in Frontend V2

- **File**: [`web/batch_queue.js`](web/batch_queue.js)
- **Functions**: `setupQueueHooks()` (`app.queuePrompt` and `api.queuePrompt` hooks)
- **Verdict**: ❌ **Not reproducible with the current submission queue**
- **Original Claim**: A second batch makes ComfyUI's `app.queuePrompt` return
  `false` synchronously, so the wrapper's `finally` clears `activeBatchContext`
  before Batch 2's items are serialized, disabling the snapshot guard.

### Why the Claim Does Not Hold
The wrapper defers the original call through `batchSubmissionQueue`:

```javascript
const turn = batchSubmissionQueue.then(async () => {
    const batch = getNextBatch(count);
    activeBatchContext = batch;
    try {
        return await origQueuePrompt(number, batchCount, queueNodeIds);
    } finally {
        activeBatchContext = null;
    }
});
batchSubmissionQueue = turn.catch(() => {});
return turn;
```

`batchSubmissionQueue` is updated synchronously before returning, so a second
queue action waits for the previous batch's submission promise to settle. Its
callback — and therefore `origQueuePrompt` — is not invoked while
`processingQueue === true`, so the synchronous `if (this.processingQueue)
return false;` path cannot fire for the second UI batch. This serialization is
present in the released `v2.6.2` as well.

ComfyUI's core behavior quoted in the original analysis is itself correct
(`comfyui_frontend_package/static/assets`): `queuePrompt` pushes to
`queueItems`, returns `false` while already processing, and otherwise loops with
`await graphToPrompt()` per item. The defect was in assuming the wrapper reached
that code immediately.

### Residual Edge Case
The early teardown described above *can* occur if a non-SaturnNodes caller
invokes `app.queuePrompt` while ComfyUI is already processing — the wrapper
would then get the synchronous `false` and clear its context. That is outside
the two-manual-batches scenario and is not addressed here.

---

## 📌 Root Cause 4: Single-Item Batches (`batchCount == 1`) Bypass Snapshot Guard

- **File**: [`web/batch_queue.js`](web/batch_queue.js)
- **Functions**: `api.queuePrompt` hook (`isSnapshotGuardEnabled() && batchContext.batchCount > 1`)
- **Verdict**: ⚠️ **Accurate code, not a defect**

### Why This Is Not a Defect
The snapshot guard exists to keep items **inside one multi-item batch**
consistent while the graph is re-serialized between iterations. A one-item batch
has no later item to protect, so skipping the snapshot is harmless.

Additionally, the guard has never protected the *first* item of any batch: the
snapshot is taken when that item is submitted, not when the user clicked Queue.
Edits made between clicking and submission affect item 0 of a multi-item batch
exactly as they affect a one-item batch. Tightening this would require capturing
the prompt at click time, which is a separate design change, not a
`batchCount > 1` bug.

---

## 📌 Root Cause 5: Function Signature Default Mismatch (`"All"` vs. `"Sequential"`)

- **File**: [`nodes/lora_loader.py`](nodes/lora_loader.py)
- **Functions**: `VisualLoraLoader.INPUT_TYPES`, `VisualLoraLoader.IS_CHANGED`, `VisualLoraLoader.load_lora(...)`
- **Verdict**: ✅ **Confirmed and fixed**
- **Symptom Produced**: **Simultaneous loading of multiple LoRAs (stacking all models into one render).**

### What Is Happening
`INPUT_TYPES` declared the hidden widget default as `"Sequential"`, while both
`IS_CHANGED` and the execution method signature fell back to `"All"`:

```python
# INPUT_TYPES
"_selection_mode": ("STRING", {"default": "Sequential"}),

# IS_CHANGED / load_lora (before the fix)
mode = kwargs.get("_selection_mode", "All")
def load_lora(..., _selection_mode="All", ...)
```

### Failure Scenario:
1. A prompt arrives without `_selection_mode` (raw API call, third-party
   client, or hand-built prompt).
2. The backend falls back to `"All"`, so the `share one selection` branch
   (`if _selection_mode in ["Random", "Sequential", "Random (No Replace)"]`) is
   skipped and `select_a_lora` is never called.
3. Every selected LoRA is loaded onto the model and CLIP in one render instead
   of cycling one per prompt.

Normal UI use is unaffected: `web/js/folder_lora_loader.js` always creates a
serialized `_selection_mode` widget defaulting to `"Sequential"`, which is why
the bug only surfaced through API-style prompts. `IS_CHANGED` was also affected:
its `"All"` fallback returned `""` (cacheable) for prompts missing the field.

### Fix Applied
Both fallbacks now match the node definition and UI:

```python
mode = kwargs.get("_selection_mode", "Sequential")
def load_lora(..., _selection_mode="Sequential", ...)
```

An explicit `"All"` sent by the UI still selects every LoRA simultaneously, so
intentional "All Loras" mode is unchanged.

---

## Summary Matrix

| Root Cause | Affected File(s) | Primary Impact | Status |
| :--- | :--- | :--- | :--- |
| **1. Hash vs Indexing Order** | `nodes/lora_loader.py` | Same LoRA selected twice; other selected LoRAs skipped entirely. | ✅ Fixed (stored cycle order) |
| **2. Inter-Batch State Carryover** | `nodes/lora_loader.py` | Prompts start at arbitrary cycle offsets; leftover pools continue. | ✅ By design (manual `↺ Counter` reset) |
| **3. Snapshot Guard Teardown** | `web/batch_queue.js` | — | ❌ Not reproducible; submission queue serializes batches |
| **4. Batch Count == 1 Bypass** | `web/batch_queue.js` | — | ⚠️ Expected; no second item to snapshot |
| **5. Default Mode Mismatch** | `nodes/lora_loader.py` | API prompts silently stack all selected LoRAs. | ✅ Fixed (defaults aligned to `Sequential`) |

### Regression Coverage Added

- `test_sequential_reorder_keeps_cycle_position` — reordering the selection
  continues the existing cycle without repeating or skipping a LoRA.
- `test_sequential_changed_selection_starts_fresh_cycle` — changing the selected
  set still starts a new bucket.
- `test_missing_selection_mode_defaults_to_sequential` — `INPUT_TYPES`,
  `load_lora`, and `IS_CHANGED` agree on the fallback mode.

---

## Follow-up: Click-to-Queue Bleed (reported after the initial audit)

**Symptom:** Queue a batch with LoRA A, then queue more prompts with LoRAs B/C
10× and A again 5× while the earlier batch is still loading, and prompts come
out with text or LoRA selections taken from a different click ("character
bleeding"). Rapid Queue clicks made the effect worse.

**Actual cause (client-side timing, not parallelism):** ComfyUI's
`app.queuePrompt` does not serialize a click immediately when it is already
submitting another batch. It pushes the request onto `queueItems` and returns
`false`; the graph is serialized with `graphToPrompt()` only when that request's
turn starts. SaturnNodes additionally serializes UI queue actions through
`batchSubmissionQueue`. Any canvas edit made between the click and the deferred
serialization was therefore captured by the queued prompt. The old snapshot
guard only froze items **after** item 0 of a multi-item batch, so item 0 and
every single-item queue remained exposed.

**Fix:** `web/batch_queue.js` now captures the graph at click time whenever a
submission is already pending (`pendingSubmissions > 0` or
`app.processingQueue === true`). Item 0 of that batch uses the captured prompt,
later items reuse it as the snapshot, and `mergeDynamicSeeds` keeps randomized
seeds from the live prompt so generated seeds still match the UI. Idle clicks
skip the extra serialization.

**Prompt iterator:** reviewed for the same class of bug. It is not affected by
submission timing because ComfyUI executes prompts serially on the server. One
real bleed source was fixed: the optional `prompt` input was ignored whenever
the node's local `text` widget was non-empty, so stale local characters could
be replayed instead of the connected *Prompt Counter* output. A connected input
now always wins.

**Why the old tests missed it:** the Python tests call selection/iterator
functions directly and the DOM tests never modelled a pending HTTP submission.
The new `tests/test_batch_queue_snapshot_dom.mjs` reproduces the deferred
`graphToPrompt()` order of ComfyUI, and the iterator precedence tests live in
`tests/test_prompt_iterator.py`.

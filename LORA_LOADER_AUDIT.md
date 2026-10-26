# 🔍 Visual LoRA Loader & Batch Queue Logic Audit
## Root Causes 1–5: Defect Analysis, Locations & Mechanics

> **Status:** Investigation and documentation only. Code changes deferred per instruction (*"dont fix!"*).

---

## Executive Overview of Observed Defects

When a user selects one or more LoRAs, queues a batch of 5, and while they are being queued selects different LoRA(s) and queues a batch of 10, the following symptoms occur:
1. **LoRAs mixing together**: Prompts in Batch 2 receive LoRAs from Batch 1, or prompts in Batch 1 switch to LoRAs from Batch 2 mid-execution.
2. **Duplicate generations**: A LoRA generates twice in a row when sequential single-generation was expected.
3. **Missing LoRAs**: A LoRA that was explicitly selected is skipped and never generated.
4. **Capture bypass**: The previous "workflow capture" (`Batch Graph Snapshot Guard`) failed to prevent these issues.

The audit identified **five distinct root causes** across the frontend and backend engines that produce these exact symptoms.

---

## 📌 Root Cause 1: Deterministic Hash Sorting vs. Unsorted Array Indexing

- **File**: [`nodes/lora_loader.py`](file:///v:/ComfyUI/ComfyUI/custom_nodes/ComfyUI-SaturnNodes/nodes/lora_loader.py#L841-L896)
- **Functions**: `select_a_lora(...)` (lines 841–896)
- **Symptom Produced**: **Same LoRA generated twice; other selected LoRA skipped entirely.**

### What Is Happening
In `select_a_lora`, the persistent state key on disk uses a SHA-256 hash calculated over the **alphabetically sorted** list of choices:

```python
# nodes/lora_loader.py:845-847
choices_hash = hashlib.sha256(
    json.dumps(sorted(valid_choices), ensure_ascii=False).encode("utf-8")
).hexdigest()[:16]

state_key = f"{prefix}_{unique_id}_{choices_hash}"
```

However, when selecting the LoRA for the prompt, the code indexes into the **unsorted** `valid_choices` list:

```python
# nodes/lora_loader.py:894-895
if mode == "Sequential":
    selected = valid_choices[index % len(valid_choices)]
    index += 1
```

In the frontend (`web/js/folder_lora_loader.js`), `_selected_lora` stores LoRAs in the order they were clicked or iterated in the DOM.

### Failure Scenario:
1. User selects **LoRA A**, then **LoRA B**:
   - `valid_choices` = `["A", "B"]`
   - `sorted(valid_choices)` = `["A", "B"]` $\rightarrow$ `choices_hash` = `H1`
   - Prompt 1 executes: `index = 0`. Selection is `valid_choices[0 % 2]` = **A**. `index` increments to `1` and is saved to `lora_loader_state.json`.
2. Later, the user deselects and reselects, or toggles a folder checkbox, resulting in click order **LoRA B**, then **LoRA A**:
   - `valid_choices` = `["B", "A"]`
   - `sorted(valid_choices)` = `["A", "B"]` $\rightarrow$ `choices_hash` = `H1` (Matches previous state!)
   - State for `H1` is loaded: `index` is `1`.
   - Prompt 2 executes: `valid_choices[1 % 2]` = `valid_choices[1]`.
   - **At `valid_choices[1]` is LoRA A!**
3. **Result**:
   - **LoRA A generated twice in a row.**
   - **LoRA B was completely skipped and never generated.**

---

## 📌 Root Cause 2: Perpetual Inter-Batch Cycle Continuation

- **File**: [`nodes/lora_loader.py`](file:///v:/ComfyUI/ComfyUI/custom_nodes/ComfyUI-SaturnNodes/nodes/lora_loader.py#L856-L928)
- **Functions**: `select_a_lora(...)` and state storage in `user/default/SaturnNodes/lora_loader_state.json`
- **Symptom Produced**: **Batches starting on arbitrary mid-cycle LoRAs; leftover pools causing unexpected repeats across sessions.**

### What Is Happening
`state_key` is keyed exclusively by `(mode, node_id, choices_hash)`:
```python
state_key = f"{prefix}_{unique_id}_{choices_hash}"
```
There is **no concept of a batch boundary, run ID, or queue session**. The `index` counter (in Sequential) and the remaining `pool` (in Random No-Replace) are persisted permanently across batches, restarts, and days.

### Failure Scenario:
1. User selects 3 LoRAs (`[A, B, C]`) and queues a batch of 5:
   - Run 1 $\rightarrow$ A (index 1)
   - Run 2 $\rightarrow$ B (index 2)
   - Run 3 $\rightarrow$ C (index 3)
   - Run 4 $\rightarrow$ A (index 4)
   - Run 5 $\rightarrow$ B (index 5)
   - State saved on disk: `index = 5`.
2. Later (or the next day), user wants to generate 2 images with those same 3 LoRAs:
   - Expectation: Starts with A, then B.
   - Actual: `index = 5`. `5 % 3 = 2` $\rightarrow$ **starts with C**, then A!
   - LoRA B is never generated.
3. In **`Random (No Replace)`**, the unpopped items from the previous run remain in `pool`. If 3 out of 5 items were consumed in Batch 1, Batch 2 starts by popping the 2 leftover items before reshuffling, producing back-to-back duplicates across batch boundaries.

---

## 📌 Root Cause 3: Premature Snapshot Guard Teardown in Frontend V2

- **File**: [`web/batch_queue.js`](file:///v:/ComfyUI/ComfyUI/custom_nodes/ComfyUI-SaturnNodes/web/batch_queue.js#L521-L592)
- **Functions**: `setupQueueHooks()` (`app.queuePrompt` and `api.queuePrompt` hooks)
- **ComfyUI Reference**: ComfyUI Vue Frontend V2 `settingStore-CUTKo1HX.js` line 1873828
- **Symptom Produced**: **LoRAs mixing together across batches; Batch 2 prompts picking up live canvas edits.**

### What Is Happening
In modern ComfyUI (Vue Frontend V2), `app.queuePrompt` manages an internal queue:
```javascript
// ComfyUI core logic:
this.queueItems.push({ number, batchCount, ... });
if (this.processingQueue) return false; // Returns synchronously!
this.processingQueue = true;
for (; this.queueItems.length; ) {
    let { batchCount } = this.queueItems.pop();
    for (let r = 0; r < batchCount; r++) {
        let x = await this.graphToPrompt(); // Reads live canvas!
        await q.queuePrompt(number, x);
    }
}
```

SaturnNodes wraps `app.queuePrompt` in `web/batch_queue.js`:
```javascript
// web/batch_queue.js:527-535
const turn = batchSubmissionQueue.then(async () => {
    activeBatchContext = getNextBatch(count);
    try {
        return await origQueuePrompt(number, batchCount, queueNodeIds);
    } finally {
        activeBatchContext = null; // <-- CRITICAL TEARDOWN RACE
    }
});
```

### Failure Scenario:
1. User queues **Batch 1 (5 items)** with LoRA 1.
   - `origQueuePrompt` starts. `this.processingQueue = true`. ComfyUI begins serializing and submitting.
2. While Batch 1 is being submitted, user clicks **LoRA 2** on canvas and queues **Batch 2 (10 items)**.
3. Batch 2 invokes `app.queuePrompt`:
   - Inside ComfyUI, `if (this.processingQueue) return false;` fires **synchronously**!
   - Because `origQueuePrompt` returns immediately, the `try / finally` block executes:
   - **`activeBatchContext = null;` executes immediately.**
4. When ComfyUI's background loop eventually finishes Batch 1 and begins Batch 2:
   - ComfyUI calls `api.queuePrompt` for Batch 2 items.
   - In `web/batch_queue.js:550`:
     ```javascript
     if (!activeBatchContext) {
         activeBatchContext = getNextBatch(1); // Treated as 1-item batch!
     }
     ```
   - Because `batchContext.batchCount == 1`, line 569 evaluates to **FALSE**:
     ```javascript
     if (isSnapshotGuardEnabled() && batchContext.batchCount > 1) // FALSE!
     ```
5. **Result**:
   - **The Snapshot Guard is completely disabled for Batch 2.**
   - ComfyUI re-serializes the graph from the live canvas on every item (`graphToPrompt()`).
   - Any further clicks or selections on the canvas bleed directly into the queued items mid-batch, mixing LoRAs between batches.

---

## 📌 Root Cause 4: Single-Item Batches (`batchCount == 1`) Bypass Snapshot Guard

- **File**: [`web/batch_queue.js`](file:///v:/ComfyUI/ComfyUI/custom_nodes/ComfyUI-SaturnNodes/web/batch_queue.js#L569)
- **Functions**: `api.queuePrompt` hook
- **Symptom Produced**: **No snapshot protection when submitting single prompts rapidly.**

### What Is Happening
Line 569 of `web/batch_queue.js` explicitly gates snapshot protection:
```javascript
// web/batch_queue.js:569
if (isSnapshotGuardEnabled() && batchContext.batchCount > 1) {
    if (itemIndex === 0) {
        batchContext.snapshotPrompt = JSON.parse(JSON.stringify(prompt));
    } else if (batchContext.snapshotPrompt) {
        promptToSend = mergeDynamicSeeds(batchContext.snapshotPrompt, prompt);
    }
}
```
If a user queues prompts with ComfyUI's batch count set to `1` (for instance, clicking Queue repeatedly while testing different LoRAs or adjusting prompts), `batchContext.batchCount > 1` is **always false**.

No snapshot is ever captured. If the server queue has a backlog and the user continues interacting with the canvas, every subsequent request serializes whatever happens to be on the canvas at the moment the HTTP call dispatches.

---

## 📌 Root Cause 5: Function Signature Default Mismatch (`"All"` vs. `"Sequential"`)

- **File**: [`nodes/lora_loader.py`](file:///v:/ComfyUI/ComfyUI/custom_nodes/ComfyUI-SaturnNodes/nodes/lora_loader.py#L952-L969)
- **Functions**: `VisualLoraLoader.INPUT_TYPES` vs. `VisualLoraLoader.load_lora(...)`
- **Symptom Produced**: **Simultaneous loading of multiple LoRAs (stacking all models into one render).**

### What Is Happening
There is a discrepancy between the default declared in `INPUT_TYPES` and the default parameter in the Python function signature:

```python
# nodes/lora_loader.py:952 (Node definition)
"hidden": {
    "_selected_lora": ("STRING", {"default": "[]"}),
    "_selection_mode": ("STRING", {"default": "Sequential"}),
    ...
}

# nodes/lora_loader.py:969 (Execution method signature)
def load_lora(self, model, clip, folder, strength_model, strength_clip,
              display_mode="Scrollable", sort_loras_by="Name (A-Z)",
              sort_folders_by="Name (A-Z)", folder_position="Folders First",
              content_alignment="Left Aligned", output_format="Filename",
              custom_regex="", output_name=None, _selected_lora="[]",
              _selection_mode="All",  # <-- DEFAULTS TO "All", NOT "Sequential"
              _scrape_on_new="true", unique_id="default", **kwargs):
```

### Failure Scenario:
1. If a workflow is executed via API, an older saved workflow format, or if `_selection_mode` is missing from the serialized inputs, Python defaults `_selection_mode` to `"All"`.
2. When `_selection_mode == "All"`:
   - Line 985 (`if _selection_mode in ["Random", "Sequential", ...]`) evaluates to **False**.
   - `select_a_lora` is **never called**.
   - `loras_to_load` retains all items in `_selected_lora`.
3. The execution loop iterates through every selected LoRA and loads all of them simultaneously onto the model and CLIP:
   ```python
   for item in loras_to_load:
       current_model, current_clip = comfy.sd.load_lora_for_models(
           current_model, current_clip, lora, strength_model, strength_clip
       )
   ```
4. **Result**:
   - Rather than cycling 1 LoRA per prompt, **all selected LoRAs are merged simultaneously into every single generated image**.

---

## Summary Matrix

| Root Cause | Affected File(s) | Primary Impact |
| :--- | :--- | :--- |
| **1. Hash vs Indexing Order** | `nodes/lora_loader.py:845-895` | Same LoRA selected twice; other selected LoRAs skipped entirely. |
| **2. Inter-Batch State Carryover** | `nodes/lora_loader.py:856-928` | Prompts start at arbitrary cycle offsets; leftover pools repeat items. |
| **3. Snapshot Guard Premature Teardown** | `web/batch_queue.js:527-580` | Queuing a second batch while first is processing bypasses snapshot lock completely. |
| **4. Batch Count == 1 Bypass** | `web/batch_queue.js:569` | Rapid single-prompt queueing offers zero snapshot protection. |
| **5. Default Mode Mismatch** | `nodes/lora_loader.py:969` | Fallback executes `"All"` mode, applying all LoRAs simultaneously. |

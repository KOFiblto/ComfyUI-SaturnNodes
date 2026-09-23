import { app } from "/scripts/app.js";
import { api } from "/scripts/api.js";
import { authenticatedFetch } from "./js/auth_helper.js";

// 36 Curated Accessible, High-Contrast Cycling Colors for Batch Visual Grouping
const BATCH_COLORS = [
    "#10b981", // 1. Emerald
    "#3b82f6", // 2. Blue
    "#8b5cf6", // 3. Purple
    "#ec4899", // 4. Pink
    "#f59e0b", // 5. Amber
    "#06b6d4", // 6. Cyan
    "#ef4444", // 7. Red
    "#14b8a6", // 8. Teal
    "#6366f1", // 9. Indigo
    "#f97316", // 10. Orange
    "#84cc16", // 11. Lime
    "#d946ef", // 12. Fuchsia
    "#0ea5e9", // 13. Sky
    "#a855f7", // 14. Violet
    "#e11d48", // 15. Rose
    "#22c55e", // 16. Green
    "#eab308", // 17. Yellow
    "#64748b", // 18. Slate
    "#2dd4bf", // 19. Turquoise
    "#fb7185", // 20. Coral
    "#38bdf8", // 21. Light Blue
    "#c084fc", // 22. Lavender
    "#f43f5e", // 23. Ruby
    "#4ade80", // 24. Mint
    "#fbbf24", // 25. Gold
    "#818cf8", // 26. Periwinkle
    "#fb923c", // 27. Tangerine
    "#a3e635", // 28. Chartreuse
    "#f472b6", // 29. Hot Pink
    "#22d3ee", // 30. Aqua
    "#e879f9", // 31. Orchid
    "#a7f3d0", // 32. Seafoam
    "#fde047", // 33. Lemon
    "#fda4af", // 34. Blush
    "#93c5fd", // 35. Cornflower
    "#c4b5fd"  // 36. Lilac
];

const STORAGE_KEY = "saturnnodes_batch_queue_meta";
const LEGACY_STORAGE_KEY = "leafflow_batch_queue_meta";
const BATCH_COUNTER_KEY = "saturnnodes_batch_counter";
const LEGACY_BATCH_COUNTER_KEY = "leafflow_batch_counter";
const SETTING_ID = "SaturnNodes.🎨 Batch Queue.01_ShowBatchLines";
const LEGACY_SETTING_ID_0 = "SaturnNodes.8 - 🎨 Batch Queue.01_ShowBatchLines";
const LEGACY_SETTING_ID_1 = "SaturnNodes.BatchQueue.Enabled";
const LEGACY_SETTING_ID_2 = "LeafFlow.BatchQueue.Enabled";
const SETTING_SNAPSHOT_GUARD = "SaturnNodes.🎨 Batch Queue.02_SnapshotGuard";
const LEGACY_SETTING_SNAPSHOT_GUARD_0 = "SaturnNodes.8 - 🎨 Batch Queue.02_SnapshotGuard";
const LEGACY_SETTING_SNAPSHOT_GUARD_1 = "SaturnNodes.BatchQueue.SnapshotGuard";
const LEGACY_SETTING_SNAPSHOT_GUARD_2 = "LeafFlow.BatchQueue.SnapshotGuard";

// In-memory registry mapping prompt_id -> batch metadata
let batchRegistry = new Map();
let activeBatchContext = null;
let batchCounter = 0;

function loadStorage() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY) || localStorage.getItem(LEGACY_STORAGE_KEY);
        if (raw) {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) {
                for (const item of parsed) {
                    if (item && item.prompt_id) {
                        batchRegistry.set(String(item.prompt_id), item);
                    }
                }
            }
        }
        const savedCounter = localStorage.getItem(BATCH_COUNTER_KEY) || localStorage.getItem(LEGACY_BATCH_COUNTER_KEY);
        if (savedCounter) {
            batchCounter = parseInt(savedCounter, 10) || 0;
        }
    } catch (e) {
        console.warn("[SaturnNodes BatchQueue] Failed to load batch storage:", e);
    }
}

function saveStorage() {
    try {
        // Prune entries to last 250 items to keep localStorage small
        const allEntries = Array.from(batchRegistry.values());
        const pruned = allEntries.slice(-250);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(pruned));
        localStorage.setItem(BATCH_COUNTER_KEY, String(batchCounter));
    } catch (e) {
        // Storage full or private mode
    }
}

function getNextBatch(batchCount = 1) {
    batchCounter++;
    const colorIndex = (batchCounter - 1) % BATCH_COLORS.length;
    const color = BATCH_COLORS[colorIndex];
    const batchId = `batch_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
    
    const batch = {
        batchId,
        batchNumber: batchCounter,
        batchCount: Math.max(1, batchCount),
        color,
        colorIndex,
        queuedAt: Date.now(),
        prompts: []
    };
    return batch;
}

// Inject CSS for the 1D git-graph style line
function injectBatchStyles() {
    if (typeof document === "undefined") return;
    const styleId = "leafflow-batch-queue-styles";
    if (document.getElementById(styleId)) return;

    const style = document.createElement("style");
    style.id = styleId;
    style.textContent = `
        /* LeafFlow 1D Git-Graph Batch Line Container */
        .leafflow-batch-line-wrap {
            position: absolute;
            left: -9px;
            top: 0;
            bottom: 0;
            width: 9px;
            pointer-events: none;
            z-index: 50;
            display: flex;
            align-items: stretch;
            justify-content: center;
            overflow: visible;
        }

        .leafflow-batch-line-svg {
            width: 100%;
            height: 100%;
            display: block;
            overflow: visible;
        }

        /* Ensure parent card has relative positioning and allows line in left margin */
        [data-testid="job-assets-list"] [data-job-id] {
            position: relative !important;
            overflow: visible !important;
        }

        /* Support for classic frontend v1 queue table rows */
        .comfy-table tr[data-job-id],
        .comfy-queue-item {
            position: relative !important;
            overflow: visible !important;
        }
    `;
    document.head.appendChild(style);
}

// Build 1D SVG line path according to segment type:
// 'single': bracket (rounded top & bottom curving right to card)
// 'first': rounded top curving right, straight all the way down
// 'middle': straight line top to bottom
// 'last': straight from top, rounded bottom curving right to card
function buildSvgPath(segmentType) {
    // Coordinate system: width=10, height=48. Curve bends toward the card (x=9)
    switch (segmentType) {
        case "single":
            return "M 9,6 Q 2,6 2,16 L 2,32 Q 2,42 9,42";
        case "first":
            return "M 9,6 Q 2,6 2,16 L 2,48";
        case "middle":
            return "M 2,0 L 2,48";
        case "last":
            return "M 2,0 L 2,32 Q 2,42 9,42";
        default:
            return "M 9,6 Q 2,6 2,16 L 2,32 Q 2,42 9,42";
    }
}

function renderBatchLineOnElement(element, segmentType, color) {
    if (!element) return;

    let wrap = element.querySelector(".leafflow-batch-line-wrap");
    if (!wrap) {
        wrap = document.createElement("div");
        wrap.className = "leafflow-batch-line-wrap";
        element.appendChild(wrap);
    }

    const dPath = buildSvgPath(segmentType);
    wrap.innerHTML = `
        <svg class="leafflow-batch-line-svg" viewBox="0 0 10 48" preserveAspectRatio="none">
            <path d="${dPath}" stroke="${color}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" fill="none" />
        </svg>
    `;
}

function removeBatchLineFromElement(element) {
    if (!element) return;
    const wrap = element.querySelector(".leafflow-batch-line-wrap");
    if (wrap) {
        wrap.remove();
    }
}

// Check if SaturnNodes Batch Queue is enabled in settings
function isBatchQueueEnabled() {
    try {
        const keys = [SETTING_ID, LEGACY_SETTING_ID_0, LEGACY_SETTING_ID_1, LEGACY_SETTING_ID_2];
        if (app.extensionManager?.setting?.get) {
            for (const k of keys) {
                const val = app.extensionManager.setting.get(k);
                if (val !== undefined) return val !== false;
            }
        }
        if (app.ui?.settings?.get) {
            for (const k of keys) {
                const val = app.ui.settings.get(k);
                if (val !== undefined) return val !== false;
            }
        }
    } catch (e) {}
    return true;
}

function isSnapshotGuardEnabled() {
    try {
        const keys = [SETTING_SNAPSHOT_GUARD, LEGACY_SETTING_SNAPSHOT_GUARD_0, LEGACY_SETTING_SNAPSHOT_GUARD_1, LEGACY_SETTING_SNAPSHOT_GUARD_2];
        if (app.extensionManager?.setting?.get) {
            for (const k of keys) {
                const val = app.extensionManager.setting.get(k);
                if (val !== undefined) return val !== false;
            }
        }
        if (app.ui?.settings?.get) {
            for (const k of keys) {
                const val = app.ui.settings.get(k);
                if (val !== undefined) return val !== false;
            }
        }
    } catch (e) {}
    return true;
}

function isSeedInput(key, val, nodeInputs) {
    const k = String(key).toLowerCase();
    // 1. Direct seed properties (seed, noise_seed, sampler_seed, seed_num, random_seed, etc.)
    if (k.includes("seed")) {
        return typeof val === "number" || (typeof val === "string" && /^-?\d+$/.test(val.trim()));
    }
    // 2. Dynamic random integer/number properties (random_value, random_int, etc.)
    if (k.includes("random") && typeof val === "number") {
        return true;
    }
    // 3. ComfyUI PrimitiveNode controlling a seed widget (contains control_after_generate or control_mode)
    if (key === "value" && nodeInputs && (nodeInputs.control_after_generate !== undefined || nodeInputs.control_mode !== undefined)) {
        return typeof val === "number" || (typeof val === "string" && /^-?\d+$/.test(String(val).trim()));
    }
    return false;
}

function mergeDynamicSeeds(snapPrompt, livePrompt) {
    if (!snapPrompt) return livePrompt;
    try {
        const cloned = JSON.parse(JSON.stringify(snapPrompt));
        if (livePrompt && livePrompt.output && cloned.output) {
            for (const [nodeId, liveNode] of Object.entries(livePrompt.output)) {
                const snapNode = cloned.output[nodeId];
                if (snapNode && snapNode.inputs && liveNode.inputs) {
                    for (const [key, val] of Object.entries(liveNode.inputs)) {
                        if (isSeedInput(key, val, liveNode.inputs)) {
                            snapNode.inputs[key] = val;
                        }
                    }
                }
            }
        }
        // Also sync seed values in workflow metadata so saved PNG metadata matches generated seeds
        if (livePrompt && livePrompt.workflow && Array.isArray(livePrompt.workflow.nodes) && cloned.workflow && Array.isArray(cloned.workflow.nodes)) {
            const liveWorkflowMap = new Map();
            for (const n of livePrompt.workflow.nodes) {
                if (n && n.id !== undefined) liveWorkflowMap.set(String(n.id), n);
            }
            for (const snapNode of cloned.workflow.nodes) {
                if (!snapNode || snapNode.id === undefined) continue;
                const liveWfNode = liveWorkflowMap.get(String(snapNode.id));
                if (liveWfNode && Array.isArray(liveWfNode.widgets_values) && Array.isArray(snapNode.widgets_values)) {
                    for (let i = 0; i < liveWfNode.widgets_values.length; i++) {
                        const liveVal = liveWfNode.widgets_values[i];
                        const snapVal = snapNode.widgets_values[i];
                        if (typeof liveVal === "number" && typeof snapVal === "number" && liveVal !== snapVal) {
                            snapNode.widgets_values[i] = liveVal;
                        }
                    }
                }
            }
        }
        return cloned;
    } catch (e) {
        console.warn("[LeafFlow BatchQueue] Error merging dynamic seeds into snapshot:", e);
        return snapPrompt;
    }
}

// Sync with server if PersistentQueue is available
async function syncBatchToServer(promptId, batchInfo) {
    try {
        await authenticatedFetch("/saturnnodes/batch_queue/sync", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                prompt_id: promptId,
                batch_info: batchInfo
            })
        }).catch(() => null);
    } catch (e) {
        // Silently ignore if server endpoint is not present
    }
}

async function loadBatchFromServer() {
    try {
        if (!api || !api.fetchApi) return;
        const res = await api.fetchApi("/saturnnodes/batch_queue/data", { cache: "no-store" }).catch(() => null);
        if (res && res.ok) {
            const data = await res.json();
            if (data && typeof data === "object") {
                for (const [pid, info] of Object.entries(data)) {
                    if (pid && info) {
                        batchRegistry.set(String(pid), info);
                    }
                }
                saveStorage();
            }
        }
    } catch (e) {}
}

// Refresh visual lines in DOM for both v1 and v2
async function updateQueueBatchVisuals() {
    if (!isBatchQueueEnabled()) {
        document.querySelectorAll(".leafflow-batch-line-wrap").forEach(el => el.remove());
        return;
    }

    // Find all visible queue item elements in DOM (supports v2 job cards and v1 rows)
    const elements = Array.from(document.querySelectorAll('[data-testid="job-assets-list"] [data-job-id], .comfy-table tr[data-job-id]'));
    if (!elements.length) return;

    // Elements are strictly in visual screen order from top to bottom
    const visiblePromptIds = elements.map(el => el.getAttribute("data-job-id")).filter(Boolean);

    // Build map of promptId -> element for visible items
    const elMap = new Map();
    for (const el of elements) {
        const pid = el.getAttribute("data-job-id");
        if (pid) elMap.set(pid, el);
    }

    // For every prompt on screen, calculate segment type based on visual screen order:
    // - Top-most card on screen for Batch A curves at the top (┌)
    // - Bottom-most card on screen for Batch A curves at the bottom (└)
    // - 1-item Batch curves at both top and bottom (()
    // - Anything in between connects with straight lines (│)
    for (const pid of visiblePromptIds) {
        const el = elMap.get(pid);
        if (!el) continue;

        const info = batchRegistry.get(pid);
        if (!info || !info.batchId) {
            removeBatchLineFromElement(el);
            continue;
        }

        const batchId = info.batchId;
        const color = info.color || BATCH_COLORS[0];

        // Find all visible items of this batch in top-to-bottom visual order
        const occurrencesOnScreen = visiblePromptIds.filter(p => {
            const b = batchRegistry.get(p);
            return b && b.batchId === batchId;
        });

        if (occurrencesOnScreen.length <= 1) {
            // Only 1 item of this batch currently visible on screen
            if ((info.batchCount || 1) === 1) {
                renderBatchLineOnElement(el, "single", color);
            } else {
                // Batch originally had multiple items, but only 1 is currently visible/unexecuted
                if (info.itemIndex === 0) {
                    renderBatchLineOnElement(el, "first", color);
                } else if (info.itemIndex === (info.batchCount - 1)) {
                    renderBatchLineOnElement(el, "last", color);
                } else {
                    renderBatchLineOnElement(el, "middle", color);
                }
            }
            continue;
        }

        const topPidOnScreen = occurrencesOnScreen[0];
        const bottomPidOnScreen = occurrencesOnScreen[occurrencesOnScreen.length - 1];

        if (pid === topPidOnScreen) {
            // Top card on screen -> curves at top (┌)
            renderBatchLineOnElement(el, "first", color);
        } else if (pid === bottomPidOnScreen) {
            // Bottom card on screen -> curves at bottom (└)
            renderBatchLineOnElement(el, "last", color);
        } else {
            // Middle cards on screen -> straight line (│)
            renderBatchLineOnElement(el, "middle", color);
        }
    }
}

let batchSubmissionQueue = Promise.resolve();

// Hook queuePrompt to track batch execution and guard multi-item batches
function setupQueueHooks() {
    loadStorage();

    // 1. Hook app.queuePrompt to know when a batch is initiated
    if (app && typeof app.queuePrompt === "function") {
        const origQueuePrompt = app.queuePrompt.bind(app);
        app.queuePrompt = async function(number, batchCount = 1, queueNodeIds) {
            const count = Math.max(1, parseInt(batchCount, 10) || 1);

            // Chain onto batchSubmissionQueue to ensure sequential batch submissions
            const turn = batchSubmissionQueue.then(async () => {
                const batch = getNextBatch(count);
                activeBatchContext = batch;
                saveStorage();
                try {
                    return await origQueuePrompt(number, batchCount, queueNodeIds);
                } finally {
                    activeBatchContext = null;
                }
            });
            batchSubmissionQueue = turn.catch(() => {});
            return turn;
        };
    }

    // 2. Hook api.queuePrompt to record every generated prompt_id & enforce snapshot guard
    if (api && typeof api.queuePrompt === "function") {
        const origApiQueuePrompt = api.queuePrompt.bind(api);
        api.queuePrompt = async function(number, prompt, targets) {
            let promptToSend = prompt;

            // Batch Graph Snapshot Guard:
            // When queueing a batch with batchCount > 1, snapshot on iteration 0 in the background
            // so canvas edits (text, LoRA selection, widgets) don't bleed into subsequent items.
            if (isSnapshotGuardEnabled() && activeBatchContext && activeBatchContext.batchCount > 1) {
                const itemIndex = activeBatchContext.prompts.length;
                if (itemIndex === 0) {
                    try {
                        activeBatchContext.snapshotPrompt = JSON.parse(JSON.stringify(prompt));
                    } catch (e) {
                        console.warn("[LeafFlow BatchQueue] Failed to snapshot prompt:", e);
                    }
                } else if (activeBatchContext.snapshotPrompt) {
                    promptToSend = mergeDynamicSeeds(activeBatchContext.snapshotPrompt, prompt);
                }
            }

            const res = await origApiQueuePrompt(number, promptToSend, targets);
            if (res && res.prompt_id) {
                const pid = String(res.prompt_id);
                if (!activeBatchContext) {
                    activeBatchContext = getNextBatch(1);
                }

                const itemIndex = activeBatchContext.prompts.length;
                const batchInfo = {
                    prompt_id: pid,
                    batchId: activeBatchContext.batchId,
                    batchNumber: activeBatchContext.batchNumber,
                    batchCount: activeBatchContext.batchCount,
                    itemIndex: itemIndex,
                    color: activeBatchContext.color,
                    colorIndex: activeBatchContext.colorIndex,
                    isQueueFront: number < 0,
                    queuedAt: Date.now()
                };

                activeBatchContext.prompts.push(pid);
                batchRegistry.set(pid, batchInfo);
                saveStorage();
                syncBatchToServer(pid, batchInfo);

                // If this batch completed its expected prompt count, clear context
                if (activeBatchContext.prompts.length >= activeBatchContext.batchCount) {
                    activeBatchContext = null;
                }

                setTimeout(updateQueueBatchVisuals, 100);
            }
            return res;
        };
    }
}

app.registerExtension({
    name: "ComfyUI.SaturnNodes.BatchQueue",
    async setup() {
        injectBatchStyles();
        setupQueueHooks();
        loadBatchFromServer();

        // Listen for queue changes
        if (api && api.addEventListener) {
            api.addEventListener("status", () => {
                setTimeout(updateQueueBatchVisuals, 100);
            });
            api.addEventListener("execution_start", () => {
                setTimeout(updateQueueBatchVisuals, 80);
            });
            api.addEventListener("executing", () => {
                setTimeout(updateQueueBatchVisuals, 150);
            });
        }

        // Set up MutationObserver on body to detect queue sidebar rendering
        let debounceTimer = null;
        const observer = new MutationObserver((mutations) => {
            let shouldUpdate = false;
            for (const m of mutations) {
                if (m.target && m.target.nodeType === 1) {
                    if (m.target.closest?.('[data-testid="job-assets-list"], .comfy-table') ||
                        m.target.matches?.('[data-testid="job-assets-list"], [data-job-id]')) {
                        shouldUpdate = true;
                        break;
                    }
                }
            }
            if (shouldUpdate) {
                clearTimeout(debounceTimer);
                debounceTimer = setTimeout(updateQueueBatchVisuals, 60);
            }
        });

        observer.observe(document.body, { childList: true, subtree: true });

        // Initial check after load
        setTimeout(updateQueueBatchVisuals, 800);
        setTimeout(updateQueueBatchVisuals, 2000);
    }
});

export { BATCH_COLORS, buildSvgPath };

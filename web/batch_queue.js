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
const BATCH_COUNTER_KEY = "saturnnodes_batch_counter";
const SETTING_ID = "SaturnNodes.🎨 Batch Queue.01_ShowBatchLines";
const SETTING_SNAPSHOT_GUARD = "SaturnNodes.🎨 Batch Queue.02_SnapshotGuard";

// In-memory registry mapping prompt_id -> batch metadata
let batchRegistry = new Map();
let activeBatchContext = null;
let batchCounter = 0;

function loadStorage() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
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
        const savedCounter = localStorage.getItem(BATCH_COUNTER_KEY);
        if (savedCounter) {
            // A negative or corrupted counter would index outside BATCH_COLORS
            // and render an undefined stroke color.
            batchCounter = Math.max(0, parseInt(savedCounter, 10) || 0);
        }
    } catch (e) {
        console.warn("[SaturnNodes BatchQueue] Failed to load batch storage:", e);
    }
}

function saveStorage() {
    try {
        // Prune entries to the 250 most recently queued items. Map insertion
        // order is not a reliable recency order when metadata for an existing
        // prompt is updated in place.
        const allEntries = Array.from(batchRegistry.values());
        const pruned = allEntries
            .map((entry, index) => ({ entry, index }))
            .sort((a, b) => {
                const aTime = Number(a.entry && a.entry.queuedAt) || 0;
                const bTime = Number(b.entry && b.entry.queuedAt) || 0;
                return aTime - bTime || a.index - b.index;
            })
            .slice(-250)
            .map(item => item.entry);
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
    const styleId = "saturnnodes-batch-queue-styles";
    if (document.getElementById(styleId)) return;

    const style = document.createElement("style");
    style.id = styleId;
    style.textContent = `
        /* SaturnNodes 1D Git-Graph Batch Line Container */
        .saturnnodes-batch-line-wrap {
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

        .saturnnodes-batch-line-svg {
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

// Batch metadata comes from localStorage and the server, so never trust its
// color string as HTML/SVG markup. Only complete 3/4/6/8-digit hex colors are
// accepted (5 and 7-digit values are not valid CSS colors).
const HEX_COLOR_PATTERN = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

function normalizeBatchColor(color, fallback = BATCH_COLORS[0]) {
    if (typeof color === "string") {
        const trimmed = color.trim();
        if (HEX_COLOR_PATTERN.test(trimmed)) return trimmed;
    }
    return fallback;
}

function normalizeSegmentType(segmentType) {
    return ["single", "first", "middle", "last"].includes(segmentType)
        ? segmentType
        : "single";
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

    let wrap = element.querySelector(".saturnnodes-batch-line-wrap");
    if (!wrap) {
        wrap = document.createElement("div");
        wrap.className = "saturnnodes-batch-line-wrap";
        element.appendChild(wrap);
    }

    const safeSegment = normalizeSegmentType(segmentType);
    const safeColor = normalizeBatchColor(color);

    // Avoid rewriting the SVG on every status/executing refresh when the
    // visible segment and batch color have not changed.
    const signature = `${safeSegment}|${safeColor}`;
    if (wrap.dataset.saturnnodesBatchSignature === signature && wrap.innerHTML) return;
    wrap.dataset.saturnnodesBatchSignature = signature;

    const dPath = buildSvgPath(safeSegment);
    wrap.innerHTML = `
        <svg class="saturnnodes-batch-line-svg" viewBox="0 0 10 48" preserveAspectRatio="none">
            <path d="${dPath}" stroke="${safeColor}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" fill="none" />
        </svg>
    `;
}

function removeBatchLineFromElement(element) {
    if (!element) return;
    const wrap = element.querySelector(".saturnnodes-batch-line-wrap");
    if (wrap) {
        wrap.remove();
    }
}

// Check if SaturnNodes Batch Queue is enabled in settings
function isBatchQueueEnabled() {
    try {
        if (app.extensionManager?.setting?.get) {
            const val = app.extensionManager.setting.get(SETTING_ID);
            if (val !== undefined) return val !== false;
        }
        if (app.ui?.settings?.get) {
            const val = app.ui.settings.get(SETTING_ID);
            if (val !== undefined) return val !== false;
        }
    } catch (e) {}
    return true;
}

function isSnapshotGuardEnabled() {
    try {
        if (app.extensionManager?.setting?.get) {
            const val = app.extensionManager.setting.get(SETTING_SNAPSHOT_GUARD);
            if (val !== undefined) return val !== false;
        }
        if (app.ui?.settings?.get) {
            const val = app.ui.settings.get(SETTING_SNAPSHOT_GUARD);
            if (val !== undefined) return val !== false;
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
                    const graphNode = app.graph?.getNodeById?.(snapNode.id) || app.graph?.getNodeById?.(Number(snapNode.id));
                    for (let i = 0; i < liveWfNode.widgets_values.length; i++) {
                        const liveVal = liveWfNode.widgets_values[i];
                        const snapVal = snapNode.widgets_values[i];
                        if (typeof liveVal === "number" && typeof snapVal === "number" && liveVal !== snapVal) {
                            const widgetName = graphNode?.widgets?.[i]?.name;
                            if (widgetName) {
                                if (isSeedInput(widgetName, liveVal)) {
                                    snapNode.widgets_values[i] = liveVal;
                                }
                            } else {
                                const apiInputs = cloned.output?.[String(snapNode.id)]?.inputs;
                                if (apiInputs) {
                                    for (const [k, v] of Object.entries(apiInputs)) {
                                        if (v === liveVal && isSeedInput(k, v)) {
                                            snapNode.widgets_values[i] = liveVal;
                                            break;
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
        return cloned;
    } catch (e) {
        console.warn("[SaturnNodes BatchQueue] Error merging dynamic seeds into snapshot:", e);
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
                    if (!pid || !info || typeof info !== "object") continue;
                    const key = String(pid);
                    const existing = batchRegistry.get(key);
                    // Never let an older server snapshot overwrite newer local
                    // metadata for the same prompt.
                    if (existing && (Number(existing.queuedAt) || 0) > (Number(info.queuedAt) || 0)) {
                        continue;
                    }
                    batchRegistry.set(key, info);
                }
                saveStorage();
            }
        }
    } catch (e) {}
}

// Queue cards are virtualized/reused by the Vue queue.  A card can keep the
// same DOM element when it moves from pending -> running or when the next batch
// starts, so the old batch line must be repainted after Vue has updated its
// data-job-id.  A single delayed update can race the async /jobs refresh; poll
// briefly after each queue event and let the MutationObserver below catch the
// actual attribute update as well.
let batchVisualRefreshToken = 0;

function scheduleBatchVisualRefresh(durationMs = 1200) {
    const token = ++batchVisualRefreshToken;
    const deadline = Date.now() + durationMs;

    const refresh = () => {
        if (token !== batchVisualRefreshToken) return;
        updateQueueBatchVisuals();
        if (Date.now() < deadline) {
            setTimeout(refresh, 200);
        }
    };

    refresh();
}

// Refresh visual lines in DOM for both v1 and v2
async function updateQueueBatchVisuals() {
    if (!isBatchQueueEnabled()) {
        document.querySelectorAll(".saturnnodes-batch-line-wrap").forEach(el => el.remove());
        return;
    }

    // Find all visible queue item elements in DOM (supports v2 job cards and v1 rows)
    const elements = Array.from(document.querySelectorAll('[data-testid="job-assets-list"] [data-job-id], .comfy-table tr[data-job-id]'));
    if (!elements.length) return;

    // Elements are strictly in visual screen order from top to bottom.
    // Dedupe by prompt id: a duplicate row would otherwise skew the batch
    // grouping counts and make the line segments disagree with the list.
    const visiblePromptIds = [];
    const elMap = new Map();
    const duplicateElements = [];
    for (const el of elements) {
        const pid = el.getAttribute("data-job-id");
        if (!pid) continue;
        if (elMap.has(pid)) {
            // A duplicate row must not keep a batch line painted by an earlier
            // render either; only the first visible occurrence is authoritative.
            duplicateElements.push(el);
            continue;
        }
        visiblePromptIds.push(pid);
        elMap.set(pid, el);
    }
    if (!visiblePromptIds.length) return;
    for (const el of duplicateElements) {
        removeBatchLineFromElement(el);
    }

    // Group visible prompts by batch once (O(n)) instead of filtering the whole
    // visible list for every rendered card (O(n²)).
    const batchGroups = new Map();
    for (const pid of visiblePromptIds) {
        const info = batchRegistry.get(pid);
        if (!info || !info.batchId) continue;
        if (!batchGroups.has(info.batchId)) batchGroups.set(info.batchId, []);
        batchGroups.get(info.batchId).push(pid);
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
        const color = normalizeBatchColor(info.color);
        const batchCount = Math.max(1, Number(info.batchCount) || 1);
        const itemIndex = Number.isInteger(info.itemIndex) ? info.itemIndex : 0;

        // All visible items of this batch in top-to-bottom visual order
        const occurrencesOnScreen = batchGroups.get(batchId) || [];

        if (occurrencesOnScreen.length <= 1) {
            // Only 1 item of this batch currently visible on screen
            if (batchCount === 1) {
                renderBatchLineOnElement(el, "single", color);
            } else {
                // Batch originally had multiple items, but only 1 is currently visible/unexecuted
                if (itemIndex === 0) {
                    renderBatchLineOnElement(el, "first", color);
                } else if (itemIndex === (batchCount - 1)) {
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
    if (setupQueueHooks._installed) return;
    setupQueueHooks._installed = true;
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

            // Reserve the item index before the request is sent; concurrent
            // submissions must not race on the post-response queue length.
            if (!activeBatchContext) {
                activeBatchContext = getNextBatch(1);
            }
            // Capture this request's context. A concurrent request may finish
            // the batch and clear the global reference while we are awaiting
            // the server.
            const batchContext = activeBatchContext;
            if (!Number.isInteger(batchContext.nextItemIndex)) {
                batchContext.nextItemIndex = 0;
            }
            if (!Number.isInteger(batchContext.inFlight)) {
                batchContext.inFlight = 0;
            }
            const itemIndex = batchContext.nextItemIndex++;
            batchContext.inFlight++;

            // Batch Graph Snapshot Guard:
            // When queueing a batch with batchCount > 1, snapshot on iteration 0 in the background
            // so canvas edits (text, LoRA selection, widgets) don't bleed into subsequent items.
            if (isSnapshotGuardEnabled() && batchContext.batchCount > 1) {
                if (itemIndex === 0) {
                    try {
                        batchContext.snapshotPrompt = JSON.parse(JSON.stringify(prompt));
                    } catch (e) {
                        console.warn("[SaturnNodes BatchQueue] Failed to snapshot prompt:", e);
                    }
                } else if (batchContext.snapshotPrompt) {
                    promptToSend = mergeDynamicSeeds(batchContext.snapshotPrompt, prompt);
                }
            }

            let res;
            try {
                res = await origApiQueuePrompt(number, promptToSend, targets);
            } catch (e) {
                batchContext.inFlight--;
                if (activeBatchContext === batchContext &&
                    batchContext.nextItemIndex >= batchContext.batchCount &&
                    batchContext.inFlight === 0) {
                    activeBatchContext = null;
                }
                throw e;
            }
            batchContext.inFlight--;
            if (res && res.prompt_id) {
                const pid = String(res.prompt_id);
                const batchInfo = {
                    prompt_id: pid,
                    batchId: batchContext.batchId,
                    batchNumber: batchContext.batchNumber,
                    batchCount: batchContext.batchCount,
                    itemIndex: itemIndex,
                    color: batchContext.color,
                    colorIndex: batchContext.colorIndex,
                    isQueueFront: number < 0,
                    queuedAt: Date.now()
                };

                batchContext.prompts.push(pid);
                batchRegistry.set(pid, batchInfo);
                saveStorage();
                syncBatchToServer(pid, batchInfo);

                // If this batch completed its expected prompt count, clear context
                if (activeBatchContext === batchContext &&
                    batchContext.nextItemIndex >= batchContext.batchCount &&
                    batchContext.inFlight === 0) {
                    activeBatchContext = null;
                }

                scheduleBatchVisualRefresh(600);
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
        loadBatchFromServer().then(() => scheduleBatchVisualRefresh(1200));

        // Listen for queue changes
        if (api && api.addEventListener) {
            const refreshAfterQueueEvent = () => scheduleBatchVisualRefresh();
            api.addEventListener("status", refreshAfterQueueEvent);
            api.addEventListener("execution_start", refreshAfterQueueEvent);
            api.addEventListener("executing", refreshAfterQueueEvent);
            api.addEventListener("execution_success", refreshAfterQueueEvent);
            api.addEventListener("execution_error", refreshAfterQueueEvent);
            api.addEventListener("execution_interrupted", refreshAfterQueueEvent);
        }

        // Set up MutationObserver on body to detect queue sidebar rendering.
        // `attributes` is essential: Vue reuses a running card and only updates
        // its data-job-id when the next batch item starts. Without watching that
        // attribute, the old batch line can remain painted on the reused card.
        // `addedNodes` is inspected because a legacy .comfy-table can be
        // inserted with its rows already built, producing no later mutation
        // inside the table.
        const QUEUE_MUTATION_SELECTOR =
            '[data-testid="job-assets-list"], .comfy-table, [data-job-id]';
        const mutationTouchesQueue = (m) => {
            if (m.target && m.target.nodeType === 1) {
                if (m.target.closest?.(QUEUE_MUTATION_SELECTOR) ||
                    m.target.matches?.(QUEUE_MUTATION_SELECTOR)) {
                    return true;
                }
            }
            for (const node of m.addedNodes || []) {
                if (node.nodeType !== 1) continue;
                if (node.matches?.(QUEUE_MUTATION_SELECTOR) ||
                    node.querySelector?.(QUEUE_MUTATION_SELECTOR)) {
                    return true;
                }
            }
            return false;
        };

        let debounceTimer = null;
        const observer = new MutationObserver((mutations) => {
            let shouldUpdate = false;
            for (const m of mutations) {
                if (mutationTouchesQueue(m)) {
                    shouldUpdate = true;
                    break;
                }
            }
            if (shouldUpdate) {
                clearTimeout(debounceTimer);
                debounceTimer = setTimeout(updateQueueBatchVisuals, 60);
            }
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ["data-job-id"],
        });

        // Initial checks after load, including the async /jobs hydration.
        scheduleBatchVisualRefresh(2500);
    }
});

export { BATCH_COLORS, buildSvgPath };

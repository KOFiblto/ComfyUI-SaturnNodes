/**
 * Helpers for DOM widgets whose elements can be unmounted and rebuilt by the
 * ComfyUI Vue node renderer or LiteGraph. A cached element reference then
 * points at a detached subtree, so writes silently update an invisible node.
 */

export function isLiveElement(el) {
    return !!el && (typeof el.isConnected !== "boolean" || el.isConnected);
}

/**
 * Return the cached element while it is still live. When it is detached, try
 * to find the element the renderer remounted for the same node/widget.
 *
 * Before the first mount there is no replacement yet, so the cached reference
 * is returned to preserve initial-value writes.
 */
export function resolveLiveElement(cachedEl, findFresh) {
    if (isLiveElement(cachedEl)) return cachedEl;
    if (typeof findFresh === "function") {
        try {
            const fresh = findFresh();
            if (fresh) return fresh;
        } catch (_) {}
    }
    return cachedEl || null;
}

/**
 * Re-resolve a node DOM widget by its `data-widget-name` marker.
 * Used by the prompt counter and LoRA count badges.
 */
export function resolveLiveWidgetElement(cachedEl, nodeId, widgetName) {
    return resolveLiveElement(cachedEl, () => {
        if (nodeId === undefined || nodeId === null) return null;
        const id = String(nodeId);
        return document.querySelector(
            `[data-node-id="${id}"] [data-widget-name="${widgetName}"], ` +
            `[data-widgets-grid-node-id="${id}"] [data-widget-name="${widgetName}"]`
        );
    });
}

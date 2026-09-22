import { api } from "/scripts/api.js";

let _cachedCsrfToken = null;
let _tokenPromise = null;

export async function getCsrfToken() {
    if (_cachedCsrfToken) {
        return _cachedCsrfToken;
    }
    if (_tokenPromise) {
        return _tokenPromise;
    }
    _tokenPromise = (async () => {
        try {
            let resp = await api.fetchApi("/saturnnodes/auth/token");
            if (!resp.ok) {
                resp = await api.fetchApi("/leafflow/auth/token");
            }
            if (resp.ok) {
                const data = await resp.json();
                _cachedCsrfToken = data.csrf_token || "";
                return _cachedCsrfToken;
            }
        } catch (e) {
            console.warn("[SaturnNodes Auth] Could not fetch CSRF token:", e);
        } finally {
            _tokenPromise = null;
        }
        return "";
    })();
    return _tokenPromise;
}

export async function authenticatedFetch(endpoint, options = {}) {
    const token = await getCsrfToken();
    const opts = { ...options };
    opts.headers = { ...(opts.headers || {}) };
    if (token) {
        opts.headers["X-SaturnNodes-CSRF-Token"] = token;
        opts.headers["X-LeafFlow-CSRF-Token"] = token;
    }
    return api.fetchApi(endpoint, opts);
}

// Expose on window for all SaturnNodes extensions (with LeafFlow alias for backward compatibility)
if (typeof window !== "undefined") {
    const authObj = {
        getToken: getCsrfToken,
        fetch: authenticatedFetch
    };
    window._SaturnNodesAuth = authObj;
    window._LeafFlowAuth = authObj;
}


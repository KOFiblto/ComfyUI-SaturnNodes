// Minimal DOM used by the standalone frontend regression tests.
// It implements only the APIs the SaturnNodes extensions touch.

function splitTopLevel(selector, delimiter = ",") {
    const parts = [];
    let depth = 0;
    let quote = null;
    let current = "";
    for (const ch of String(selector)) {
        if (quote) {
            current += ch;
            if (ch === quote) quote = null;
            continue;
        }
        if (ch === '"' || ch === "'") {
            quote = ch;
            current += ch;
            continue;
        }
        if (ch === "[" || ch === "(") depth++;
        if (ch === "]" || ch === ")") depth--;
        if (ch === delimiter && depth === 0) {
            parts.push(current.trim());
            current = "";
            continue;
        }
        current += ch;
    }
    if (current.trim()) parts.push(current.trim());
    return parts.filter(Boolean);
}

function parseAttributeTest(raw) {
    const match = raw.match(
        /^\[\s*([\w-]+)\s*(?:([*^$~|]?=)\s*(?:"([^"]*)"|'([^']*)'|([^\]\s]+))\s*)?(?:([iIsS]))?\s*\]$/
    );
    if (!match) return null;
    return {
        name: match[1],
        operator: match[2] || null,
        value: match[3] ?? match[4] ?? match[5] ?? "",
        insensitive: (match[6] || "").toLowerCase() === "i",
    };
}

function matchAttribute(el, test) {
    if (!el.hasAttribute(test.name)) return false;
    if (!test.operator) return true;
    let actual = String(el.getAttribute(test.name));
    let expected = test.value;
    if (test.insensitive) {
        actual = actual.toLowerCase();
        expected = expected.toLowerCase();
    }
    switch (test.operator) {
        case "=": return actual === expected;
        case "*=": return actual.includes(expected);
        case "^=": return actual.startsWith(expected);
        case "$=": return actual.endsWith(expected);
        case "~=": return actual.split(/\s+/).includes(expected);
        case "|=": return actual === expected || actual.startsWith(`${expected}-`);
        default: return false;
    }
}

function matchCompound(el, compound) {
    if (!el || el.nodeType !== 1) return false;
    let rest = compound.trim();
    if (!rest) return false;

    const tagMatch = rest.match(/^([a-zA-Z][\w-]*|\*)/);
    if (tagMatch) {
        const tag = tagMatch[1];
        if (tag !== "*" && el.tagName !== tag.toUpperCase()) return false;
        rest = rest.slice(tag.length);
    }

    while (rest.length) {
        if (rest.startsWith("#")) {
            const m = rest.match(/^#([\w-]+)/);
            if (!m) return false;
            if (el.id !== m[1]) return false;
            rest = rest.slice(m[0].length);
            continue;
        }
        if (rest.startsWith(".")) {
            const m = rest.match(/^\.([\w-]+)/);
            if (!m) return false;
            if (!el.classList.contains(m[1])) return false;
            rest = rest.slice(m[0].length);
            continue;
        }
        if (rest.startsWith("[")) {
            let depth = 0;
            let end = -1;
            for (let i = 0; i < rest.length; i++) {
                if (rest[i] === "[") depth++;
                if (rest[i] === "]") {
                    depth--;
                    if (depth === 0) { end = i; break; }
                }
            }
            if (end < 0) return false;
            const test = parseAttributeTest(rest.slice(0, end + 1));
            if (!test || !matchAttribute(el, test)) return false;
            rest = rest.slice(end + 1);
            continue;
        }
        if (rest.startsWith(":")) {
            const m = rest.match(/^:([\w-]+)(?:\([^)]*\))?/);
            if (!m) return false;
            // :hover / :focus are never true in these tests. Other pseudos are
            // treated as non-restrictive so simple selectors still work.
            if (m[1] === "hover" || m[1] === "focus" || m[1] === "focus-visible") return false;
            rest = rest.slice(m[0].length);
            continue;
        }
        // Unsupported combinator (e.g. ">") - stop rather than mis-match.
        break;
    }
    return true;
}

function matchChain(el, tokens, index) {
    if (!matchCompound(el, tokens[index])) return false;
    if (index === 0) return true;
    let ancestor = el.parentElement;
    while (ancestor) {
        if (matchChain(ancestor, tokens, index - 1)) return true;
        ancestor = ancestor.parentElement;
    }
    return false;
}

export function matchesSelector(el, selector) {
    if (!el || el.nodeType !== 1) return false;
    return splitTopLevel(selector).some(part => {
        const tokens = part.trim().split(/\s+/).filter(Boolean);
        if (!tokens.length) return false;
        return matchChain(el, tokens, tokens.length - 1);
    });
}

function makeStyle() {
    const props = new Map();
    const style = {
        setProperty(name, value) {
            props.set(String(name), String(value));
            const camel = String(name).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
            style[camel] = String(value);
        },
        removeProperty(name) {
            props.delete(String(name));
            const camel = String(name).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
            delete style[camel];
        },
        getPropertyValue(name) {
            return props.get(String(name)) || "";
        },
        cssText: "",
    };
    return style;
}

export class FakeElement {
    constructor(tagName, doc = null) {
        this.tagName = String(tagName || "div").toUpperCase();
        this.nodeType = 1;
        this.ownerDocument = doc;
        this.attributes = new Map();
        this.children = [];
        this.parentNode = null;
        this._classes = new Set();
        this._listeners = new Map();
        this._rect = { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 };
        this._isRoot = false;
        this._innerHTML = "";
        this._text = "";
        this.dataset = {};
        this.style = makeStyle();
        this.id = "";
        this.value = "";
        this.offsetParent = null;
        this.offsetHeight = 0;
        this.offsetWidth = 0;
        this.scrollTop = 0;
        this.scrollHeight = 0;
        this.clientHeight = 0;
        this.disabled = false;
        this.type = "";
        this.title = "";
        this.src = "";
        this.checked = false;
    }

    get className() {
        return Array.from(this._classes).join(" ");
    }

    set className(value) {
        this._classes = new Set(String(value || "").split(/\s+/).filter(Boolean));
    }

    get classList() {
        const el = this;
        return {
            add(...names) { names.forEach(n => n && el._classes.add(String(n))); },
            remove(...names) { names.forEach(n => el._classes.delete(String(n))); },
            contains(name) { return el._classes.has(String(name)); },
            toggle(name, force) {
                const has = el._classes.has(String(name));
                const next = force === undefined ? !has : !!force;
                if (next) el._classes.add(String(name));
                else el._classes.delete(String(name));
                return next;
            },
        };
    }

    get isConnected() {
        let node = this;
        while (node) {
            if (node._isRoot) return true;
            node = node.parentNode;
        }
        return false;
    }

    get parentElement() {
        return this.parentNode && this.parentNode.nodeType === 1 ? this.parentNode : null;
    }

    get innerHTML() {
        return this._innerHTML;
    }

    set innerHTML(value) {
        this._innerHTML = String(value ?? "");
        this.children.forEach(child => { child.parentNode = null; });
        this.children = [];
    }

    get textContent() {
        return this._text;
    }

    set textContent(value) {
        this._text = String(value ?? "");
    }

    getBoundingClientRect() {
        return { ...this._rect };
    }

    setRect(rect) {
        this._rect = { ...this._rect, ...rect };
        this.offsetHeight = this._rect.height;
        this.offsetWidth = this._rect.width;
        return this;
    }

    setAttribute(name, value) {
        const key = String(name);
        const stringValue = String(value);
        this.attributes.set(key, stringValue);
        if (key === "id") this.id = stringValue;
        if (key === "class") this.className = stringValue;
        if (key === "value") this.value = stringValue;
        if (key === "src") this.src = stringValue;
        if (key.startsWith("data-")) {
            const camel = key.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
            this.dataset[camel] = stringValue;
        }
    }

    getAttribute(name) {
        const key = String(name);
        if (key === "class") return this.className || null;
        if (key === "id") return this.id || null;
        return this.attributes.has(key) ? this.attributes.get(key) : null;
    }

    hasAttribute(name) {
        const key = String(name);
        if (key === "class") return this._classes.size > 0;
        if (key === "id") return !!this.id;
        return this.attributes.has(key);
    }

    removeAttribute(name) {
        const key = String(name);
        this.attributes.delete(key);
        if (key === "id") this.id = "";
        if (key === "class") this.className = "";
    }

    appendChild(child) {
        if (!child) return child;
        if (child.parentNode) child.parentNode.removeChild(child);
        child.parentNode = this;
        this.children.push(child);
        return child;
    }

    insertBefore(child, reference) {
        if (!child) return child;
        if (child.parentNode) child.parentNode.removeChild(child);
        const index = reference ? this.children.indexOf(reference) : -1;
        child.parentNode = this;
        if (index < 0) this.children.push(child);
        else this.children.splice(index, 0, child);
        return child;
    }

    removeChild(child) {
        const index = this.children.indexOf(child);
        if (index >= 0) this.children.splice(index, 1);
        child.parentNode = null;
        return child;
    }

    remove() {
        if (this.parentNode) this.parentNode.removeChild(this);
    }

    contains(node) {
        let current = node;
        while (current) {
            if (current === this) return true;
            current = current.parentNode;
        }
        return false;
    }

    matches(selector) {
        return matchesSelector(this, selector);
    }

    closest(selector) {
        let node = this;
        while (node && node.nodeType === 1) {
            if (matchesSelector(node, selector)) return node;
            node = node.parentNode;
        }
        return null;
    }

    querySelectorAll(selector) {
        const found = [];
        const walk = node => {
            for (const child of node.children) {
                if (matchesSelector(child, selector)) found.push(child);
                walk(child);
            }
        };
        walk(this);
        return found;
    }

    querySelector(selector) {
        return this.querySelectorAll(selector)[0] || null;
    }

    addEventListener(type, callback) {
        const key = String(type);
        if (!this._listeners.has(key)) this._listeners.set(key, []);
        this._listeners.get(key).push(callback);
    }

    removeEventListener(type, callback) {
        const key = String(type);
        const list = this._listeners.get(key);
        if (!list) return;
        const index = list.indexOf(callback);
        if (index >= 0) list.splice(index, 1);
    }

    dispatchEvent(event) {
        const type = event?.type;
        const list = this._listeners.get(type) || [];
        if (!event.target) event.target = this;
        for (const callback of [...list]) {
            callback.call(this, event);
        }
        const handler = this[`on${type}`];
        if (typeof handler === "function") handler.call(this, event);
        return !event.defaultPrevented;
    }

    focus() {}
    select() {}
    blur() {}
    click() { this.dispatchEvent({ type: "click", preventDefault() {}, stopPropagation() {} }); }
    setPointerCapture() {}
    releasePointerCapture() {}
    scrollIntoView() {}
}

export function createDocument() {
    const doc = {
        nodeType: 9,
        readyState: "complete",
        _listeners: new Map(),
    };
    doc.body = new FakeElement("body", doc);
    doc.body._isRoot = true;
    doc.head = new FakeElement("head", doc);
    doc.head._isRoot = true;
    doc.documentElement = new FakeElement("html", doc);
    doc.documentElement._isRoot = true;
    doc.documentElement.appendChild(doc.head);
    doc.documentElement.appendChild(doc.body);

    doc.createElement = tag => new FakeElement(tag, doc);
    doc.createTextNode = text => ({ nodeType: 3, textContent: String(text), parentNode: null });

    doc.getElementById = id => {
        const search = node => {
            if (node.id === id) return node;
            for (const child of node.children) {
                const found = search(child);
                if (found) return found;
            }
            return null;
        };
        return search(doc.documentElement);
    };

    doc.querySelectorAll = selector => doc.documentElement.querySelectorAll(selector);
    doc.querySelector = selector => doc.documentElement.querySelector(selector);

    doc.addEventListener = (type, callback) => {
        const key = String(type);
        if (!doc._listeners.has(key)) doc._listeners.set(key, []);
        doc._listeners.get(key).push(callback);
    };
    doc.removeEventListener = (type, callback) => {
        const list = doc._listeners.get(String(type));
        if (!list) return;
        const index = list.indexOf(callback);
        if (index >= 0) list.splice(index, 1);
    };
    doc.dispatchEvent = event => {
        if (!event.target) event.target = doc.body;
        for (const callback of [...(doc._listeners.get(event.type) || [])]) {
            callback.call(doc, event);
        }
        return !event.defaultPrevented;
    };
    doc.listenerCount = type => (doc._listeners.get(String(type)) || []).length;

    doc.execCommand = () => true;
    doc.activeElement = doc.body;

    return doc;
}

export function createWindow(doc, overrides = {}) {
    const win = {
        innerWidth: 1280,
        innerHeight: 900,
        screen: { width: 1920, height: 1080 },
        isSecureContext: false,
        location: { origin: "http://localhost", reload() {} },
        _listeners: new Map(),
        addEventListener(type, callback) {
            const key = String(type);
            if (!win._listeners.has(key)) win._listeners.set(key, []);
            win._listeners.get(key).push(callback);
        },
        removeEventListener(type, callback) {
            const list = win._listeners.get(String(type));
            if (!list) return;
            const index = list.indexOf(callback);
            if (index >= 0) list.splice(index, 1);
        },
        dispatchEvent(event) {
            for (const callback of [...(win._listeners.get(event.type) || [])]) {
                callback.call(win, event);
            }
            return !event.defaultPrevented;
        },
        getComputedStyle(el) {
            return {
                display: el?.style?.display || "block",
                visibility: el?.style?.visibility || "visible",
            };
        },
        requestAnimationFrame(callback) {
            return setTimeout(() => callback(Date.now()), 0);
        },
        cancelAnimationFrame(id) {
            clearTimeout(id);
        },
        listenerCount(type) {
            return (win._listeners.get(String(type)) || []).length;
        },
        ...overrides,
    };
    return win;
}

export class FakeMutationObserver {
    constructor(callback) {
        this.callback = callback;
        this.target = null;
        this.options = null;
        this.disconnected = false;
        FakeMutationObserver.instances.push(this);
    }

    observe(target, options) {
        this.target = target;
        this.options = options;
    }

    disconnect() {
        this.disconnected = true;
    }

    takeRecords() {
        return [];
    }

    emit(records) {
        this.callback(records, this);
    }
}
FakeMutationObserver.instances = [];

export function sleep(ms = 15) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

export function stripImports(source) {
    return source
        .replace(/^import .*$/gm, "")
        .replace(/export \{[^}]*\};?\s*$/m, "");
}

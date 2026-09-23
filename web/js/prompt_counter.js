import { app } from "/scripts/app.js";

function countPromptsInText(text, separator, customRegex) {
    if (!text || !text.trim()) return 0;
    const cleanText = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const sep = (separator || ">1 Empty Line").toLowerCase();

    if (sep.includes("regex")) {
        const patStr = (customRegex || "").trim() || "\\n\\s*\\n+";
        try {
            const re = new RegExp(patStr, "g");
            const rawBlocks = cleanText.split(re);
            let count = 0;
            for (const b of rawBlocks) {
                const s = b.trim();
                if (s) {
                    try {
                        if (!new RegExp(`^(?:${patStr})$`).test(b)) {
                            count++;
                        }
                    } catch (_) {
                        count++;
                    }
                }
            }
            return count;
        } catch (e) {
            // Fallback on invalid regex
            const rawBlocks = cleanText.split(/\n\s*\n+/);
            return rawBlocks.filter(b => b.trim()).length;
        }
    } else if (sep.includes("newline")) {
        return cleanText.split('\n').filter(line => line.trim()).length;
    } else if (sep.includes(">2") || sep.includes("2 empty")) {
        return cleanText.split(/(?:\n\s*){3,}/).filter(b => b.trim()).length;
    } else { // >1 Empty Line / >1 Emptyline
        return cleanText.split(/\n\s*\n+/).filter(b => b.trim()).length;
    }
}

app.registerExtension({
    name: "ComfyUI.LeafFlow.PromptCounter",
    async nodeCreated(node) {
        if (node.comfyClass === "PromptCounter") {
            const textWidget = node.widgets?.find(w => w.name === "text");
            const sepWidget = node.widgets?.find(w => w.name === "separator");
            const regexWidget = node.widgets?.find(w => w.name === "custom_regex");

            // Live Prompt Count preview widget matching ResolutionSelector styling
            let countWidget = node.widgets?.find(w => w.name === "prompt_count_preview" || w._isPromptCount);
            let badgeSpan = node._promptBadgeSpan;
            if (!countWidget) {
                const badgeEl = document.createElement("div");
                badgeEl.className = "not-disabled:bg-component-node-widget-background not-disabled:text-component-node-foreground [[readonly]]:bg-component-node-widget-background-disabled border-none rounded-md flex w-full items-center justify-center gap-2 px-2 h-6 col-span-2";
                badgeEl.setAttribute("data-widget-name", "prompt_count_preview");
                badgeEl.setAttribute("node-type", "PromptCounter");
                badgeEl.style.cssText = "display: flex; align-items: center; justify-content: center; gap: 6px; padding: 0 8px; height: 24px; min-height: 24px; border-radius: 6px; background: var(--component-node-widget-background, rgba(255, 255, 255, 0.06)); color: var(--component-node-foreground, #e4e4e7); font-size: 12px; font-weight: 500; width: 100%; box-sizing: border-box; user-select: none;";

                badgeSpan = document.createElement("span");
                badgeSpan.className = "text-xs";
                badgeSpan.style.cssText = "font-weight: 600; color: #f59e0b;";
                badgeSpan.textContent = "0 Prompts";
                badgeEl.appendChild(badgeSpan);
                node._promptBadgeSpan = badgeSpan;

                countWidget = node.addDOMWidget("prompt_count_preview", "preview", badgeEl, {
                    serialize: false,
                    getValue() { return badgeSpan.textContent; },
                    setValue(v) { badgeSpan.textContent = v; }
                });
                countWidget._isPromptCount = true;
                countWidget.computeSize = function() {
                    return [node.size[0] - 20, 24];
                };
            }

            function updateCount() {
                const text = (textWidget?.inputEl ? textWidget.inputEl.value : textWidget?.value) || "";
                const sep = sepWidget?.value || ">1 Empty Line";
                const regex = regexWidget?.value || "";
                const count = countPromptsInText(text, sep, regex);
                node._promptCount = count;
                const label = `${count} Prompt${count === 1 ? "" : "s"}`;
                if (node._promptBadgeSpan) {
                    node._promptBadgeSpan.textContent = label;
                }
                if (countWidget) {
                    countWidget.value = label;
                }

                // Manage custom_regex enable/disable
                if (regexWidget) {
                    const isCustom = String(sep || "").toLowerCase().includes("regex");
                    regexWidget.disabled = !isCustom;
                    if (regexWidget.inputEl) {
                        regexWidget.inputEl.disabled = !isCustom;
                        regexWidget.inputEl.style.opacity = isCustom ? "1" : "0.4";
                        regexWidget.inputEl.style.pointerEvents = isCustom ? "auto" : "none";
                    }
                    if (regexWidget.options) {
                        regexWidget.options.disabled = !isCustom;
                    }
                }

                app.graph?.setDirtyCanvas(true, true);
            }

            // Hook DOM input listener on text textarea
            function hookInputEl() {
                if (textWidget?.inputEl && !textWidget.inputEl._promptCounterHooked) {
                    textWidget.inputEl._promptCounterHooked = true;
                    textWidget.inputEl.addEventListener("input", () => {
                        textWidget.value = textWidget.inputEl.value;
                        updateCount();
                    });
                    textWidget.inputEl.addEventListener("paste", () => {
                        setTimeout(() => {
                            textWidget.value = textWidget.inputEl.value;
                            updateCount();
                        }, 20);
                    });
                }
            }

            if (textWidget) {
                const origTextCb = textWidget.callback;
                textWidget.callback = function(val) {
                    if (origTextCb) origTextCb.apply(this, arguments);
                    updateCount();
                };
            }

            if (sepWidget) {
                const origSepCb = sepWidget.callback;
                sepWidget.callback = function(val) {
                    if (origSepCb) origSepCb.apply(this, arguments);
                    updateCount();
                };
            }

            if (regexWidget) {
                const origRegexCb = regexWidget.callback;
                regexWidget.callback = function(val) {
                    if (origRegexCb) origRegexCb.apply(this, arguments);
                    updateCount();
                };

                const origMouse = regexWidget.mouse;
                regexWidget.mouse = function(event, pos, n) {
                    if (this.disabled) return false;
                    if (origMouse) return origMouse.apply(this, arguments);
                };

                const origDraw = regexWidget.draw;
                regexWidget.draw = function(ctx, n, widget_width, y, widget_height) {
                    if (this.disabled) {
                        ctx.save();
                        ctx.globalAlpha = 0.35;
                        if (origDraw) origDraw.apply(this, arguments);
                        ctx.restore();
                    } else {
                        if (origDraw) origDraw.apply(this, arguments);
                    }
                };
            }

            // Also draw title pill badge when node is collapsed
            const origOnDrawForeground = node.onDrawForeground;
            node.onDrawForeground = function(ctx) {
                hookInputEl();

                // If textWidget value changed without callback
                const currentVal = (textWidget?.inputEl ? textWidget.inputEl.value : textWidget?.value) || "";
                if (currentVal !== node._lastPromptVal) {
                    node._lastPromptVal = currentVal;
                    updateCount();
                }

                if (node.flags?.collapsed) {
                    const count = node._promptCount ?? 0;
                    const label = `${count} Prompt${count === 1 ? "" : "s"}`;
                    ctx.save();
                    ctx.font = "bold 11px Inter, system-ui, sans-serif";
                    const badgeText = label;
                    const tw = ctx.measureText(badgeText).width;
                    const bx = node.size[0] - tw - 16;
                    const by = -LiteGraph.NODE_TITLE_HEIGHT + 3;

                    ctx.fillStyle = count > 0 ? "rgba(180, 140, 95, 0.25)" : "rgba(255, 255, 255, 0.08)";
                    ctx.strokeStyle = count > 0 ? "rgba(180, 140, 95, 0.6)" : "rgba(255, 255, 255, 0.2)";
                    ctx.lineWidth = 1;
                    ctx.beginPath();
                    if (ctx.roundRect) {
                        ctx.roundRect(bx, by, tw + 10, 18, 4);
                    } else {
                        ctx.rect(bx, by, tw + 10, 18);
                    }
                    ctx.fill();
                    ctx.stroke();

                    ctx.fillStyle = count > 0 ? "#decbb2" : "#cbd5e1";
                    ctx.textAlign = "left";
                    ctx.textBaseline = "middle";
                    ctx.fillText(badgeText, bx + 5, by + 9);
                    ctx.restore();
                }

                if (origOnDrawForeground) origOnDrawForeground.apply(this, arguments);
            };

            const origOnConfigure = node.onConfigure;
            node.onConfigure = function() {
                if (origOnConfigure) origOnConfigure.apply(this, arguments);
                setTimeout(() => {
                    hookInputEl();
                    updateCount();
                }, 40);
            };

            setTimeout(() => {
                hookInputEl();
                updateCount();
            }, 20);
        }
    }
});

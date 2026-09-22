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

            // Add the live count display widget
            const countWidget = node.addWidget("text", "Prompts", "0 Prompts", () => {}, { serialize: false });
            countWidget.disabled = true;

            // Custom drawing for counter widget
            countWidget.computeSize = function(width) {
                return [width, 28];
            };

            countWidget.draw = function(ctx, n, widget_width, y, widget_height) {
                ctx.save();
                const count = n._promptCount ?? 0;
                const label = `${count} Prompt${count === 1 ? "" : "s"}`;

                const margin = 8;
                const badgeX = margin;
                const badgeY = y + 2;
                const badgeW = widget_width - margin * 2;
                const badgeH = Math.max(24, widget_height - 4);
                const radius = 6;

                // Subtle dark background pill
                ctx.fillStyle = count > 0 ? "rgba(34, 197, 94, 0.15)" : "rgba(255, 255, 255, 0.05)";
                ctx.strokeStyle = count > 0 ? "rgba(34, 197, 94, 0.5)" : "rgba(255, 255, 255, 0.15)";
                ctx.lineWidth = 1;

                ctx.beginPath();
                if (ctx.roundRect) {
                    ctx.roundRect(badgeX, badgeY, badgeW, badgeH, radius);
                } else {
                    ctx.rect(badgeX, badgeY, badgeW, badgeH);
                }
                ctx.fill();
                ctx.stroke();

                // Text
                ctx.font = "bold 13px Inter, system-ui, sans-serif";
                ctx.textAlign = "center";
                ctx.textBaseline = "middle";
                ctx.fillStyle = count > 0 ? "#4ade80" : "#94a3b8";
                ctx.fillText(label, badgeX + badgeW / 2, badgeY + badgeH / 2);

                ctx.restore();
            };

            function updateCount() {
                const text = (textWidget?.inputEl ? textWidget.inputEl.value : textWidget?.value) || "";
                const sep = sepWidget?.value || ">1 Empty Line";
                const regex = regexWidget?.value || "";
                const count = countPromptsInText(text, sep, regex);
                node._promptCount = count;
                const label = `${count} Prompt${count === 1 ? "" : "s"}`;
                countWidget.value = label;

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

                    ctx.fillStyle = count > 0 ? "rgba(34, 197, 94, 0.2)" : "rgba(255, 255, 255, 0.08)";
                    ctx.strokeStyle = count > 0 ? "rgba(34, 197, 94, 0.6)" : "rgba(255, 255, 255, 0.2)";
                    ctx.lineWidth = 1;
                    ctx.beginPath();
                    if (ctx.roundRect) {
                        ctx.roundRect(bx, by, tw + 10, 18, 4);
                    } else {
                        ctx.rect(bx, by, tw + 10, 18);
                    }
                    ctx.fill();
                    ctx.stroke();

                    ctx.fillStyle = count > 0 ? "#4ade80" : "#cbd5e1";
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

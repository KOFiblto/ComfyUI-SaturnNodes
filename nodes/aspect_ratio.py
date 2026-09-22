import re
import math

class TextAspectRatioFinder:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "aspect_ratios": ("STRING", {
                    "default": "1:1, 2:3, 3:2, 3:4, 4:3, 9:16, 16:9, 21:9",
                    "multiline": False
                }),
                "search_mode": (["First match (Front)", "Last match (Back)"], {
                    "default": "First match (Front)"
                }),
                "target_mp": ("FLOAT", {
                    "default": 1.0,
                    "min": 0.1,
                    "max": 16.0,
                    "step": 0.1,
                    "display": "number"
                }),
                "default_aspect_ratio": ("STRING", {
                    "default": "1:1",
                    "multiline": False
                }),
                "multiple_of": ("INT", {
                    "default": 8,
                    "min": 8,
                    "max": 128,
                    "step": 4,
                    "advanced": True
                }),
                "min_mp": ("FLOAT", {
                    "default": 0.1,
                    "min": 0.01,
                    "max": 64.0,
                    "step": 0.1,
                    "display": "number",
                    "advanced": True
                }),
                "max_mp": ("FLOAT", {
                    "default": 16.0,
                    "min": 0.1,
                    "max": 64.0,
                    "step": 0.1,
                    "display": "number",
                    "advanced": True
                }),
            },
            "optional": {
                "text": ("STRING", {"forceInput": True}),
            },
            "hidden": {
                "unique_id": "UNIQUE_ID",
            }
        }

    RETURN_TYPES = ("INT", "INT", "STRING")
    RETURN_NAMES = ("width", "height", "aspect_ratio")
    FUNCTION = "find_aspect_ratio"
    CATEGORY = "🪐 SaturnNodes/Utils"
    DESCRIPTION = "Searches text for aspect ratios (e.g. 16:9), syntax checks them, and calculates width & height for target megapixels."

    def find_aspect_ratio(
        self,
        aspect_ratios="1:1, 2:3, 3:2, 3:4, 4:3, 9:16, 16:9, 21:9",
        search_mode="First match (Front)",
        target_mp=1.0,
        default_aspect_ratio="1:1",
        multiple_of=8,
        min_mp=0.1,
        max_mp=16.0,
        text=None,
        unique_id=None,
        **kwargs
    ):
        text_str = str(text) if text is not None else ""

        min_v = float(min_mp)
        max_v = max(min_v, float(max_mp))
        effective_mp = max(min_v, min(max_v, float(target_mp)))

        valid_ratios = []
        raw_items = [item.strip() for item in str(aspect_ratios or "").split(",") if item.strip()]
        
        for item in raw_items:
            match = re.match(r'^(\d+(?:\.\d+)?)\s*[:xX/]\s*(\d+(?:\.\d+)?)$', item)
            if match:
                w_val = float(match.group(1))
                h_val = float(match.group(2))
                if w_val > 0 and h_val > 0:
                    w_str = str(int(w_val)) if w_val.is_integer() else str(w_val)
                    h_str = str(int(h_val)) if h_val.is_integer() else str(h_val)
                    ratio_fmt = f"{w_str}:{h_str}"
                    if ratio_fmt not in valid_ratios:
                        valid_ratios.append(ratio_fmt)

        found_ratio = None
        matches = []
        
        if text_str:
            if valid_ratios:
                # 1. When allowed aspect_ratios are configured: ONLY match these exact ratios!
                for ratio in valid_ratios:
                    w_p, h_p = ratio.split(":")
                    pattern = r'(?<![\d.])' + re.escape(w_p) + r'\s*[:xX/]\s*' + re.escape(h_p) + r'(?!\d|\.\d)'
                    for m in re.finditer(pattern, text_str):
                        matches.append((m.start(), ratio))
            else:
                # 2. When aspect_ratios input is EMPTY: accept ANY valid aspect ratio found in the text
                gen_pattern = r'(?<![\d.])(\d+(?:\.\d+)?)\s*[:xX/]\s*(\d+(?:\.\d+)?)(?!\d|\.\d)'
                for m in re.finditer(gen_pattern, text_str):
                    try:
                        w_val = float(m.group(1))
                        h_val = float(m.group(2))
                        if w_val > 0 and h_val > 0:
                            w_str = str(int(w_val)) if w_val.is_integer() else str(w_val)
                            h_str = str(int(h_val)) if h_val.is_integer() else str(h_val)
                            ratio_fmt = f"{w_str}:{h_str}"
                            if not any(m_pos == m.start() for m_pos, _ in matches):
                                matches.append((m.start(), ratio_fmt))
                    except Exception:
                        pass

        if matches:
            matches.sort(key=lambda x: x[0])
            if search_mode in ["Back", "Last match (Back)"]:
                found_ratio = matches[-1][1]
            else:
                found_ratio = matches[0][1]
        else:
            found_ratio = default_aspect_ratio

        # Parse found_ratio and validate. If corrupted/invalid, fall back to "1:1"
        try:
            m_ratio = re.match(r'^(\d+(?:\.\d+)?)\s*[:xX/]\s*(\d+(?:\.\d+)?)$', str(found_ratio or "").strip())
            if m_ratio:
                w_part = float(m_ratio.group(1))
                h_part = float(m_ratio.group(2))
                if w_part <= 0 or h_part <= 0:
                    raise ValueError("Dimensions must be positive")
                w_str = str(int(w_part)) if w_part.is_integer() else str(w_part)
                h_str = str(int(h_part)) if h_part.is_integer() else str(h_part)
                found_ratio = f"{w_str}:{h_str}"
            else:
                raise ValueError(f"Cannot parse aspect ratio: {found_ratio}")
        except Exception as e:
            err_msg = f"Aspect ratio '{found_ratio}' is invalid. Falling back to '1:1'."
            print(f"[SaturnNodes] Warning: {err_msg} ({e})")
            try:
                from server import PromptServer
                if hasattr(PromptServer, "instance") and PromptServer.instance:
                    PromptServer.instance.send_sync("saturnnodes_node_error_state", {
                        "node_id": str(unique_id or ""),
                        "title": "Aspect Ratio Warning",
                        "message": err_msg,
                        "fallback": "1:1"
                    })
            except Exception:
                pass
            w_part, h_part = 1.0, 1.0
            found_ratio = "1:1"

        r = w_part / h_part

        total_pixels = effective_mp * 1024.0 * 1024.0
        
        raw_h = math.sqrt(total_pixels / r)
        raw_w = raw_h * r

        m = max(4, int(multiple_of))
        width = max(m, int(round(raw_w / m)) * m)
        height = max(m, int(round(raw_h / m)) * m)

        return (width, height, found_ratio)

from server import PromptServer

class PreviewImageSizeAspectRatio:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {},
            "optional": {
                "width": ("INT", {"default": 0, "min": 0, "max": 16384, "forceInput": True}),
                "height": ("INT", {"default": 0, "min": 0, "max": 16384, "forceInput": True}),
                "aspect_ratio": ("STRING", {"forceInput": True}),
                "ratio_float": ("FLOAT", {"default": 0.0, "min": 0.0, "max": 100.0, "step": 0.01, "forceInput": True}),
            },
            "hidden": {
                "unique_id": "UNIQUE_ID",
            }
        }

    RETURN_TYPES = ()
    RETURN_NAMES = ()
    FUNCTION = "process_preview"
    CATEGORY = "🪐 SaturnNodes/Utils"
    OUTPUT_NODE = True
    DESCRIPTION = "Visual preview node that displays image aspect ratio and dimension summary."

    def process_preview(
        self,
        width=None,
        height=None,
        aspect_ratio=None,
        ratio_float=None,
        unique_id="default"
    ):
        w_val = int(width) if width is not None and int(width) > 0 else 0
        h_val = int(height) if height is not None and int(height) > 0 else 0
        ar_str = str(aspect_ratio).strip() if aspect_ratio is not None else ""
        r_flt = float(ratio_float) if ratio_float is not None and float(ratio_float) > 0 else 0.0

        calc_ratio = 1.0
        display_text = "1 x 1"

        if w_val > 0 and h_val > 0:
            calc_ratio = w_val / h_val
            display_text = f"{w_val} x {h_val}"
        elif ar_str:
            match = re.match(r'^(\d+(?:\.\d+)?)\s*[:xX/]\s*(\d+(?:\.\d+)?)$', ar_str)
            if match:
                w_p = float(match.group(1))
                h_p = float(match.group(2))
                if w_p > 0 and h_p > 0:
                    calc_ratio = w_p / h_p
                    w_disp = int(w_p) if w_p.is_integer() else w_p
                    h_disp = int(h_p) if h_p.is_integer() else h_p
                    display_text = f"{w_disp} x {h_disp}"
            else:
                display_text = ar_str
        elif r_flt > 0:
            calc_ratio = r_flt
            if r_flt >= 1.0:
                w_disp = round(r_flt, 2)
                display_text = f"{w_disp} x 1"
            else:
                h_disp = round(1.0 / r_flt, 2)
                display_text = f"1 x {h_disp}"

        try:
            PromptServer.instance.send_sync("saturnnodes_update_preview_aspect_ratio", {
                "node_id": str(unique_id),
                "ratio": calc_ratio,
                "display_text": display_text
            })
        except Exception:
            pass

        return {}

# Alias for backward compatibility
AspectRatioFinder = TextAspectRatioFinder

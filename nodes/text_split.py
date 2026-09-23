import re

class SaturnTextSplit:
    """
    SaturnNodes Text Split Node:
    Splits input text into two parts (text1 and text2) by either a literal character sequence
    or a regular expression pattern, supporting forward (from start) and backward (from end) splitting.
    """
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "text": ("STRING", {"default": "", "multiline": True, "placeholder": "Text to split..."}),
                "split_by": ("STRING", {"default": "--", "multiline": False, "placeholder": "Character sequence or regex pattern"}),
            },
            "optional": {
                "use_regex": ("BOOLEAN", {"default": False, "tooltip": "Interpret 'split_by' as a Regular Expression instead of a literal string."}),
                "split_direction": (["forward (first occurrence from start)", "backward (last occurrence from end)"], {"default": "forward (first occurrence from start)", "advanced": True, "tooltip": "Choose whether to split on the first match from the beginning or the last match from the end."}),
                "strip_whitespace": ("BOOLEAN", {"default": False, "advanced": True, "tooltip": "Strip leading/trailing whitespace from the resulting text1 and text2."}),
            }
        }

    RETURN_TYPES = ("STRING", "STRING")
    RETURN_NAMES = ("text1", "text2")
    FUNCTION = "split_text"
    CATEGORY = "🪐 SaturnNodes/Utils"
    DESCRIPTION = "Splits input text into two parts (text1 and text2) by a character sequence or regex pattern, with forward/backward splitting."

    def split_text(
        self,
        text="",
        split_by="--",
        use_regex=False,
        split_direction="forward (first occurrence from start)",
        strip_whitespace=False
    ):
        input_text = str(text) if text is not None else ""
        delimiter = str(split_by) if split_by is not None else ""

        if not input_text or not delimiter:
            t1 = input_text.strip() if strip_whitespace else input_text
            return (t1, "")

        is_forward = "forward" in str(split_direction).lower()

        if use_regex:
            try:
                if is_forward:
                    match = re.search(delimiter, input_text)
                    if match:
                        start, end = match.span()
                        t1 = input_text[:start]
                        t2 = input_text[end:]
                    else:
                        t1, t2 = input_text, ""
                else:
                    # Backward: find all matches and take the last match
                    matches = list(re.finditer(delimiter, input_text))
                    if matches:
                        last_match = matches[-1]
                        start, end = last_match.span()
                        t1 = input_text[:start]
                        t2 = input_text[end:]
                    else:
                        t1, t2 = input_text, ""
            except Exception as e:
                print(f"[SaturnNodes Text Split] Regex error: {e}. Falling back to literal string split.")
                if is_forward:
                    parts = input_text.split(delimiter, 1)
                else:
                    parts = input_text.rsplit(delimiter, 1)
                t1 = parts[0]
                t2 = parts[1] if len(parts) > 1 else ""
        else:
            # Literal string sequence split
            if is_forward:
                parts = input_text.split(delimiter, 1)
            else:
                parts = input_text.rsplit(delimiter, 1)
            t1 = parts[0]
            t2 = parts[1] if len(parts) > 1 else ""

        if strip_whitespace:
            t1 = t1.strip()
            t2 = t2.strip()

        return (t1, t2)

LeafFlowTextSplit = SaturnTextSplit
SaturnTextSplit = SaturnTextSplit

import re
import csv
import io

def parse_find_targets(find_str):
    if not find_str or not find_str.strip():
        return []
    try:
        reader = csv.reader(io.StringIO(find_str.strip()), skipinitialspace=True)
        raw_items = []
        for row in reader:
            for item in row:
                s = item.strip()
                if (s.startswith('"') and s.endswith('"')) or (s.startswith("'") and s.endswith("'")):
                    s = s[1:-1].strip()
                if s:
                    raw_items.append(s)
        return raw_items
    except Exception:
        raw_items = []
        parts = find_str.split(',')
        for part in parts:
            item = part.strip()
            if (item.startswith('"') and item.endswith('"')) or (item.startswith("'") and item.endswith("'")):
                item = item[1:-1].strip()
            if item:
                raw_items.append(item)
        return raw_items

class MultiTextReplacer:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "find": ("STRING", {"default": "", "multiline": True}),
                "replace": ("STRING", {"default": "", "multiline": False}),
                "case_sensitive": ("BOOLEAN", {"default": False, "advanced": True}),
                "search_mode": (["Comma Separated List", "Regex Pattern"], {"default": "Comma Separated List", "advanced": True}),
            },
            "optional": {
                "text": ("STRING", {"default": "", "multiline": True, "forceInput": True}),
            }
        }

    RETURN_TYPES = ("STRING", "INT")
    RETURN_NAMES = ("text", "replaced_count")
    FUNCTION = "replace_text"
    CATEGORY = "🪐 SaturnNodes/Utils"
    DESCRIPTION = "Searches input text for multiple search targets specified in a comma-separated list or regex, and replaces all matches with a replacement string."

    def replace_text(
        self,
        find="",
        replace="",
        case_sensitive=False,
        search_mode="Comma Separated List",
        text=None
    ):
        input_text = str(text) if text is not None else ""
        if not input_text or not find:
            return (input_text, 0)

        flags = 0 if case_sensitive else re.IGNORECASE
        replaced_count = 0
        result_text = input_text

        if search_mode == "Comma Separated List":
            targets = parse_find_targets(find)
            if not targets:
                return (input_text, 0)

            # Sort targets by length descending so longer phrases match first
            targets.sort(key=len, reverse=True)

            # Build single unified regex pattern to guarantee 100% protection against recursive replacement loops
            escaped_targets = [re.escape(t) for t in targets]
            unified_pattern = "(?:" + "|".join(escaped_targets) + ")"

            # Count total matches
            replaced_count = len(re.findall(unified_pattern, result_text, flags=flags))
            # Perform single-pass substitution
            result_text = re.sub(unified_pattern, lambda m: replace, result_text, flags=flags)
        else: # Regex Pattern
            lines = [line.strip() for line in find.splitlines() if line.strip()]
            for pattern_str in lines:
                try:
                    count = len(re.findall(pattern_str, result_text, flags=flags))
                    replaced_count += count
                    result_text = re.sub(pattern_str, lambda m: replace, result_text, flags=flags)
                except Exception as e:
                    print(f"[SaturnNodes] 🍃 Invalid regex pattern '{pattern_str}': {e}")

        return (result_text, replaced_count)

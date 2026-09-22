from .prompt_iterator import parse_prompt_blocks

class PromptCounter:
    """
    LeafFlow Prompt Counter:
    Multiline text prompt input node with real-time prompt counting according to
    selectable separator ("Newline", ">1 Empty Line", ">2 Empty Lines", "Custom Regex").
    Outputs STRING (unmodified text) and count (integer count of prompts).
    """
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "text": ("STRING", {"default": "", "multiline": True, "placeholder": "Enter multiline prompts here..."}),
            },
            "optional": {
                "separator": ([
                    ">1 Empty Line",
                    "Newline",
                    ">2 Empty Lines",
                    "Custom Regex"
                ], {"default": ">1 Empty Line", "advanced": True}),
                "custom_regex": ("STRING", {"default": "", "advanced": True, "placeholder": "Custom regex delimiter (e.g. \\n---\\n)"}),
            }
        }

    RETURN_TYPES = ("STRING", "INT")
    RETURN_NAMES = ("STRING", "count")
    FUNCTION = "count_prompts"
    CATEGORY = "🪐 SaturnNodes/Utils"
    DESCRIPTION = "Multiline prompt text input with live prompt count display according to selectable separator or custom regex."

    def count_prompts(self, text="", separator=">1 Empty Line", custom_regex="", **kwargs):
        text_str = str(text) if text is not None else ""
        blocks = parse_prompt_blocks(text_str, separator, custom_regex)
        return (text_str, len(blocks))

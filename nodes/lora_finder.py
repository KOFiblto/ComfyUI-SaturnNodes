import os
import re
import folder_paths
import comfy.sd
from comfy.utils import load_torch_file
from .lora_loader import (
    get_filtered_loras_mapping,
    increment_lora_usage,
    LORA_CATEGORY,
    LORA_OUTPUT_FORMAT_CHOICES
)
from .utils import parse_pretty_name, format_lora_output_name

class TextLoraFinder:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "model": ("MODEL",),
                "clip": ("CLIP",),
                "folder": ("STRING", {"default": ""}),
                "search_for": ([
                    "Parsed Name",
                    "Filename",
                    "Filename without extension",
                    "Custom Regex"
                ], {"default": "Parsed Name"}),
                "custom_regex": ("STRING", {"default": "", "advanced": True}),
                "search_mode": (["First match (Front)", "Last match (Back)"], {"default": "First match (Front)"}),
                "find_amount": ("INT", {"default": 1, "min": 1, "max": 20, "step": 1}),
                "strength_model": ("FLOAT", {"default": 1.0, "min": -100.0, "max": 100.0, "step": 0.01}),
                "strength_clip": ("FLOAT", {"default": 1.0, "min": -100.0, "max": 100.0, "step": 0.01}),
                "output_format": (LORA_OUTPUT_FORMAT_CHOICES, {"default": "Filename", "advanced": True}),
            },
            "optional": {
                "text": ("STRING", {"forceInput": True}),
            }
        }

    RETURN_TYPES = ("MODEL", "CLIP", "STRING")
    RETURN_NAMES = ("MODEL", "CLIP", "loras")
    FUNCTION = "find_and_load_loras"
    CATEGORY = LORA_CATEGORY
    DESCRIPTION = "Scans input text for LoRA names, automatically loads matched LoRAs into Model/CLIP, and outputs the formatted list."

    def find_and_load_loras(
        self,
        model,
        clip,
        folder="",
        search_for="Parsed Name",
        custom_regex="",
        search_mode="First match (Front)",
        find_amount=1,
        strength_model=1.0,
        strength_clip=1.0,
        output_format="Filename",
        text=None,
        start_from=None,
        prompt=None,
        **kwargs
    ):
        active_mode = search_mode
        if start_from is not None and search_mode == "First match (Front)":
            if start_from == "Back":
                active_mode = "Last match (Back)"
            elif start_from == "Front":
                active_mode = "First match (Front)"

        input_text = text if text is not None else prompt
        text_str = str(input_text) if input_text is not None else ""
        if not text_str:
            return (model, clip, "")

        mapping = get_filtered_loras_mapping(folder, pretty=True)
        if not mapping:
            return (model, clip, "")

        matches = []
        seen_paths = set()

        if search_for == "Custom Regex":
            if custom_regex and custom_regex.strip():
                try:
                    pattern = re.compile(custom_regex, re.IGNORECASE)
                    for m in pattern.finditer(text_str):
                        matched_text = m.group(0).strip()
                        for display_name, sys_path in mapping.items():
                            if display_name in ["[ NONE ]", "[ RANDOM ]"] or not sys_path or sys_path == "[ NONE ]":
                                continue
                            if sys_path in seen_paths:
                                continue
                            
                            pretty_val = re.sub(r'\s+V\d+(\.\d+)?$', '', parse_pretty_name(sys_path), flags=re.IGNORECASE).strip()
                            fname = os.path.basename(sys_path)
                            fname_noext = os.path.splitext(fname)[0]
                            
                            if (matched_text.lower() in [pretty_val.lower(), fname.lower(), fname_noext.lower(), display_name.lower()]):
                                matches.append((m.start(), display_name, sys_path))
                                seen_paths.add(sys_path)
                except Exception as e:
                    print(f"[SaturnNodes] 🍃 Invalid custom regex pattern '{custom_regex}': {e}")
        else:
            for display_name, sys_path in mapping.items():
                if display_name in ["[ NONE ]", "[ RANDOM ]"] or not sys_path or sys_path == "[ NONE ]":
                    continue
                if sys_path in seen_paths:
                    continue

                if search_for in ["Pretty Name", "Parsed Name"]:
                    target_name = re.sub(r'\s+V\d+(\.\d+)?$', '', parse_pretty_name(sys_path), flags=re.IGNORECASE).strip()
                elif search_for == "Filename":
                    target_name = os.path.basename(sys_path)
                else: # Filename without extension
                    target_name = os.path.splitext(os.path.basename(sys_path))[0]

                if not target_name:
                    continue

                pattern = r'(?<!\w)' + re.escape(target_name) + r'(?!\w)'
                for m in re.finditer(pattern, text_str, flags=re.IGNORECASE):
                    matches.append((m.start(), display_name, sys_path))
                    seen_paths.add(sys_path)

        if not matches:
            return (model, clip, "")

        matches.sort(key=lambda x: x[0])

        num_to_take = max(1, int(find_amount))
        if active_mode in ["Back", "Last match (Back)"]:
            selected_matches = matches[-num_to_take:]
        else:
            selected_matches = matches[:num_to_take]

        current_model = model
        current_clip = clip
        formatted_names = []

        for start_idx, disp_name, sys_path in selected_matches:
            lora_path = folder_paths.get_full_path("loras", sys_path)
            if not lora_path or not os.path.exists(lora_path):
                continue

            if strength_model != 0 or strength_clip != 0:
                try:
                    lora_weights = load_torch_file(lora_path, safe_load=True)
                    current_model, current_clip = comfy.sd.load_lora_for_models(
                        current_model, current_clip, lora_weights, strength_model, strength_clip
                    )
                    increment_lora_usage(sys_path)
                except Exception as e:
                    print(f"[SaturnNodes] 🍃 Error loading LoRA '{sys_path}': {e}")
                    continue
            else:
                increment_lora_usage(sys_path)

            out_name = format_lora_output_name(sys_path, disp_name, output_format=output_format, custom_regex=custom_regex)
            if out_name:
                formatted_names.append(out_name)

        return (current_model, current_clip, ", ".join(formatted_names))

# Alias for backward compatibility
LoraTextFinder = TextLoraFinder

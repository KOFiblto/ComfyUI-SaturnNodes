import os
import torch
import numpy as np
from PIL import Image, ImageOps
import folder_paths
from .utils import sanitize_folder_path

LOADER_CATEGORY = "🪐 SaturnNodes/Loaders"

class LoadRecentOutputs:
    @classmethod
    def INPUT_TYPES(s):
        return {
            "required": {
                "output_folder": ("STRING", {"default": "output"}),
                "amount": ("INT", {"default": 5, "min": 1, "max": 100, "step": 1}),
                "index": ("INT", {
                    "default": 0, 
                    "min": 0, 
                    "max": 1000000, 
                    "step": 1,
                    "control_after_generate": "increment"
                }),
                "order": (["Newest First (0 = latest)", "Chronological (Oldest First)"], {
                    "default": "Newest First (0 = latest)",
                    "advanced": True
                }),
            }
        }

    RETURN_TYPES = ("IMAGE",)
    FUNCTION = "load_single_image"
    CATEGORY = LOADER_CATEGORY
    DESCRIPTION = "Cycles through recently generated output images.\n\nExplanation of Index:\n- 'amount' grabs the X newest images from the folder.\n- 'index' selects which of those X images to output (0 = newest image).\n- If index exceeds amount, it loops back around."

    def load_single_image(self, output_folder, amount, index, order="Newest First (0 = latest)", **kwargs):
        clean_input = (output_folder or "").strip()
        if clean_input == "output" or not clean_input:
            output_dir = folder_paths.get_output_directory()
        else:
            output_dir = sanitize_folder_path(clean_input, default_dir=folder_paths.get_output_directory())

        if not os.path.exists(output_dir):
            dummy = torch.zeros((1, 512, 512, 3), dtype=torch.float32)
            return (dummy,)

        valid_extensions = ('.png', '.jpg', '.jpeg', '.webp', '.bmp')
        file_list = []
        try:
            for root, dirs, files in os.walk(output_dir):
                for file in files:
                    if file.lower().endswith(valid_extensions):
                        path = os.path.join(root, file)
                        try:
                            mtime = os.path.getmtime(path)
                            file_list.append((path, mtime))
                        except OSError:
                            continue
        except Exception as e:
            print(f"[LeafFlow] 🍃 Error scanning output folder '{output_dir}': {e}")
            dummy = torch.zeros((1, 512, 512, 3), dtype=torch.float32)
            return (dummy,)

        if not file_list:
            dummy = torch.zeros((1, 512, 512, 3), dtype=torch.float32)
            return (dummy,)

        file_list.sort(key=lambda x: x[1], reverse=True)
        recent_files = file_list[:amount]
        if "oldest" in str(order).lower() or "chronological" in str(order).lower():
            recent_files.reverse()

        actual_index = index % len(recent_files)
        target_file, _ = recent_files[actual_index]

        try:
            img = Image.open(target_file)
            img = ImageOps.exif_transpose(img)
            image = img.convert("RGB")
            image = np.array(image).astype(np.float32) / 255.0
            image = torch.from_numpy(image).unsqueeze(0)
        except Exception as e:
            print(f"[LeafFlow] Error loading recent output image {target_file}: {e}")
            image = torch.zeros((1, 512, 512, 3), dtype=torch.float32)

        return (image,)

import os
import time
import torch
import numpy as np
import re
from PIL import Image, ImageOps
import comfy.model_management
from .utils import sanitize_folder_path

def get_current_prompt_id():
    try:
        from server import PromptServer
        server = PromptServer.instance
        if hasattr(server, "prompt_queue") and server.prompt_queue.currently_running:
            for item in server.prompt_queue.currently_running.values():
                if isinstance(item, (tuple, list)) and len(item) > 1:
                    return str(item[1])
    except Exception:
        pass
    return None

def is_file_ready(filepath):
    try:
        if not os.path.exists(filepath) or os.path.getsize(filepath) == 0:
            return False
        with open(filepath, "rb") as f:
            f.seek(0, os.SEEK_END)
        return True
    except (OSError, IOError, PermissionError):
        return False

_WATCHER_STATE = {}

class LoadImageFromFolder:
    @classmethod
    def INPUT_TYPES(s):
        return {
            "required": {
                "folder": ("STRING", {"default": "input/watch"}),
                "wait_if_folder_is_empty": ("BOOLEAN", {"default": True}),
                "rescan_interval": ("INT", {"default": 2, "min": 1, "max": 60}),
                "sort_by": (["date_modified", "date_created", "name"], {"default": "date_modified"}),
                "regex_filter": ("STRING", {"default": ".*"}),
                "delete_image": ("BOOLEAN", {"default": False, "tooltip": "If enabled, deletes the image file from disk after loading it. If disabled, cycles through all images in the folder sequentially."}),
            },
            "hidden": {
                "unique_id": "UNIQUE_ID",
            }
        }

    RETURN_TYPES = ("IMAGE", "BOOLEAN")
    RETURN_NAMES = ("image", "has_image")
    FUNCTION = "watch"
    CATEGORY = "🪐 SaturnNodes/Automation"
    DESCRIPTION = "Loads an image from a folder, optionally waiting if the folder is empty, with automatic sequential cycling when delete is False."

    @classmethod
    def IS_CHANGED(s, **kwargs):
        # Force re-execution to continuously check folder status
        return float("NaN")

    def create_dummy_image(self):
        # Returns a 512x512 standard 0-tensor for safe no-image state
        return torch.zeros((1, 512, 512, 3), dtype=torch.float32)

    def load_and_remove_image(self, filepath, delete_image=False):
        with Image.open(filepath) as img:
            i = ImageOps.exif_transpose(img)
            image_array = np.array(i.convert("RGB")).astype(np.float32) / 255.0
            img_tensor = torch.from_numpy(image_array)[None,]
        
        if delete_image:
            try:
                os.remove(filepath)
            except Exception as e:
                print(f"[LeafFlow] Warning: Failed to remove processed file '{filepath}': {e}")
            
        return img_tensor

    def get_filtered_files(self, folder, sort_by, regex_filter):
        valid_extensions = ('.png', '.jpg', '.jpeg', '.webp')
        try:
            regex = re.compile(regex_filter)
        except Exception as e:
            print(f"[LeafFlow] Invalid regex: {e}. Falling back to .*")
            regex = re.compile(".*")

        files = []
        for f in os.listdir(folder):
            filepath = os.path.join(folder, f)
            if os.path.isfile(filepath) and f.lower().endswith(valid_extensions):
                if regex.search(f) and is_file_ready(filepath):
                    files.append(filepath)

        if not files:
            return []

        valid_files = []
        for file in files:
            try:
                if sort_by == "date_modified":
                    val = os.path.getmtime(file)
                elif sort_by == "date_created":
                    val = os.path.getctime(file)
                else:
                    val = file
                valid_files.append((file, val))
            except OSError:
                continue

        if sort_by in ("date_modified", "date_created"):
            valid_files.sort(key=lambda x: x[1], reverse=True) # newest first
        elif sort_by == "name":
            valid_files.sort(key=lambda x: x[1]) # alphabetical
            
        return [x[0] for x in valid_files]

    def _select_file(self, files, delete_image, unique_id, folder):
        if not files:
            return None

        if delete_image:
            # When deleting on each run, always consume the first available file
            return files[0]

        # When keeping images (delete_image=False), cycle sequentially through all files!
        state_key = f"{unique_id}_{folder}"
        current_pid = get_current_prompt_id()
        
        node_state = _WATCHER_STATE.get(state_key, {"index": 0, "assigned": {}})
        assigned = node_state.get("assigned", {})
        current_idx = int(node_state.get("index", 0))

        if current_pid and current_pid in assigned:
            # Re-use exact index on persistent queue crash recovery
            idx = assigned[current_pid] % len(files)
        else:
            idx = current_idx % len(files)
            if current_pid:
                assigned[current_pid] = idx
                if len(assigned) > 50:
                    for k in list(assigned.keys())[:-50]:
                        del assigned[k]
            node_state["index"] = (current_idx + 1) % len(files)
            node_state["assigned"] = assigned
            _WATCHER_STATE[state_key] = node_state

        return files[idx]

    def watch(self, folder, wait_if_folder_is_empty, rescan_interval, sort_by, regex_filter, delete_image=False, unique_id="default", **kwargs):
        folder = sanitize_folder_path(folder, default_dir="input/watch")
        
        if wait_if_folder_is_empty:
            while True:
                comfy.model_management.throw_exception_if_processing_interrupted()

                if os.path.exists(folder) and os.path.isdir(folder):
                    try:
                        files = self.get_filtered_files(folder, sort_by, regex_filter)
                        if files:
                            filepath = self._select_file(files, delete_image, unique_id, folder)
                            if filepath:
                                try:
                                    img_tensor = self.load_and_remove_image(filepath, delete_image=delete_image)
                                    return (img_tensor, True)
                                except Exception as e:
                                    print(f"[LeafFlow] Error processing {filepath}: {e}")
                    except Exception as e:
                        print(f"[LeafFlow] Error accessing directory {folder}: {e}")

                time.sleep(rescan_interval)
        else:
            if os.path.exists(folder) and os.path.isdir(folder):
                try:
                    files = self.get_filtered_files(folder, sort_by, regex_filter)
                    if files:
                        filepath = self._select_file(files, delete_image, unique_id, folder)
                        if filepath:
                            try:
                                img_tensor = self.load_and_remove_image(filepath, delete_image=delete_image)
                                return (img_tensor, True)
                            except Exception as e:
                                print(f"[LeafFlow] Error processing {filepath}: {e}")
                except Exception as e:
                    print(f"[LeafFlow] Error accessing directory {folder}: {e}")

            # No image present or folder missing -> return standard dummy tensor & False immediately
            return (self.create_dummy_image(), False)

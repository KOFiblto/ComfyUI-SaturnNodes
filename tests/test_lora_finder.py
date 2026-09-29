import os
import sys
import unittest
from unittest.mock import patch, MagicMock

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import test_helper

from nodes.lora_finder import TextLoraFinder

class TestLoraFinder(unittest.TestCase):
    def setUp(self):
        self.finder = TextLoraFinder()

    def test_empty_or_none_text(self):
        model, clip, loras = self.finder.find_and_load_loras(
            model="MODEL_OBJ",
            clip="CLIP_OBJ",
            text=""
        )
        self.assertEqual(model, "MODEL_OBJ")
        self.assertEqual(clip, "CLIP_OBJ")
        self.assertEqual(loras, "")

        m2, c2, l2 = self.finder.find_and_load_loras(
            model="MODEL_OBJ",
            clip="CLIP_OBJ",
            text=None
        )
        self.assertEqual(l2, "")

    @patch("nodes.lora_finder.get_filtered_loras_mapping")
    @patch("nodes.lora_finder.folder_paths.get_full_path")
    @patch("nodes.lora_finder.os.path.exists")
    @patch("nodes.lora_finder.load_torch_file")
    @patch("nodes.lora_finder.comfy.sd.load_lora_for_models")
    def test_find_and_load_lora_match(self, mock_load_lora, mock_load_torch, mock_exists, mock_get_path, mock_mapping):
        mock_mapping.return_value = {
            "Cyberpunk Character": "characters/char_cyberpunk-character_v1.safetensors"
        }
        mock_get_path.return_value = "/models/loras/characters/char_cyberpunk-character_v1.safetensors"
        mock_exists.return_value = True
        mock_load_torch.return_value = {}
        mock_load_lora.return_value = ("PATCHED_MODEL", "PATCHED_CLIP")

        model, clip, loras = self.finder.find_and_load_loras(
            model="MODEL",
            clip="CLIP",
            text="A digital painting of a Cyberpunk Character at neon midnight",
            search_for="Parsed Name",
            output_format="Parsed Name"
        )
        self.assertEqual(model, "PATCHED_MODEL")
        self.assertEqual(clip, "PATCHED_CLIP")
        self.assertIn("Cyberpunk Character", loras)

if __name__ == "__main__":
    unittest.main()

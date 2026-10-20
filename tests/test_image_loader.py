import os
import sys
import json
import shutil
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import test_helper

from PIL import Image

from nodes.image_loader import trace_positive_prompt_from_graph, parse_positive_from_parameters
import nodes.image_loader as image_loader

class TestPromptExtraction(unittest.TestCase):
    def test_standard_ksampler_graph(self):
        graph = {
            "3": {
                "class_type": "KSampler",
                "inputs": {
                    "positive": ["6", 0],
                    "negative": ["7", 0],
                    "model": ["4", 0]
                }
            },
            "6": {
                "class_type": "CLIPTextEncode",
                "inputs": {
                    "text": "a majestic lion in the savanna at golden hour"
                }
            },
            "7": {
                "class_type": "CLIPTextEncode",
                "inputs": {
                    "text": "ugly, blurry, low quality"
                }
            }
        }
        res = trace_positive_prompt_from_graph(graph)
        self.assertEqual(res, "a majestic lion in the savanna at golden hour")

    def test_flux_guidance_graph(self):
        graph = {
            "1": {
                "class_type": "KSamplerSelect",
                "inputs": {}
            },
            "2": {
                "class_type": "SamplerCustomAdvanced",
                "inputs": {
                    "guider": ["3", 0]
                }
            },
            "3": {
                "class_type": "BasicGuider",
                "inputs": {
                    "conditioning": ["4", 0]
                }
            },
            "4": {
                "class_type": "FluxGuidance",
                "inputs": {
                    "guidance": 3.5,
                    "conditioning": ["5", 0]
                }
            },
            "5": {
                "class_type": "CLIPTextEncode",
                "inputs": {
                    "text": "a cyberpunk futuristic street in Tokyo, neon reflections"
                }
            }
        }
        res = trace_positive_prompt_from_graph(graph)
        self.assertEqual(res, "a cyberpunk futuristic street in Tokyo, neon reflections")

    def test_sdxl_text_g_and_text_l(self):
        graph = {
            "10": {
                "class_type": "KSampler",
                "inputs": {
                    "positive": ["20", 0],
                    "negative": ["21", 0]
                }
            },
            "20": {
                "class_type": "CLIPTextEncodeSDXL",
                "inputs": {
                    "text_g": "an astronaut riding a horse",
                    "text_l": "photorealistic, 8k resolution"
                }
            },
            "21": {
                "class_type": "CLIPTextEncodeSDXL",
                "inputs": {
                    "text_g": "blurry",
                    "text_l": "cartoon"
                }
            }
        }
        res = trace_positive_prompt_from_graph(graph)
        self.assertIn("an astronaut riding a horse", res)
        self.assertIn("photorealistic, 8k resolution", res)
        self.assertNotIn("blurry", res)

    def test_conditioning_combine(self):
        graph = {
            "1": {
                "class_type": "KSampler",
                "inputs": {
                    "positive": ["2", 0],
                    "negative": ["9", 0]
                }
            },
            "2": {
                "class_type": "ConditioningCombine",
                "inputs": {
                    "conditioning_1": ["3", 0],
                    "conditioning_2": ["4", 0]
                }
            },
            "3": {
                "class_type": "CLIPTextEncode",
                "inputs": {"text": "part 1 of positive prompt"}
            },
            "4": {
                "class_type": "CLIPTextEncode",
                "inputs": {"text": "part 2 of positive prompt"}
            }
        }
        res = trace_positive_prompt_from_graph(graph)
        self.assertIn("part 1 of positive prompt", res)
        self.assertIn("part 2 of positive prompt", res)

    def test_primitive_string_link(self):
        graph = {
            "1": {
                "class_type": "KSampler",
                "inputs": {
                    "positive": ["2", 0]
                }
            },
            "2": {
                "class_type": "CLIPTextEncode",
                "inputs": {
                    "text": ["3", 0]
                }
            },
            "3": {
                "class_type": "PrimitiveString",
                "inputs": {
                    "value": "string from primitive node"
                }
            }
        }
        res = trace_positive_prompt_from_graph(graph)
        self.assertEqual(res, "string from primitive node")

    def test_a1111_parameters_parsing(self):
        param_str = """A portrait of an ancient wizard with a glowing crystal staff
Negative prompt: ugly, deformed, bad anatomy
Steps: 30, Sampler: DPM++ 2M Karras, CFG scale: 7, Seed: 12345, Size: 512x768"""
        res = parse_positive_from_parameters(param_str)
        self.assertEqual(res, "A portrait of an ancient wizard with a glowing crystal staff")

class TestImageFolderScanning(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.mkdtemp()
        self.folder = os.path.join(self.temp_dir, "images")
        os.makedirs(self.folder)
        self.old_cache = image_loader.CACHE_FILE
        self.old_thumbs = image_loader.IMAGE_THUMBNAILS_DIR
        image_loader.CACHE_FILE = os.path.join(self.temp_dir, "prompts_cache.json")
        image_loader.IMAGE_THUMBNAILS_DIR = os.path.join(self.temp_dir, "thumbs")

    def tearDown(self):
        image_loader.CACHE_FILE = self.old_cache
        image_loader.IMAGE_THUMBNAILS_DIR = self.old_thumbs
        shutil.rmtree(self.temp_dir, ignore_errors=True)

    def _make_image(self, name, size=(32, 32), mtime=None):
        path = os.path.join(self.folder, name)
        Image.new("RGB", size, (120, 90, 60)).save(path)
        if mtime:
            os.utime(path, (mtime, mtime))
        return path

    def test_metadata_limit_and_cache_reuse(self):
        base = 1_600_000_000
        self._make_image("a.png", mtime=base)
        self._make_image("b.png", mtime=base + 10)
        self._make_image("c.png", mtime=base + 20)

        calls = []

        def fake_extract(path):
            calls.append(path)
            return (f"prompt-{os.path.basename(path)}", 32, 32)

        with patch("nodes.image_loader.extract_metadata_from_image", side_effect=fake_extract):
            names, mapping, prompts = image_loader.scan_image_folder(self.folder, metadata_limit=2)
            self.assertEqual(names, ["c.png", "b.png", "a.png"])
            self.assertEqual(mapping["a.png"], "a.png")
            self.assertEqual(len(calls), 2)
            self.assertEqual(prompts["c.png"], "prompt-c.png")
            self.assertEqual(prompts["b.png"], "prompt-b.png")
            self.assertEqual(prompts["a.png"], "")

            # Unchanged mtimes must be served from the disk cache.
            calls.clear()
            image_loader.scan_image_folder(self.folder, metadata_limit=2)
            self.assertEqual(calls, [])

        self.assertTrue(os.path.exists(image_loader.CACHE_FILE))

    def test_thumbnail_disk_cache_and_mtime_invalidation(self):
        path = self._make_image("large.png", size=(640, 480), mtime=1_600_000_000)
        first = image_loader.get_or_create_image_thumbnail(path, 1_600_000_000, 256)
        self.assertTrue(first.endswith(".webp"))
        self.assertTrue(os.path.exists(first))
        with Image.open(first) as thumb:
            self.assertLessEqual(max(thumb.size), 256)

        second = image_loader.get_or_create_image_thumbnail(path, 1_600_000_000, 256)
        self.assertEqual(first, second)

        third = image_loader.get_or_create_image_thumbnail(path, 1_600_000_100, 256)
        self.assertNotEqual(first, third)
        self.assertTrue(os.path.exists(third))

    def test_metadata_scan_limit_setting_is_bounded(self):
        with patch("nodes.image_loader.get_env_setting", return_value="42"):
            self.assertEqual(image_loader.get_image_metadata_scan_limit(), 42)
        with patch("nodes.image_loader.get_env_setting", return_value="oops"):
            self.assertEqual(image_loader.get_image_metadata_scan_limit(), 128)
        with patch("nodes.image_loader.get_env_setting", return_value="-5"):
            self.assertEqual(image_loader.get_image_metadata_scan_limit(), 0)
        with patch("nodes.image_loader.get_env_setting", return_value="99999"):
            self.assertEqual(image_loader.get_image_metadata_scan_limit(), 2000)


if __name__ == "__main__":
    unittest.main()

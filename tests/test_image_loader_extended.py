import json
import os
import shutil
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import test_helper  # noqa: F401

from PIL import Image, PngImagePlugin

import nodes.image_loader as image_loader
from nodes.image_loader import (
    decode_bytes_safely,
    parse_positive_from_parameters,
    scan_image_folder,
    trace_positive_prompt_from_graph,
)


class TestImageLoaderExtended(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.mkdtemp()
        self.cache_file = os.path.join(self.temp_dir, "image_prompts_cache.json")
        self.old_cache = image_loader.CACHE_FILE
        image_loader.CACHE_FILE = self.cache_file

    def tearDown(self):
        image_loader.CACHE_FILE = self.old_cache
        shutil.rmtree(self.temp_dir, ignore_errors=True)

    def _make_png(self, name, mtime, subfolder="", prompt_graph=None, parameters=None):
        folder = os.path.join(self.temp_dir, subfolder) if subfolder else self.temp_dir
        os.makedirs(folder, exist_ok=True)
        path = os.path.join(folder, name)
        info = PngImagePlugin.PngInfo()
        if prompt_graph is not None:
            info.add_text("prompt", json.dumps(prompt_graph))
        if parameters is not None:
            info.add_text("parameters", parameters)
        Image.new("RGB", (6, 6), (30, 40, 50)).save(path, pnginfo=info)
        os.utime(path, (mtime, mtime))
        return path

    def test_equal_mtimes_are_sorted_deterministically(self):
        base = 1_700_000_000
        self._make_png("b.png", base)
        self._make_png("a.png", base)
        self._make_png("c.png", base, subfolder="sub")
        self._make_png("a.png", base, subfolder="sub")

        names, mapping, prompts = scan_image_folder(self.temp_dir, metadata_limit=0)
        expected = ["a.png", "b.png", "sub/a.png", "sub/c.png"]
        self.assertEqual(names, expected)
        self.assertEqual(list(mapping), expected)
        self.assertEqual(list(prompts), expected)
        self.assertTrue(all(value == "" for value in prompts.values()))

    def test_newest_images_come_first_across_subfolders(self):
        base = 1_700_000_000
        self._make_png("old.png", base)
        self._make_png("new.png", base + 50, subfolder="nested")

        names, _, _ = scan_image_folder(self.temp_dir, metadata_limit=0)
        self.assertEqual(names, ["nested/new.png", "old.png"])

    def test_metadata_limit_zero_skips_extraction(self):
        self._make_png("one.png", 1_700_000_000)
        with patch("nodes.image_loader.extract_metadata_from_image") as extract:
            names, _, prompts = scan_image_folder(self.temp_dir, metadata_limit=0)
        extract.assert_not_called()
        self.assertEqual(names, ["one.png"])
        self.assertEqual(prompts, {"one.png": ""})

    def test_metadata_limit_only_reads_newest_entries(self):
        base = 1_700_000_000
        self._make_png("older.png", base)
        self._make_png("newer.png", base + 10)

        with patch(
            "nodes.image_loader.extract_metadata_from_image",
            side_effect=lambda path: ("prompt:" + os.path.basename(path), 6, 6),
        ) as extract:
            names, _, prompts = scan_image_folder(self.temp_dir, metadata_limit=1)

        self.assertEqual(names, ["newer.png", "older.png"])
        self.assertEqual(extract.call_count, 1)
        self.assertEqual(prompts["newer.png"], "prompt:newer.png")
        self.assertEqual(prompts["older.png"], "")

    def test_metadata_cache_is_reused_and_invalidated_by_mtime(self):
        path = self._make_png("cached.png", 1_700_000_000)
        with patch(
            "nodes.image_loader.extract_metadata_from_image",
            return_value=("cached prompt", 6, 6),
        ) as extract:
            scan_image_folder(self.temp_dir, metadata_limit=10)
            scan_image_folder(self.temp_dir, metadata_limit=10)
            self.assertEqual(extract.call_count, 1)

            os.utime(path, (1_700_000_100, 1_700_000_100))
            scan_image_folder(self.temp_dir, metadata_limit=10)
            self.assertEqual(extract.call_count, 2)

    def test_png_prompt_metadata_is_extracted(self):
        graph = {
            "1": {"class_type": "KSampler", "inputs": {"positive": ["2", 0], "negative": ["3", 0]}},
            "2": {"class_type": "CLIPTextEncode", "inputs": {"text": "a beautiful castle"}},
            "3": {"class_type": "CLIPTextEncode", "inputs": {"text": "ugly"}},
        }
        self._make_png("graph.png", 1_700_000_000, prompt_graph=graph)
        names, _, prompts = scan_image_folder(self.temp_dir, metadata_limit=10)
        self.assertEqual(names, ["graph.png"])
        self.assertEqual(prompts["graph.png"], "a beautiful castle")

    def test_corrupt_image_does_not_break_the_scan(self):
        path = os.path.join(self.temp_dir, "broken.png")
        with open(path, "wb") as handle:
            handle.write(b"not a png")
        os.utime(path, (1_700_000_000, 1_700_000_000))

        names, _, prompts = scan_image_folder(self.temp_dir, metadata_limit=10)
        self.assertEqual(names, ["broken.png"])
        self.assertEqual(prompts["broken.png"], "")

    def test_non_image_files_are_ignored(self):
        with open(os.path.join(self.temp_dir, "notes.txt"), "w", encoding="utf-8") as handle:
            handle.write("not an image")
        names, _, prompts = scan_image_folder(self.temp_dir, metadata_limit=10)
        self.assertEqual(names, [])
        self.assertEqual(prompts, {})

    def test_corrupt_cache_file_is_ignored_and_replaced(self):
        self._make_png("image.png", 1_700_000_000)
        with open(self.cache_file, "w", encoding="utf-8") as handle:
            handle.write("{ broken json")

        names, _, _ = scan_image_folder(self.temp_dir, metadata_limit=10)
        self.assertEqual(names, ["image.png"])
        with open(self.cache_file, "r", encoding="utf-8") as handle:
            payload = json.load(handle)
        self.assertIsInstance(payload, dict)
        self.assertEqual(len(payload), 1)

    def test_cache_is_pruned_to_256_entries(self):
        self._make_png("image.png", 1_700_000_000)
        stale = {
            os.path.join(self.temp_dir, f"stale-{index}.png"): {
                "mtime": 1,
                "prompt": f"old-{index}",
            }
            for index in range(300)
        }
        with open(self.cache_file, "w", encoding="utf-8") as handle:
            json.dump(stale, handle)

        scan_image_folder(self.temp_dir, metadata_limit=10)
        with open(self.cache_file, "r", encoding="utf-8") as handle:
            payload = json.load(handle)
        self.assertEqual(len(payload), 256)
        self.assertIn(os.path.join(self.temp_dir, "image.png"), payload)

    def test_byte_parameters_and_positive_parser(self):
        self.assertEqual(
            parse_positive_from_parameters(b"A cat\r\nNegative prompt: dog\r\nSteps: 20"),
            "A cat",
        )
        self.assertEqual(parse_positive_from_parameters(None), "")
        self.assertEqual(parse_positive_from_parameters("Line one\nSteps: 2"), "Line one")
        self.assertEqual(decode_bytes_safely(b"plain"), "plain")
        self.assertEqual(decode_bytes_safely(None), "")

    def test_graph_tracing_handles_cycles_and_ignores_negative_links(self):
        graph = {
            "1": {
                "class_type": "KSampler",
                "inputs": {"positive": ["2", 0], "negative": ["4", 0]},
            },
            "2": {
                "class_type": "CLIPTextEncode",
                "inputs": {"text": "hello", "positive": ["3", 0]},
            },
            "3": {
                "class_type": "CLIPTextEncode",
                "inputs": {"text": "world", "positive": ["2", 0]},
            },
            "4": {"class_type": "CLIPTextEncode", "inputs": {"text": "negative text"}},
        }
        self.assertEqual(trace_positive_prompt_from_graph(graph), "hello\nworld")

        fallback = {"7": {"class_type": "CLIPTextEncode", "inputs": {"text": "fallback text"}}}
        self.assertEqual(trace_positive_prompt_from_graph(fallback), "fallback text")
        self.assertEqual(trace_positive_prompt_from_graph(None), "")
        self.assertEqual(trace_positive_prompt_from_graph({}), "")


if __name__ == "__main__":
    unittest.main()

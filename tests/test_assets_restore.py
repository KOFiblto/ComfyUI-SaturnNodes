import os
import sys
import json
import time
import copy
import shutil
import tempfile
import threading
import unittest
from unittest.mock import MagicMock, patch

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import test_helper

from PIL import Image, PngImagePlugin
import nodes.generation_times as generation_times
from nodes.generation_times import (
    record_generation_time,
    get_generation_time,
    patch_prompt_queue,
)
from nodes.assets_restore import (
    AssetsRestoreManager,
    parse_a1111_positive_prompt,
    _decode_exif_text,
)


class TestAssetsRestore(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.mkdtemp()
        self.output_dir = os.path.join(self.temp_dir, "output")
        os.makedirs(self.output_dir)

    def tearDown(self):
        shutil.rmtree(self.temp_dir, ignore_errors=True)

    def _make_png(self, name, mtime, prompt_json=None, parameters=None, subfolder=""):
        folder = os.path.join(self.output_dir, subfolder) if subfolder else self.output_dir
        os.makedirs(folder, exist_ok=True)
        path = os.path.join(folder, name)
        info = PngImagePlugin.PngInfo()
        if prompt_json is not None:
            info.add_text("prompt", json.dumps(prompt_json))
        if parameters is not None:
            info.add_text("parameters", parameters)
        Image.new("RGB", (8, 8), (20, 30, 40)).save(path, pnginfo=info)
        os.utime(path, (mtime, mtime))
        return path

    def test_scan_returns_newest_limit_and_respects_recursive_setting(self):
        base = 1_600_000_000
        self._make_png("old.png", base)
        self._make_png("new.png", base + 100)
        self._make_png("nested.png", base + 200, subfolder="child")

        manager = AssetsRestoreManager()
        stats = {}
        recursive = manager.scan_output_images(self.output_dir, limit=2, recursive=True, stats=stats)
        self.assertEqual([x["filename"] for x in recursive], ["new.png", "nested.png"])
        self.assertEqual(stats["scanned"], 3)

        flat = manager.scan_output_images(self.output_dir, limit=10, recursive=False)
        self.assertEqual([x["filename"] for x in flat], ["old.png", "new.png"])

    def test_extract_png_and_a1111_metadata(self):
        base = 1_600_000_000
        prompt = {"1": {"class_type": "CLIPTextEncode", "inputs": {"text": "hello"}}}
        self._make_png("meta.png", base, prompt_json=prompt)
        manager = AssetsRestoreManager()
        prompt_dict, workflow_dict, positive = manager.extract_image_metadata(
            os.path.join(self.output_dir, "meta.png"))
        self.assertEqual(prompt_dict, prompt)
        self.assertEqual(workflow_dict, {})
        self.assertEqual(positive, "")

        self._make_png(
            "a1111.png", base + 1,
            parameters="A beautiful castle\nNegative prompt: ugly\nSteps: 20, Sampler: Euler")
        _, _, positive = manager.extract_image_metadata(os.path.join(self.output_dir, "a1111.png"))
        self.assertEqual(positive, "A beautiful castle")

    def test_decode_exif_user_comment_prefixes(self):
        # EXIF Unicode comments are UTF-16 big-endian after an 8-byte prefix
        # (this is what piexif.helper.UserComment.dump produces).
        unicode_comment = b"UNICODE\x00" + "A castle\nSteps: 20".encode("utf-16-be")
        self.assertEqual(_decode_exif_text(unicode_comment), "A castle\nSteps: 20")
        ascii_comment = b"ASCII\x00\x00\x00" + b"plain prompt"
        self.assertEqual(_decode_exif_text(ascii_comment), "plain prompt")

    def test_parse_a1111_positive_prompt(self):
        self.assertEqual(
            parse_a1111_positive_prompt("A cat\n\nNegative prompt: dog\nSteps: 20"),
            "A cat",
        )
        self.assertEqual(
            parse_a1111_positive_prompt("Just a prompt\nSteps: 10, Sampler: Euler a"),
            "Just a prompt",
        )
        self.assertEqual(parse_a1111_positive_prompt(""), "")

    def test_restore_uses_generation_time_and_builds_debug_report(self):
        base = 1_600_000_000
        first = self._make_png("first.png", base, subfolder="sub")
        second = self._make_png("second.png", base + 60)

        fake_queue = MagicMock()
        fake_queue.history = {}
        fake_queue.mutex = threading.RLock()
        server = MagicMock()
        server.prompt_queue = fake_queue

        manager = AssetsRestoreManager()
        with patch("nodes.assets_restore.folder_paths.get_output_directory", return_value=self.output_dir), \
             patch("nodes.assets_restore.is_assets_restore_enabled", return_value=True), \
             patch("nodes.assets_restore.is_recursive_assets_scan_enabled", return_value=True), \
             patch("nodes.assets_restore.get_assets_restore_count", return_value=10), \
             patch("nodes.assets_restore.get_generation_time", side_effect=lambda fn, sf="", mt=None: 12.5 if fn == "first.png" else None), \
             patch.object(manager, "_ingest_assets", return_value=0):
            restored = manager.restore_on_launch(server, force=True)

        self.assertEqual(restored, 2)
        self.assertEqual(len(fake_queue.history), 2)
        entries = list(fake_queue.history.values())
        self.assertEqual(entries[0]["outputs"]["0"]["images"][0]["filename"], "first.png")
        start_ts = entries[0]["status"]["messages"][0][1]["timestamp"]
        end_ts = entries[0]["status"]["messages"][1][1]["timestamp"]
        self.assertEqual(end_ts - start_ts, 12500)
        self.assertEqual(entries[0]["status"]["saturnnodes_duration"], 12.5)
        self.assertEqual(entries[0]["prompt"][3]["extra_pnginfo"]["saturnnodes_generation_time"], 12.5)
        self.assertEqual(len(entries[0]["status"]["messages"]), 2)
        # No recorded duration: keep the mtime for sorting, but do not emit an
        # execution_success timestamp that would render as a fake "0.00s".
        self.assertEqual(entries[1]["status"]["messages"][0][1]["timestamp"], base * 1000 + 60 * 1000)
        self.assertEqual(len(entries[1]["status"]["messages"]), 1)

        report = manager.last_debug_report
        self.assertEqual(report["restored_count"], 2)
        self.assertEqual(report["generation_time_matches"], 1)
        self.assertEqual(report["total_scanned_images"], 2)
        self.assertIn("elapsed_ms", report)
        self.assertTrue(os.path.exists(first) and os.path.exists(second))


class TestGenerationTimes(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.mkdtemp()
        self.old_file = generation_times.GENERATION_TIMES_FILE
        self.old_data = generation_times._DATA
        self.old_mtime = generation_times._DATA_MTIME
        self.old_patched = generation_times._PATCHED
        self.old_starts = dict(generation_times._START_TIMES)
        generation_times.GENERATION_TIMES_FILE = os.path.join(self.temp_dir, "generation_times.json")
        generation_times._DATA = None
        generation_times._DATA_MTIME = None
        generation_times._PATCHED = False
        generation_times._START_TIMES.clear()

    def tearDown(self):
        generation_times.GENERATION_TIMES_FILE = self.old_file
        generation_times._DATA = self.old_data
        generation_times._DATA_MTIME = self.old_mtime
        generation_times._PATCHED = self.old_patched
        generation_times._START_TIMES.clear()
        generation_times._START_TIMES.update(self.old_starts)
        shutil.rmtree(self.temp_dir, ignore_errors=True)

    def test_record_and_lookup_generation_time(self):
        record_generation_time("pid-1", 3.25, [
            {"filename": "a.png", "subfolder": ""},
            {"filename": "b.png", "subfolder": "nested"},
        ])
        self.assertEqual(get_generation_time("a.png"), 3.25)
        self.assertEqual(get_generation_time("b.png", "nested"), 3.25)
        self.assertEqual(get_generation_time("b.png"), 3.25)  # bare filename fallback
        self.assertIsNone(get_generation_time("missing.png"))

        with open(generation_times.GENERATION_TIMES_FILE, "r", encoding="utf-8") as f:
            raw = f.read()
        self.assertNotIn("\n", raw)  # compact JSON

    def test_moved_file_fallback_is_timestamp_guarded_and_unambiguous(self):
        now = time.time()
        record_generation_time("pid-moved", 7.0, [
            {"filename": "moved.png", "subfolder": "old"},
        ])
        # A moved file has a new subfolder/key; the bare-name fallback works
        # only when the recorded completion time is close to the file mtime.
        self.assertEqual(get_generation_time("moved.png", "new", now), 7.0)
        self.assertIsNone(get_generation_time("moved.png", "new", now - 3600))

        record_generation_time("pid-other", 9.0, [
            {"filename": "moved.png", "subfolder": "elsewhere"},
        ])
        # Two candidate records are ambiguous, so no duration is invented.
        self.assertIsNone(get_generation_time("moved.png", "new", now))

    def test_temporary_outputs_are_not_recorded_for_assets(self):
        files = generation_times._extract_output_files({
            "outputs": {"1": {"images": [
                {"filename": "preview.png", "subfolder": "", "type": "temp"},
                {"filename": "saved.png", "subfolder": "", "type": "output"},
                {"filename": "no-type.png", "subfolder": ""},
            ]}}
        })
        self.assertEqual([f["filename"] for f in files], ["saved.png", "no-type.png"])
        record_generation_time("pid-temp", 2.0, files)
        self.assertIsNone(get_generation_time("preview.png"))
        self.assertEqual(get_generation_time("saved.png"), 2.0)

    def test_queue_patch_measures_task_duration(self):
        class FakeQueue:
            def __init__(self):
                self.currently_running = {}
                self.mutex = threading.RLock()
                self.items = [(0, "pid-42", {"prompt": {}}, {}, {}, True)]
                self.task_counter = 0

            def get(self, *args, **kwargs):
                if not self.items:
                    return None
                item = self.items.pop(0)
                task_id = self.task_counter
                self.task_counter += 1
                self.currently_running[task_id] = copy.deepcopy(item)
                # Match ComfyUI's real PromptQueue.get return shape.
                return (item, task_id)

            def task_done(self, item_id, history_result, status, process_item=None):
                self.currently_running.pop(item_id, None)

        queue = FakeQueue()
        server = MagicMock()
        server.prompt_queue = queue

        patch_prompt_queue(server)
        item, task_id = queue.get()
        queue.task_done(task_id, {
            "outputs": {"9": {"images": [{"filename": "queued.png", "subfolder": "run"}]}}
        }, "success")

        duration = get_generation_time("queued.png", "run")
        self.assertIsNotNone(duration)
        self.assertGreaterEqual(duration, 0.0)
        with open(generation_times.GENERATION_TIMES_FILE, "r", encoding="utf-8") as f:
            saved = json.load(f)
        self.assertEqual(saved["entries"]["run/queued.png"]["status"], "success")


if __name__ == "__main__":
    unittest.main()

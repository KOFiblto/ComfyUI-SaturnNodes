import json
import os
import shutil
import sys
import tempfile
import threading
import time
import unittest
import uuid
from types import SimpleNamespace
from unittest.mock import patch

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import test_helper  # noqa: F401  (redirects SaturnNodes state to a temp dir)

from PIL import Image, PngImagePlugin

from nodes.assets_restore import (
    AssetsRestoreManager,
    _decode_exif_text,
    get_assets_restore_count,
    parse_a1111_positive_prompt,
)


class TestAssetsRestoreExtended(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.mkdtemp()
        self.output_dir = os.path.join(self.temp_dir, "output")
        os.makedirs(self.output_dir)

    def tearDown(self):
        shutil.rmtree(self.temp_dir, ignore_errors=True)

    def _make_png(self, name, mtime, subfolder="", prompt_json=None, parameters=None):
        folder = os.path.join(self.output_dir, subfolder) if subfolder else self.output_dir
        os.makedirs(folder, exist_ok=True)
        path = os.path.join(folder, name)
        info = PngImagePlugin.PngInfo()
        if prompt_json is not None:
            info.add_text("prompt", json.dumps(prompt_json))
        if parameters is not None:
            info.add_text("parameters", parameters)
        Image.new("RGB", (8, 8), (10, 20, 30)).save(path, pnginfo=info)
        os.utime(path, (mtime, mtime))
        return path

    def _fake_queue(self, history=None, mutex=True):
        queue = SimpleNamespace(history=history)
        if mutex:
            queue.mutex = threading.RLock()
        return queue

    def _server(self, queue):
        return SimpleNamespace(prompt_queue=queue, queue_updated=lambda: None)

    def test_scan_equal_mtimes_use_path_tiebreak(self):
        base = 1_700_000_000
        # Deliberately create in non-sorted order so filesystem iteration order
        # cannot accidentally make the test pass.
        self._make_png("b.png", base)
        self._make_png("a.png", base)
        self._make_png("c.png", base, subfolder="sub")
        self._make_png("a.png", base, subfolder="sub")

        manager = AssetsRestoreManager()
        first = manager.scan_output_images(self.output_dir, limit=10)
        second = manager.scan_output_images(self.output_dir, limit=10)

        expected = [
            ("a.png", ""),
            ("b.png", ""),
            ("a.png", "sub"),
            ("c.png", "sub"),
        ]
        self.assertEqual([(x["filename"], x["subfolder"]) for x in first], expected)
        self.assertEqual(first, second, "repeated scans must return identical ordering")

    def test_scan_limit_is_clamped_and_invalid_limits_fall_back(self):
        base = 1_700_000_000
        for index in range(4):
            self._make_png(f"img{index}.png", base + index)
        with open(os.path.join(self.output_dir, "notes.txt"), "w", encoding="utf-8") as handle:
            handle.write("not an image")

        manager = AssetsRestoreManager()
        stats = {}
        newest_one = manager.scan_output_images(self.output_dir, limit=0, stats=stats)
        self.assertEqual([x["filename"] for x in newest_one], ["img3.png"])
        self.assertEqual(stats["scanned"], 4, "non-image files must not count as scanned images")

        self.assertEqual(
            [x["filename"] for x in manager.scan_output_images(self.output_dir, limit=-7)],
            ["img3.png"],
        )
        self.assertEqual(
            len(manager.scan_output_images(self.output_dir, limit="not-a-number")),
            4,
            "an invalid limit must fall back to the default scan size",
        )

    def test_restore_limit_is_clamped_and_invalid_uses_setting(self):
        base = 1_700_000_000
        self._make_png("one.png", base)
        self._make_png("two.png", base + 1)
        self._make_png("three.png", base + 2)

        manager = AssetsRestoreManager()
        queue = self._fake_queue()
        with patch("nodes.assets_restore.folder_paths.get_output_directory", return_value=self.output_dir), \
             patch("nodes.assets_restore.is_assets_restore_enabled", return_value=True), \
             patch("nodes.assets_restore.is_recursive_assets_scan_enabled", return_value=True), \
             patch("nodes.assets_restore.get_generation_time", return_value=None), \
             patch.object(manager, "_ingest_assets", return_value=0):
            self.assertEqual(manager.restore_on_launch(self._server(queue), limit=0, force=True), 1)

        manager = AssetsRestoreManager()
        queue = self._fake_queue()
        with patch("nodes.assets_restore.folder_paths.get_output_directory", return_value=self.output_dir), \
             patch("nodes.assets_restore.is_assets_restore_enabled", return_value=True), \
             patch("nodes.assets_restore.is_recursive_assets_scan_enabled", return_value=True), \
             patch("nodes.assets_restore.get_assets_restore_count", return_value=2), \
             patch("nodes.assets_restore.get_generation_time", return_value=None), \
             patch.object(manager, "_ingest_assets", return_value=0):
            self.assertEqual(
                manager.restore_on_launch(self._server(queue), limit="broken", force=True),
                2,
            )

    def test_concurrent_force_restores_are_serialized(self):
        self._make_png("image.png", 1_700_000_000)
        manager = AssetsRestoreManager()
        queue = self._fake_queue()
        server = self._server(queue)

        intervals = []
        intervals_lock = threading.Lock()

        def slow_ingest(prepared):
            start = time.monotonic()
            time.sleep(0.08)
            end = time.monotonic()
            with intervals_lock:
                intervals.append((start, end))
            return len(prepared)

        errors = []

        def run_restore():
            try:
                manager.restore_on_launch(server, force=True)
            except Exception as exc:  # pragma: no cover - surfaced via assert below
                errors.append(exc)

        # Apply the module patches in the main thread. Patching the same target
        # from two threads can restore stale values when the contexts unwind in
        # a different order and would make this test flaky.
        with patch("nodes.assets_restore.folder_paths.get_output_directory", return_value=self.output_dir), \
             patch("nodes.assets_restore.is_assets_restore_enabled", return_value=True), \
             patch("nodes.assets_restore.is_recursive_assets_scan_enabled", return_value=True), \
             patch("nodes.assets_restore.get_generation_time", return_value=None), \
             patch.object(manager, "_ingest_assets", side_effect=slow_ingest):
            threads = [threading.Thread(target=run_restore) for _ in range(2)]
            for thread in threads:
                thread.start()
            for thread in threads:
                thread.join(10)

        self.assertEqual(errors, [])
        self.assertEqual(len(intervals), 2)
        intervals.sort()
        self.assertGreaterEqual(
            intervals[1][0],
            intervals[0][1] - 0.01,
            "the restore lock must prevent overlapping restore/ingest runs",
        )

    def test_restore_preserves_cross_day_timestamps_and_durations(self):
        day = 86_400
        base = 1_700_000_000
        specs = [
            ("day-one.png", base, 1.5),
            ("day-two.png", base + day, 2.0),
            ("day-three.png", base + 2 * day, 3.25),
        ]
        durations = {}
        for name, mtime, duration in specs:
            self._make_png(name, mtime)
            durations[name] = duration

        manager = AssetsRestoreManager()
        queue = self._fake_queue()
        server = self._server(queue)

        with patch("nodes.assets_restore.folder_paths.get_output_directory", return_value=self.output_dir), \
             patch("nodes.assets_restore.is_assets_restore_enabled", return_value=True), \
             patch("nodes.assets_restore.is_recursive_assets_scan_enabled", return_value=True), \
             patch(
                 "nodes.assets_restore.get_generation_time",
                 side_effect=lambda fn, sf="", mt=None: durations.get(fn),
             ), \
             patch.object(manager, "_ingest_assets", return_value=0):
            restored = manager.restore_on_launch(server, force=True)

        self.assertEqual(restored, 3)
        entries = list(queue.history.values())
        self.assertEqual(
            [entry["prompt"][0] for entry in entries],
            [1, 2, 3],
            "restored history must be numbered oldest to newest across days",
        )

        for entry, (name, mtime, duration) in zip(entries, specs):
            mtime_ms = int(mtime * 1000)
            duration_ms = int(duration * 1000)
            self.assertEqual(entry["prompt"][3]["create_time"], mtime_ms, name)
            messages = entry["status"]["messages"]
            self.assertEqual([message[0] for message in messages], ["execution_start", "execution_success"])
            self.assertEqual(messages[0][1]["timestamp"], mtime_ms - duration_ms, name)
            self.assertEqual(messages[1][1]["timestamp"], mtime_ms, name)
            self.assertEqual(entry["status"]["saturnnodes_duration"], duration, name)
            self.assertEqual(
                entry["prompt"][3]["extra_pnginfo"]["saturnnodes_generation_time"],
                duration,
                name,
            )
            self.assertEqual(
                entry["outputs"]["0"]["images"][0]["filename"],
                name,
            )

    def test_restore_handles_missing_mutex_and_bad_history(self):
        self._make_png("image.png", 1_700_000_000)
        manager = AssetsRestoreManager()
        queue = self._fake_queue(history=None, mutex=False)
        server = self._server(queue)

        with patch("nodes.assets_restore.folder_paths.get_output_directory", return_value=self.output_dir), \
             patch("nodes.assets_restore.is_assets_restore_enabled", return_value=True), \
             patch("nodes.assets_restore.is_recursive_assets_scan_enabled", return_value=True), \
             patch("nodes.assets_restore.get_generation_time", return_value=None), \
             patch.object(manager, "_ingest_assets", return_value=0):
            restored = manager.restore_on_launch(server, force=True)

        self.assertEqual(restored, 1)
        self.assertIsInstance(queue.history, dict)
        self.assertEqual(len(queue.history), 1)

    def test_restore_survives_asset_db_ingest_failure(self):
        self._make_png("image.png", 1_700_000_000)
        manager = AssetsRestoreManager()
        queue = self._fake_queue()
        server = self._server(queue)

        with patch("nodes.assets_restore.folder_paths.get_output_directory", return_value=self.output_dir), \
             patch("nodes.assets_restore.is_assets_restore_enabled", return_value=True), \
             patch("nodes.assets_restore.is_recursive_assets_scan_enabled", return_value=True), \
             patch("nodes.assets_restore.get_generation_time", return_value=None), \
             patch.object(manager, "_ingest_assets", side_effect=RuntimeError("asset db unavailable")):
            restored = manager.restore_on_launch(server, force=True)

        self.assertEqual(restored, 1)
        self.assertEqual(manager.last_debug_report["asset_db_registered"], 0)
        self.assertEqual(manager.last_debug_report["status"], "success")

    def test_restore_ignores_non_finite_or_negative_durations(self):
        base = 1_700_000_000
        for name in ("nan.png", "inf.png", "neg.png", "ok.png"):
            self._make_png(name, base)
            base += 1

        durations = {
            "nan.png": float("nan"),
            "inf.png": float("inf"),
            "neg.png": -2.5,
            "ok.png": 4.0,
        }

        manager = AssetsRestoreManager()
        queue = self._fake_queue()
        server = self._server(queue)

        with patch("nodes.assets_restore.folder_paths.get_output_directory", return_value=self.output_dir), \
             patch("nodes.assets_restore.is_assets_restore_enabled", return_value=True), \
             patch("nodes.assets_restore.is_recursive_assets_scan_enabled", return_value=True), \
             patch("nodes.assets_restore.get_generation_time", side_effect=lambda fn, sf="", mt=None: durations[fn]), \
             patch.object(manager, "_ingest_assets", return_value=0):
            restored = manager.restore_on_launch(server, force=True)

        self.assertEqual(restored, 4)
        entries = {
            entry["outputs"]["0"]["images"][0]["filename"]: entry
            for entry in queue.history.values()
        }
        for name in ("nan.png", "inf.png", "neg.png"):
            self.assertEqual(len(entries[name]["status"]["messages"]), 1, name)
            self.assertNotIn("saturnnodes_duration", entries[name]["status"], name)
            self.assertNotIn(
                "saturnnodes_generation_time",
                entries[name]["prompt"][3]["extra_pnginfo"],
                name,
            )
        self.assertEqual(len(entries["ok.png"]["status"]["messages"]), 2)
        self.assertEqual(entries["ok.png"]["status"]["saturnnodes_duration"], 4.0)

    def test_restore_disabled_marks_launch_and_skips_scan(self):
        manager = AssetsRestoreManager()
        queue = self._fake_queue()
        server = self._server(queue)

        with patch("nodes.assets_restore.is_assets_restore_enabled", return_value=False), \
             patch.object(manager, "scan_output_images") as scan:
            self.assertEqual(manager.restore_on_launch(server), 0)
            self.assertEqual(manager.restore_on_launch(server), 0)

        scan.assert_not_called()
        self.assertTrue(manager._restored_on_launch)

    def test_restore_runs_once_without_force(self):
        self._make_png("image.png", 1_700_000_000)
        manager = AssetsRestoreManager()
        queue = self._fake_queue()
        server = self._server(queue)

        with patch("nodes.assets_restore.folder_paths.get_output_directory", return_value=self.output_dir), \
             patch("nodes.assets_restore.is_assets_restore_enabled", return_value=True), \
             patch("nodes.assets_restore.is_recursive_assets_scan_enabled", return_value=True), \
             patch("nodes.assets_restore.get_generation_time", return_value=None), \
             patch.object(manager, "_ingest_assets", return_value=0), \
             patch.object(manager, "scan_output_images", wraps=manager.scan_output_images) as scan:
            self.assertEqual(manager.restore_on_launch(server), 1)
            self.assertEqual(manager.restore_on_launch(server), 0)

        self.assertEqual(scan.call_count, 1)

    def test_restored_prompt_ids_are_stable_and_unique(self):
        base = 1_700_000_000
        self._make_png("same.png", base)
        self._make_png("same.png", base + 1, subfolder="one")
        self._make_png("same.png", base + 2, subfolder="two")

        manager = AssetsRestoreManager()
        first_queue = self._fake_queue()
        second_queue = self._fake_queue()

        for queue in (first_queue, second_queue):
            with patch("nodes.assets_restore.folder_paths.get_output_directory", return_value=self.output_dir), \
                 patch("nodes.assets_restore.is_assets_restore_enabled", return_value=True), \
                 patch("nodes.assets_restore.is_recursive_assets_scan_enabled", return_value=True), \
                 patch("nodes.assets_restore.get_generation_time", return_value=None), \
                 patch.object(manager, "_ingest_assets", return_value=0):
                manager.restore_on_launch(self._server(queue), force=True)

        first_ids = set(first_queue.history)
        second_ids = set(second_queue.history)
        self.assertEqual(first_ids, second_ids)
        self.assertEqual(len(first_ids), 3)
        self.assertEqual(
            first_ids,
            {
                str(uuid.uuid5(uuid.NAMESPACE_URL, f"saturnnodes:{key}"))
                for key in ("same.png", "one/same.png", "two/same.png")
            },
        )
        for entry in first_queue.history.values():
            self.assertIn(entry["prompt"][1], first_ids)

    def test_decode_exif_text_strips_bom_and_nul_padding(self):
        unicode_comment = b"UNICODE\x00" + "\ufeffA castle\x00".encode("utf-16-be")
        self.assertEqual(_decode_exif_text(unicode_comment), "A castle")
        self.assertEqual(
            _decode_exif_text(b"ASCII\x00\x00\x00" + b"A\x00B\x00"),
            "AB",
        )
        self.assertEqual(_decode_exif_text("\ufeff padded \x00"), "padded")
        self.assertEqual(_decode_exif_text(None), "")
        self.assertEqual(_decode_exif_text(b""), "")

    def test_parse_a1111_accepts_bytes_and_crlf(self):
        raw = b"A cat\r\nNegative prompt: dog\r\nSteps: 20, Sampler: Euler"
        self.assertEqual(parse_a1111_positive_prompt(raw), "A cat")
        self.assertEqual(
            parse_a1111_positive_prompt(b"Line one\r\nLine two\r\nSteps: 4"),
            "Line one\nLine two",
        )
        self.assertEqual(parse_a1111_positive_prompt(None), "")

    def test_generation_time_count_setting_clamps(self):
        with patch("nodes.assets_restore.get_env_setting", return_value="0"):
            self.assertEqual(get_assets_restore_count(), 1)
        with patch("nodes.assets_restore.get_env_setting", return_value="100000"):
            self.assertEqual(get_assets_restore_count(), 1000)
        with patch("nodes.assets_restore.get_env_setting", return_value="not-a-number"):
            self.assertEqual(get_assets_restore_count(), 64)


if __name__ == "__main__":
    unittest.main()

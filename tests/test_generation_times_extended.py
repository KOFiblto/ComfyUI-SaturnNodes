import json
import math
import os
import shutil
import sys
import tempfile
import threading
import unittest
from unittest.mock import patch

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import test_helper  # noqa: F401  (redirects SaturnNodes state to a temp dir)

import nodes.generation_times as generation_times


class TestGenerationTimesExtended(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.mkdtemp()
        self.old_file = generation_times.GENERATION_TIMES_FILE
        self.old_user_dir = generation_times.USER_DIR
        self.old_data = generation_times._DATA
        self.old_mtime = generation_times._DATA_MTIME
        self.old_patched = generation_times._PATCHED
        self.old_starts = dict(generation_times._START_TIMES)
        generation_times.GENERATION_TIMES_FILE = os.path.join(self.temp_dir, "generation_times.json")
        generation_times.USER_DIR = self.temp_dir
        generation_times._DATA = None
        generation_times._DATA_MTIME = None
        generation_times._PATCHED = False
        generation_times._START_TIMES.clear()

    def tearDown(self):
        generation_times.GENERATION_TIMES_FILE = self.old_file
        generation_times.USER_DIR = self.old_user_dir
        generation_times._DATA = self.old_data
        generation_times._DATA_MTIME = self.old_mtime
        generation_times._PATCHED = self.old_patched
        generation_times._START_TIMES.clear()
        generation_times._START_TIMES.update(self.old_starts)
        shutil.rmtree(self.temp_dir, ignore_errors=True)

    def _write_payload(self, payload):
        with open(generation_times.GENERATION_TIMES_FILE, "w", encoding="utf-8") as handle:
            json.dump(payload, handle)
        generation_times._DATA = None
        generation_times._DATA_MTIME = None

    def test_rejects_non_finite_negative_and_non_numeric_durations(self):
        bad_values = [float("nan"), float("inf"), float("-inf"), -0.001, "not-a-number", None, object()]
        for index, value in enumerate(bad_values):
            generation_times.record_generation_time(
                f"pid-{index}",
                value,
                [{"filename": f"bad{index}.png", "subfolder": ""}],
            )

        self.assertFalse(
            os.path.exists(generation_times.GENERATION_TIMES_FILE),
            "invalid durations must not create a generation-times file",
        )
        for index in range(len(bad_values)):
            self.assertIsNone(generation_times.get_generation_time(f"bad{index}.png"))

    def test_rejects_missing_or_malformed_file_entries(self):
        generation_times.record_generation_time("pid", 2.0, None)
        generation_times.record_generation_time("pid", 2.0, [])
        generation_times.record_generation_time("pid", 2.0, [None, "x", {}, {"filename": ""}])
        self.assertIsNone(generation_times.get_generation_time(""))

        generation_times.record_generation_time("pid", 2.0, [{"filename": "valid.png"}])
        self.assertEqual(generation_times.get_generation_time("valid.png"), 2.0)

    def test_rounds_and_overwrites_duplicate_file_keys(self):
        generation_times.record_generation_time(
            "pid-1", 1.23456, [{"filename": "same.png", "subfolder": "sub"}]
        )
        self.assertEqual(generation_times.get_generation_time("same.png", "sub"), 1.235)

        generation_times.record_generation_time(
            "pid-2", 9.0, [{"filename": "same.png", "subfolder": "sub"}]
        )
        with open(generation_times.GENERATION_TIMES_FILE, "r", encoding="utf-8") as handle:
            payload = json.load(handle)
        self.assertEqual(len(payload["entries"]), 1)
        self.assertEqual(payload["entries"]["sub/same.png"]["duration"], 9.0)
        self.assertEqual(payload["entries"]["sub/same.png"]["prompt_id"], "pid-2")

    def test_pruning_keeps_the_newest_entries(self):
        times = iter([1000.0, 1001.0, 1002.0, 1003.0, 1004.0])
        with patch.object(generation_times, "MAX_ENTRIES", 3), \
             patch("nodes.generation_times.time.time", side_effect=lambda: next(times)):
            for index in range(5):
                generation_times.record_generation_time(
                    f"pid-{index}",
                    float(index),
                    [{"filename": f"file{index}.png", "subfolder": ""}],
                )

        with open(generation_times.GENERATION_TIMES_FILE, "r", encoding="utf-8") as handle:
            payload = json.load(handle)
        self.assertEqual(
            set(payload["entries"]),
            {"file2.png", "file3.png", "file4.png"},
        )

    def test_entry_timestamp_handles_malformed_values(self):
        self.assertEqual(generation_times._entry_timestamp(None), 0)
        self.assertEqual(generation_times._entry_timestamp("x"), 0)
        self.assertEqual(generation_times._entry_timestamp({}), 0)
        self.assertEqual(generation_times._entry_timestamp({"completed": "bad"}), 0)
        self.assertEqual(generation_times._entry_timestamp({"completed": -10}), 0)
        self.assertEqual(generation_times._entry_timestamp({"completed": float("inf")}), 0)
        self.assertEqual(generation_times._entry_timestamp({"completed": "1234"}), 1234)

    def test_get_generation_time_rejects_corrupt_stored_durations(self):
        self._write_payload({
            "version": 1,
            "entries": {
                "nan.png": {"duration": float("nan"), "completed": 1},
                "inf.png": {"duration": float("inf"), "completed": 1},
                "neg.png": {"duration": -4, "completed": 1},
                "text.png": {"duration": "fast", "completed": 1},
                "ok.png": {"duration": "1.5", "completed": 1},
            },
        })
        for name in ("nan.png", "inf.png", "neg.png", "text.png"):
            self.assertIsNone(generation_times.get_generation_time(name), name)
        self.assertEqual(generation_times.get_generation_time("ok.png"), 1.5)

    def test_load_data_recovers_from_corrupt_or_legacy_payloads(self):
        with open(generation_times.GENERATION_TIMES_FILE, "w", encoding="utf-8") as handle:
            handle.write("{ this is not json")
        data = generation_times._load_data()
        self.assertEqual(data, {"version": 1, "entries": {}})

        self._write_payload({"entries": {"legacy.png": {"duration": 2.0, "completed": 5}}})
        data = generation_times._load_data()
        self.assertEqual(data["version"], 1)
        self.assertEqual(generation_times.get_generation_time("legacy.png"), 2.0)

    def test_corrupt_entries_are_dropped_on_load_and_save(self):
        self._write_payload({
            "version": 1,
            "entries": {
                "nan.png": {"duration": float("nan"), "completed": 1},
                "inf.png": {"duration": float("inf"), "completed": 1},
                "neg.png": {"duration": -4, "completed": 1},
                "text.png": {"duration": "fast", "completed": 1},
                "ok.png": {"duration": "1.5", "completed": 1},
            },
        })

        data = generation_times._load_data()
        self.assertEqual(set(data["entries"]), {"ok.png"})
        self.assertEqual(data["entries"]["ok.png"]["duration"], 1.5)

        # A corrupt entry must not make every future save fail under
        # allow_nan=False. The valid entry and the new one must persist.
        generation_times.record_generation_time(
            "pid", 3.0, [{"filename": "new.png", "subfolder": ""}]
        )
        with open(generation_times.GENERATION_TIMES_FILE, "r", encoding="utf-8") as handle:
            payload = json.load(handle)
        self.assertEqual(set(payload["entries"]), {"ok.png", "new.png"})
        self.assertEqual(payload["entries"]["new.png"]["duration"], 3.0)

    def test_save_retries_windows_replace_lock_and_cleans_temp_file(self):
        real_replace = os.replace
        attempts = {"count": 0}

        def flaky_replace(src, dst):
            attempts["count"] += 1
            if attempts["count"] < 3:
                raise PermissionError("file is locked")
            return real_replace(src, dst)

        with patch("nodes.generation_times.os.replace", side_effect=flaky_replace), \
             patch("nodes.generation_times.time.sleep"):
            generation_times._save_data({"version": 1, "entries": {"a.png": {"duration": 1}}})

        self.assertEqual(attempts["count"], 3)
        self.assertTrue(os.path.exists(generation_times.GENERATION_TIMES_FILE))
        self.assertEqual(
            [name for name in os.listdir(self.temp_dir) if name.endswith(".tmp")],
            [],
        )

    def test_save_failure_does_not_leave_temp_file_behind(self):
        with patch("nodes.generation_times.os.replace", side_effect=PermissionError("locked")), \
             patch("nodes.generation_times.time.sleep"):
            generation_times._save_data({"version": 1, "entries": {}})

        self.assertEqual(
            [name for name in os.listdir(self.temp_dir) if name.endswith(".tmp")],
            [],
        )

    def test_moved_file_fallback_handles_invalid_mtime(self):
        now = 1_700_000_000.0
        with patch("nodes.generation_times.time.time", return_value=now):
            generation_times.record_generation_time(
                "pid", 6.0, [{"filename": "moved.png", "subfolder": "old"}]
            )
        # A non-numeric mtime must not crash the fallback path.
        self.assertEqual(
            generation_times.get_generation_time("moved.png", "new", "not-a-number"),
            6.0,
        )

    def test_extract_output_files_ignores_malformed_history(self):
        self.assertEqual(generation_times._extract_output_files(None), [])
        self.assertEqual(generation_times._extract_output_files({}), [])
        self.assertEqual(
            generation_times._extract_output_files({"outputs": {"1": {"images": "bad"}}}),
            [],
        )
        files = generation_times._extract_output_files({
            "outputs": {
                "1": {"images": [
                    None,
                    {"filename": ""},
                    {"filename": "temp.png", "type": "temp"},
                    {"filename": "saved.png", "subfolder": "sub"},
                ]},
                "2": "bad",
            }
        })
        self.assertEqual(files, [{"filename": "saved.png", "subfolder": "sub", "type": "output"}])


if __name__ == "__main__":
    unittest.main()

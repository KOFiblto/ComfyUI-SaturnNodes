import os
import sys
import unittest
import json
import tempfile
import threading
from unittest.mock import MagicMock, patch

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import test_helper

from nodes.queue_control import PersistentQueueManager, PauseQueueManager
import nodes.queue_control as queue_control

# 36 Colors matching web/batch_queue.js
BATCH_COLORS = [
    "#10b981", "#3b82f6", "#8b5cf6", "#ec4899", "#f59e0b", "#06b6d4",
    "#ef4444", "#14b8a6", "#6366f1", "#f97316", "#84cc16", "#d946ef",
    "#0ea5e9", "#a855f7", "#e11d48", "#22c55e", "#eab308", "#64748b",
    "#2dd4bf", "#fb7185", "#38bdf8", "#c084fc", "#f43f5e", "#4ade80",
    "#fbbf24", "#818cf8", "#fb923c", "#a3e635", "#f472b6", "#22d3ee",
    "#e879f9", "#a7f3d0", "#fde047", "#fda4af", "#93c5fd", "#c4b5fd"
]

def calculate_segment_types(ordered_pids, registry):
    """
    Python mirror of the segment calculation logic in web/batch_queue.js
    """
    segments = {}
    for pid in ordered_pids:
        info = registry.get(pid)
        if not info or not info.get("batchId"):
            segments[pid] = None
            continue

        batch_id = info["batchId"]
        occurrences = [p for p in ordered_pids if registry.get(p, {}).get("batchId") == batch_id]

        if len(occurrences) <= 1:
            batch_count = info.get("batchCount", 1)
            if batch_count == 1:
                segments[pid] = "single"
            else:
                item_index = info.get("itemIndex", 0)
                if item_index == 0:
                    segments[pid] = "first"
                elif item_index == (batch_count - 1):
                    segments[pid] = "last"
                else:
                    segments[pid] = "middle"
            continue

        first_pid = occurrences[0]
        last_pid = occurrences[-1]

        if pid == first_pid:
            segments[pid] = "first"
        elif pid == last_pid:
            segments[pid] = "last"
        else:
            segments[pid] = "middle"

    return segments


class TestBatchQueueLogic(unittest.TestCase):
    def test_36_color_cycling(self):
        self.assertEqual(len(BATCH_COLORS), 36)
        
        # Batch 1 -> color index 0
        self.assertEqual((1 - 1) % 36, 0)
        self.assertEqual(BATCH_COLORS[(1 - 1) % 36], "#10b981")

        # Batch 36 -> color index 35
        self.assertEqual((36 - 1) % 36, 35)
        self.assertEqual(BATCH_COLORS[(36 - 1) % 36], "#c4b5fd")

        # Batch 37 -> cycles back to color index 0
        self.assertEqual((37 - 1) % 36, 0)
        self.assertEqual(BATCH_COLORS[(37 - 1) % 36], "#10b981")

        # Batch 73 -> cycles back to color index 0
        self.assertEqual((73 - 1) % 36, 0)

    def test_single_item_batch(self):
        registry = {
            "p1": {"batchId": "b1", "batchCount": 1, "itemIndex": 0}
        }
        segments = calculate_segment_types(["p1"], registry)
        self.assertEqual(segments["p1"], "single")

    def test_intact_contiguous_batch(self):
        registry = {
            "p1": {"batchId": "b1", "batchCount": 3, "itemIndex": 0},
            "p2": {"batchId": "b1", "batchCount": 3, "itemIndex": 1},
            "p3": {"batchId": "b1", "batchCount": 3, "itemIndex": 2},
        }
        segments = calculate_segment_types(["p1", "p2", "p3"], registry)
        self.assertEqual(segments["p1"], "first")
        self.assertEqual(segments["p2"], "middle")
        self.assertEqual(segments["p3"], "last")

    def test_interrupted_batch_inserted_in_between(self):
        # Batch A was [pA1, pA2], but prompt B was inserted in-between: [pA1, pB, pA2]
        registry = {
            "pA1": {"batchId": "bA", "batchCount": 2, "itemIndex": 0},
            "pB":  {"batchId": "bB", "batchCount": 1, "itemIndex": 0},
            "pA2": {"batchId": "bA", "batchCount": 2, "itemIndex": 1},
        }
        segments = calculate_segment_types(["pA1", "pB", "pA2"], registry)
        # pA1 is the start of Batch A (curves top, open bottom)
        self.assertEqual(segments["pA1"], "first")
        # pB is a standalone single item (curves top and bottom)
        self.assertEqual(segments["pB"], "single")
        # pA2 is the end of Batch A (open top, curves bottom)
        self.assertEqual(segments["pA2"], "last")

    def test_multiple_interruptions(self):
        # [pA1, pB, pA2, pC, pA3]
        registry = {
            "pA1": {"batchId": "bA", "batchCount": 3, "itemIndex": 0},
            "pB":  {"batchId": "bB", "batchCount": 1, "itemIndex": 0},
            "pA2": {"batchId": "bA", "batchCount": 3, "itemIndex": 1},
            "pC":  {"batchId": "bC", "batchCount": 1, "itemIndex": 0},
            "pA3": {"batchId": "bA", "batchCount": 3, "itemIndex": 2},
        }
        segments = calculate_segment_types(["pA1", "pB", "pA2", "pC", "pA3"], registry)
        self.assertEqual(segments["pA1"], "first")
        self.assertEqual(segments["pB"], "single")
        self.assertEqual(segments["pA2"], "middle")
        self.assertEqual(segments["pC"], "single")
        self.assertEqual(segments["pA3"], "last")


class TestPersistentQueueBatchMetadata(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.temp_file = os.path.join(self.temp_dir.name, "test_persistent_queue.json")
        self.patcher = patch("nodes.queue_control.PERSISTENT_FILE", self.temp_file)
        self.patcher.start()
        self.enabled_patcher = patch("nodes.queue_control.is_persistent_queue_enabled", return_value=True)
        self.enabled_patcher.start()

    def tearDown(self):
        self.enabled_patcher.stop()
        self.patcher.stop()
        self.temp_dir.cleanup()

    def test_save_and_restore_batch_info(self):
        mgr = PersistentQueueManager()
        
        # Set batch info for a prompt
        batch_data = {
            "batchId": "b_12345",
            "batchNumber": 5,
            "batchCount": 3,
            "itemIndex": 0,
            "color": "#10b981",
            "colorIndex": 4
        }
        mgr.set_batch_info("prompt_99", batch_data)
        self.assertIn("prompt_99", mgr.batch_meta)

        # Add item to persistent queue
        item_tuple = (0, "prompt_99", {"prompt": {}}, {}, {})
        mgr.add_item(item_tuple)
        mgr.flush()

        # Verify batch_info is attached inside persistent_items
        saved_entry = [x for x in mgr.persistent_items if x["prompt_id"] == "prompt_99"][0]
        self.assertEqual(saved_entry.get("batch_info"), batch_data)

        # Simulate reload from disk
        new_mgr = PersistentQueueManager()
        self.assertIn("prompt_99", new_mgr.batch_meta)
        self.assertEqual(new_mgr.batch_meta["prompt_99"]["batchId"], "b_12345")

    def test_remove_item_cleans_batch_meta(self):
        mgr = PersistentQueueManager()
        mgr.set_batch_info("p1", {"batchId": "b1"})
        mgr.add_item((0, "p1", {}, {}, {}))
        self.assertIn("p1", mgr.batch_meta)

        mgr.remove_item("p1")
        mgr.flush()
        self.assertNotIn("p1", mgr.batch_meta)
        self.assertEqual(len(mgr.persistent_items), 0)

    def test_wipe_all_cleans_batch_meta(self):
        mgr = PersistentQueueManager()
        mgr.set_batch_info("p1", {"batchId": "b1"})
        mgr.set_batch_info("p2", {"batchId": "b2"})
        mgr.wipe_all()
        self.assertEqual(len(mgr.batch_meta), 0)
        self.assertEqual(len(mgr.persistent_items), 0)


class TestPersistentQueueHardening(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.temp_file = os.path.join(self.temp_dir.name, "test_persistent_queue.json")
        self.patch_file = patch("nodes.queue_control.PERSISTENT_FILE", self.temp_file)
        self.patch_user = patch("nodes.queue_control.USER_DIR", self.temp_dir.name)
        self.patch_enabled = patch("nodes.queue_control.is_persistent_queue_enabled", return_value=True)
        self.patch_file.start()
        self.patch_user.start()
        self.patch_enabled.start()

    def tearDown(self):
        self.patch_enabled.stop()
        self.patch_user.stop()
        self.patch_file.stop()
        self.temp_dir.cleanup()

    def test_finished_prompt_cannot_be_resynced(self):
        mgr = PersistentQueueManager()
        mgr.set_batch_info("p1", {"batchId": "b1"})
        mgr.add_item((0, "p1", {}, {}, {}))
        mgr.remove_item("p1")

        # A late /saturnnodes/batch_queue/sync from another client must not
        # resurrect metadata for a prompt that already finished.
        mgr.set_batch_info("p1", {"batchId": "b1"})
        self.assertNotIn("p1", mgr.batch_meta)

    def test_batch_meta_is_capped_keeping_recent_entries(self):
        mgr = PersistentQueueManager()
        mgr.MAX_BATCH_META = 3
        with patch("nodes.queue_control.time.time", side_effect=[1, 2, 3, 4, 5]):
            for i in range(5):
                mgr.set_batch_info(f"p{i}", {"batchId": f"b{i}"})

        self.assertEqual(len(mgr.batch_meta), 3)
        self.assertNotIn("p0", mgr.batch_meta)
        self.assertNotIn("p1", mgr.batch_meta)
        self.assertIn("p2", mgr.batch_meta)
        self.assertIn("p4", mgr.batch_meta)

    def test_saves_are_debounced_compact_and_flushable(self):
        mgr = PersistentQueueManager()
        mgr.add_item((0, "p1", {"prompt": {}}, {}, {}))
        # The first write is deliberately deferred; memory is authoritative.
        self.assertTrue(mgr._save_dirty)
        mgr.flush()

        self.assertFalse(mgr._save_dirty)
        self.assertTrue(os.path.exists(self.temp_file))
        with open(self.temp_file, "r", encoding="utf-8") as f:
            raw = f.read()
        # Compact JSON (no indentation/newlines) keeps the file small.
        self.assertNotIn("\n", raw)
        self.assertEqual(json.loads(raw)[0]["prompt_id"], "p1")
        self.assertFalse(os.path.exists(self.temp_file + ".tmp"))

    def test_restore_retry_setting_keeps_then_drops_failed_prompts(self):
        mgr = PersistentQueueManager()
        mgr.persistent_items = [{
            "prompt_id": "p1",
            "item": [0, "p1", {"prompt": {}}, {}],
            "retries": 0,
        }]

        server = MagicMock()
        server.prompt_queue.get_history.return_value = {}
        server.prompt_queue.put.side_effect = RuntimeError("queue unavailable")
        server.number = 0

        def fake_setting(key, default):
            return "1" if key == "PERSISTENT_QUEUE_MAX_RETRIES" else default

        with patch("nodes.queue_control.PromptServer.instance", server), \
             patch("nodes.queue_control.get_env_setting", side_effect=fake_setting):
            mgr.restore_queue("test-client")
            self.assertEqual(len(mgr.persistent_items), 1)
            self.assertEqual(mgr.persistent_items[0]["retries"], 1)

            mgr.has_claimed_once = False
            mgr.restore_queue("test-client")
            self.assertEqual(len(mgr.persistent_items), 0)
            self.assertIn("p1", mgr.recently_finished)

    def test_pause_state_persists_when_enabled(self):
        def fake_setting(key, default):
            if key == "PERSIST_PAUSE_STATE":
                return "true"
            return default

        with patch("nodes.queue_control.get_env_setting", side_effect=fake_setting):
            first = PauseQueueManager()
            first.set_pause(True, "instantly")
            second = PauseQueueManager()

        self.assertTrue(second.paused)
        self.assertEqual(second.mode, "instantly")
        self.assertEqual(second.is_waiting, True)


class TestPauseQueuePatchedGet(unittest.TestCase):
    def test_finite_timeout_returns_instead_of_busy_spinning(self):
        class FakeQueue:
            def __init__(self):
                self.currently_running = {}
                self.mutex = threading.RLock()
                self.calls = 0
                self.last_timeout = object()

            def get(self, timeout=None):
                self.calls += 1
                self.last_timeout = timeout
                return None

        queue = FakeQueue()
        server = MagicMock()
        server.prompt_queue = queue

        def fake_setting(key, default):
            return default

        with patch("nodes.queue_control.get_env_setting", side_effect=fake_setting), \
             patch.object(queue_control.PromptServer, "instance", server):
            manager = PauseQueueManager()
            manager.patch_all()
            # ComfyUI main.py calls get(timeout=0.0) when a GC pass is due.
            # The wrapper must return immediately (not spin forever).
            self.assertIsNone(queue.get(timeout=0.0))
            self.assertEqual(queue.calls, 1)
            self.assertEqual(queue.last_timeout, 0.0)


if __name__ == "__main__":
    unittest.main()

import os
import sys
import json
import time
import shutil
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import test_helper

import nodes.lora_loader as lora_loader
from nodes.lora_loader import (
    select_a_lora,
    save_lora_cycle_state,
    load_lora_cycle_state,
    increment_lora_usage,
    flush_lora_usage,
    load_usage_data,
    reset_lora_usage_file,
    get_file_sha256_cached,
)


class TestLoraSelection(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.mkdtemp()
        self.old_state_file = lora_loader.LORA_STATE_FILE
        self.old_user_dir = lora_loader.USER_DIR
        self.old_usage_cache = lora_loader._USAGE_CACHE
        self.old_usage_dirty = lora_loader._USAGE_DIRTY
        self.old_usage_timer = lora_loader._USAGE_TIMER
        self.old_flush_delay = lora_loader._USAGE_FLUSH_DELAY
        self.old_hash_cache = lora_loader._HASH_CACHE
        self.old_hash_cache_file = lora_loader.HASH_CACHE_FILE

        lora_loader.LORA_STATE_FILE = os.path.join(self.temp_dir, "lora_loader_state.json")
        lora_loader.HASH_CACHE_FILE = os.path.join(self.temp_dir, "lora_hash_cache.json")
        lora_loader.USER_DIR = self.temp_dir
        lora_loader._USAGE_CACHE = None
        lora_loader._USAGE_DIRTY = False
        lora_loader._USAGE_TIMER = None
        lora_loader._USAGE_FLUSH_DELAY = 60.0
        lora_loader._HASH_CACHE = None

    def tearDown(self):
        if lora_loader._USAGE_TIMER is not None:
            lora_loader._USAGE_TIMER.cancel()
        lora_loader.LORA_STATE_FILE = self.old_state_file
        lora_loader.USER_DIR = self.old_user_dir
        lora_loader._USAGE_CACHE = self.old_usage_cache
        lora_loader._USAGE_DIRTY = self.old_usage_dirty
        lora_loader._USAGE_TIMER = self.old_usage_timer
        lora_loader._USAGE_FLUSH_DELAY = self.old_flush_delay
        lora_loader._HASH_CACHE = self.old_hash_cache
        lora_loader.HASH_CACHE_FILE = self.old_hash_cache_file
        shutil.rmtree(self.temp_dir, ignore_errors=True)

    def test_sequential_advances_and_retry_does_not_advance(self):
        choices = ["A", "B", "C"]
        self.assertEqual(select_a_lora("Sequential", "node1", choices, "p1"), "A")
        self.assertEqual(select_a_lora("Sequential", "node1", choices, "p2"), "B")
        # Crash recovery / retry returns the assigned item without double-advancing.
        self.assertEqual(select_a_lora("Sequential", "node1", choices, "p1"), "A")
        self.assertEqual(select_a_lora("Sequential", "node1", choices, "p3"), "C")
        self.assertEqual(select_a_lora("Sequential", "node1", choices, "p4"), "A")

    def test_no_replace_cycles_all_items_and_avoids_immediate_repeat(self):
        choices = ["A", "B", "C"]
        first_cycle = [
            select_a_lora("Random (No Replace)", "node2", choices, f"c1-{i}")
            for i in range(3)
        ]
        self.assertEqual(set(first_cycle), {"A", "B", "C"})

        second_cycle = [
            select_a_lora("Random (No Replace)", "node2", choices, f"c2-{i}")
            for i in range(3)
        ]
        self.assertEqual(set(second_cycle), {"A", "B", "C"})
        # The first pick of a new cycle must not repeat the final pick of the
        # previous cycle back-to-back.
        self.assertNotEqual(second_cycle[0], first_cycle[-1])

    def test_no_replace_retry_does_not_consume_pool(self):
        choices = ["A", "B", "C", "D"]
        first = select_a_lora("Random (No Replace)", "node3", choices, "retry-1")
        state_before = load_lora_cycle_state()
        key = list(state_before.keys())[0]
        pool_before = list(state_before[key]["pool"])

        retried = select_a_lora("Random (No Replace)", "node3", choices, "retry-1")
        state_after = load_lora_cycle_state()
        self.assertEqual(first, retried)
        self.assertEqual(state_after[key]["pool"], pool_before)

    def test_assigned_map_is_pruned_but_recent_retry_survives(self):
        choices = ["A", "B", "C"]
        for i in range(60):
            select_a_lora("Sequential", "node4", choices, f"prompt-{i}")

        state = load_lora_cycle_state()
        key = list(state.keys())[0]
        assigned = state[key]["assigned"]
        self.assertLessEqual(len(assigned), 50)
        self.assertNotIn("prompt-0", assigned)
        self.assertIn("prompt-59", assigned)

        # Retrying an old prompt that is no longer tracked simply picks a new
        # item instead of crashing, and the map stays bounded.
        select_a_lora("Sequential", "node4", choices, "prompt-0")
        state = load_lora_cycle_state()
        self.assertLessEqual(len(state[key]["assigned"]), 50)

    def test_global_state_prune_keeps_recent_entries(self):
        state = {}
        for i in range(105):
            state[f"seq_node_{i}"] = {"index": 0, "assigned": {}, "last_updated": i}

        save_lora_cycle_state(state)

        self.assertEqual(len(state), 100)
        self.assertNotIn("seq_node_0", state)
        self.assertNotIn("seq_node_4", state)
        self.assertIn("seq_node_5", state)
        self.assertIn("seq_node_104", state)

    def test_usage_increments_are_batched_until_flush(self):
        self.assertEqual(load_usage_data(), {})
        with patch("nodes.lora_loader.get_env_setting", return_value="true"):
            increment_lora_usage("folder/alpha_one.safetensors")
            increment_lora_usage("folder/alpha_one.safetensors")
            increment_lora_usage("folder/beta_two.safetensors")
            # Nothing written yet, but the in-memory view is already current.
            self.assertEqual(load_usage_data().get("One"), 2)
            flush_lora_usage()

        usage_file = os.path.join(self.temp_dir, "lora_usage.json")
        self.assertTrue(os.path.exists(usage_file))
        with open(usage_file, "r", encoding="utf-8") as f:
            raw = json.load(f)
        self.assertEqual(raw.get("One"), 2)
        self.assertEqual(raw.get("Two"), 1)

        reset_lora_usage_file()
        self.assertEqual(load_usage_data(), {})

    def test_sha256_cache_reuses_unchanged_file(self):
        lora_file = os.path.join(self.temp_dir, "lora.safetensors")
        with open(lora_file, "wb") as f:
            f.write(b"weights-v1")

        with patch("nodes.lora_loader.get_file_sha256", return_value="HASH-1") as mock_hash:
            first = get_file_sha256_cached(lora_file)
            second = get_file_sha256_cached(lora_file)
            self.assertEqual((first, second), ("HASH-1", "HASH-1"))
            self.assertEqual(mock_hash.call_count, 1)

            # A changed mtime/size invalidates the cached hash.
            with open(lora_file, "ab") as f:
                f.write(b"-more")
            future = time.time() + 5
            os.utime(lora_file, (future, future))
            get_file_sha256_cached(lora_file)
            self.assertEqual(mock_hash.call_count, 2)


if __name__ == "__main__":
    unittest.main()

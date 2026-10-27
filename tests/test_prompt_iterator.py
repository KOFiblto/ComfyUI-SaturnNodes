import os
import sys
import unittest
import tempfile
import json
import shutil
import time
from unittest.mock import patch

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import test_helper

from nodes.prompt_iterator import (
    PromptQueueIterator,
    parse_prompt_blocks,
    load_state,
    save_state,
    reset_node_state,
    invalidate_state_cache,
)
import nodes.prompt_iterator as pi

class TestPromptQueueIterator(unittest.TestCase):
    def setUp(self):
        self.node = PromptQueueIterator()
        self.temp_dir = tempfile.mkdtemp()
        self.state_file = os.path.join(self.temp_dir, "test_state.json")

    def tearDown(self):
        shutil.rmtree(self.temp_dir, ignore_errors=True)

    def test_parse_prompt_blocks_newline(self):
        text = "Prompt 1\nPrompt 2\n\nPrompt 3"
        blocks = parse_prompt_blocks(text, separator="Newline")
        self.assertEqual(blocks, ["Prompt 1", "Prompt 2", "Prompt 3"])

    def test_parse_prompt_blocks_empty_lines(self):
        text = "Block 1 line 1\nBlock 1 line 2\n\nBlock 2"
        blocks = parse_prompt_blocks(text, separator=">1 Empty Line")
        self.assertEqual(len(blocks), 2)
        self.assertEqual(blocks[0], "Block 1 line 1\nBlock 1 line 2")
        self.assertEqual(blocks[1], "Block 2")

    def test_parse_prompt_blocks_custom_regex(self):
        text = "Prompt A\n---\nPrompt B\n---\nPrompt C"
        blocks = parse_prompt_blocks(text, separator="Custom Regex", custom_regex=r"\n---\n")
        self.assertEqual(blocks, ["Prompt A", "Prompt B", "Prompt C"])

    def test_parse_prompt_blocks_custom_regex_capturing_group(self):
        text = "Prompt A\n---\nPrompt B\n---\nPrompt C"
        blocks = parse_prompt_blocks(text, separator="Custom Regex", custom_regex=r"(\n---\n)")
        self.assertEqual(blocks, ["Prompt A", "Prompt B", "Prompt C"])

    def test_parse_prompt_blocks_custom_regex_invalid_fallback(self):
        text = "Prompt 1\n\nPrompt 2"
        # Invalid regex [unterminated class
        blocks = parse_prompt_blocks(text, separator="Custom Regex", custom_regex=r"[unterminated")
        self.assertEqual(blocks, ["Prompt 1", "Prompt 2"])

    def test_sequential_10_batch_execution(self):
        """
        Verify that 10 prompts are executed in exact sequential order (0 to 9).
        """
        prompts_10 = "\n\n".join([f"Prompt A{i}" for i in range(10)])
        state_db = {}

        def mock_load():
            return dict(state_db)

        def mock_save(new_state):
            nonlocal state_db
            state_db = dict(new_state)

        with patch("nodes.prompt_iterator.load_state", side_effect=mock_load), \
             patch("nodes.prompt_iterator.save_state", side_effect=mock_save), \
             patch("nodes.prompt_iterator.PromptServer.instance.send_sync"):

            for expected_idx in range(10):
                p, rem_text, rem_count, exhausted = self.node.process_queue(
                    pop_mode="Sequential (Loop on End)",
                    separator=">1 Empty Line",
                    text=prompts_10,
                    unique_id="node_10_test"
                )
                self.assertEqual(p, f"Prompt A{expected_idx}")
                self.assertEqual(rem_count, 10 - (expected_idx + 1))

    def test_linked_prompt_input_wins_over_stale_text(self):
        """
        A connected `prompt` input is authoritative; the local multiline `text`
        widget must not replay stale characters from an earlier session.
        """
        state_db = {}

        def mock_load():
            return dict(state_db)

        def mock_save(new_state):
            nonlocal state_db
            state_db = dict(new_state)

        stale_text = "stale one\n\nstale two"
        linked_text = "linked one\n\nlinked two"

        with patch("nodes.prompt_iterator.load_state", side_effect=mock_load), \
             patch("nodes.prompt_iterator.save_state", side_effect=mock_save), \
             patch("nodes.prompt_iterator.PromptServer.instance.send_sync"):

            p0, _, _, _ = self.node.process_queue(
                text=stale_text, prompt=linked_text, unique_id="linked_node"
            )
            p1, _, _, _ = self.node.process_queue(
                text=stale_text, prompt=linked_text, unique_id="linked_node"
            )

        self.assertEqual(p0, "linked one")
        self.assertEqual(p1, "linked two")

    def test_linked_empty_prompt_does_not_replay_local_text(self):
        """An empty linked prompt produces no run, even if `text` is stale."""
        p, remaining, count, exhausted = self.node.process_queue(
            text="stale prompt text", prompt="", unique_id="linked_empty"
        )
        self.assertEqual(p, "")
        self.assertEqual(remaining, "")
        self.assertEqual(count, 0)
        self.assertFalse(exhausted)

    def test_multi_pack_isolation_pack_a_and_pack_b(self):
        """
        Verify Pack A (10 prompts) and Pack B (5 prompts) run with complete isolation.
        """
        pack_a = "\n\n".join([f"PackA_{i}" for i in range(10)])
        pack_b = "\n\n".join([f"PackB_{i}" for i in range(5)])
        state_db = {}

        def mock_load():
            return dict(state_db)

        def mock_save(new_state):
            nonlocal state_db
            state_db = dict(new_state)

        with patch("nodes.prompt_iterator.load_state", side_effect=mock_load), \
             patch("nodes.prompt_iterator.save_state", side_effect=mock_save), \
             patch("nodes.prompt_iterator.PromptServer.instance.send_sync"):

            # Run 3 items of Pack A
            p0, _, _, _ = self.node.process_queue(text=pack_a, unique_id="shared_node")
            p1, _, _, _ = self.node.process_queue(text=pack_a, unique_id="shared_node")
            p2, _, _, _ = self.node.process_queue(text=pack_a, unique_id="shared_node")
            self.assertEqual(p0, "PackA_0")
            self.assertEqual(p1, "PackA_1")
            self.assertEqual(p2, "PackA_2")

            # Run Pack B -> Must start cleanly at PackB_0!
            pb0, _, _, _ = self.node.process_queue(text=pack_b, unique_id="shared_node")
            pb1, _, _, _ = self.node.process_queue(text=pack_b, unique_id="shared_node")
            self.assertEqual(pb0, "PackB_0")
            self.assertEqual(pb1, "PackB_1")

            # Switch back to Pack A -> Must continue at PackA_3!
            p3, _, _, _ = self.node.process_queue(text=pack_a, unique_id="shared_node")
            self.assertEqual(p3, "PackA_3")

    def test_text_modification_resets_counter_to_zero(self):
        """
        Changing the prompt text (deleting 3 items) creates a new hash and starts at 0.
        """
        pack_10 = "\n\n".join([f"Item_{i}" for i in range(10)])
        pack_7 = "\n\n".join([f"Item_{i}" for i in range(7)]) # 3 deleted
        state_db = {}

        def mock_load():
            return dict(state_db)

        def mock_save(new_state):
            nonlocal state_db
            state_db = dict(new_state)

        with patch("nodes.prompt_iterator.load_state", side_effect=mock_load), \
             patch("nodes.prompt_iterator.save_state", side_effect=mock_save), \
             patch("nodes.prompt_iterator.PromptServer.instance.send_sync"):

            # Run 2 items of 10-pack
            self.node.process_queue(text=pack_10, unique_id="edit_node")
            self.node.process_queue(text=pack_10, unique_id="edit_node")

            # Switch to edited 7-pack -> Must start at Item_0!
            first_of_7, _, rem_count, _ = self.node.process_queue(text=pack_7, unique_id="edit_node")
            self.assertEqual(first_of_7, "Item_0")
            self.assertEqual(rem_count, 6)

    def test_forced_counter_reset(self):
        """
        Manual counter reset forces next execution back to 0.
        """
        pack = "P0\n\nP1\n\nP2\n\nP3"
        state_db = {}

        def mock_load():
            return dict(state_db)

        def mock_save(new_state):
            nonlocal state_db
            state_db = dict(new_state)

        with patch("nodes.prompt_iterator.load_state", side_effect=mock_load), \
             patch("nodes.prompt_iterator.save_state", side_effect=mock_save), \
             patch("nodes.prompt_iterator.PromptServer.instance.send_sync"):

            # Run P0, P1
            p0, _, _, _ = self.node.process_queue(text=pack, unique_id="reset_test")
            p1, _, _, _ = self.node.process_queue(text=pack, unique_id="reset_test")
            self.assertEqual(p0, "P0")
            self.assertEqual(p1, "P1")

            # Simulate Reset Counter (set index to 0)
            for k in list(state_db.keys()):
                if "reset_test" in k:
                    state_db[k]["index"] = 0

            # Next run must be P0 again!
            p0_again, _, _, _ = self.node.process_queue(text=pack, unique_id="reset_test")
            self.assertEqual(p0_again, "P0")

    def test_crash_recovery_assigned_prompt_id_retains_index(self):
        """
        Verify that if a prompt is interrupted/restored with the same prompt_id,
        it re-executes the exact same prompt index instead of skipping ahead.
        """
        pack = "Prompt 0\n\nPrompt 1\n\nPrompt 2"
        state_db = {}

        def mock_load():
            return dict(state_db)

        def mock_save(new_state):
            nonlocal state_db
            state_db = dict(new_state)

        with patch("nodes.prompt_iterator.load_state", side_effect=mock_load), \
             patch("nodes.prompt_iterator.save_state", side_effect=mock_save), \
             patch("nodes.prompt_iterator.PromptServer.instance.send_sync"):

            # 1. First execution with prompt_id = "job-uuid-1" -> gets Prompt 0
            with patch("nodes.prompt_iterator.get_current_prompt_id", return_value="job-uuid-1"):
                p0, _, _, _ = self.node.process_queue(text=pack, unique_id="recover_node")
                self.assertEqual(p0, "Prompt 0")

            # 2. Workflow is interrupted mid-way and restored by persistent queue (same prompt_id "job-uuid-1")
            with patch("nodes.prompt_iterator.get_current_prompt_id", return_value="job-uuid-1"):
                p0_retry, _, _, _ = self.node.process_queue(text=pack, unique_id="recover_node")
                # Must STILL be Prompt 0, NOT Prompt 1!
                self.assertEqual(p0_retry, "Prompt 0")

            # 3. Next workflow run with new prompt_id = "job-uuid-2" -> gets Prompt 1!
            with patch("nodes.prompt_iterator.get_current_prompt_id", return_value="job-uuid-2"):
                p1, _, _, _ = self.node.process_queue(text=pack, unique_id="recover_node")
                self.assertEqual(p1, "Prompt 1")

    def test_per_node_hash_pruning(self):
        """
        Verify that editing text in a node cleans up old abandoned text hashes beyond 3 entries.
        """
        state_db = {}

        def mock_load():
            return dict(state_db)

        def mock_save(new_state):
            nonlocal state_db
            state_db = dict(new_state)

        with patch("nodes.prompt_iterator.load_state", side_effect=mock_load), \
             patch("nodes.prompt_iterator.save_state", side_effect=mock_save), \
             patch("nodes.prompt_iterator.PromptServer.instance.send_sync"):

            # Create 6 text variants on the same node
            for i in range(6):
                text_variant = f"Variant {i} text"
                self.node.process_queue(text=text_variant, unique_id="prune_node")

            # Only at most 3 entries for 'prune_node' should remain in state
            matching_keys = [k for k in state_db.keys() if k.startswith("node_prune_node_")]
            self.assertLessEqual(len(matching_keys), 3)

    def test_random_cycle_permutation(self):
        """
        Verify that Random (Cycle) mode visits all items in a permutation before repeating.
        """
        pack = "A\n\nB\n\nC\n\nD\n\nE"
        state_db = {}

        def mock_load():
            return dict(state_db)

        def mock_save(new_state):
            nonlocal state_db
            state_db = dict(new_state)

        with patch("nodes.prompt_iterator.load_state", side_effect=mock_load), \
             patch("nodes.prompt_iterator.save_state", side_effect=mock_save), \
             patch("nodes.prompt_iterator.PromptServer.instance.send_sync"):

            picked = []
            for _ in range(5):
                p, _, _, _ = self.node.process_queue(
                    pop_mode="Random (Cycle)",
                    text=pack,
                    unique_id="cycle_test_node"
                )
                picked.append(p)

            # All 5 unique items must have been visited in 1 cycle
            self.assertEqual(len(picked), 5)
            self.assertEqual(set(picked), {"A", "B", "C", "D", "E"})

    def test_separator_and_mode_isolate_state_keys(self):
        """Changing the splitter/mode must not continue another config's pointer."""
        pack = "A\n\nB\n\nC"
        state_db = {}

        with patch("nodes.prompt_iterator.load_state", side_effect=lambda: dict(state_db)), \
             patch("nodes.prompt_iterator.save_state", side_effect=lambda s: state_db.update(s)), \
             patch("nodes.prompt_iterator.PromptServer.instance.send_sync"):
            a0, _, _, _ = self.node.process_queue(
                separator=">1 Empty Line", text=pack, unique_id="cfg_node")
            a1, _, _, _ = self.node.process_queue(
                separator=">1 Empty Line", text=pack, unique_id="cfg_node")
            self.assertEqual((a0, a1), ("A", "B"))

            # Newline splitter is a different config and must start at index 0.
            n0, _, _, _ = self.node.process_queue(
                separator="Newline", text=pack, unique_id="cfg_node")
            self.assertEqual(n0, "A")

            # Random mode with the same splitter is also a different config.
            r0, _, _, _ = self.node.process_queue(
                pop_mode="Random (Keep)", separator=">1 Empty Line", text=pack, unique_id="cfg_node")
            self.assertIn(r0, {"A", "B", "C"})

            # Returning to the original config resumes at C.
            a2, _, _, _ = self.node.process_queue(
                separator=">1 Empty Line", text=pack, unique_id="cfg_node")
            self.assertEqual(a2, "C")

    def test_input_types_preserve_legacy_widget_positions(self):
        # New widgets must be appended, never inserted in the middle: ComfyUI
        # restores workflow widget values positionally.
        spec = PromptQueueIterator.INPUT_TYPES()
        self.assertEqual(list(spec["required"].keys()), ["pop_mode", "separator", "text"])
        self.assertEqual(list(spec["optional"].keys())[:2], ["custom_regex", "track_by"])

    def test_track_by_node_only_shares_pointer_across_text_edits(self):
        state_db = {}

        with patch("nodes.prompt_iterator.load_state", side_effect=lambda: dict(state_db)), \
             patch("nodes.prompt_iterator.save_state", side_effect=lambda s: state_db.update(s)), \
             patch("nodes.prompt_iterator.PromptServer.instance.send_sync"):
            p0, _, _, _ = self.node.process_queue(
                text="A\n\nB\n\nC", unique_id="node_track", track_by="Node Only")
            self.assertEqual(p0, "A")

            # The edited prompt pack keeps the same pointer (index 1 -> Y).
            p1, _, _, _ = self.node.process_queue(
                text="X\n\nY\n\nZ", unique_id="node_track", track_by="Node Only")
            self.assertEqual(p1, "Y")

            # Default tracking starts the edited pack from the beginning.
            d0, _, _, _ = self.node.process_queue(
                text="X\n\nY\n\nZ", unique_id="text_track")
            self.assertEqual(d0, "X")

    def test_stop_on_end_exhausted_flag_and_remaining(self):
        state_db = {}

        with patch("nodes.prompt_iterator.load_state", side_effect=lambda: dict(state_db)), \
             patch("nodes.prompt_iterator.save_state", side_effect=lambda s: state_db.update(s)), \
             patch("nodes.prompt_iterator.PromptServer.instance.send_sync"):
            p0, rem0, count0, exhausted0 = self.node.process_queue(
                pop_mode="Sequential (Stop on End)", text="A\n\nB", unique_id="stop_node")
            self.assertEqual((p0, rem0, count0, exhausted0), ("A", "B", 1, False))

            p1, rem1, count1, exhausted1 = self.node.process_queue(
                pop_mode="Sequential (Stop on End)", text="A\n\nB", unique_id="stop_node")
            self.assertEqual((p1, rem1, count1, exhausted1), ("B", "", 0, True))

            # Further runs keep returning the final prompt and report exhaustion.
            p2, _, count2, exhausted2 = self.node.process_queue(
                pop_mode="Sequential (Stop on End)", text="A\n\nB", unique_id="stop_node")
            self.assertEqual((p2, count2, exhausted2), ("B", 0, True))

    def test_random_cycle_remaining_follows_shuffle_order(self):
        state_db = {}

        with patch("nodes.prompt_iterator.load_state", side_effect=lambda: dict(state_db)), \
             patch("nodes.prompt_iterator.save_state", side_effect=lambda s: state_db.update(s)), \
             patch("nodes.prompt_iterator.PromptServer.instance.send_sync"), \
             patch("nodes.prompt_iterator.random.shuffle", side_effect=lambda seq: seq.reverse()):
            results = []
            for _ in range(4):
                results.append(self.node.process_queue(
                    pop_mode="Random (Cycle)", text="A\n\nB\n\nC\n\nD", unique_id="cycle_rem"))

            # Reversed order is D, C, B, A.
            self.assertEqual([r[0] for r in results], ["D", "C", "B", "A"])
            self.assertEqual([r[2] for r in results], [3, 2, 1, 0])
            self.assertEqual(results[0][1], "C\n\nB\n\nA")
            self.assertEqual(results[1][1], "B\n\nA")
            self.assertEqual(results[2][1], "A")
            self.assertEqual(results[3][1], "")

    def test_hard_reset_clears_assignments_and_shuffle(self):
        state = {
            "node_42_aaaa_1111": {
                "index": 3,
                "last_run": 3,
                "assigned_prompts": {"prompt-a": 1, "prompt-b": 2},
                "shuffled_order": [1, 0, 2],
            },
            "node_42": {"index": 2, "assigned_prompts": {"prompt-c": 0}},
            "node_99_bbbb_2222": {"index": 5, "assigned_prompts": {"keep": 1}},
        }

        matched = reset_node_state(state, "42")

        self.assertTrue(matched)
        self.assertEqual(state["node_42_aaaa_1111"]["index"], 0)
        self.assertEqual(state["node_42_aaaa_1111"]["last_run"], 0)
        self.assertEqual(state["node_42_aaaa_1111"]["assigned_prompts"], {})
        self.assertEqual(state["node_42_aaaa_1111"]["shuffled_order"], [])
        self.assertEqual(state["node_42"]["assigned_prompts"], {})
        # Other nodes are untouched.
        self.assertEqual(state["node_99_bbbb_2222"]["index"], 5)
        self.assertEqual(state["node_99_bbbb_2222"]["assigned_prompts"], {"keep": 1})

    def test_global_prune_keeps_most_recent_entries(self):
        state = {}
        for i in range(105):
            state[f"node_prune_{i}_{i}"] = {"index": 0, "last_updated": i}

        old_file = pi.STATE_FILE
        old_user = pi.USER_DIR
        pi.STATE_FILE = os.path.join(self.temp_dir, "prune_state.json")
        pi.USER_DIR = self.temp_dir
        try:
            save_state(state)
        finally:
            pi.STATE_FILE = old_file
            pi.USER_DIR = old_user
            invalidate_state_cache()

        self.assertEqual(len(state), 100)
        self.assertNotIn("node_prune_0_0", state)
        self.assertNotIn("node_prune_4_4", state)
        self.assertIn("node_prune_5_5", state)
        self.assertIn("node_prune_104_104", state)

    def test_load_state_uses_mtime_cache_and_returns_copies(self):
        state_file = os.path.join(self.temp_dir, "cache_state.json")
        old_file = pi.STATE_FILE
        old_user = pi.USER_DIR
        pi.STATE_FILE = state_file
        pi.USER_DIR = self.temp_dir
        try:
            invalidate_state_cache()
            save_state({"node_a": {"index": 1, "last_updated": 1}})
            first = load_state()
            first["node_a"]["index"] = 999  # Must not mutate the cache.
            second = load_state()
            self.assertEqual(second["node_a"]["index"], 1)

            # External edit (new mtime) must invalidate the in-memory cache.
            with open(state_file, "w", encoding="utf-8") as f:
                json.dump({"node_a": {"index": 7, "last_updated": 2}}, f)
            future = time.time() + 5
            os.utime(state_file, (future, future))
            third = load_state()
            self.assertEqual(third["node_a"]["index"], 7)
        finally:
            pi.STATE_FILE = old_file
            pi.USER_DIR = old_user
            invalidate_state_cache()

if __name__ == "__main__":
    unittest.main()

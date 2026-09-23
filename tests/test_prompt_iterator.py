import os
import sys
import unittest
import tempfile
import json
import shutil
from unittest.mock import patch

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import test_helper

from nodes.prompt_iterator import PromptQueueIterator, parse_prompt_blocks, load_state, save_state

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
                p, rem_text, rem_count = self.node.process_queue(
                    pop_mode="Sequential (Loop on End)",
                    separator=">1 Empty Line",
                    text=prompts_10,
                    unique_id="node_10_test"
                )
                self.assertEqual(p, f"Prompt A{expected_idx}")
                self.assertEqual(rem_count, 10 - (expected_idx + 1))

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
            p0, _, _ = self.node.process_queue(text=pack_a, unique_id="shared_node")
            p1, _, _ = self.node.process_queue(text=pack_a, unique_id="shared_node")
            p2, _, _ = self.node.process_queue(text=pack_a, unique_id="shared_node")
            self.assertEqual(p0, "PackA_0")
            self.assertEqual(p1, "PackA_1")
            self.assertEqual(p2, "PackA_2")

            # Run Pack B -> Must start cleanly at PackB_0!
            pb0, _, _ = self.node.process_queue(text=pack_b, unique_id="shared_node")
            pb1, _, _ = self.node.process_queue(text=pack_b, unique_id="shared_node")
            self.assertEqual(pb0, "PackB_0")
            self.assertEqual(pb1, "PackB_1")

            # Switch back to Pack A -> Must continue at PackA_3!
            p3, _, _ = self.node.process_queue(text=pack_a, unique_id="shared_node")
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
            first_of_7, _, rem_count = self.node.process_queue(text=pack_7, unique_id="edit_node")
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
            p0, _, _ = self.node.process_queue(text=pack, unique_id="reset_test")
            p1, _, _ = self.node.process_queue(text=pack, unique_id="reset_test")
            self.assertEqual(p0, "P0")
            self.assertEqual(p1, "P1")

            # Simulate Reset Counter (set index to 0)
            for k in list(state_db.keys()):
                if "reset_test" in k:
                    state_db[k]["index"] = 0

            # Next run must be P0 again!
            p0_again, _, _ = self.node.process_queue(text=pack, unique_id="reset_test")
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
                p0, _, _ = self.node.process_queue(text=pack, unique_id="recover_node")
                self.assertEqual(p0, "Prompt 0")

            # 2. Workflow is interrupted mid-way and restored by persistent queue (same prompt_id "job-uuid-1")
            with patch("nodes.prompt_iterator.get_current_prompt_id", return_value="job-uuid-1"):
                p0_retry, _, _ = self.node.process_queue(text=pack, unique_id="recover_node")
                # Must STILL be Prompt 0, NOT Prompt 1!
                self.assertEqual(p0_retry, "Prompt 0")

            # 3. Next workflow run with new prompt_id = "job-uuid-2" -> gets Prompt 1!
            with patch("nodes.prompt_iterator.get_current_prompt_id", return_value="job-uuid-2"):
                p1, _, _ = self.node.process_queue(text=pack, unique_id="recover_node")
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
                p, _, _ = self.node.process_queue(
                    pop_mode="Random (Cycle)",
                    text=pack,
                    unique_id="cycle_test_node"
                )
                picked.append(p)

            # All 5 unique items must have been visited in 1 cycle
            self.assertEqual(len(picked), 5)
            self.assertEqual(set(picked), {"A", "B", "C", "D", "E"})

if __name__ == "__main__":
    unittest.main()

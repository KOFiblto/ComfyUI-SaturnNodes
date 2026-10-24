import json
import os
import sys
import tempfile
import threading
import unittest
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import test_helper  # noqa: F401  (redirects SaturnNodes state to a temp dir)

import nodes.queue_control as queue_control
from nodes.queue_control import PersistentQueueManager


def make_entry(prompt_id, priority=0, item_pid=None, create_time=1, extra=None):
    item = [
        priority,
        prompt_id if item_pid is None else item_pid,
        {"prompt": {}},
        {"client_id": "old-client", "create_time": create_time},
        [],
    ]
    entry = {"prompt_id": prompt_id, "item": item}
    if extra:
        entry.update(extra)
    return entry


class FakePromptQueue:
    def __init__(self, history=None):
        self.history = {} if history is None else history
        self.items = []
        self.mutex = threading.RLock()
        self.currently_running = {}
        self.queue = []
        self.fail_delete = False
        self.fail_wipe = False
        self.fail_ids = set()

    def get_history(self):
        return self.history

    def put(self, item):
        if item[1] in self.fail_ids:
            raise RuntimeError(f"cannot queue {item[1]}")
        self.items.append(item)
        self.queue.append(item)

    def task_done(self, item_id, history_result, status, process_item=None):
        self.currently_running.pop(item_id, None)

    def delete_queue_item(self, predicate):
        if self.fail_delete:
            raise RuntimeError("delete failed")
        self.queue = [item for item in self.queue if not predicate(item)]

    def wipe_queue(self):
        if self.fail_wipe:
            raise RuntimeError("wipe failed")
        self.queue = []


class TestPersistentQueueRestore(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.temp_file = os.path.join(self.temp_dir.name, "persistent_queue.json")
        self.patches = [
            patch("nodes.queue_control.PERSISTENT_FILE", self.temp_file),
            patch("nodes.queue_control.USER_DIR", self.temp_dir.name),
            patch("nodes.queue_control.is_persistent_queue_enabled", return_value=True),
            patch.object(
                PersistentQueueManager,
                "_schedule_save_locked",
                new=lambda self: None,
            ),
        ]
        for patcher in self.patches:
            patcher.start()
        self.manager = PersistentQueueManager()

    def tearDown(self):
        for patcher in reversed(self.patches):
            patcher.stop()
        self.temp_dir.cleanup()

    def _server(self, queue, number=0):
        return SimpleNamespace(
            prompt_queue=queue,
            number=number,
            queue_updated=MagicMock(),
            get_queue_status=MagicMock(return_value={}),
            send_sync=MagicMock(),
        )

    def _write_payload(self, payload):
        with open(self.temp_file, "w", encoding="utf-8") as handle:
            json.dump(payload, handle)

    def _read_payload(self):
        with open(self.temp_file, "r", encoding="utf-8") as handle:
            return json.load(handle)

    def test_normalize_entry_uses_top_level_prompt_id(self):
        raw = {"prompt_id": "top-level", "item": [0, "different", {"prompt": {}}]}
        entry = PersistentQueueManager._normalize_entry(raw)
        self.assertEqual(entry["prompt_id"], "top-level")
        self.assertEqual(entry["item"][1], "different")

        self.assertIsNone(PersistentQueueManager._normalize_entry(None))
        self.assertIsNone(PersistentQueueManager._normalize_entry({"prompt_id": "x", "item": "bad"}))
        self.assertIsNone(PersistentQueueManager._normalize_entry({"prompt_id": "x", "item": [0]}))
        self.assertIsNone(PersistentQueueManager._normalize_entry({"item": [0, ""]}))
        self.assertEqual(
            PersistentQueueManager._normalize_entry({"item": [0, "from-item"]})["prompt_id"],
            "from-item",
        )

    def test_normalize_items_repairs_and_dedupes_last_wins(self):
        first = make_entry("p1", priority=1)
        duplicate = make_entry("p1", priority=99)
        malformed = {"prompt_id": "bad", "item": "nope"}
        items, changed = PersistentQueueManager._normalize_items([first, malformed, duplicate])
        self.assertTrue(changed)
        self.assertEqual(len(items), 1)
        self.assertEqual(items[0]["prompt_id"], "p1")
        self.assertEqual(items[0]["item"][0], 99)

    def test_restore_repairs_mismatched_item_prompt_id(self):
        entry = make_entry("top-level", item_pid="wrong-id", priority=4)
        self.manager.persistent_items = [entry]
        queue = FakePromptQueue()
        server = self._server(queue, number=2)

        with patch.object(queue_control.PromptServer, "instance", server), \
             patch.object(queue_control.pause_manager, "set_pause"):
            self.manager.restore_queue("new-client")

        self.assertEqual(len(queue.items), 1)
        self.assertEqual(queue.items[0][1], "top-level")
        self.assertEqual(self.manager.persistent_items[0]["item"][1], "top-level")
        payload = self._read_payload()
        self.assertEqual(payload["items"][0]["item"][1], "top-level")

    def test_restore_drops_prompts_already_in_history(self):
        self.manager.persistent_items = [make_entry("finished"), make_entry("pending", priority=2)]
        queue = FakePromptQueue(history={"finished": {"status": "success"}})
        server = self._server(queue)

        with patch.object(queue_control.PromptServer, "instance", server), \
             patch.object(queue_control.pause_manager, "set_pause"):
            self.manager.restore_queue()

        self.assertEqual([item[1] for item in queue.items], ["pending"])
        self.assertEqual([x["prompt_id"] for x in self.manager.persistent_items], ["pending"])

    def test_restore_drops_malformed_entries(self):
        self.manager.persistent_items = [
            {"prompt_id": "short", "item": [0, "short"]},
            {"prompt_id": "bad-output", "item": [0, "bad-output", "not-a-dict"]},
            {"prompt_id": "valid", "item": [0, "valid", {"prompt": {}}, {}, []]},
        ]
        queue = FakePromptQueue()
        server = self._server(queue)

        with patch.object(queue_control.PromptServer, "instance", server), \
             patch.object(queue_control.pause_manager, "set_pause"):
            self.manager.restore_queue()

        self.assertEqual([item[1] for item in queue.items], ["valid"])
        self.assertEqual([x["prompt_id"] for x in self.manager.persistent_items], ["valid"])

    def test_restore_assigns_ordered_unique_create_times_and_client_id(self):
        self.manager.persistent_items = [
            make_entry("p1", priority=10),
            make_entry("p2", priority=5),
            make_entry("p3", priority=7),
        ]
        queue = FakePromptQueue()
        server = self._server(queue, number=3)

        with patch.object(queue_control.PromptServer, "instance", server), \
             patch.object(queue_control.pause_manager, "set_pause"), \
             patch("nodes.queue_control.time.time", return_value=2_000_000.0):
            self.manager.restore_queue("client-42")

        create_times = [item[3]["create_time"] for item in queue.items]
        self.assertEqual(create_times, [1_999_999_998, 1_999_999_999, 2_000_000_000])
        self.assertEqual(create_times, sorted(set(create_times)))
        for item in queue.items:
            self.assertEqual(item[3]["client_id"], "client-42")
        self.assertEqual(server.number, 11, "server priority counter must exceed restored items")

    def test_restore_retries_with_malformed_retry_counter(self):
        entry = make_entry("flaky", extra={"retries": "not-a-number"})
        self.manager.persistent_items = [entry]
        queue = FakePromptQueue()
        queue.fail_ids.add("flaky")
        server = self._server(queue)

        def env(key, default):
            if key == "PERSISTENT_QUEUE_MAX_RETRIES":
                return "2"
            return default

        with patch.object(queue_control.PromptServer, "instance", server), \
             patch.object(queue_control.pause_manager, "set_pause"), \
             patch("nodes.queue_control.get_env_setting", side_effect=env):
            self.manager.restore_queue()
            self.assertEqual(self.manager.persistent_items[0]["retries"], 1)

            self.manager.has_claimed_once = False
            self.manager.restore_queue()
            self.assertEqual(self.manager.persistent_items[0]["retries"], 2)

            self.manager.has_claimed_once = False
            self.manager.restore_queue()

        self.assertEqual(self.manager.persistent_items, [])
        self.assertEqual(queue.items, [])

    def test_restore_drops_after_first_failure_when_retries_disabled(self):
        self.manager.persistent_items = [make_entry("flaky")]
        queue = FakePromptQueue()
        queue.fail_ids.add("flaky")
        server = self._server(queue)

        with patch.object(queue_control.PromptServer, "instance", server), \
             patch.object(queue_control.pause_manager, "set_pause"):
            self.manager.restore_queue()

        self.assertEqual(self.manager.persistent_items, [])

    def test_restore_tolerates_history_read_failure(self):
        self.manager.persistent_items = [make_entry("p1")]
        queue = FakePromptQueue()

        def broken_history():
            raise RuntimeError("history unavailable")

        queue.get_history = broken_history
        server = self._server(queue)

        with patch.object(queue_control.PromptServer, "instance", server), \
             patch.object(queue_control.pause_manager, "set_pause"):
            self.manager.restore_queue()

        self.assertEqual([item[1] for item in queue.items], ["p1"])

    def test_restore_force_state_setting_is_case_insensitive(self):
        for setting, expected in (("force paused", True), ("FORCE RUNNING", False)):
            self.manager.persistent_items = [make_entry("p1")]
            self.manager.has_claimed_once = False
            queue = FakePromptQueue()
            server = self._server(queue)

            def env(key, default, value=setting):
                if key == "PERSISTENT_QUEUE_RESTORED_STATE":
                    return value
                return default

            with patch.object(queue_control.PromptServer, "instance", server), \
                 patch.object(queue_control.pause_manager, "set_pause") as set_pause, \
                 patch("nodes.queue_control.get_env_setting", side_effect=env):
                self.manager.restore_queue()

            set_pause.assert_called_once_with(expected)

    def test_restore_is_skipped_when_disabled_or_empty(self):
        queue = FakePromptQueue()
        server = self._server(queue)

        with patch.object(queue_control.PromptServer, "instance", server), \
             patch("nodes.queue_control.is_persistent_queue_enabled", return_value=False):
            self.manager.persistent_items = [make_entry("p1")]
            self.manager.restore_queue()
        self.assertTrue(self.manager.has_claimed_once)
        self.assertEqual(queue.items, [])

        self.manager.has_claimed_once = False
        self.manager.persistent_items = []
        with patch.object(queue_control.PromptServer, "instance", server):
            self.manager.restore_queue()
        self.assertEqual(queue.items, [])

    def test_newer_schema_file_is_not_overwritten_by_restore_or_add(self):
        original = {
            "schema_version": 99,
            "items": [{"prompt_id": "future", "item": [0, "future", {}, {}, []], "future_field": True}],
        }
        self._write_payload(original)
        self.manager.load_from_file()
        self.assertTrue(self.manager._read_only_newer_schema)
        self.assertEqual(self.manager.persistent_items, [])

        self.manager.add_item((0, "new", {"prompt": {}}, {}, []))
        self.manager.save_to_file(immediate=True)
        self.assertEqual(self._read_payload(), original)

    def test_load_from_file_rewrites_duplicate_entries(self):
        duplicate = make_entry("p1", priority=99)
        self._write_payload({
            "schema_version": 1,
            "items": [make_entry("p1", priority=1), duplicate],
        })
        manager = PersistentQueueManager()
        self.assertEqual(len(manager.persistent_items), 1)
        self.assertEqual(manager.persistent_items[0]["item"][0], 99)
        self.assertEqual(len(self._read_payload()["items"]), 1)

    def test_batch_info_requires_dict_and_ignores_finished_prompts(self):
        self.manager.set_batch_info("p1", "not-a-dict")
        self.manager.set_batch_info("", {"batchId": "empty"})
        self.assertEqual(self.manager.batch_meta, {})

        info = {"batchId": "b1", "color": "#10b981"}
        self.manager.set_batch_info("p1", info)
        self.assertEqual(self.manager.batch_meta["p1"], info)

        self.manager.add_item((0, "p1", {"prompt": {}}, {}, []))
        self.assertEqual(self.manager.persistent_items[0]["batch_info"], info)

        self.manager.remove_item("p1")
        self.manager.set_batch_info("p1", {"batchId": "late"})
        self.assertNotIn("p1", self.manager.batch_meta)

    def test_cancel_and_wipe_remove_persistence_only_after_success(self):
        queue = FakePromptQueue()
        server = self._server(queue)
        self.manager._patched = False

        with patch.object(queue_control.PromptServer, "instance", server):
            self.manager.patch_server()

        queue.put((0, "p1", {"prompt": {}}, {}, []))
        self.assertEqual([x["prompt_id"] for x in self.manager.persistent_items], ["p1"])

        queue.fail_delete = True
        with self.assertRaises(RuntimeError):
            queue.delete_queue_item(lambda item: True)
        self.assertEqual([x["prompt_id"] for x in self.manager.persistent_items], ["p1"])

        queue.fail_delete = False
        queue.delete_queue_item(lambda item: True)
        self.assertEqual(self.manager.persistent_items, [])

        queue.put((0, "p2", {"prompt": {}}, {}, []))
        self.assertEqual([x["prompt_id"] for x in self.manager.persistent_items], ["p2"])
        queue.fail_wipe = True
        with self.assertRaises(RuntimeError):
            queue.wipe_queue()
        self.assertEqual([x["prompt_id"] for x in self.manager.persistent_items], ["p2"])

        queue.fail_wipe = False
        queue.wipe_queue()
        self.assertEqual(self.manager.persistent_items, [])

        queue.put((0, "p3", {"prompt": {}}, {}, []))
        queue.currently_running[7] = (0, "p3", {"prompt": {}}, {}, [])
        queue.task_done(7, {}, "success")
        self.assertEqual(self.manager.persistent_items, [])

    def test_restore_syncs_client_id_to_all_entries(self):
        self.manager.persistent_items = [make_entry("p1"), make_entry("p2", priority=2)]
        queue = FakePromptQueue()
        server = self._server(queue)

        with patch.object(queue_control.PromptServer, "instance", server), \
             patch.object(queue_control.pause_manager, "set_pause"):
            self.manager.restore_queue("client-x")

        payload = self._read_payload()
        self.assertEqual(
            [item["item"][3]["client_id"] for item in payload["items"]],
            ["client-x", "client-x"],
        )


if __name__ == "__main__":
    unittest.main()

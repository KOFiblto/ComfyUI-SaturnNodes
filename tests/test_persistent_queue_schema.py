import json
import os
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import test_helper  # noqa: F401  (redirects SaturnNodes state to a temp dir)

import nodes.queue_control as queue_control
from nodes.queue_control import PersistentQueueManager

ITEM = [0, "p1", {"prompt": {}}, {}, {}]


class TestPersistentQueueSchema(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.temp_file = os.path.join(self.temp_dir.name, "persistent_queue.json")
        self.patches = [
            patch("nodes.queue_control.PERSISTENT_FILE", self.temp_file),
            patch("nodes.queue_control.USER_DIR", self.temp_dir.name),
            patch("nodes.queue_control.is_persistent_queue_enabled", return_value=True),
        ]
        for patcher in self.patches:
            patcher.start()

    def tearDown(self):
        for patcher in reversed(self.patches):
            patcher.stop()
        self.temp_dir.cleanup()

    def write_payload(self, payload):
        with open(self.temp_file, "w", encoding="utf-8") as f:
            json.dump(payload, f)

    def read_payload(self):
        with open(self.temp_file, "r", encoding="utf-8") as f:
            return json.load(f)

    def test_legacy_list_is_migrated_to_versioned_envelope(self):
        self.write_payload([
            {
                "prompt_id": "p1",
                "item": ITEM,
                "batch_info": {"batchId": "b1", "color": "#4ade80"},
            }
        ])

        mgr = PersistentQueueManager()

        self.assertEqual(len(mgr.persistent_items), 1)
        self.assertEqual(mgr.batch_meta["p1"]["batchId"], "b1")

        payload = self.read_payload()
        self.assertIsInstance(payload, dict)
        self.assertEqual(
            payload["schema_version"],
            queue_control.PERSISTENT_QUEUE_SCHEMA_VERSION,
        )
        self.assertEqual(len(payload["items"]), 1)
        self.assertEqual(payload["items"][0]["prompt_id"], "p1")

    def test_current_envelope_loads_without_rewriting(self):
        original = {
            "schema_version": queue_control.PERSISTENT_QUEUE_SCHEMA_VERSION,
            "items": [{"prompt_id": "p2", "item": ITEM}],
        }
        self.write_payload(original)

        mgr = PersistentQueueManager()

        self.assertEqual(len(mgr.persistent_items), 1)
        self.assertEqual(mgr.persistent_items[0]["prompt_id"], "p2")
        self.assertEqual(self.read_payload(), original)

    def test_newer_schema_is_left_untouched(self):
        original = {
            "schema_version": queue_control.PERSISTENT_QUEUE_SCHEMA_VERSION + 999,
            "items": [{"prompt_id": "p3", "item": ITEM}],
        }
        self.write_payload(original)

        mgr = PersistentQueueManager()

        self.assertEqual(mgr.persistent_items, [])
        self.assertEqual(
            self.read_payload(),
            original,
            "a file from a newer version must not be overwritten on downgrade",
        )

        # Even an explicit save must keep the foreign file read-only.
        mgr.add_item((0, "p5", {}, {}, {}))
        mgr.flush()
        self.assertEqual(
            self.read_payload(),
            original,
            "saving while downgraded must not overwrite the newer file",
        )

    def test_save_writes_versioned_envelope(self):
        mgr = PersistentQueueManager()
        mgr.add_item((0, "p4", {}, {}, {}))
        mgr.flush()

        payload = self.read_payload()
        self.assertEqual(
            payload["schema_version"],
            queue_control.PERSISTENT_QUEUE_SCHEMA_VERSION,
        )
        self.assertEqual([x["prompt_id"] for x in payload["items"]], ["p4"])


if __name__ == "__main__":
    unittest.main()

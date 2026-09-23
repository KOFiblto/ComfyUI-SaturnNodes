import os
import sys
import unittest
import threading

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import test_helper

from nodes.decision_node import DecisionManager, SaturnDecision

class TestDecisionNode(unittest.TestCase):
    def setUp(self):
        self.node = SaturnDecision()

    def test_decision_manager_register_and_trigger(self):
        uid = "test_decision_123"
        event = threading.Event()
        DecisionManager.register_wait(uid, event)
        self.assertIn(uid, DecisionManager._waiting_events)

        triggered = DecisionManager.trigger_action(uid, "cancel")
        self.assertTrue(triggered)
        self.assertTrue(event.is_set())

        action = DecisionManager.get_action(uid)
        self.assertEqual(action, "cancel")
        self.assertNotIn(uid, DecisionManager._waiting_events)

    def test_decision_disabled_mode(self):
        res = self.node.decide(disable=True, send_os_notification=False, timeout=-1, unique_id="disabled_node")
        self.assertEqual(res, (False,))

    def test_decision_manager_unknown_id_default(self):
        action = DecisionManager.get_action("non_existent_id")
        self.assertEqual(action, "continue")

if __name__ == "__main__":
    unittest.main()

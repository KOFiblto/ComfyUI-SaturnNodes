import unittest
from unittest.mock import MagicMock, patch
from nodes.queue_control import PowerControlManager, PauseQueueManager

class TestPowerControlManager(unittest.TestCase):
    def setUp(self):
        self.pause_manager = PauseQueueManager()
        self.pause_manager.paused = False
        self.pause_manager.is_waiting = False
        self.power_manager = PowerControlManager(self.pause_manager)

    def test_arm_disabled_by_default(self):
        with patch("nodes.queue_control.is_process_management_enabled", return_value=False):
            result = self.power_manager.arm("restart")
            self.assertFalse(result)
            self.assertIsNone(self.power_manager.pending_action)
            self.assertIsNone(self.power_manager.armed_at)
            status = self.power_manager.get_status()
            self.assertFalse(status["enabled"])
            self.assertFalse(self.power_manager.execute_restart())
            self.assertFalse(self.power_manager.execute_shutdown())

    def test_arm_and_disarm(self):
        with patch("nodes.queue_control.is_process_management_enabled", return_value=True):
            result = self.power_manager.arm("restart")
            self.assertTrue(result)
            self.assertEqual(self.power_manager.pending_action, "restart")
            self.assertIsNotNone(self.power_manager.armed_at)

            status = self.power_manager.get_status()
            self.assertEqual(status["pending_action"], "restart")
            self.assertTrue(status["enabled"])

            self.power_manager.arm("shutdown")
            self.assertEqual(self.power_manager.pending_action, "shutdown")

            self.power_manager.arm(None)
            self.assertIsNone(self.power_manager.pending_action)
            self.assertIsNone(self.power_manager.armed_at)

    def test_does_not_execute_when_paused(self):
        with patch("nodes.queue_control.is_process_management_enabled", return_value=True):
            self.power_manager.arm("restart")
            self.pause_manager.paused = True

            with patch.object(self.power_manager, "execute_restart") as mock_restart:
                self.power_manager.check_and_execute()
                mock_restart.assert_not_called()
                self.assertEqual(self.power_manager.pending_action, "restart")

    def test_does_not_execute_when_tasks_remaining(self):
        with patch("nodes.queue_control.is_process_management_enabled", return_value=True):
            self.power_manager.arm("restart")
            mock_queue = MagicMock()
            mock_queue.get_tasks_remaining.return_value = 2
            mock_queue.currently_running = {"1": True}

            with patch("server.PromptServer.instance") as mock_server:
                mock_server.prompt_queue = mock_queue
                with patch.object(self.power_manager, "execute_restart") as mock_restart:
                    self.power_manager.check_and_execute()
                    mock_restart.assert_not_called()
                    self.assertEqual(self.power_manager.pending_action, "restart")

    def test_executes_when_queue_empty_and_idle(self):
        with patch("nodes.queue_control.is_process_management_enabled", return_value=True):
            self.power_manager.arm("restart")
            mock_queue = MagicMock()
            mock_queue.get_tasks_remaining.return_value = 0
            mock_queue.currently_running = {}

            with patch("server.PromptServer.instance") as mock_server:
                mock_server.prompt_queue = mock_queue
                with patch.object(self.power_manager, "execute_restart") as mock_restart:
                    self.power_manager.check_and_execute()
                    mock_restart.assert_called_once()
                    self.assertIsNone(self.power_manager.pending_action)

if __name__ == "__main__":
    unittest.main()


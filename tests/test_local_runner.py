import os
import sys
import tempfile
import unittest
from unittest.mock import patch, MagicMock

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import test_helper
from nodes.local_runner import (
    RunLocalFileNode,
    get_allowed_scripts_directory,
    is_script_path_permitted,
    resolve_target_path,
    authorize_node_run,
    consume_node_authorization,
    clear_all_authorizations
)

class TestLocalRunner(unittest.TestCase):
    def setUp(self):
        self.node = RunLocalFileNode()
        clear_all_authorizations()

    def tearDown(self):
        clear_all_authorizations()

    def test_operator_authorization_required(self):
        with patch("nodes.local_runner.is_local_file_execution_enabled", return_value=True):
            with tempfile.TemporaryDirectory() as temp_dir:
                script_path = os.path.join(temp_dir, "test.bat")
                with open(script_path, "w") as f:
                    f.write("@echo off\n")

                with patch("nodes.local_runner.get_allowed_scripts_directory", return_value=temp_dir):
                    stdout, stderr, exit_code, success, passthrough = self.node.run_local_file(
                        file_path="test.bat",
                        unique_id="node_99",
                        trigger="trigger_data"
                    )
                    self.assertEqual(exit_code, -1)
                    self.assertFalse(success)
                    self.assertIn("Authorize Run", stderr)
                    self.assertEqual(passthrough, "trigger_data")

    def test_global_security_setting_disabled_by_default(self):
        with patch("nodes.local_runner.is_local_file_execution_enabled", return_value=False):
            stdout, stderr, exit_code, success, _ = self.node.run_local_file(
                file_path="some_script.bat",
                unique_id="node_99"
            )
            self.assertEqual(exit_code, -1)
            self.assertFalse(success)
            self.assertIn("disabled by default for security", stderr)

    def test_path_confinement_rejects_absolute_paths(self):
        resolved, msg = resolve_target_path("C:\\Windows\\System32\\cmd.exe")
        self.assertIsNone(resolved)
        self.assertIn("Absolute paths are forbidden", msg)

        resolved_posix, msg_posix = resolve_target_path("/bin/sh")
        self.assertIsNone(resolved_posix)
        self.assertIn("Absolute paths are forbidden", msg_posix)

    def test_path_confinement_rejects_traversal(self):
        resolved, msg = resolve_target_path("../../../etc/passwd")
        self.assertIsNone(resolved)
        self.assertIn("Directory traversal", msg)

        resolved_win, msg_win = resolve_target_path("scripts/../../sensitive.txt")
        self.assertIsNone(resolved_win)
        self.assertIn("Directory traversal", msg_win)

    def test_single_use_authorization_consumed_on_run(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            if sys.platform.startswith("win"):
                script_path = os.path.join(temp_dir, "single_use.bat")
                with open(script_path, "w") as f:
                    f.write("@echo off\necho Consumed\n")
            else:
                script_path = os.path.join(temp_dir, "single_use.sh")
                with open(script_path, "w") as f:
                    f.write('#!/bin/bash\necho "Consumed"\n')

            with patch("nodes.local_runner.get_allowed_scripts_directory", return_value=temp_dir), \
                 patch("nodes.local_runner.is_local_file_execution_enabled", return_value=True):

                # 1. Authorize for node_42
                filename = os.path.basename(script_path)
                authorize_node_run("node_42", filename)

                # First run must succeed
                stdout, stderr, exit_code, success, _ = self.node.run_local_file(
                    file_path=filename,
                    unique_id="node_42"
                )
                self.assertEqual(exit_code, 0)
                self.assertTrue(success)

                # Second run with same node ID must be rejected (authorization consumed)
                stdout2, stderr2, exit_code2, success2, _ = self.node.run_local_file(
                    file_path=filename,
                    unique_id="node_42"
                )
                self.assertEqual(exit_code2, -1)
                self.assertFalse(success2)
                self.assertIn("Node has not been authorized", stderr2)

    def test_script_mismatch_authorization_rejected(self):
        with patch("nodes.local_runner.is_local_file_execution_enabled", return_value=True):
            authorize_node_run("node_1", "approved_tool.bat")
            authorized, msg = consume_node_authorization("node_1", "C:\\scripts\\malicious_tool.bat")
            self.assertFalse(authorized)
            self.assertIn("does not match", msg)

    def test_build_command_args(self):
        target = "test_script.bat" if sys.platform.startswith("win") else "test_script.sh"
        cmd = self.node.build_command_args(target, '--arg1 "value with spaces" --num 42')
        if sys.platform.startswith("win"):
            self.assertIn("/c", cmd)
            self.assertIn("--arg1", cmd)
            self.assertTrue(any("value with spaces" in x for x in cmd))
            self.assertIn("42", cmd)
        else:
            self.assertIn("/bin/bash", cmd)
            self.assertIn("--arg1", cmd)
            self.assertIn("value with spaces", cmd)

    def test_execution_synchronous(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            if sys.platform.startswith("win"):
                script_path = os.path.join(temp_dir, "echo_test.bat")
                with open(script_path, "w") as f:
                    f.write("@echo off\necho Output: %1 %2\n")
            else:
                script_path = os.path.join(temp_dir, "echo_test.sh")
                with open(script_path, "w") as f:
                    f.write('#!/bin/bash\necho "Output: $1 $2"\n')

            filename = os.path.basename(script_path)
            authorize_node_run("node_sync", filename)

            with patch("nodes.local_runner.get_allowed_scripts_directory", return_value=temp_dir), \
                 patch("nodes.local_runner.is_local_file_execution_enabled", return_value=True):
                stdout, stderr, exit_code, success, passthrough = self.node.run_local_file(
                    file_path=filename,
                    parameters="Hello World",
                    run_mode="Synchronous (Wait for Output)",
                    trigger="flow_pass",
                    unique_id="node_sync"
                )
                self.assertEqual(exit_code, 0)
                self.assertTrue(success)
                self.assertIn("Hello World", stdout)
                self.assertEqual(passthrough, "flow_pass")

    def test_timeout_cancellation(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            if sys.platform.startswith("win"):
                script_path = os.path.join(temp_dir, "sleep_test.bat")
                with open(script_path, "w") as f:
                    f.write(f"@echo off\n\"{sys.executable}\" -c \"import time; time.sleep(5)\"\n")
            else:
                script_path = os.path.join(temp_dir, "sleep_test.sh")
                with open(script_path, "w") as f:
                    f.write("#!/bin/bash\nsleep 3\n")

            filename = os.path.basename(script_path)
            authorize_node_run("node_timeout", filename)

            with patch("nodes.local_runner.get_allowed_scripts_directory", return_value=temp_dir), \
                 patch("nodes.local_runner.is_local_file_execution_enabled", return_value=True):
                stdout, stderr, exit_code, success, _ = self.node.run_local_file(
                    file_path=filename,
                    timeout=1,
                    run_mode="Synchronous (Wait for Output)",
                    unique_id="node_timeout"
                )
                self.assertEqual(exit_code, -1)
                self.assertFalse(success)
                self.assertIn("timed out", stderr)
            import time
            time.sleep(0.5)

if __name__ == "__main__":
    unittest.main()

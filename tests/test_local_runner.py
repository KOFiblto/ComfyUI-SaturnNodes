import os
import sys
import tempfile
import unittest
from unittest.mock import patch, MagicMock

import test_helper
from nodes.local_runner import (
    RunLocalFileNode,
    get_allowed_script_directories,
    is_script_path_permitted
)

class TestLocalRunner(unittest.TestCase):
    def setUp(self):
        self.node = RunLocalFileNode()

    def test_security_consent_required(self):
        stdout, stderr, exit_code, success, passthrough = self.node.run_local_file(
            file_path="some_script.bat",
            security_consent=False,
            trigger="trigger_data"
        )
        self.assertEqual(exit_code, -1)
        self.assertFalse(success)
        self.assertIn("security_consent", stderr)
        self.assertEqual(passthrough, "trigger_data")

    def test_global_security_setting_disabled(self):
        with patch("nodes.local_runner.get_env_setting", return_value="false"):
            stdout, stderr, exit_code, success, _ = self.node.run_local_file(
                file_path="some_script.bat",
                security_consent=True
            )
            self.assertEqual(exit_code, -1)
            self.assertFalse(success)
            self.assertIn("disabled in LeafFlow global settings", stderr)

    def test_script_path_sandboxing(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            temp_file = os.path.join(temp_dir, "test.bat")
            with open(temp_file, "w") as f:
                f.write("@echo off\n")

            # Outside allowed directories by default
            with patch("nodes.local_runner.get_allowed_script_directories", return_value=["C:\\approved"]):
                permitted, msg = is_script_path_permitted(temp_file, allow_any_path=False)
                self.assertFalse(permitted)
                self.assertIn("Security Restriction", msg)

                # Permitted if allow_any_path is True
                permitted_any, _ = is_script_path_permitted(temp_file, allow_any_path=True)
                self.assertTrue(permitted_any)

                # Permitted if inside approved directory
                with patch("nodes.local_runner.get_allowed_script_directories", return_value=[temp_dir]):
                    permitted_inside, _ = is_script_path_permitted(temp_file, allow_any_path=False)
                    self.assertTrue(permitted_inside)

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

            with patch("nodes.local_runner.get_allowed_script_directories", return_value=[temp_dir]):
                stdout, stderr, exit_code, success, passthrough = self.node.run_local_file(
                    file_path=script_path,
                    security_consent=True,
                    parameters="Hello World",
                    run_mode="Synchronous (Wait for Output)",
                    trigger="flow_pass"
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

            with patch("nodes.local_runner.get_allowed_script_directories", return_value=[temp_dir]):
                stdout, stderr, exit_code, success, _ = self.node.run_local_file(
                    file_path=script_path,
                    security_consent=True,
                    timeout=1,
                    run_mode="Synchronous (Wait for Output)"
                )
                self.assertEqual(exit_code, -1)
                self.assertFalse(success)
                self.assertIn("timed out", stderr)
            import time
            time.sleep(0.5)

if __name__ == "__main__":
    unittest.main()

import os
import shutil
import subprocess
import unittest


DOM_TESTS = [
    "test_power_popup_dom.mjs",
    "test_copy_prompt_dom.mjs",
    "test_copy_prompt_restore_dom.mjs",
    "test_floating_dock_dom.mjs",
    "test_widget_guards_dom.mjs",
    "test_queue_height_dom.mjs",
    "test_batch_queue_dom.mjs",
    "test_batch_queue_snapshot_dom.mjs",
    "test_batch_queue_restore_dom.mjs",
    "test_persistent_queue_claim_dom.mjs",
    "test_character_presets_dom.mjs",
]


class TestFrontendDomRegressions(unittest.TestCase):
    def test_dom_regressions(self):
        node = shutil.which("node")
        if not node:
            self.skipTest("Node.js is not available")

        repo_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        for script_name in DOM_TESTS:
            with self.subTest(script=script_name):
                script = os.path.join(repo_root, "tests", script_name)
                result = subprocess.run(
                    [node, script],
                    cwd=repo_root,
                    capture_output=True,
                    text=True,
                    timeout=60,
                )
                self.assertEqual(
                    result.returncode,
                    0,
                    msg=f"{script_name} failed:\n{result.stdout}\n{result.stderr}",
                )


if __name__ == "__main__":
    unittest.main()

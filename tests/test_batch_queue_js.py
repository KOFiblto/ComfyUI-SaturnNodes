import os
import shutil
import subprocess
import unittest


class TestBatchQueueDomRegression(unittest.TestCase):
    def test_reused_active_card_repaints_after_job_id_change(self):
        node = shutil.which("node")
        if not node:
            self.skipTest("Node.js is not available")

        repo_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        script = os.path.join(repo_root, "tests", "test_batch_queue_dom.mjs")
        result = subprocess.run(
            [node, script],
            cwd=repo_root,
            capture_output=True,
            text=True,
            timeout=30,
        )
        self.assertEqual(
            result.returncode,
            0,
            msg=f"Batch queue DOM regression failed:\n{result.stdout}\n{result.stderr}",
        )


if __name__ == "__main__":
    unittest.main()

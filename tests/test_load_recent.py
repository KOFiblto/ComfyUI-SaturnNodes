import os
import sys
import unittest
import tempfile
import shutil
from PIL import Image
from unittest.mock import patch

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import test_helper

from nodes.load_recent import LoadRecentOutputs

class TestLoadRecent(unittest.TestCase):
    def setUp(self):
        import folder_paths
        self.node = LoadRecentOutputs()
        out_dir = folder_paths.get_output_directory()
        os.makedirs(out_dir, exist_ok=True)
        self.temp_dir = tempfile.mkdtemp(dir=out_dir)
        self.rel_dir = os.path.relpath(self.temp_dir, out_dir)

    def tearDown(self):
        shutil.rmtree(self.temp_dir, ignore_errors=True)

    def test_load_single_image_finds_recent_image(self):
        img = Image.new("RGB", (64, 64), color="red")
        f1 = os.path.join(self.temp_dir, "recent_01.png")
        f2 = os.path.join(self.temp_dir, "recent_02.png")
        img.save(f1)
        img.save(f2)

        out_tensor, = self.node.load_single_image(output_folder=self.rel_dir, amount=2, index=0)
        self.assertEqual(out_tensor.shape[0], 1)
        self.assertEqual(out_tensor.shape[1], 64)
        self.assertEqual(out_tensor.shape[2], 64)

    def test_load_recent_empty_directory_returns_dummy(self):
        out_tensor, = self.node.load_single_image(output_folder=self.rel_dir, amount=5, index=0)
        self.assertEqual(out_tensor.shape, (1, 512, 512, 3))

if __name__ == "__main__":
    unittest.main()

import os
import sys
import unittest
import tempfile
import shutil
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import test_helper

from nodes.auto_watcher import LoadImageFromFolder

class TestAutoWatcher(unittest.TestCase):
    def setUp(self):
        import folder_paths
        self.node = LoadImageFromFolder()
        inp_dir = folder_paths.get_input_directory()
        os.makedirs(inp_dir, exist_ok=True)
        self.temp_dir = tempfile.mkdtemp(dir=inp_dir)
        self.rel_dir = os.path.relpath(self.temp_dir, inp_dir)

    def tearDown(self):
        shutil.rmtree(self.temp_dir, ignore_errors=True)

    def test_create_dummy_image(self):
        dummy = self.node.create_dummy_image()
        self.assertEqual(dummy.shape, (1, 512, 512, 3))

    def test_get_filtered_files_by_regex(self):
        img = Image.new("RGB", (64, 64), color="blue")
        f1 = os.path.join(self.temp_dir, "test_01.png")
        f2 = os.path.join(self.temp_dir, "test_02.jpg")
        f3 = os.path.join(self.temp_dir, "other.png")
        f4 = os.path.join(self.temp_dir, "ignored.txt")
        img.save(f1)
        img.save(f2)
        img.save(f3)
        with open(f4, "w") as f:
            f.write("text file")

        files = self.node.get_filtered_files(self.temp_dir, sort_by="name", regex_filter=r"test_\d+")
        self.assertEqual(len(files), 2)
        self.assertIn(f1, files)
        self.assertIn(f2, files)
        self.assertNotIn(f3, files)
        self.assertNotIn(f4, files)

    def test_empty_folder_returns_dummy(self):
        empty_dir = os.path.join(self.temp_dir, "empty")
        os.makedirs(empty_dir, exist_ok=True)
        empty_rel = os.path.join(self.rel_dir, "empty")
        img_tensor, has_image = self.node.watch(
            folder=empty_rel,
            wait_if_folder_is_empty=False,
            rescan_interval=1,
            sort_by="date_modified",
            regex_filter=".*"
        )
        self.assertFalse(has_image)
        self.assertEqual(img_tensor.shape, (1, 512, 512, 3))

    def test_sequential_cycle_when_delete_false(self):
        """Verify that when delete_image=False, consecutive runs cycle through files instead of loading the same file forever."""
        f1 = os.path.join(self.temp_dir, "img_a.png")
        f2 = os.path.join(self.temp_dir, "img_b.png")
        Image.new("RGB", (64, 64), color="red").save(f1)
        Image.new("RGB", (64, 64), color="green").save(f2)

        # Run 1 -> loads img_a
        t1, has1 = self.node.watch(folder=self.rel_dir, wait_if_folder_is_empty=False, rescan_interval=1, sort_by="name", regex_filter=".*", delete_image=False, unique_id="cycle_test")
        self.assertTrue(has1)

        # Run 2 -> loads img_b (cycled!)
        t2, has2 = self.node.watch(folder=self.rel_dir, wait_if_folder_is_empty=False, rescan_interval=1, sort_by="name", regex_filter=".*", delete_image=False, unique_id="cycle_test")
        self.assertTrue(has2)

        # Run 3 -> loops back to img_a
        t3, has3 = self.node.watch(folder=self.rel_dir, wait_if_folder_is_empty=False, rescan_interval=1, sort_by="name", regex_filter=".*", delete_image=False, unique_id="cycle_test")
        self.assertTrue(has3)

    def test_load_and_remove_image_with_delete_toggle(self):
        img = Image.new("RGB", (64, 64), color="red")
        img_path = os.path.join(self.temp_dir, "test_del.png")
        img.save(img_path)

        # 1. delete_image = False (default: file must remain on disk)
        tensor = self.node.load_and_remove_image(img_path, delete_image=False)
        self.assertEqual(tensor.shape, (1, 64, 64, 3))
        self.assertTrue(os.path.exists(img_path), "File should not be deleted when delete_image=False")

        # 2. delete_image = True (file must be removed from disk)
        tensor2 = self.node.load_and_remove_image(img_path, delete_image=True)
        self.assertEqual(tensor2.shape, (1, 64, 64, 3))
        self.assertFalse(os.path.exists(img_path), "File should be deleted when delete_image=True")

if __name__ == "__main__":
    unittest.main()

import os
import shutil
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import test_helper  # noqa: F401

import folder_paths
import numpy as np
import torch
from PIL import Image

from nodes.load_recent import LoadRecentOutputs


class TestLoadRecentExtended(unittest.TestCase):
    def setUp(self):
        self.node = LoadRecentOutputs()
        out_dir = folder_paths.get_output_directory()
        os.makedirs(out_dir, exist_ok=True)
        self.temp_dir = tempfile.mkdtemp(dir=out_dir)
        self.rel_dir = os.path.relpath(self.temp_dir, out_dir)

    def tearDown(self):
        shutil.rmtree(self.temp_dir, ignore_errors=True)

    def _make_image(self, name, color, mtime):
        path = os.path.join(self.temp_dir, name)
        Image.new("RGB", (4, 4), color=color).save(path)
        os.utime(path, (mtime, mtime))
        return path

    def _load(self, amount=5, index=0, order="Newest First (0 = latest)", folder=None):
        tensor, = self.node.load_single_image(
            output_folder=self.rel_dir if folder is None else folder,
            amount=amount,
            index=index,
            order=order,
        )
        return tensor

    def test_equal_mtimes_have_a_deterministic_tiebreak(self):
        base = 1_700_000_000
        self._make_image("z.png", "red", base)
        self._make_image("a.png", "green", base)
        self._make_image("m.png", "blue", base)

        # Newest-first with equal mtimes sorts by full path descending.
        self.assertEqual(tuple(self._load(amount=3, index=0).shape), (1, 4, 4, 3))

        colors = [self._load(amount=3, index=i)[0, 0, 0].tolist() for i in range(3)]
        self.assertEqual(colors[0][0], 1.0)  # z.png red
        self.assertEqual(colors[1][2], 1.0)  # m.png blue
        self.assertAlmostEqual(colors[2][1], 0.5019608, places=5)  # a.png green

    def test_chronological_order_reverses_the_same_set(self):
        base = 1_700_000_000
        self._make_image("oldest.png", "red", base)
        self._make_image("middle.png", "green", base + 10)
        self._make_image("newest.png", "blue", base + 20)

        newest_first = [self._load(amount=3, index=i)[0, 0, 0].tolist() for i in range(3)]
        oldest_first = [
            self._load(amount=3, index=i, order="Chronological (Oldest First)")[0, 0, 0].tolist()
            for i in range(3)
        ]
        self.assertEqual(oldest_first, list(reversed(newest_first)))

    def test_index_wraps_and_negative_index_clamps_to_zero(self):
        base = 1_700_000_000
        self._make_image("older.png", "red", base)
        self._make_image("newer.png", "blue", base + 10)

        wrapped = self._load(amount=2, index=3)[0, 0, 0].tolist()
        self.assertEqual(wrapped[0], 1.0, "index 3 must wrap to the second of two images")

        clamped = self._load(amount=2, index=-5)[0, 0, 0].tolist()
        self.assertEqual(clamped[2], 1.0, "a negative index must clamp to the newest image")

    def test_invalid_amount_and_index_fall_back_safely(self):
        base = 1_700_000_000
        self._make_image("older.png", "red", base)
        self._make_image("newer.png", "blue", base + 10)

        tensor = self._load(amount="not-a-number", index="not-a-number")
        self.assertEqual(tuple(tensor.shape), (1, 4, 4, 3))
        self.assertEqual(tensor[0, 0, 0].tolist()[2], 1.0)

        tensor = self._load(amount=0, index=0)
        self.assertEqual(tensor[0, 0, 0].tolist()[2], 1.0)

    def test_amount_larger_than_available_still_wraps(self):
        base = 1_700_000_000
        self._make_image("only.png", "green", base)
        tensor = self._load(amount=100, index=7)
        self.assertEqual(tuple(tensor.shape), (1, 4, 4, 3))
        self.assertAlmostEqual(float(tensor[0, 0, 0, 1]), 0.5019608, places=5)

    def test_missing_or_empty_folder_returns_dummy(self):
        missing = os.path.join(self.temp_dir, "does-not-exist")
        tensor = self._load(folder=os.path.relpath(missing, folder_paths.get_output_directory()))
        self.assertEqual(tuple(tensor.shape), (1, 512, 512, 3))
        self.assertEqual(tensor.dtype, torch.float32)
        self.assertEqual(float(tensor.sum()), 0.0)

        empty = os.path.join(self.temp_dir, "empty")
        os.makedirs(empty)
        tensor = self._load(folder=os.path.relpath(empty, folder_paths.get_output_directory()))
        self.assertEqual(tuple(tensor.shape), (1, 512, 512, 3))
        self.assertEqual(float(tensor.sum()), 0.0)

    def test_corrupt_image_returns_dummy_instead_of_raising(self):
        path = os.path.join(self.temp_dir, "broken.png")
        with open(path, "wb") as handle:
            handle.write(b"this is not a PNG")
        os.utime(path, (1_700_000_000, 1_700_000_000))

        tensor = self._load(amount=1, index=0)
        self.assertEqual(tuple(tensor.shape), (1, 512, 512, 3))
        self.assertEqual(float(tensor.sum()), 0.0)

    def test_unsupported_extensions_are_ignored(self):
        with open(os.path.join(self.temp_dir, "notes.txt"), "w", encoding="utf-8") as handle:
            handle.write("not an image")
        tensor = self._load(amount=5, index=0)
        self.assertEqual(tuple(tensor.shape), (1, 512, 512, 3))
        self.assertEqual(float(tensor.sum()), 0.0)

    def test_returned_tensor_is_float_rgb_in_zero_one_range(self):
        path = os.path.join(self.temp_dir, "solid.png")
        Image.new("RGB", (3, 2), color=(255, 0, 0)).save(path)
        os.utime(path, (1_700_000_000, 1_700_000_000))

        tensor = self._load(amount=1, index=0)
        self.assertEqual(tuple(tensor.shape), (1, 2, 3, 3))
        self.assertEqual(tensor.dtype, torch.float32)
        self.assertEqual(tensor[0, :, :, 0].tolist(), [[1.0, 1.0, 1.0], [1.0, 1.0, 1.0]])
        self.assertEqual(tensor[0, :, :, 1].tolist(), [[0.0, 0.0, 0.0], [0.0, 0.0, 0.0]])


if __name__ == "__main__":
    unittest.main()

import os
import sys
import unittest
import torch
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import test_helper

from nodes.stereogram import SaturnStereo3D

class TestSaturnStereo3D(unittest.TestCase):
    def setUp(self):
        self.node = SaturnStereo3D()
        self.img = torch.rand((1, 128, 128, 3), dtype=torch.float32)
        self.depth = torch.linspace(0, 1, 128).view(1, 1, 128).expand(1, 128, 128).unsqueeze(-1).repeat(1, 1, 1, 3)

    def test_cross_eye_mode_dimensions(self):
        # Image is 128x128. With gap=10, border=5:
        # Side by side: 128 + 10 + 128 = 266 width.
        # With border=5 on each side: Width = 266 + 10 = 276. Height = 128 + 10 = 138.
        res = self.node.generate(
            self.img,
            depth_map=self.depth,
            mode="Cross-Eye",
            depth_intensity=30.0,
            gap_spacing=10,
            outer_border=5,
            alignment_dots=True
        )
        stereogram, left_eye, right_eye, depth_out = res
        self.assertEqual(stereogram.shape, (1, 138, 276, 3))
        self.assertEqual(left_eye.shape, (1, 128, 128, 3))
        self.assertEqual(right_eye.shape, (1, 128, 128, 3))
        self.assertEqual(depth_out.shape, (1, 128, 128, 3))

    def test_parallel_mode(self):
        res = self.node.generate(
            self.img,
            depth_map=self.depth,
            mode="Parallel (Wall-Eyed)",
            depth_intensity=25.0,
            gap_spacing=0,
            outer_border=0,
            alignment_dots=False
        )
        stereogram, _, _, _ = res
        self.assertEqual(stereogram.shape, (1, 128, 256, 3))

    def test_anaglyph_mode(self):
        res = self.node.generate(
            self.img,
            depth_map=self.depth,
            mode="Red-Cyan Anaglyph",
            depth_intensity=25.0
        )
        stereogram, left_eye, right_eye, _ = res
        self.assertEqual(stereogram.shape, (1, 128, 128, 3))
        np.testing.assert_allclose(stereogram[..., 0].cpu().numpy(), left_eye[..., 0].cpu().numpy(), atol=1e-5)
        np.testing.assert_allclose(stereogram[..., 1].cpu().numpy(), right_eye[..., 1].cpu().numpy(), atol=1e-5)
        np.testing.assert_allclose(stereogram[..., 2].cpu().numpy(), right_eye[..., 2].cpu().numpy(), atol=1e-5)

    def test_top_bottom_mode(self):
        res = self.node.generate(
            self.img,
            depth_map=self.depth,
            mode="Top-Bottom (Over-Under)",
            gap_spacing=6,
            outer_border=0
        )
        stereogram, _, _, _ = res
        self.assertEqual(stereogram.shape, (1, 262, 128, 3))

    def test_single_eye_modes(self):
        res_left = self.node.generate(self.img, depth_map=self.depth, mode="Left Eye Only")
        res_right = self.node.generate(self.img, depth_map=self.depth, mode="Right Eye Only")
        self.assertEqual(res_left[0].shape, (1, 128, 128, 3))
        self.assertEqual(res_right[0].shape, (1, 128, 128, 3))

    def test_zoom_and_pan(self):
        res = self.node.generate(
            self.img,
            depth_map=self.depth,
            image_zoom=150.0,
            pan_horizontal=20.0,
            pan_vertical=-10.0
        )
        stereogram = res[0]
        self.assertIsNotNone(stereogram)
        self.assertEqual(stereogram.dim(), 4)

    def test_auto_depth_fallback(self):
        res = self.node.generate(
            self.img,
            depth_map=None,
            mode="Cross-Eye",
            depth_intensity=20.0
        )
        stereogram, _, _, depth_out = res
        self.assertEqual(stereogram.shape[0], 1)
        self.assertEqual(depth_out.shape, (1, 128, 128, 3))


from nodes.stereogram import SaturnStereo3DLive

class TestSaturnStereo3DLive(unittest.TestCase):
    def setUp(self):
        self.node = SaturnStereo3DLive()
        self.img = torch.rand((1, 64, 64, 3), dtype=torch.float32)
        self.depth = torch.rand((1, 64, 64, 3), dtype=torch.float32)

    def test_live_viewer_output_structure(self):
        # SaturnStereo3DLive is an OUTPUT_NODE that returns a dict with 'ui' and 'result'
        self.assertTrue(self.node.OUTPUT_NODE)
        res = self.node.generate(
            self.img,
            depth_map=self.depth,
            mode="Cross-Eye",
            depth_intensity=20.0,
            live_auto_render=True
        )
        self.assertIsInstance(res, dict)
        self.assertIn("ui", res)
        self.assertIn("result", res)
        self.assertIn("images", res["ui"])
        stereogram, left_eye, right_eye, depth_out = res["result"]
        self.assertEqual(stereogram.shape[0], 1)
        self.assertEqual(left_eye.shape, (1, 64, 64, 3))
        self.assertEqual(right_eye.shape, (1, 64, 64, 3))
        self.assertEqual(depth_out.shape, (1, 64, 64, 3))

    def test_live_input_types(self):
        inputs = self.node.INPUT_TYPES()
        self.assertIn("required", inputs)
        self.assertIn("depth_intensity", inputs["required"])
        self.assertIn("mode", inputs["required"])


if __name__ == "__main__":
    unittest.main()

import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import test_helper

from nodes.text_split import SaturnTextSplit

class TestSaturnTextSplit(unittest.TestCase):
    def setUp(self):
        self.node = SaturnTextSplit()

    def test_forward_literal_split_basic(self):
        # User standard case: "Hello --- Bye" with delimiter "--"
        t1, t2 = self.node.split_text(
            text="Hello --- Bye",
            split_by="--",
            use_regex=False,
            split_direction="forward (first occurrence from start)",
            strip_whitespace=False
        )
        self.assertEqual(t1, "Hello ")
        self.assertEqual(t2, "- Bye")

    def test_backward_literal_split_basic(self):
        # Splitting from end
        t1, t2 = self.node.split_text(
            text="Hello --- Bye",
            split_by="--",
            use_regex=False,
            split_direction="backward (last occurrence from end)",
            strip_whitespace=False
        )
        self.assertEqual(t1, "Hello -")
        self.assertEqual(t2, " Bye")

    def test_strip_whitespace(self):
        t1, t2 = self.node.split_text(
            text="  Left Part   ---   Right Part  ",
            split_by="---",
            use_regex=False,
            strip_whitespace=True
        )
        self.assertEqual(t1, "Left Part")
        self.assertEqual(t2, "Right Part")

    def test_forward_regex_split(self):
        t1, t2 = self.node.split_text(
            text="prompt_v1__step_100__seed_42",
            split_by=r"__step_\d+__",
            use_regex=True,
            split_direction="forward (first occurrence from start)"
        )
        self.assertEqual(t1, "prompt_v1")
        self.assertEqual(t2, "seed_42")

    def test_backward_regex_split(self):
        t1, t2 = self.node.split_text(
            text="tag1#123tag2#456tag3",
            split_by=r"#\d+",
            use_regex=True,
            split_direction="backward (last occurrence from end)"
        )
        self.assertEqual(t1, "tag1#123tag2")
        self.assertEqual(t2, "tag3")

    def test_edge_case_empty_text(self):
        t1, t2 = self.node.split_text(text="", split_by="--")
        self.assertEqual(t1, "")
        self.assertEqual(t2, "")

    def test_edge_case_none_text(self):
        t1, t2 = self.node.split_text(text=None, split_by="--")
        self.assertEqual(t1, "")
        self.assertEqual(t2, "")

    def test_edge_case_empty_delimiter(self):
        t1, t2 = self.node.split_text(text="Some text", split_by="")
        self.assertEqual(t1, "Some text")
        self.assertEqual(t2, "")

    def test_edge_case_delimiter_not_found(self):
        t1, t2 = self.node.split_text(text="Hello World", split_by="---")
        self.assertEqual(t1, "Hello World")
        self.assertEqual(t2, "")

    def test_edge_case_delimiter_at_start(self):
        t1, t2 = self.node.split_text(text="--Rest of message", split_by="--")
        self.assertEqual(t1, "")
        self.assertEqual(t2, "Rest of message")

    def test_edge_case_delimiter_at_end(self):
        t1, t2 = self.node.split_text(text="First part--", split_by="--")
        self.assertEqual(t1, "First part")
        self.assertEqual(t2, "")

    def test_edge_case_invalid_regex_fallback(self):
        t1, t2 = self.node.split_text(
            text="Hello [unclosed bracket World",
            split_by="[unclosed bracket",
            use_regex=True
        )
        self.assertEqual(t1, "Hello ")
        self.assertEqual(t2, " World")

    def test_multiline_text_split(self):
        text = "Line 1\nLine 2\n---\nLine 3\nLine 4"
        t1, t2 = self.node.split_text(text=text, split_by="\n---\n")
        self.assertEqual(t1, "Line 1\nLine 2")
        self.assertEqual(t2, "Line 3\nLine 4")

if __name__ == "__main__":
    unittest.main()

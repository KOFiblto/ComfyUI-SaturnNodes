import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import test_helper

from nodes.text_replacer import MultiTextReplacer, parse_find_targets

class TestMultiTextReplacer(unittest.TestCase):
    def setUp(self):
        self.node = MultiTextReplacer()

    def test_parse_find_targets_basic(self):
        targets = parse_find_targets("dog, cat, bird")
        self.assertEqual(targets, ["dog", "cat", "bird"])

    def test_parse_find_targets_with_quotes(self):
        targets = parse_find_targets('"dog", "cat", "bird"')
        self.assertEqual(targets, ["dog", "cat", "bird"])

    def test_parse_find_targets_with_comma_inside_quotes(self):
        targets = parse_find_targets('"hello, world", "foo, bar", baz')
        self.assertEqual(targets, ["hello, world", "foo, bar", "baz"])

    def test_replace_comma_separated_list(self):
        text, count = self.node.replace_text(
            find="dog, cat, bird",
            replace="animal",
            case_sensitive=False,
            search_mode="Comma Separated List",
            text="I have a dog and a cat and a bird."
        )
        self.assertEqual(text, "I have a animal and a animal and a animal.")
        self.assertEqual(count, 3)

    def test_replace_longest_match_first(self):
        text, count = self.node.replace_text(
            find="dog, hot dog",
            replace="food",
            search_mode="Comma Separated List",
            text="I ate a hot dog."
        )
        self.assertEqual(text, "I ate a food.")
        self.assertEqual(count, 1)

    def test_case_sensitivity(self):
        text_ci, count_ci = self.node.replace_text(
            find="cat",
            replace="feline",
            case_sensitive=False,
            text="Cat and cat"
        )
        self.assertEqual(text_ci, "feline and feline")
        self.assertEqual(count_ci, 2)

        text_cs, count_cs = self.node.replace_text(
            find="cat",
            replace="feline",
            case_sensitive=True,
            text="Cat and cat"
        )
        self.assertEqual(text_cs, "Cat and feline")
        self.assertEqual(count_cs, 1)

    def test_regex_mode(self):
        text, count = self.node.replace_text(
            find=r"\b\d{4}\b",
            replace="YEAR",
            search_mode="Regex Pattern",
            text="In 1999 and 2024."
        )
        self.assertEqual(text, "In YEAR and YEAR.")
        self.assertEqual(count, 2)

    def test_edge_case_empty_text(self):
        text, count = self.node.replace_text(find="test", replace="new", text="")
        self.assertEqual(text, "")
        self.assertEqual(count, 0)

    def test_edge_case_none_text(self):
        text, count = self.node.replace_text(find="test", replace="new", text=None)
        self.assertEqual(text, "")
        self.assertEqual(count, 0)

    def test_edge_case_empty_find(self):
        text, count = self.node.replace_text(find="", replace="new", text="Hello")
        self.assertEqual(text, "Hello")
        self.assertEqual(count, 0)

    def test_edge_case_deletion_empty_replace(self):
        text, count = self.node.replace_text(find="badword", replace="", text="badword good text")
        self.assertEqual(text, " good text")
        self.assertEqual(count, 1)

if __name__ == "__main__":
    unittest.main()

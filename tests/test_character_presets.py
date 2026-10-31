import json
import os
import shutil
import struct
import sys
import tempfile
import unittest
from unittest.mock import MagicMock, patch

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import test_helper

import folder_paths
import nodes.character_presets as cp
from nodes.character_presets import (
    ApplyCharacterLoRAs,
    CharacterPresetPicker,
    build_outputs,
    card_json_path,
    card_preview_path,
    delete_card,
    duplicate_card,
    humanize_lora_name,
    import_lora_cards,
    load_card,
    match_cards,
    normalize_card,
    normalize_card_id,
    normalize_lora_entry,
    parse_selected,
    resolve_lora,
    save_card,
    scan_lora_import,
    select_cards,
)


FAKE_LORAS = [
    "krea2/Chey.safetensors",
    "krea2/Dilaraa.safetensors",
    "styles/film_grain.safetensors",
]


def card(card_id, trigger, positive="", negative="", loras=None, **extra):
    payload = {
        "name": card_id.rsplit("/", 1)[-1],
        "trigger": trigger,
        "positive": positive,
        "negative": negative,
        "loras": loras if loras is not None else [],
    }
    payload.update(extra)
    return normalize_card(payload, card_id)


class CharacterPresetTestCase(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.mkdtemp(prefix="saturn_chars_")
        self.presets_dir = os.path.join(self.temp_dir, "character_presets")
        os.makedirs(self.presets_dir, exist_ok=True)
        self.patches = [
            patch.object(cp, "PRESETS_DIR", self.presets_dir),
            patch.object(cp, "USER_DIR", self.temp_dir),
            patch.object(cp, "USAGE_FILE", os.path.join(self.temp_dir, "character_usage.json")),
            patch.object(cp, "CYCLE_STATE_FILE", os.path.join(self.temp_dir, "character_cycle_state.json")),
            patch.object(cp, "available_loras", lambda: list(FAKE_LORAS)),
            patch("folder_paths.get_full_path", return_value=""),
        ]
        for patcher in self.patches:
            patcher.start()
        cp.invalidate_card_cache()

    def tearDown(self):
        for patcher in reversed(self.patches):
            patcher.stop()
        cp.invalidate_card_cache()
        shutil.rmtree(self.temp_dir, ignore_errors=True)

    def write_raw(self, card_id, payload, image=None):
        path = card_json_path(card_id)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w", encoding="utf-8") as handle:
            json.dump(payload, handle)
        if image:
            with open(os.path.splitext(path)[0] + ".png", "wb") as handle:
                handle.write(image)
        cp.invalidate_card_cache()
        return path


class TestCardModel(CharacterPresetTestCase):
    def test_normalize_card_id(self):
        self.assertEqual(normalize_card_id(" Chey.json "), "Chey")
        self.assertEqual(normalize_card_id("folder\\Chey.json"), "folder/Chey")
        self.assertEqual(normalize_card_id("/folder//Chey/"), "folder/Chey")
        self.assertEqual(normalize_card_id(None), "")

    def test_normalize_lora_entry_variants(self):
        self.assertEqual(
            normalize_lora_entry("krea2\\Chey.safetensors"),
            {
                "name": "krea2/Chey.safetensors",
                "strength_model": 1.0,
                "strength_clip": 1.0,
                "enabled": True,
            },
        )
        self.assertIsNone(normalize_lora_entry("   "))
        self.assertIsNone(normalize_lora_entry(42))
        entry = normalize_lora_entry({"name": "a.safetensors", "strength_model": "0.5", "enabled": False})
        self.assertEqual(entry["strength_model"], 0.5)
        self.assertEqual(entry["strength_clip"], 1.0)
        self.assertFalse(entry["enabled"])

    def test_normalize_card_defaults(self):
        normalized = normalize_card({"positive": "a photo", "tags": "one, two"}, "folder/Chey")
        self.assertEqual(normalized["id"], "folder/Chey")
        self.assertEqual(normalized["name"], "Chey")
        self.assertEqual(normalized["folder"], "folder")
        self.assertEqual(normalized["positive"], "a photo")
        self.assertEqual(normalized["tags"], ["one", "two"])
        self.assertTrue(normalized["enabled"])
        self.assertEqual(normalized["loras"], [])

    def test_normalize_card_legacy_prompt_keys(self):
        normalized = normalize_card({"prompt": "legacy", "negative_prompt": "bad"}, "Chey")
        self.assertEqual(normalized["positive"], "legacy")
        self.assertEqual(normalized["negative"], "bad")


class TestPaths(CharacterPresetTestCase):
    def test_card_json_path_containment(self):
        self.assertIsNotNone(card_json_path("folder/Chey"))
        self.assertIsNone(card_json_path("../evil"))
        self.assertIsNone(card_json_path("folder/../../evil"))
        self.assertIsNone(card_json_path("C:/windows/evil"))
        self.assertIsNone(card_json_path(""))
        # A leading slash is stripped, so the card stays inside the presets dir.
        inside = card_json_path("/absolute")
        self.assertTrue(inside.startswith(os.path.abspath(self.presets_dir)))

    def test_save_load_delete_round_trip(self):
        save_card("folder/Chey", {"trigger": "Chey", "positive": "smiling"})
        loaded = load_card("folder/Chey")
        self.assertEqual(loaded["trigger"], "Chey")
        self.assertTrue(os.path.exists(card_json_path("folder/Chey")))

        with open(os.path.splitext(card_json_path("folder/Chey"))[0] + ".png", "wb") as handle:
            handle.write(b"png")
        self.assertTrue(delete_card("folder/Chey"))
        self.assertFalse(os.path.exists(card_json_path("folder/Chey")))
        self.assertFalse(os.path.exists(os.path.splitext(card_json_path("folder/Chey"))[0] + ".png"))

    def test_sidecar_detection_is_case_insensitive(self):
        save_card("Chey", {"trigger": "Chey"})
        upper = os.path.splitext(card_json_path("Chey"))[0] + ".PNG"
        with open(upper, "wb") as handle:
            handle.write(b"png-bytes")
        self.assertEqual(cp.card_preview_path("Chey"), upper)
        self.assertTrue(delete_card("Chey"))
        self.assertFalse(os.path.exists(upper))

    def test_move_thumbnail_on_rename(self):
        save_card("Chey", {"trigger": "Chey"})
        source = os.path.splitext(card_json_path("Chey"))[0] + ".png"
        with open(source, "wb") as handle:
            handle.write(b"png-bytes")
        self.assertTrue(cp._move_thumbnail("Chey", "folder/Chey Renamed"))
        target = os.path.splitext(card_json_path("folder/Chey Renamed"))[0] + ".png"
        self.assertTrue(os.path.exists(target))
        self.assertFalse(os.path.exists(source))

    def test_duplicate_copies_thumbnail(self):
        save_card("Chey", {"trigger": "Chey"})
        source = os.path.splitext(card_json_path("Chey"))[0] + ".png"
        with open(source, "wb") as handle:
            handle.write(b"png-bytes")
        duplicate = duplicate_card("Chey", "folder/Chey Copy")
        self.assertIsNotNone(duplicate)
        self.assertEqual(duplicate["trigger"], "Chey")
        copied = os.path.splitext(card_json_path("folder/Chey Copy"))[0] + ".png"
        with open(copied, "rb") as handle:
            self.assertEqual(handle.read(), b"png-bytes")

    def test_resolve_lora_variants(self):
        self.assertEqual(resolve_lora("krea2/Chey.safetensors"), "krea2/Chey.safetensors")
        self.assertEqual(resolve_lora("KREA2\\chey.safetensors"), "krea2/Chey.safetensors")
        self.assertEqual(resolve_lora("Chey.safetensors"), "krea2/Chey.safetensors")
        self.assertEqual(resolve_lora("Chey"), "krea2/Chey.safetensors")
        self.assertIsNone(resolve_lora("missing.safetensors"))
        self.assertIsNone(resolve_lora(""))

    def test_resolve_lora_ambiguous_basename_is_rejected(self):
        with patch.object(cp, "available_loras", lambda: ["a/Chey.safetensors", "b/Chey.safetensors"]):
            self.assertIsNone(resolve_lora("Chey.safetensors"))


class TestMatching(CharacterPresetTestCase):
    def setUp(self):
        super().setUp()
        self.char1 = card("char1", "Char1", "red hair")
        self.char2 = card("char2", "Character2", "blue hair")
        self.cards = [self.char1, self.char2]

    def test_first_trigger_in_text_wins(self):
        matched = match_cards("I am Char1 and Character2", self.cards, "Contains")
        self.assertEqual([entry["id"] for entry in matched], ["char1"])

    def test_text_order_not_card_order(self):
        matched = match_cards("Character2 meets Char1", self.cards, "Contains")
        self.assertEqual([entry["id"] for entry in matched], ["char2"])

    def test_match_all_returns_text_order(self):
        matched = match_cards("Character2 meets Char1", self.cards, "Contains", match_all=True)
        self.assertEqual([entry["id"] for entry in matched], ["char2", "char1"])

    def test_whole_word_avoids_partial_hits(self):
        cards = [card("char", "Char", ""), card("char2", "Char2", "")]
        matched = match_cards("Char2 posing", cards, "Whole Word")
        self.assertEqual([entry["id"] for entry in matched], ["char2"])
        self.assertEqual(match_cards("Character posing", cards, "Whole Word"), [])

    def test_contains_allows_partial_hits(self):
        cards = [card("char", "Char", "")]
        self.assertEqual(len(match_cards("Character posing", cards, "Contains")), 1)
        self.assertEqual(match_cards("Character posing", cards, "Whole Word"), [])

    def test_exact_mode(self):
        cards = [card("char", "Char", "")]
        self.assertEqual(match_cards("char", cards, "Exact", case_sensitive=True), [])
        self.assertEqual(len(match_cards(" Char ", cards, "Exact")), 1)
        self.assertEqual(match_cards("Char posing", cards, "Exact"), [])

    def test_case_sensitivity(self):
        self.assertEqual(len(match_cards("char1 here", self.cards, "Contains")), 1)
        self.assertEqual(match_cards("char1 here", self.cards, "Contains", case_sensitive=True), [])

    def test_cards_without_trigger_are_ignored(self):
        cards = [card("notrigger", "", ""), card("char1", "Char1", "")]
        self.assertEqual([entry["id"] for entry in match_cards("Char1", cards, "Contains")], ["char1"])


class TestOutputs(CharacterPresetTestCase):
    def test_build_outputs_assembles_and_dedupes(self):
        first = card(
            "char1",
            "Char1",
            "red hair",
            "ugly",
            loras=[
                {"name": "krea2/Chey.safetensors", "strength_model": 0.8, "strength_clip": 0.6},
                {"name": "styles/film_grain.safetensors", "strength_model": 0.2},
            ],
        )
        second = card(
            "char2",
            "Char2",
            "blue hair",
            "blurry",
            loras=[{"name": "Chey.safetensors", "strength_model": 1.0}],
        )
        positive, negative, stack, names = build_outputs([first, second])
        self.assertEqual(positive, "red hair, blue hair")
        self.assertEqual(negative, "ugly, blurry")
        self.assertEqual(names, "char1, char2")
        self.assertEqual(len(stack), 2)
        self.assertEqual(stack[0]["name"], "krea2/Chey.safetensors")
        self.assertEqual(stack[0]["strength_model"], 0.8)
        self.assertEqual(stack[0]["strength_clip"], 0.6)
        self.assertTrue(stack[0]["resolved"])

    def test_build_outputs_custom_separator_and_missing_lora(self):
        entry = card("char1", "Char1", "a", "b", loras=[{"name": "missing.safetensors"}])
        positive, negative, stack, _ = build_outputs([entry], separator="\n")
        self.assertEqual(positive, "a")
        self.assertEqual(negative, "b")
        self.assertFalse(stack[0]["resolved"])
        self.assertEqual(stack[0]["name"], "missing.safetensors")

    def test_build_outputs_skips_disabled_loras(self):
        entry = card(
            "char1",
            "Char1",
            loras=[
                {"name": "krea2/Chey.safetensors", "enabled": False},
                {"name": "krea2/Dilaraa.safetensors"},
            ],
        )
        _, _, stack, _ = build_outputs([entry])
        self.assertEqual([item["name"] for item in stack], ["krea2/Dilaraa.safetensors"])


class TestSelection(CharacterPresetTestCase):
    def setUp(self):
        super().setUp()
        self.cards = [card(f"c{index}", f"T{index}") for index in range(4)]
        self.ids = [entry["id"] for entry in self.cards]

    def test_parse_selected(self):
        self.assertEqual(parse_selected('["a", "b"]'), ["a", "b"])
        self.assertEqual(parse_selected("a, b ,, c"), ["a", "b", "c"])
        self.assertEqual(parse_selected(""), [])
        self.assertEqual(parse_selected("[]"), [])
        self.assertEqual(parse_selected('{"bad": 1}'), [])

    def test_none_and_all_modes(self):
        self.assertEqual(select_cards(self.cards, self.ids[:2], "None", "node"), [])
        picked = select_cards(self.cards, self.ids[:2], "All", "node")
        self.assertEqual([entry["id"] for entry in picked], self.ids[:2])

    def test_all_mode_ignores_unselected_cards(self):
        picked = select_cards(self.cards, [self.ids[2]], "All", "node")
        self.assertEqual([entry["id"] for entry in picked], [self.ids[2]])

    def test_sequential_cycles_through_selection(self):
        picks = [select_cards(self.cards, self.ids[:2], "Sequential", "seq-node")[0]["id"] for _ in range(4)]
        self.assertEqual(picks, [self.ids[0], self.ids[1], self.ids[0], self.ids[1]])

    def test_random_no_replace_covers_selection_before_repeat(self):
        picks = [select_cards(self.cards, self.ids, "Random (No Replace)", "rand-node")[0]["id"] for _ in range(4)]
        self.assertEqual(sorted(picks), sorted(self.ids))

    def test_selection_is_ignored_for_unknown_ids(self):
        self.assertEqual(select_cards(self.cards, ["ghost"], "All", "node"), [])


class TestPickerNode(CharacterPresetTestCase):
    def setUp(self):
        super().setUp()
        save_card("char1", {"trigger": "Char1", "positive": "red hair"})
        save_card("char2", {"trigger": "Char2", "positive": "blue hair"})
        cp.invalidate_card_cache()
        self.node = CharacterPresetPicker()

    def test_detect_uses_selection_when_text_is_empty(self):
        stack, _, positive, _, names = self.node.pick(
            text="", selection_mode="All", _selected_presets='["char1"]'
        )
        self.assertEqual(positive, "red hair")
        self.assertEqual(names, "char1")
        self.assertEqual(stack, [])

    def test_detect_mode_matches_first_trigger(self):
        stack, stack_json, positive, negative, names = self.node.pick(
            text="Char2 and Char1", match_mode="Whole Word"
        )
        self.assertEqual(positive, "blue hair")
        self.assertEqual(names, "char2")
        self.assertEqual(json.loads(stack_json), stack)

    def test_select_mode_without_selection_is_empty(self):
        stack, _, positive, _, names = self.node.pick(_selected_presets="[]")
        self.assertEqual(stack, [])
        self.assertEqual(positive, "")
        self.assertEqual(names, "")

    def test_select_mode_uses_hidden_widget(self):
        _, _, positive, _, names = self.node.pick(
            selection_mode="All", _selected_presets='["char1", "char2"]'
        )
        self.assertEqual(positive, "red hair, blue hair")
        self.assertEqual(names, "char1, char2")

    def test_folder_filter_applies_to_detect(self):
        save_card("folder/char3", {"trigger": "Char3", "positive": "green hair"})
        cp.invalidate_card_cache()
        _, _, positive, _, _ = self.node.pick(text="Char3", folder="folder")
        self.assertEqual(positive, "green hair")
        _, _, positive, _, _ = self.node.pick(text="Char3", folder="")
        self.assertEqual(positive, "green hair")

    def test_disabled_cards_are_skipped_by_default(self):
        save_card("off", {"trigger": "Off", "positive": "hidden", "enabled": False})
        cp.invalidate_card_cache()
        _, _, positive, _, _ = self.node.pick(text="Off")
        self.assertEqual(positive, "")
        _, _, positive, _, _ = self.node.pick(text="Off", include_disabled=True)
        self.assertEqual(positive, "hidden")


class TestApplierNode(CharacterPresetTestCase):
    def test_applier_is_a_noop_without_stack(self):
        model, clip = object(), object()
        applied_model, applied_clip = ApplyCharacterLoRAs().apply(model, clip)
        self.assertIs(applied_model, model)
        self.assertIs(applied_clip, clip)

    def test_applier_reads_json_fallback_and_skips_missing(self):
        model, clip = "MODEL", "CLIP"
        lora_file = os.path.join(self.temp_dir, "Chey.safetensors")
        with open(lora_file, "wb") as handle:
            handle.write(b"stub")
        stack = [
            {"name": "krea2/Chey.safetensors", "strength_model": 0.7, "strength_clip": 0.4},
            {"name": "missing.safetensors", "strength_model": 1.0, "strength_clip": 1.0},
        ]
        loader = MagicMock(return_value=("MODEL_LORA", "CLIP_LORA"))
        with patch("folder_paths.get_full_path", return_value=lora_file), patch.object(
            cp.comfy.sd, "load_lora_for_models", loader
        ):
            applied_model, applied_clip = ApplyCharacterLoRAs().apply(
                model, clip, loras_json=json.dumps(stack)
            )
        self.assertEqual((applied_model, applied_clip), ("MODEL_LORA", "CLIP_LORA"))
        loader.assert_called_once()
        args = loader.call_args[0]
        self.assertEqual(args[3], 0.7)
        self.assertEqual(args[4], 0.4)

    def test_applier_skips_zero_strength_entries(self):
        loader = MagicMock()
        with patch.object(cp.comfy.sd, "load_lora_for_models", loader):
            ApplyCharacterLoRAs().apply(
                "MODEL",
                "CLIP",
                loras=[{"name": "krea2/Chey.safetensors", "strength_model": 0, "strength_clip": 0}],
            )
        loader.assert_not_called()


class TestLoraImport(CharacterPresetTestCase):
    def setUp(self):
        super().setUp()
        self.loras_dir = os.path.join(self.temp_dir, "loras")
        os.makedirs(os.path.join(self.loras_dir, "krea2", "Celebrity", "Actresses"), exist_ok=True)
        self.write_lora("krea2/Celebrity/Actresses/krea2_Ana-De-Armas_v1.safetensors", {"1_sks woman": {"sks woman": 1}})
        self.write_lora("krea2/Celebrity/Actresses/krea2_Emma-Watson-V4.safetensors")
        self.write_lora("krea2/Celebrity/Actresses/krea2_Emma-Watson-V2_large_onetrainer.safetensors")
        self.write_lora("krea2/Celebrity/Men/krea2_Hero.safetensors", {"1_hero": {"hero": 3}})
        self.write_lora("krea2/Other/Unrelated.safetensors")
        self.import_patches = [
            patch.object(cp, "available_loras", self.list_loras),
            patch.object(
                folder_paths,
                "get_folder_paths",
                create=True,
                new=lambda kind: [self.loras_dir] if kind == "loras" else [],
            ),
            patch("folder_paths.get_full_path", self.full_path),
        ]
        for patcher in self.import_patches:
            patcher.start()

    def tearDown(self):
        for patcher in reversed(self.import_patches):
            patcher.stop()
        super().tearDown()

    def write_lora(self, relative, tag_frequency=None):
        path = os.path.join(self.loras_dir, *relative.split("/"))
        os.makedirs(os.path.dirname(path), exist_ok=True)
        metadata = {}
        if tag_frequency is not None:
            metadata["ss_tag_frequency"] = json.dumps(tag_frequency)
        header = json.dumps({"__metadata__": metadata, "weight": {"dtype": "F16", "shape": [1], "data_offsets": [0, 2]}}).encode("utf-8")
        with open(path, "wb") as handle:
            handle.write(struct.pack("<Q", len(header)))
            handle.write(header)
            handle.write(b"\x00\x00")
        return path

    def list_loras(self):
        found = []
        for root, _dirs, files in os.walk(self.loras_dir):
            for name in files:
                if name.lower().endswith(".safetensors"):
                    found.append(os.path.relpath(os.path.join(root, name), self.loras_dir).replace("\\", "/"))
        return sorted(found)

    def full_path(self, _kind, name):
        candidate = os.path.join(self.loras_dir, *str(name).replace("\\", "/").split("/"))
        return candidate if os.path.exists(candidate) else ""

    def test_humanize_lora_name(self):
        self.assertEqual(humanize_lora_name("krea2_Ana-De-Armas_v1.safetensors"), "Ana De Armas")
        self.assertEqual(humanize_lora_name("krea2_Emma-Watson-V2_large_onetrainer.safetensors"), "Emma Watson")
        self.assertEqual(humanize_lora_name("krea2_Judy-Hopps.safetensors"), "Judy Hopps")
        self.assertEqual(humanize_lora_name("Celebrity.safetensors"), "Celebrity")

    def test_scan_only_reads_the_requested_folder(self):
        _, entries = scan_lora_import("krea2/Celebrity", target_folder="Celebrity")
        loras = {entry["lora"] for entry in entries}
        self.assertIn("krea2/Celebrity/Actresses/krea2_Ana-De-Armas_v1.safetensors", loras)
        self.assertNotIn("krea2/Other/Unrelated.safetensors", loras)
        self.assertEqual(len(entries), 4)

    def test_scan_builds_cards_under_the_target_folder(self):
        _, entries = scan_lora_import("krea2/Celebrity", target_folder="Celebrity")
        ids = {entry["id"] for entry in entries}
        self.assertIn("Celebrity/Actresses/Ana De Armas", ids)
        self.assertIn("Celebrity/Men/Hero", ids)

    def test_scan_disambiguates_version_collisions(self):
        _, entries = scan_lora_import("krea2/Celebrity/Actresses", target_folder="")
        ids = sorted(entry["id"] for entry in entries)
        self.assertIn("Emma Watson", ids)
        self.assertIn("Emma Watson V4", ids)

    def test_metadata_trigger_is_used_when_meaningful(self):
        _, entries = scan_lora_import("krea2/Celebrity/Men", trigger_mode="metadata")
        hero = next(entry for entry in entries if entry["lora"].endswith("krea2_Hero.safetensors"))
        self.assertEqual(hero["trigger"], "hero")

    def test_generic_metadata_trigger_falls_back_to_the_name(self):
        _, entries = scan_lora_import("krea2/Celebrity/Actresses", trigger_mode="metadata")
        ana = next(entry for entry in entries if entry["lora"].endswith("krea2_Ana-De-Armas_v1.safetensors"))
        self.assertEqual(ana["trigger"], "Ana De Armas")

    def test_trigger_mode_none_emits_no_trigger(self):
        _, entries = scan_lora_import("krea2/Celebrity/Men", trigger_mode="none")
        self.assertEqual(entries[0]["trigger"], "")

    def test_scan_rejects_folders_outside_the_loras_root(self):
        with self.assertRaises(ValueError):
            scan_lora_import("../")
        with self.assertRaises(ValueError):
            scan_lora_import("krea2/../..")

    def test_import_creates_cards_with_lora_and_preview(self):
        result = import_lora_cards("krea2/Celebrity/Men", target_folder="Celebrity")
        self.assertEqual(len(result["created"]), 1)
        saved = load_card("Celebrity/Hero")
        self.assertIsNotNone(saved)
        self.assertEqual(saved["trigger"], "Hero")
        self.assertEqual(saved["loras"][0]["name"], "krea2/Celebrity/Men/krea2_Hero.safetensors")
        self.assertTrue(saved["notes"].startswith("Imported from"))

    def test_import_marks_existing_cards_and_skips_them(self):
        import_lora_cards("krea2/Celebrity/Men")
        _, entries = scan_lora_import("krea2/Celebrity/Men")
        self.assertTrue(entries[0]["exists"])
        result = import_lora_cards("krea2/Celebrity/Men")
        self.assertEqual(result["created"], [])
        self.assertEqual(result["skipped"][0]["reason"], "exists")

    def test_import_overwrite_keeps_existing_prompts(self):
        import_lora_cards("krea2/Celebrity/Men")
        saved = load_card("Hero")
        saved["positive"] = "heroic portrait"
        saved["trigger"] = "cap"
        save_card("Hero", saved)
        result = import_lora_cards("krea2/Celebrity/Men", overwrite=True)
        self.assertEqual(len(result["created"]), 1)
        merged = load_card("Hero")
        self.assertEqual(merged["positive"], "heroic portrait")
        self.assertEqual(merged["trigger"], "cap")

    def test_import_only_selected_loras(self):
        result = import_lora_cards(
            "krea2/Celebrity/Actresses",
            ["krea2/Celebrity/Actresses/krea2_Emma-Watson-V4.safetensors"],
        )
        self.assertEqual([entry["id"] for entry in result["created"]], ["Emma Watson"])

    def test_import_preview_comes_from_the_lora_sidecar(self):
        image = os.path.join(self.loras_dir, "krea2", "Celebrity", "Men", "krea2_Hero.jpg")
        with open(image, "wb") as handle:
            handle.write(b"\xff\xd8\xff\xd9")
        import_lora_cards("krea2/Celebrity/Men")
        preview = card_preview_path("Hero")
        self.assertEqual(os.path.normcase(preview), os.path.normcase(image))


if __name__ == "__main__":
    unittest.main()

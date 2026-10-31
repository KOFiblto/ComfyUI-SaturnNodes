"""Character preset cards: JSON cards with sidecar thumbnails, a visual picker
node and a companion node that applies the selected LoRA stack.

Cards live in ``ComfyUI/user/default/SaturnNodes/character_presets`` as
``<Name>.json`` plus an optional ``<Name>.png`` thumbnail. Subfolders are
supported and act as categories.
"""

from __future__ import annotations

import base64
import copy
import hashlib
import json
import os
import random
import re
import shutil
import subprocess
import sys
import threading
import time

import folder_paths
from aiohttp import web
from server import PromptServer

from .utils import get_saturnnodes_user_dir, is_authenticated_local_request

try:  # ComfyUI runtime
    import comfy.sd
    from comfy.utils import load_torch_file
except Exception:  # pragma: no cover - test stubs provide mocks
    comfy = None
    load_torch_file = None

USER_DIR = get_saturnnodes_user_dir()
PRESETS_DIR = os.path.join(USER_DIR, "character_presets")
CYCLE_STATE_FILE = os.path.join(USER_DIR, "character_cycle_state.json")
USAGE_FILE = os.path.join(USER_DIR, "character_usage.json")

CARD_CATEGORY = "🪐 SaturnNodes/Loaders"
STACK_TYPE = "SATURN_LORA_STACK"

MATCH_MODES = ["Whole Word", "Contains", "Exact"]
SELECTION_MODES = ["Sequential", "Random", "Random (No Replace)", "All", "None"]
SORT_PRESETS = [
    "Name (A-Z)",
    "Name (Z-A)",
    "Usage (High to Low)",
    "Usage (Low to High)",
    "Date Modified (Newest First)",
    "Date Modified (Oldest First)",
]

_IMAGE_EXTENSIONS = (".png", ".jpg", ".jpeg", ".webp")
_MAX_THUMBNAIL_BYTES = 12 * 1024 * 1024

_STATE_LOCK = threading.RLock()
_USAGE_LOCK = threading.RLock()
_CARD_CACHE_LOCK = threading.RLock()
_CARD_CACHE = {"signature": None, "cards": []}


# ---------------------------------------------------------------------------
# Paths and identifiers
# ---------------------------------------------------------------------------

def ensure_presets_dir():
    os.makedirs(PRESETS_DIR, exist_ok=True)
    return PRESETS_DIR


def normalize_card_id(card_id):
    """Normalize a card identifier: forward slashes, no extension, no padding."""
    text = str(card_id or "").replace("\\", "/").strip().strip("/")
    text = re.sub(r"/{2,}", "/", text)
    if text.lower().endswith(".json"):
        text = text[:-5]
    return text


def is_safe_card_id(card_id):
    if not card_id or len(card_id) > 240:
        return False
    if card_id.startswith("/") or ":" in card_id or "\x00" in card_id:
        return False
    parts = card_id.split("/")
    if any(part in ("", ".", "..") for part in parts):
        return False
    return True


def card_json_path(card_id):
    """Absolute path of a card file, or None when the id escapes the presets dir."""
    cid = normalize_card_id(card_id)
    if not is_safe_card_id(cid):
        return None
    base = os.path.abspath(ensure_presets_dir())
    target = os.path.abspath(os.path.join(base, *cid.split("/")) + ".json")
    try:
        if os.path.commonpath([base, target]) != base:
            return None
    except ValueError:
        return None
    return target


def _sidecar_images(base_no_ext):
    """Every existing sidecar image for a card stem, case-insensitively."""
    directory = os.path.dirname(base_no_ext)
    stem = os.path.basename(base_no_ext).lower()
    try:
        entries = os.listdir(directory)
    except OSError:
        return []
    found = []
    for filename in entries:
        lowered = filename.lower()
        if any(lowered == stem + ext for ext in _IMAGE_EXTENSIONS):
            found.append(os.path.join(directory, filename))
    return found


def _sidecar_image(base_no_ext):
    found = _sidecar_images(base_no_ext)
    return found[0] if found else None


def card_preview_path(card_id, card=None, available=None):
    """Card thumbnail: sidecar image first, then a single LoRA preview."""
    path = card_json_path(card_id)
    if not path:
        return None
    sidecar = _sidecar_image(os.path.splitext(path)[0])
    if sidecar:
        return sidecar

    if card is None:
        card = load_card(card_id)
    if not card:
        return None

    enabled = [entry for entry in card.get("loras", []) if entry.get("enabled", True)]
    if len(enabled) != 1:
        return None
    resolved = resolve_lora(enabled[0].get("name", ""), available)
    if not resolved:
        return None
    return lora_preview_path(resolved)


# ---------------------------------------------------------------------------
# LoRA resolution
# ---------------------------------------------------------------------------

def available_loras():
    try:
        return list(folder_paths.get_filename_list("loras"))
    except Exception:
        return []


def resolve_lora(name, available=None):
    """Resolve a card LoRA reference against the installed LoRA list."""
    if not name:
        return None
    available = available if available is not None else available_loras()
    target = str(name).replace("\\", "/").strip()
    if not target:
        return None
    lowered = target.lower()

    for candidate in available:
        if candidate.replace("\\", "/").lower() == lowered:
            return candidate

    target_base = lowered.rsplit("/", 1)[-1]
    base_matches = [
        candidate
        for candidate in available
        if candidate.replace("\\", "/").lower().rsplit("/", 1)[-1] == target_base
    ]
    if len(base_matches) == 1:
        return base_matches[0]

    target_stem = target_base.rsplit(".", 1)[0]
    stem_matches = [
        candidate
        for candidate in available
        if candidate.replace("\\", "/").lower().rsplit("/", 1)[-1].rsplit(".", 1)[0] == target_stem
    ]
    if len(stem_matches) == 1:
        return stem_matches[0]
    return None


def lora_preview_path(lora_name):
    try:
        full_path = folder_paths.get_full_path("loras", lora_name)
    except Exception:
        full_path = None
    if not full_path or not os.path.exists(full_path):
        return None
    return _sidecar_image(os.path.splitext(full_path)[0])


# ---------------------------------------------------------------------------
# Card model
# ---------------------------------------------------------------------------

def _as_float(value, default):
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def normalize_lora_entry(raw):
    if isinstance(raw, str):
        name = raw.strip()
        if not name:
            return None
        return {
            "name": name.replace("\\", "/"),
            "strength_model": 1.0,
            "strength_clip": 1.0,
            "enabled": True,
        }
    if not isinstance(raw, dict):
        return None
    name = str(raw.get("name") or raw.get("lora") or "").strip()
    if not name:
        return None
    return {
        "name": name.replace("\\", "/"),
        "strength_model": _as_float(raw.get("strength_model", 1.0), 1.0),
        "strength_clip": _as_float(raw.get("strength_clip", 1.0), 1.0),
        "enabled": bool(raw.get("enabled", True)),
    }


def normalize_card(data, card_id):
    """Coerce a raw JSON card into the canonical shape used everywhere."""
    cid = normalize_card_id(card_id)
    raw = data if isinstance(data, dict) else {}
    default_name = cid.rsplit("/", 1)[-1]

    name = str(raw.get("name") or default_name).strip() or default_name
    trigger = str(raw.get("trigger") or "").strip()
    positive = str(raw.get("positive") or raw.get("prompt") or "").strip()
    negative = str(raw.get("negative") or raw.get("negative_prompt") or "").strip()

    loras = []
    for entry in raw.get("loras") or []:
        normalized = normalize_lora_entry(entry)
        if normalized:
            loras.append(normalized)

    tags = raw.get("tags")
    if isinstance(tags, str):
        tags = [part.strip() for part in tags.split(",") if part.strip()]
    elif isinstance(tags, list):
        tags = [str(tag).strip() for tag in tags if str(tag).strip()]
    else:
        tags = []

    return {
        "id": cid,
        "name": name,
        "folder": cid.rsplit("/", 1)[0] if "/" in cid else "",
        "trigger": trigger,
        "positive": positive,
        "negative": negative,
        "loras": loras,
        "tags": tags,
        "notes": str(raw.get("notes") or ""),
        "enabled": bool(raw.get("enabled", True)),
    }


def load_card(card_id):
    path = card_json_path(card_id)
    if not path or not os.path.exists(path):
        return None
    try:
        with open(path, "r", encoding="utf-8") as handle:
            data = json.load(handle)
    except Exception as exc:
        print(f"[SaturnNodes] Error reading character preset '{card_id}': {exc}")
        return None
    return normalize_card(data, card_id)


def save_card(card_id, card):
    path = card_json_path(card_id)
    if not path:
        raise ValueError("Invalid card id")
    os.makedirs(os.path.dirname(path), exist_ok=True)
    normalized = normalize_card(card, card_id)
    payload = {
        "name": normalized["name"],
        "trigger": normalized["trigger"],
        "positive": normalized["positive"],
        "negative": normalized["negative"],
        "loras": normalized["loras"],
        "tags": normalized["tags"],
        "notes": normalized["notes"],
        "enabled": normalized["enabled"],
    }
    temp_path = path + ".tmp"
    with open(temp_path, "w", encoding="utf-8") as handle:
        json.dump(payload, handle, indent=2, ensure_ascii=False)
    os.replace(temp_path, path)
    invalidate_card_cache()
    return normalized


def delete_card(card_id):
    path = card_json_path(card_id)
    if not path:
        return False
    removed = False
    base_no_ext = os.path.splitext(path)[0]
    for candidate in _sidecar_images(base_no_ext):
        try:
            os.remove(candidate)
            removed = True
        except OSError:
            pass
    if os.path.exists(path):
        try:
            os.remove(path)
            removed = True
        except OSError:
            pass
    invalidate_card_cache()
    return removed


def duplicate_card(card_id, new_id):
    card = load_card(card_id)
    if not card:
        return None
    new_card = copy.deepcopy(card)
    new_card["name"] = normalize_card_id(new_id).rsplit("/", 1)[-1]
    saved = save_card(new_id, new_card)
    source = card_json_path(card_id)
    target = card_json_path(new_id)
    if source and target:
        source_image = _sidecar_image(os.path.splitext(source)[0])
        if source_image:
            extension = os.path.splitext(source_image)[1]
            try:
                shutil.copyfile(source_image, os.path.splitext(target)[0] + extension)
            except OSError:
                pass
    return saved


# ---------------------------------------------------------------------------
# Card scanning
# ---------------------------------------------------------------------------

def _presets_signature():
    ensure_presets_dir()
    digest = hashlib.sha256()
    for root, dirs, files in os.walk(PRESETS_DIR):
        dirs.sort()
        for filename in sorted(files):
            if not filename.lower().endswith((".json",) + _IMAGE_EXTENSIONS):
                continue
            full = os.path.join(root, filename)
            try:
                stat = os.stat(full)
            except OSError:
                continue
            relative = os.path.relpath(full, PRESETS_DIR).replace("\\", "/")
            digest.update(relative.encode("utf-8"))
            digest.update(str(stat.st_mtime_ns).encode("utf-8"))
            digest.update(str(stat.st_size).encode("utf-8"))
    return digest.hexdigest()[:16]


def invalidate_card_cache():
    with _CARD_CACHE_LOCK:
        _CARD_CACHE["signature"] = None
        _CARD_CACHE["cards"] = []


def list_cards(folder="", include_disabled=False, use_cache=True):
    """Return every card under the presets directory (optionally filtered)."""
    ensure_presets_dir()
    signature = _presets_signature()

    with _CARD_CACHE_LOCK:
        if use_cache and _CARD_CACHE["signature"] == signature:
            cards = copy.deepcopy(_CARD_CACHE["cards"])
        else:
            cards = _scan_cards()
            _CARD_CACHE["signature"] = signature
            _CARD_CACHE["cards"] = copy.deepcopy(cards)

    prefix = normalize_card_id(folder).lower()
    if prefix:
        cards = [
            card
            for card in cards
            if card["folder"].lower() == prefix
            or card["folder"].lower().startswith(prefix + "/")
        ]
    if not include_disabled:
        cards = [card for card in cards if card.get("enabled", True)]

    usage = load_usage()
    available = available_loras()
    for card in cards:
        card["usage"] = usage.get(card["id"], 0)
        card["has_preview"] = card_preview_path(card["id"], card, available) is not None
        card["missing_loras"] = [
            entry["name"]
            for entry in card["loras"]
            if entry.get("enabled", True) and not resolve_lora(entry["name"], available)
        ]
        try:
            card["mtime"] = os.path.getmtime(card_json_path(card["id"]) or "")
        except (OSError, TypeError):
            card["mtime"] = 0
    return cards


def _scan_cards():
    cards = []
    for root, dirs, files in os.walk(PRESETS_DIR):
        dirs.sort()
        for filename in sorted(files):
            if not filename.lower().endswith(".json"):
                continue
            full = os.path.join(root, filename)
            relative = os.path.relpath(full, PRESETS_DIR).replace("\\", "/")
            card_id = relative[:-5]
            if not is_safe_card_id(card_id):
                continue
            try:
                with open(full, "r", encoding="utf-8") as handle:
                    data = json.load(handle)
            except Exception as exc:
                print(f"[SaturnNodes] Skipping invalid character preset '{relative}': {exc}")
                continue
            cards.append(normalize_card(data, card_id))
    return cards


def list_folders():
    ensure_presets_dir()
    folders = set()
    for root, dirs, files in os.walk(PRESETS_DIR):
        relative = os.path.relpath(root, PRESETS_DIR).replace("\\", "/")
        if relative != ".":
            folders.add(relative)
        for filename in files:
            if not filename.lower().endswith(".json"):
                continue
            sub = os.path.relpath(root, PRESETS_DIR).replace("\\", "/")
            if sub != ".":
                folders.add(sub)
    return sorted(folders)


# ---------------------------------------------------------------------------
# Usage counters
# ---------------------------------------------------------------------------

def load_usage():
    try:
        if not os.path.exists(USAGE_FILE):
            return {}
        with open(USAGE_FILE, "r", encoding="utf-8") as handle:
            data = json.load(handle)
        if isinstance(data, dict):
            return {str(key): int(value) for key, value in data.items() if str(value).lstrip("-").isdigit()}
    except Exception:
        pass
    return {}


def increment_usage(card_ids):
    if not card_ids:
        return
    with _USAGE_LOCK:
        usage = load_usage()
        for card_id in card_ids:
            usage[card_id] = int(usage.get(card_id, 0)) + 1
        try:
            os.makedirs(USER_DIR, exist_ok=True)
            temp_path = USAGE_FILE + ".tmp"
            with open(temp_path, "w", encoding="utf-8") as handle:
                json.dump(usage, handle, indent=2, ensure_ascii=False)
            os.replace(temp_path, USAGE_FILE)
        except Exception as exc:
            print(f"[SaturnNodes] Error saving character usage: {exc}")


# ---------------------------------------------------------------------------
# Selection: trigger detection and cycling
# ---------------------------------------------------------------------------

def _trigger_match(text_lowered, trigger_lowered, match_mode):
    """Return the character index of a trigger hit, or -1."""
    if not trigger_lowered:
        return -1
    if match_mode == "Exact":
        return 0 if text_lowered.strip() == trigger_lowered else -1
    if match_mode == "Whole Word":
        pattern = r"(?<![0-9a-z_])" + re.escape(trigger_lowered) + r"(?![0-9a-z_])"
        match = re.search(pattern, text_lowered)
        return match.start() if match else -1
    return text_lowered.find(trigger_lowered)


def match_cards(text, cards, match_mode="Whole Word", case_sensitive=False, match_all=False):
    """Find cards whose trigger appears in ``text``.

    Matches are ordered by their position in the text, so the first trigger
    written wins when ``match_all`` is disabled.
    """
    if not text:
        return []
    haystack = text if case_sensitive else text.lower()
    hits = []
    for card in cards:
        trigger = card.get("trigger") or ""
        if not trigger:
            continue
        needle = trigger if case_sensitive else trigger.lower()
        index = _trigger_match(haystack, needle, match_mode)
        if index >= 0:
            hits.append((index, card["id"], card))
    hits.sort(key=lambda item: (item[0], item[1]))
    matched = [card for _, _, card in hits]
    if not matched:
        return []
    return matched if match_all else [matched[0]]


def _load_cycle_state():
    try:
        if not os.path.exists(CYCLE_STATE_FILE):
            return {}
        with open(CYCLE_STATE_FILE, "r", encoding="utf-8") as handle:
            data = json.load(handle)
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def _save_cycle_state(state):
    try:
        os.makedirs(USER_DIR, exist_ok=True)
        temp_path = CYCLE_STATE_FILE + ".tmp"
        with open(temp_path, "w", encoding="utf-8") as handle:
            json.dump(state, handle, indent=2, ensure_ascii=False)
        os.replace(temp_path, CYCLE_STATE_FILE)
    except Exception as exc:
        print(f"[SaturnNodes] Error saving character cycle state: {exc}")


def _current_prompt_id():
    try:
        server = PromptServer.instance
        queue = getattr(server, "prompt_queue", None)
        mutex = getattr(queue, "mutex", None)
        if mutex:
            with mutex:
                items = list(queue.currently_running.values())
        else:
            items = list(queue.currently_running.values())
        for item in items:
            if isinstance(item, (tuple, list)) and len(item) > 1:
                return str(item[1])
    except Exception:
        pass
    return None


def _remember_assignment(assigned, prompt_id, card_id, limit=50):
    if not prompt_id:
        return
    assigned.pop(prompt_id, None)
    assigned[prompt_id] = card_id
    while len(assigned) > limit:
        assigned.pop(next(iter(assigned)))


def select_cycled(mode, node_id, card_ids, prompt_id=None):
    """Sequential / Random / Random (No Replace) pick over ``card_ids``."""
    card_ids = [card_id for card_id in card_ids if card_id]
    if not card_ids:
        return None
    prefix = {
        "Random": "rand",
        "Sequential": "seq",
        "Random (No Replace)": "noreplace",
    }.get(mode)
    if not prefix:
        return None

    choices_hash = hashlib.sha256(
        json.dumps(sorted(card_ids), ensure_ascii=False).encode("utf-8")
    ).hexdigest()[:16]
    state_key = f"card_{prefix}_{node_id}_{choices_hash}"

    with _STATE_LOCK:
        state = _load_cycle_state()
        node_state = state.get(state_key)
        if isinstance(node_state, dict):
            raw_assigned = node_state.get("assigned", {})
            assigned = dict(raw_assigned) if isinstance(raw_assigned, dict) else {}
            raw_pool = node_state.get("pool", [])
            pool = list(raw_pool) if isinstance(raw_pool, (list, tuple)) else []
            last_selected = node_state.get("last")
            raw_order = node_state.get("order")
            order = list(raw_order) if isinstance(raw_order, (list, tuple)) else []
            try:
                index = max(0, int(node_state.get("index", 0)))
            except (TypeError, ValueError):
                index = 0
        else:
            assigned, pool, last_selected, order, index = {}, [], None, [], 0

        if mode == "Sequential":
            if not order or sorted(order) != sorted(card_ids):
                order = list(card_ids)
            if order:
                index %= len(order)
        else:
            order = []

        selected = None
        if prompt_id and prompt_id in assigned:
            candidate = assigned[prompt_id]
            selected = candidate if candidate in card_ids else None

        if selected is None:
            if mode == "Sequential":
                selected = order[index % len(order)] if order else None
                index += 1
            elif mode == "Random":
                selected = random.choice(card_ids)
            else:
                pool = [card_id for card_id in pool if card_id in card_ids]
                if not pool:
                    pool = list(card_ids)
                    random.shuffle(pool)
                    if len(pool) > 1 and last_selected in pool:
                        if pool[0] == last_selected:
                            swap_index = random.randrange(1, len(pool))
                            pool[0], pool[swap_index] = pool[swap_index], pool[0]
                selected = pool.pop(0)
                last_selected = selected

        if prompt_id and selected:
            _remember_assignment(assigned, prompt_id, selected)

        entry = {"assigned": assigned, "last_updated": int(time.time())}
        if mode == "Sequential":
            entry["index"] = index
            entry["order"] = order
        if mode == "Random (No Replace)":
            entry["pool"] = pool
            entry["last"] = last_selected
        state[state_key] = entry
        _save_cycle_state(state)
        return selected


def parse_selected(raw):
    if not raw:
        return []
    if isinstance(raw, (list, tuple)):
        return [str(item) for item in raw if str(item).strip()]
    text = str(raw).strip()
    if not text:
        return []
    if text.startswith("[") or text.startswith("{"):
        try:
            parsed = json.loads(text)
        except Exception:
            return []
        if isinstance(parsed, list):
            return [str(item) for item in parsed if str(item).strip()]
        return []
    return [part.strip() for part in text.split(",") if part.strip()]


def select_cards(cards, selected_ids, selection_mode, node_id, prompt_id=None):
    """Resolve the manually selected ids into the cards used for this run."""
    by_id = {card["id"]: card for card in cards}
    ordered = [by_id[card_id] for card_id in selected_ids if card_id in by_id]

    if selection_mode == "None":
        return []
    if selection_mode == "All":
        return ordered
    if not ordered:
        return []
    picked = select_cycled(selection_mode, node_id, [card["id"] for card in ordered], prompt_id)
    if not picked:
        return []
    return [by_id[picked]] if picked in by_id else []


# ---------------------------------------------------------------------------
# Output assembly
# ---------------------------------------------------------------------------

def build_outputs(cards, separator=", ", available=None):
    positives = []
    negatives = []
    stack = []
    names = []
    seen = set()
    available = available if available is not None else available_loras()

    for card in cards:
        if card.get("positive"):
            positives.append(card["positive"])
        if card.get("negative"):
            negatives.append(card["negative"])
        names.append(card.get("name") or card.get("id", ""))
        for entry in card.get("loras", []):
            if not entry.get("enabled", True):
                continue
            resolved = resolve_lora(entry.get("name", ""), available)
            key = (resolved or entry.get("name", "")).replace("\\", "/").lower()
            if key in seen:
                continue
            seen.add(key)
            stack.append(
                {
                    "name": resolved or entry.get("name", ""),
                    "requested": entry.get("name", ""),
                    "strength_model": entry.get("strength_model", 1.0),
                    "strength_clip": entry.get("strength_clip", 1.0),
                    "resolved": bool(resolved),
                }
            )
    joiner = separator if separator is not None else ", "
    return joiner.join(positives), joiner.join(negatives), stack, ", ".join(names)


def _notify_ui(node_id, card_ids, mode, status):
    try:
        PromptServer.instance.send_sync(
            "saturnnodes_character_presets_selected",
            {
                "node_id": str(node_id),
                "cards": list(card_ids),
                "mode": mode,
                "status": status,
            },
        )
    except Exception:
        pass


# ---------------------------------------------------------------------------
# Nodes
# ---------------------------------------------------------------------------

class CharacterPresetPicker:
    """Visual character preset browser.

    Emits the selected cards' LoRA stack plus their positive and negative
    prompts. In Detect mode the cards are chosen by scanning an upstream text
    for their triggers instead of by clicking.
    """

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "folder": ("STRING", {"default": ""}),
                "mode": (["Select", "Detect"], {"default": "Select"}),
                "selection_mode": (SELECTION_MODES, {"default": "Sequential"}),
                "separator": ("STRING", {"default": ", ", "advanced": True}),
                "match_mode": (MATCH_MODES, {"default": "Whole Word", "advanced": True}),
                "match_all": ("BOOLEAN", {"default": False, "advanced": True}),
                "case_sensitive": ("BOOLEAN", {"default": False, "advanced": True}),
                "include_disabled": ("BOOLEAN", {"default": False, "advanced": True}),
                "sort_presets_by": (SORT_PRESETS, {"default": "Name (A-Z)", "advanced": True}),
                "folder_position": (
                    ["Folders First", "Root Presets First"],
                    {"default": "Folders First", "advanced": True},
                ),
                "display_mode": (["Scrollable", "Show All"], {"default": "Scrollable", "advanced": True}),
            },
            "optional": {
                "text": ("STRING", {"forceInput": True}),
            },
            "hidden": {
                "_selected_presets": ("STRING", {"default": "[]"}),
                "unique_id": "UNIQUE_ID",
            },
        }

    RETURN_TYPES = (STACK_TYPE, "STRING", "STRING", "STRING", "STRING")
    RETURN_NAMES = ("loras", "loras_json", "positive", "negative", "names")
    FUNCTION = "pick"
    CATEGORY = CARD_CATEGORY
    DESCRIPTION = (
        "Visual character preset browser. Pick cards to emit their LoRA stack and "
        "prompts, or use Detect mode to select cards by matching their triggers "
        "inside an upstream prompt text."
    )

    @classmethod
    def IS_CHANGED(cls, mode="Select", selection_mode="Sequential", folder="", text="", **kwargs):
        signature = _presets_signature()
        if mode == "Detect":
            return f"{signature}|detect|{text}"
        if selection_mode in ("Sequential", "Random", "Random (No Replace)"):
            return time.time()
        return f"{signature}|{selection_mode}|{folder}"

    def pick(
        self,
        folder="",
        mode="Select",
        selection_mode="Sequential",
        separator=", ",
        match_mode="Whole Word",
        match_all=False,
        case_sensitive=False,
        include_disabled=False,
        sort_presets_by="Name (A-Z)",
        folder_position="Folders First",
        display_mode="Scrollable",
        text="",
        _selected_presets="[]",
        unique_id="default",
        **kwargs,
    ):
        cards = list_cards(folder=folder, include_disabled=include_disabled)
        available = available_loras()
        prompt_id = _current_prompt_id()
        status = ""

        if mode == "Detect":
            if not (text or "").strip():
                # In Detect mode the upstream text is a hard requirement: without
                # it there is nothing to scan, so fail loudly instead of silently
                # emitting an empty stack.
                raise ValueError(
                    "Character Preset Picker: Detect mode requires a text input. "
                    "Connect the prompt text to the 'text' input or switch Mode to Select."
                )
            chosen = match_cards(text, cards, match_mode, case_sensitive, match_all)
            if not chosen:
                status = "no-match"
        else:
            chosen = select_cards(cards, parse_selected(_selected_presets), selection_mode, unique_id, prompt_id)
            if not chosen and selection_mode != "None":
                status = "no-selection"

        positive, negative, stack, names = build_outputs(chosen, separator, available)
        increment_usage([card["id"] for card in chosen])
        _notify_ui(unique_id, [card["id"] for card in chosen], mode, status)

        missing = [entry["requested"] for entry in stack if not entry["resolved"]]
        if missing:
            print(f"[SaturnNodes] Character Preset Picker: missing LoRA file(s): {', '.join(missing)}")

        return (stack, json.dumps(stack, ensure_ascii=False), positive, negative, names)


class ApplyCharacterLoRAs:
    """Apply a character preset LoRA stack to a MODEL/CLIP pair."""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "model": ("MODEL",),
                "clip": ("CLIP",),
            },
            "optional": {
                "loras": (STACK_TYPE,),
                "loras_json": ("STRING", {"forceInput": True}),
            },
        }

    RETURN_TYPES = ("MODEL", "CLIP")
    RETURN_NAMES = ("MODEL", "CLIP")
    FUNCTION = "apply"
    CATEGORY = CARD_CATEGORY
    DESCRIPTION = (
        "Applies the LoRA stack emitted by the Character Preset Picker, using each "
        "entry's own model and clip strength."
    )

    def apply(self, model, clip, loras=None, loras_json=None):
        stack = loras if isinstance(loras, list) else []
        if not stack and loras_json:
            try:
                parsed = json.loads(loras_json)
                if isinstance(parsed, list):
                    stack = parsed
            except Exception:
                stack = []

        current_model = model
        current_clip = clip
        available = available_loras()

        for entry in stack:
            if not isinstance(entry, dict):
                continue
            requested = entry.get("name") or entry.get("requested") or ""
            resolved = resolve_lora(requested, available)
            if not resolved:
                print(f"[SaturnNodes] Apply Character LoRAs: skipping missing LoRA '{requested}'")
                continue
            try:
                strength_model = float(entry.get("strength_model", 1.0))
                strength_clip = float(entry.get("strength_clip", 1.0))
            except (TypeError, ValueError):
                strength_model = strength_clip = 1.0

            if strength_model == 0 and strength_clip == 0:
                continue

            try:
                lora_path = folder_paths.get_full_path("loras", resolved)
                if not lora_path or not os.path.exists(lora_path):
                    print(f"[SaturnNodes] Apply Character LoRAs: file not found for '{resolved}'")
                    continue
                lora_data = load_torch_file(lora_path, safe_load=True)
                current_model, current_clip = comfy.sd.load_lora_for_models(
                    current_model, current_clip, lora_data, strength_model, strength_clip
                )
            except Exception as exc:
                print(f"[SaturnNodes] Apply Character LoRAs: failed to load '{resolved}': {exc}")

        return (current_model, current_clip)


# ---------------------------------------------------------------------------
# HTTP routes
# ---------------------------------------------------------------------------

server = PromptServer.instance
routes = server.routes


@routes.get("/saturnnodes/character_presets/get_presets")
async def get_presets_endpoint(request):
    if not is_authenticated_local_request(request):
        return web.json_response({"error": "Forbidden: Local authenticated access only"}, status=403)
    try:
        folder = request.query.get("folder", "")
        include_disabled = request.query.get("include_disabled", "false").lower() == "true"
        cards = list_cards(folder=folder, include_disabled=include_disabled, use_cache=False)
        return web.json_response(
            {
                "cards": cards,
                "folders": list_folders(),
                "root": PRESETS_DIR,
            }
        )
    except Exception as exc:
        return web.json_response({"error": str(exc)}, status=500)


@routes.get("/saturnnodes/character_presets/get_preview")
async def get_preview_endpoint(request):
    if not is_authenticated_local_request(request):
        return web.json_response({"error": "Forbidden: Local authenticated access only"}, status=403)
    card_id = request.query.get("id", "")
    card = load_card(card_id)
    path = card_preview_path(card_id, card)
    if not path or not os.path.exists(path):
        return web.Response(status=404)

    full = request.query.get("full", "false").lower() == "true"
    try:
        if full:
            with open(path, "rb") as handle:
                return web.Response(body=handle.read(), content_type=_content_type(path))
        from .lora_loader import get_or_create_thumbnail

        thumb = get_or_create_thumbnail(path, max_size=256)
        if thumb and os.path.exists(thumb):
            with open(thumb, "rb") as handle:
                return web.Response(body=handle.read(), content_type="image/webp")
    except Exception:
        pass

    with open(path, "rb") as handle:
        return web.Response(body=handle.read(), content_type=_content_type(path))


def _content_type(path):
    extension = os.path.splitext(path)[1].lower()
    return {
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".webp": "image/webp",
    }.get(extension, "application/octet-stream")


@routes.get("/saturnnodes/character_presets/get_loras")
async def get_loras_endpoint(request):
    if not is_authenticated_local_request(request):
        return web.json_response({"error": "Forbidden: Local authenticated access only"}, status=403)
    return web.json_response({"loras": sorted(available_loras())})


@routes.post("/saturnnodes/character_presets/save")
async def save_card_endpoint(request):
    if not is_authenticated_local_request(request):
        return web.json_response({"error": "Forbidden: Local authenticated access only"}, status=403)
    try:
        payload = await request.json()
    except Exception:
        return web.json_response({"error": "Invalid JSON body"}, status=400)

    card_id = normalize_card_id(payload.get("id", ""))
    original_id = normalize_card_id(payload.get("original_id", "") or card_id)
    card = payload.get("card") or {}
    if not is_safe_card_id(card_id):
        return web.json_response({"error": "Invalid card id"}, status=400)

    try:
        saved = save_card(card_id, card)
    except Exception as exc:
        return web.json_response({"error": str(exc)}, status=500)

    if original_id and original_id != card_id:
        try:
            _move_thumbnail(original_id, card_id)
        except Exception:
            pass
        try:
            delete_card(original_id)
        except Exception:
            pass

    thumbnail = payload.get("thumbnail_data_url")
    thumbnail_error = None
    if thumbnail:
        thumbnail_error = _write_thumbnail(card_id, thumbnail)
    elif payload.get("remove_thumbnail"):
        _remove_thumbnail(card_id)

    return web.json_response(
        {
            "status": "ok",
            "card": saved,
            "missing_loras": [
                entry["name"]
                for entry in saved["loras"]
                if not resolve_lora(entry["name"])
            ],
            "thumbnail_error": thumbnail_error,
        }
    )


def _move_thumbnail(source_id, target_id):
    source = card_json_path(source_id)
    target = card_json_path(target_id)
    if not source or not target:
        return False
    source_base = os.path.splitext(source)[0]
    target_base = os.path.splitext(target)[0]
    try:
        os.makedirs(os.path.dirname(target_base), exist_ok=True)
    except OSError:
        return False
    moved = False
    for candidate in _sidecar_images(source_base):
        extension = os.path.splitext(candidate)[1]
        try:
            os.replace(candidate, target_base + extension)
            moved = True
        except OSError:
            pass
    if moved:
        invalidate_card_cache()
    return moved


def _remove_thumbnail(card_id):
    path = card_json_path(card_id)
    if not path:
        return False
    base_no_ext = os.path.splitext(path)[0]
    removed = False
    for candidate in _sidecar_images(base_no_ext):
        try:
            os.remove(candidate)
            removed = True
        except OSError:
            pass
    invalidate_card_cache()
    return removed


def _write_thumbnail(card_id, data_url):
    try:
        header, _, encoded = str(data_url).partition(",")
        if "base64" not in header:
            return "Unsupported image payload"
        mime = header.split(";", 1)[0].replace("data:", "").strip().lower()
        extension = {
            "image/png": ".png",
            "image/jpeg": ".jpg",
            "image/jpg": ".jpg",
            "image/webp": ".webp",
        }.get(mime)
        if not extension:
            return "Unsupported image type (use PNG, JPEG or WebP)"
        raw = base64.b64decode(encoded, validate=False)
        if len(raw) > _MAX_THUMBNAIL_BYTES:
            return "Image is too large (max 12 MB)"
        path = card_json_path(card_id)
        if not path:
            return "Invalid card id"
        base_no_ext = os.path.splitext(path)[0]
        target = base_no_ext + extension
        for stale in _sidecar_images(base_no_ext):
            if os.path.normcase(stale) != os.path.normcase(target):
                try:
                    os.remove(stale)
                except OSError:
                    pass
        with open(target, "wb") as handle:
            handle.write(raw)
        invalidate_card_cache()
        return None
    except Exception as exc:
        return str(exc)


@routes.post("/saturnnodes/character_presets/delete")
async def delete_card_endpoint(request):
    if not is_authenticated_local_request(request):
        return web.json_response({"error": "Forbidden: Local authenticated access only"}, status=403)
    try:
        payload = await request.json()
    except Exception:
        return web.json_response({"error": "Invalid JSON body"}, status=400)
    card_id = normalize_card_id(payload.get("id", ""))
    if not is_safe_card_id(card_id):
        return web.json_response({"error": "Invalid card id"}, status=400)
    removed = delete_card(card_id)
    return web.json_response({"status": "ok" if removed else "missing"})


@routes.post("/saturnnodes/character_presets/duplicate")
async def duplicate_card_endpoint(request):
    if not is_authenticated_local_request(request):
        return web.json_response({"error": "Forbidden: Local authenticated access only"}, status=403)
    try:
        payload = await request.json()
    except Exception:
        return web.json_response({"error": "Invalid JSON body"}, status=400)
    card_id = normalize_card_id(payload.get("id", ""))
    new_id = normalize_card_id(payload.get("new_id", ""))
    if not is_safe_card_id(card_id) or not is_safe_card_id(new_id):
        return web.json_response({"error": "Invalid card id"}, status=400)
    if card_json_path(new_id) and os.path.exists(card_json_path(new_id)):
        return web.json_response({"error": "A card with that name already exists"}, status=409)
    saved = duplicate_card(card_id, new_id)
    if not saved:
        return web.json_response({"error": "Source card not found"}, status=404)
    return web.json_response({"status": "ok", "card": saved})


@routes.post("/saturnnodes/character_presets/use_lora_preview")
async def use_lora_preview_endpoint(request):
    if not is_authenticated_local_request(request):
        return web.json_response({"error": "Forbidden: Local authenticated access only"}, status=403)
    try:
        payload = await request.json()
    except Exception:
        return web.json_response({"error": "Invalid JSON body"}, status=400)
    card_id = normalize_card_id(payload.get("id", ""))
    if not is_safe_card_id(card_id):
        return web.json_response({"error": "Invalid card id"}, status=400)

    card = load_card(card_id)
    if not card:
        return web.json_response({"error": "Card not found"}, status=404)

    enabled = [entry for entry in card.get("loras", []) if entry.get("enabled", True)]
    if len(enabled) != 1:
        return web.json_response({"error": "Card needs exactly one LoRA to inherit its preview"}, status=400)
    resolved = resolve_lora(enabled[0].get("name", ""))
    source = lora_preview_path(resolved) if resolved else None
    if not source:
        return web.json_response({"error": "That LoRA has no preview image"}, status=404)

    target = os.path.splitext(card_json_path(card_id))[0] + ".png"
    try:
        shutil.copyfile(source, target)
    except OSError as exc:
        return web.json_response({"error": str(exc)}, status=500)
    invalidate_card_cache()
    return web.json_response({"status": "ok"})


@routes.post("/saturnnodes/character_presets/open_folder")
async def open_folder_endpoint(request):
    if not is_authenticated_local_request(request):
        return web.json_response({"error": "Forbidden: Local authenticated access only"}, status=403)
    ensure_presets_dir()
    try:
        if sys.platform == "win32":
            os.startfile(PRESETS_DIR)  # noqa: S606 - local user initiated
        elif sys.platform == "darwin":
            subprocess.Popen(["open", PRESETS_DIR])
        else:
            subprocess.Popen(["xdg-open", PRESETS_DIR])
        return web.json_response({"status": "ok"})
    except Exception as exc:
        return web.json_response({"error": str(exc)}, status=500)

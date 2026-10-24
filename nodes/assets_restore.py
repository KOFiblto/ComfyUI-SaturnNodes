import os
import json
import math
import time
import uuid
import heapq
import datetime
import threading
from PIL import Image

import folder_paths
from .utils import get_env_setting
from .generation_times import get_generation_time, get_generation_time_debug

def is_assets_restore_enabled():
    val = get_env_setting("ENABLE_ASSETS_RESTORE", "true").lower()
    return val in ["true", "1", "yes"]

def get_assets_restore_count():
    try:
        val = int(get_env_setting("RESTORE_ASSETS_COUNT", "64"))
        return max(1, min(1000, val))
    except Exception:
        return 64

def is_recursive_assets_scan_enabled():
    val = get_env_setting("RESTORE_ASSETS_RECURSIVE", "true").lower()
    return val in ["true", "1", "yes"]

def is_restored_generation_time_enabled():
    val = get_env_setting("SHOW_RESTORED_GENERATION_TIME", "true").lower()
    return val in ["true", "1", "yes"]

def _strip_exif_text(text):
    """Strip NUL padding, a UTF BOM and surrounding whitespace from EXIF text."""
    value = str(text or "").replace("\x00", "").strip()
    if value.startswith("\ufeff"):
        value = value[1:].strip()
    return value

def _decode_exif_text(raw):
    """Decode an EXIF UserComment, including the standard 8-byte prefix."""
    if not raw:
        return ""
    if isinstance(raw, bytes):
        prefix, body = raw[:8], raw[8:]
        if prefix.startswith(b"UNICODE"):
            # The EXIF standard / piexif write UTF-16 big-endian here, not a
            # BOM-prefixed native-endian string.
            try:
                return _strip_exif_text(body.decode("utf-16-be", errors="ignore"))
            except Exception:
                pass
        if prefix.startswith(b"ASCII"):
            try:
                return _strip_exif_text(body.decode("ascii", errors="ignore"))
            except Exception:
                pass
        if prefix.startswith(b"JIS"):
            try:
                return _strip_exif_text(body.decode("shift_jis", errors="ignore"))
            except Exception:
                pass
        try:
            return _strip_exif_text(raw.decode("utf-8", errors="ignore"))
        except Exception:
            return ""
    return _strip_exif_text(raw)

def parse_a1111_positive_prompt(parameters):
    """Extract the positive prompt from an A1111/Forge `parameters` string."""
    if not parameters:
        return ""
    if isinstance(parameters, bytes):
        parameters = _decode_exif_text(parameters)
    text = str(parameters).replace("\r\n", "\n").replace("\r", "\n").strip()
    if not text:
        return ""
    negative_index = text.find("Negative prompt:")
    if negative_index >= 0:
        positive = text[:negative_index].strip()
    else:
        positive = text
    # Drop the trailing generation-settings line (Steps: ..., Sampler: ...).
    lines = positive.split("\n")
    if lines:
        last = lines[-1].strip()
        if last.startswith("Steps:") or ("Sampler:" in last and "Steps:" in last):
            lines = lines[:-1]
    return "\n".join(lines).strip()

class AssetsRestoreManager:
    def __init__(self):
        self._restored_on_launch = False
        self._restore_lock = threading.RLock()
        self.last_debug_report = {}
        self.restored_count = 0

    def extract_image_metadata(self, filepath):
        """Extracts embedded prompt/workflow metadata from PNG, JPEG or WebP."""
        prompt_dict = {}
        workflow_dict = {}
        positive_prompt = ""

        try:
            with Image.open(filepath) as img:
                prompt_raw = img.info.get("prompt")
                workflow_raw = img.info.get("workflow")
                parameters_raw = img.info.get("parameters")

                # JPEG / WebP files written by ComfyUI or A1111 may carry the
                # metadata in an EXIF UserComment instead of PNG text chunks.
                if not parameters_raw:
                    exif = None
                    try:
                        exif = img.getexif()
                    except Exception:
                        exif = None
                    if not exif:
                        raw_exif = img.info.get("exif")
                        if raw_exif:
                            try:
                                exif = Image.Exif()
                                exif.load(raw_exif)
                            except Exception:
                                exif = None
                    if exif:
                        try:
                            parameters_raw = _decode_exif_text(exif.get(0x9286))
                        except Exception:
                            parameters_raw = ""

                if prompt_raw:
                    try:
                        parsed_prompt = json.loads(prompt_raw) if isinstance(prompt_raw, str) else prompt_raw
                        if isinstance(parsed_prompt, dict):
                            prompt_dict = parsed_prompt
                    except Exception:
                        pass

                if workflow_raw:
                    try:
                        parsed_workflow = json.loads(workflow_raw) if isinstance(workflow_raw, str) else workflow_raw
                        if isinstance(parsed_workflow, dict):
                            workflow_dict = parsed_workflow
                    except Exception:
                        pass

                if parameters_raw:
                    positive_prompt = parse_a1111_positive_prompt(parameters_raw)
        except Exception:
            pass

        return prompt_dict, workflow_dict, positive_prompt

    def scan_output_images(self, base_output_dir, limit=64, recursive=True, stats=None):
        """Return the newest `limit` images without keeping the full tree in memory."""
        if not os.path.exists(base_output_dir):
            return []

        valid_extensions = {".png", ".jpg", ".jpeg", ".webp"}
        norm_base = os.path.normpath(base_output_dir)
        if stats is None:
            stats = {}

        def iter_images():
            if recursive:
                roots = os.walk(norm_base)
            else:
                try:
                    roots = [(norm_base, [], os.listdir(norm_base))]
                except OSError:
                    roots = []
            for root, _, files in roots:
                for file in files:
                    _, ext = os.path.splitext(file)
                    if ext.lower() not in valid_extensions:
                        continue
                    full_path = os.path.join(root, file)
                    try:
                        mtime = os.path.getmtime(full_path)
                    except OSError:
                        continue
                    stats["scanned"] = stats.get("scanned", 0) + 1
                    rel_dir = os.path.relpath(root, norm_base)
                    subfolder = "" if rel_dir == "." else rel_dir.replace("\\", "/")
                    yield {
                        "filepath": full_path,
                        "filename": file,
                        "subfolder": subfolder,
                        "mtime": mtime,
                    }

        try:
            safe_limit = max(1, int(limit))
        except (TypeError, ValueError):
            safe_limit = 64

        # Keep only the top-N candidates (bounded memory). Include the
        # normalized relative path in the key so equal mtimes (bulk copies,
        # archive extraction, FAT timestamp granularity) always resolve to the
        # same files and the same order on every scan.
        def sort_key(item):
            return (
                item["mtime"],
                item["subfolder"],
                item["filename"],
            )

        top_images = heapq.nlargest(safe_limit, iter_images(), key=sort_key)
        # Restore chronological order (oldest -> newest) for stable history
        # numbering. Equal timestamps sort by subfolder/filename ascending.
        top_images.sort(key=sort_key)
        return top_images

    def _ingest_assets(self, prepared):
        """Register restored files in ComfyUI's asset DB using a single session."""
        if not prepared:
            return 0
        try:
            import importlib
            ingest_mod = importlib.import_module("app.assets.services.ingest")
            register_file_in_place = getattr(ingest_mod, "register_file_in_place", None)
            if not register_file_in_place:
                return 0
        except Exception:
            return 0

        registered = []
        for entry in prepared:
            try:
                res = register_file_in_place(abs_path=entry["filepath"], name=entry["filename"], tags=["output"])
                if res and hasattr(res, "ref") and res.ref and hasattr(res.ref, "id"):
                    registered.append((res.ref.id, entry))
            except Exception:
                pass

        if not registered:
            return 0

        try:
            db_mod = importlib.import_module("app.database.db")
            queries_mod = importlib.import_module("app.assets.database.queries")
            init_db = getattr(db_mod, "init_db", None)
            create_session = getattr(db_mod, "create_session", None)
            set_reference_metadata = getattr(queries_mod, "set_reference_metadata", None)
            if init_db and create_session and set_reference_metadata:
                init_db()
                with create_session() as session:
                    for reference_id, entry in registered:
                        set_reference_metadata(session, reference_id=reference_id, metadata={
                            "jobId": entry["prompt_id"],
                            "nodeId": entry["output_node_id"],
                            "filename": entry["filename"],
                            "subfolder": entry["subfolder"],
                        })
                    session.commit()
        except Exception:
            pass
        return len(registered)

    def restore_on_launch(self, server, limit=None, force=False):
        """Populate PromptQueue.history with the newest generated images.

        Serialized because the Restore Now endpoint can be triggered from
        several browser tabs while the startup restore is still running.
        """
        with self._restore_lock:
            return self._restore_on_launch(server, limit=limit, force=force)

    def _restore_on_launch(self, server, limit=None, force=False):
        if self._restored_on_launch and not force:
            return 0

        started_at = time.time()
        if limit is None:
            limit = get_assets_restore_count()
        else:
            try:
                limit = max(1, min(1000, int(limit)))
            except (TypeError, ValueError):
                limit = get_assets_restore_count()

        enabled = is_assets_restore_enabled()
        if not enabled:
            self._restored_on_launch = True
            return 0

        recursive = is_recursive_assets_scan_enabled()
        show_generation_time = is_restored_generation_time_enabled()
        base_output_dir = folder_paths.get_output_directory()
        output_exists = os.path.exists(base_output_dir)
        scan_stats = {}
        images = self.scan_output_images(
            base_output_dir, limit=limit, recursive=recursive, stats=scan_stats
        ) if output_exists else []

        prompt_queue = getattr(server, "prompt_queue", None)
        prepared = []
        metadata_found = 0
        generation_time_matches = 0

        # Scan, metadata parsing and history-entry construction happen outside
        # the queue mutex so the executor thread is never blocked on disk I/O.
        for idx, item in enumerate(images, 1):
            filepath = item["filepath"]
            filename = item["filename"]
            subfolder = item["subfolder"]

            rel_key = f"{subfolder}/{filename}" if subfolder else filename
            prompt_id = str(uuid.uuid5(uuid.NAMESPACE_URL, f"saturnnodes:{rel_key}"))

            prompt_dict, workflow_dict, positive_prompt = self.extract_image_metadata(filepath)
            if prompt_dict or workflow_dict or positive_prompt:
                metadata_found += 1

            output_node_id = None
            if isinstance(prompt_dict, dict) and prompt_dict:
                for nid, nval in prompt_dict.items():
                    if isinstance(nval, dict) and "SaveImage" in str(nval.get("class_type", "")):
                        output_node_id = str(nid)
                        break
                if not output_node_id:
                    output_node_id = str(next(iter(prompt_dict.keys())))
            if not output_node_id:
                output_node_id = "0"

            extra_pnginfo = {}
            if isinstance(workflow_dict, dict) and workflow_dict:
                extra_pnginfo["workflow"] = workflow_dict
            if positive_prompt:
                extra_pnginfo["positive_prompt"] = positive_prompt

            try:
                mtime_ms = max(0, int(float(item.get("mtime", 0)) * 1000))
            except (TypeError, ValueError, OverflowError):
                mtime_ms = 0

            duration = get_generation_time(filename, subfolder, item.get("mtime")) if show_generation_time else None
            if duration is not None:
                try:
                    duration = float(duration)
                except (TypeError, ValueError, OverflowError):
                    duration = None
                if duration is not None and (not math.isfinite(duration) or duration < 0):
                    duration = None

            if duration is not None:
                generation_time_matches += 1
                execution_start_ms = max(0, mtime_ms - int(duration * 1000))
                extra_pnginfo["saturnnodes_generation_time"] = round(duration, 3)
            else:
                execution_start_ms = mtime_ms

            # Only emit an execution_success timestamp when a real duration is
            # known. Two timestamps would make the stock UI report "0.00s" for
            # older images; start-only preserves their mtime for sorting while
            # leaving the duration blank.
            status_messages = [["execution_start", {"timestamp": execution_start_ms}]]
            if duration is not None:
                status_messages.append(["execution_success", {"timestamp": mtime_ms}])

            history_entry = {
                "prompt": [
                    idx,
                    prompt_id,
                    prompt_dict,
                    {
                        "create_time": mtime_ms,
                        "extra_pnginfo": extra_pnginfo,
                        "client_id": "saturnnodes_restored"
                    },
                    [output_node_id]
                ],
                "outputs": {
                    output_node_id: {
                        "images": [
                            {
                                "filename": filename,
                                "subfolder": subfolder,
                                "type": "output"
                            }
                        ]
                    }
                },
                "status": {
                    "status_str": "success",
                    "completed": True,
                    "messages": status_messages
                }
            }
            if duration is not None:
                history_entry["status"]["saturnnodes_duration"] = round(duration, 3)

            prepared.append({
                "prompt_id": prompt_id,
                "history_entry": history_entry,
                "filepath": filepath,
                "filename": filename,
                "subfolder": subfolder,
                "output_node_id": output_node_id,
            })

        restored_count = 0
        if prompt_queue is not None:
            mutex = getattr(prompt_queue, "mutex", None)
            if mutex is None:
                mutex = threading.RLock()
            with mutex:
                history = getattr(prompt_queue, "history", None)
                if not isinstance(history, dict):
                    history = {}
                    try:
                        prompt_queue.history = history
                    except Exception:
                        pass
                for entry in prepared:
                    history[entry["prompt_id"]] = entry["history_entry"]
                    restored_count += 1

        # Asset DB ingestion is best-effort: a broken/absent app.assets must
        # never prevent the restored history from being usable.
        try:
            registered_count = self._ingest_assets(prepared)
        except Exception as e:
            print(f"[SaturnNodes] Asset DB ingestion failed after restore: {e}")
            registered_count = 0
        self._restored_on_launch = True
        self.restored_count = restored_count

        self.last_debug_report = {
            "timestamp": datetime.datetime.now().isoformat(),
            "status": "success",
            "enabled": enabled,
            "configured_limit": limit,
            "recursive": recursive,
            "show_generation_time": show_generation_time,
            "output_exists": output_exists,
            "total_scanned_images": scan_stats.get("scanned", 0),
            "restored_count": restored_count,
            "metadata_found": metadata_found,
            "generation_time_matches": generation_time_matches,
            "generation_time_records": get_generation_time_debug().get("recorded_files", 0),
            "asset_db_registered": registered_count,
            "elapsed_ms": int((time.time() - started_at) * 1000),
        }

        if restored_count > 0:
            if server:
                try:
                    server.queue_updated()
                except Exception:
                    pass

        return restored_count

assets_restore_manager = AssetsRestoreManager()

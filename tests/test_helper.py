import os
import sys
import types
from unittest.mock import MagicMock

SATURNNODES_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# Ensure SaturnNodes root is prioritized at the very start of sys.path
while SATURNNODES_ROOT in sys.path:
    sys.path.remove(SATURNNODES_ROOT)
sys.path.insert(0, SATURNNODES_ROOT)

# If 'nodes' in sys.modules is ComfyUI's root nodes.py file, replace it with SaturnNodes' nodes package
if "nodes" in sys.modules:
    nodes_mod = sys.modules["nodes"]
    if not hasattr(nodes_mod, "__path__") or not getattr(nodes_mod, "__file__", "").startswith(SATURNNODES_ROOT):
        del sys.modules["nodes"]

# Provide lightweight mock stubs for ComfyUI environment if running in standalone CI / test runner
if "aiohttp" not in sys.modules:
    try:
        import aiohttp
    except ImportError:
        aiohttp_mock = types.ModuleType("aiohttp")
        web_mock = types.ModuleType("aiohttp.web")
        web_mock.json_response = MagicMock(return_value={})
        web_mock.Response = MagicMock()
        aiohttp_mock.web = web_mock
        sys.modules["aiohttp"] = aiohttp_mock
        sys.modules["aiohttp.web"] = web_mock

if "piexif" not in sys.modules:
    try:
        import piexif
    except ImportError:
        piexif_mock = types.ModuleType("piexif")
        piexif_mock.load = MagicMock(return_value={})
        piexif_mock.dump = MagicMock(return_value=b"")
        piexif_mock.insert = MagicMock()
        sys.modules["piexif"] = piexif_mock

if "pystray" not in sys.modules:
    try:
        import pystray
    except ImportError:
        pystray_mock = types.ModuleType("pystray")
        sys.modules["pystray"] = pystray_mock

if "comfy" not in sys.modules:
    comfy_mock = types.ModuleType("comfy")
    mm_mock = types.ModuleType("comfy.model_management")
    mm_mock.throw_exception_if_processing_interrupted = MagicMock()
    comfy_mock.model_management = mm_mock
    
    sd_mock = types.ModuleType("comfy.sd")
    sd_mock.load_lora_for_models = MagicMock(side_effect=lambda m, c, l, sm, sc: (m, c))
    comfy_mock.sd = sd_mock

    utils_mock = types.ModuleType("comfy.utils")
    utils_mock.load_torch_file = MagicMock(return_value={})
    comfy_mock.utils = utils_mock

    sys.modules["comfy"] = comfy_mock
    sys.modules["comfy.model_management"] = mm_mock
    sys.modules["comfy.sd"] = sd_mock
    sys.modules["comfy.utils"] = utils_mock

if "folder_paths" not in sys.modules:
    fp_mock = types.ModuleType("folder_paths")
    fp_mock.get_input_directory = MagicMock(return_value=os.path.join(SATURNNODES_ROOT, "input"))
    fp_mock.get_output_directory = MagicMock(return_value=os.path.join(SATURNNODES_ROOT, "output"))
    fp_mock.get_temp_directory = MagicMock(return_value=os.path.join(SATURNNODES_ROOT, "temp"))
    fp_mock.get_filename_list = MagicMock(return_value=[])
    fp_mock.get_full_path = MagicMock(return_value="")
    fp_mock.base_path = SATURNNODES_ROOT
    sys.modules["folder_paths"] = fp_mock

if "server" not in sys.modules:
    server_mock = types.ModuleType("server")
    ps_mock = MagicMock()
    ps_mock.instance.routes = MagicMock()
    server_mock.PromptServer = ps_mock
    sys.modules["server"] = server_mock

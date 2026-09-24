import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import test_helper

from nodes.utils import (
    parse_pretty_name,
    parse_pretty_name_with_version,
    sanitize_folder_path,
    format_lora_output_name,
    is_local_request,
    is_safe_path,
    sanitize_image_loader_folder,
    get_csrf_token,
    is_same_origin_or_direct,
    is_authenticated_local_request
)

class TestUtils(unittest.TestCase):
    def test_is_local_request(self):
        class DummyReq:
            def __init__(self, ip):
                self.remote = ip
        self.assertTrue(is_local_request(DummyReq("127.0.0.1")))
        self.assertTrue(is_local_request(DummyReq("::1")))
        self.assertTrue(is_local_request(DummyReq("localhost")))
        self.assertFalse(is_local_request(DummyReq("192.168.1.50")))
        self.assertFalse(is_local_request(DummyReq("10.0.0.1")))
        self.assertFalse(is_local_request(DummyReq("8.8.8.8")))

    def test_csrf_token_generation(self):
        token = get_csrf_token()
        self.assertIsInstance(token, str)
        self.assertEqual(len(token), 64)
        # Session token is consistent across calls in same session
        self.assertEqual(get_csrf_token(), token)

    def test_is_same_origin_or_direct(self):
        class DummyReq:
            def __init__(self, headers=None):
                self.headers = headers or {}

        # 1. Direct or same-origin
        self.assertTrue(is_same_origin_or_direct(DummyReq()))
        self.assertTrue(is_same_origin_or_direct(DummyReq({"Origin": "http://127.0.0.1:8188"})))
        self.assertTrue(is_same_origin_or_direct(DummyReq({"Origin": "http://localhost:8188"})))

        # 2. Block cross-site via Sec-Fetch-Site
        self.assertFalse(is_same_origin_or_direct(DummyReq({"Sec-Fetch-Site": "cross-site"})))

        # 3. Block malicious cross-origin
        self.assertFalse(is_same_origin_or_direct(DummyReq({"Origin": "http://attacker-site.com"})))
        self.assertFalse(is_same_origin_or_direct(DummyReq({"Referer": "http://malicious.org/exploit.html"})))

    def test_is_authenticated_local_request(self):
        class DummyReq:
            def __init__(self, ip="127.0.0.1", headers=None):
                self.remote = ip
                self.headers = headers or {}

        valid_token = get_csrf_token()

        # Valid local request with matching token
        valid_req = DummyReq("127.0.0.1", {
            "Origin": "http://127.0.0.1:8188",
            "X-LeafFlow-CSRF-Token": valid_token
        })
        self.assertTrue(is_authenticated_local_request(valid_req))

        # Missing token
        no_token_req = DummyReq("127.0.0.1", {"Origin": "http://127.0.0.1:8188"})
        self.assertFalse(is_authenticated_local_request(no_token_req))

        # Wrong token
        wrong_token_req = DummyReq("127.0.0.1", {
            "Origin": "http://127.0.0.1:8188",
            "X-LeafFlow-CSRF-Token": "invalid_forged_token"
        })
        self.assertFalse(is_authenticated_local_request(wrong_token_req))

        # Remote IP attempting to forge or replay token
        remote_req = DummyReq("192.168.1.100", {
            "Origin": "http://127.0.0.1:8188",
            "X-LeafFlow-CSRF-Token": valid_token
        })
        self.assertFalse(is_authenticated_local_request(remote_req))

        # Cross-site drive-by request (Sec-Fetch-Site: cross-site)
        drive_by_req = DummyReq("127.0.0.1", {
            "Sec-Fetch-Site": "cross-site",
            "X-LeafFlow-CSRF-Token": valid_token
        })
        self.assertFalse(is_authenticated_local_request(drive_by_req))

    def test_is_safe_path(self):
        import tempfile
        base1 = tempfile.mkdtemp()
        sub = os.path.join(base1, "images", "test.png")
        escape = os.path.join(base1, "..", "passwords.txt")
        self.assertTrue(is_safe_path(sub, allowed_bases=[base1]))
        self.assertFalse(is_safe_path(escape, allowed_bases=[base1]))
        import shutil
        shutil.rmtree(base1, ignore_errors=True)

    def test_parse_pretty_name(self):
        name = parse_pretty_name("krea2_ana-de-armas_v1.safetensors")
        self.assertEqual(name, "Ana De Armas")

    def test_parse_pretty_name_special_keywords(self):
        name = parse_pretty_name("tag_cyberpunk-nsfw-v2.safetensors")
        self.assertIn("NSFW", name)
        self.assertIn("V2", name)

    def test_parse_pretty_name_with_version(self):
        name_v = parse_pretty_name_with_version("krea2_ana-de-armas_v1.safetensors")
        self.assertEqual(name_v, "Ana De Armas V1")

    def test_format_lora_output_name_modes(self):
        rel_path = os.path.join("celebrities", "ana_de_armas.safetensors")
        
        parsed = format_lora_output_name(rel_path, "Ana De Armas", "Parsed Name")
        self.assertEqual(parsed, "Ana De Armas")

        filename = format_lora_output_name(rel_path, "Ana De Armas", "Filename")
        self.assertEqual(filename, "ana_de_armas.safetensors")

        no_ext = format_lora_output_name(rel_path, "Ana De Armas", "Filename without extension")
        self.assertEqual(no_ext, "ana_de_armas")

        custom_reg = format_lora_output_name(rel_path, "Ana De Armas", "Custom Regex", custom_regex=r"ana_([a-z]+)")
        self.assertEqual(custom_reg, "ana_de")

    def test_sanitize_folder_path_wildcard_stripping(self):
        clean = sanitize_folder_path("watch/*")
        self.assertNotIn("*", clean)

    def test_sanitize_folder_path_blocks_absolute_paths(self):
        import folder_paths
        inp = os.path.abspath(os.path.realpath(folder_paths.get_input_directory()))
        out = os.path.abspath(os.path.realpath(folder_paths.get_output_directory()))
        
        # Test Windows drive letters and root paths
        for bad_path in ["C:\\Windows\\System32", "D:\\SecretData", "/etc/passwd", "\\\\server\\share"]:
            res = sanitize_folder_path(bad_path)
            res_norm = os.path.abspath(os.path.realpath(res))
            # Must be confined strictly within input or output directory
            is_confined = (os.path.commonpath([inp, res_norm]) == inp) or (os.path.commonpath([out, res_norm]) == out)
            self.assertTrue(is_confined, f"Path '{bad_path}' escaped confinement! Got: '{res_norm}'")

    def test_sanitize_folder_path_blocks_directory_traversal(self):
        import folder_paths
        inp = os.path.abspath(os.path.realpath(folder_paths.get_input_directory()))
        out = os.path.abspath(os.path.realpath(folder_paths.get_output_directory()))

        for bad_traversal in ["../../etc", "watch/../../secret", "..\\..\\Windows", "sub/../../../root"]:
            res = sanitize_folder_path(bad_traversal)
            res_norm = os.path.abspath(os.path.realpath(res))
            is_confined = (os.path.commonpath([inp, res_norm]) == inp) or (os.path.commonpath([out, res_norm]) == out)
            self.assertTrue(is_confined, f"Traversal '{bad_traversal}' escaped confinement! Got: '{res_norm}'")

    def test_sanitize_folder_path_allows_safe_subfolders(self):
        import folder_paths
        inp = os.path.abspath(os.path.realpath(folder_paths.get_input_directory()))
        out = os.path.abspath(os.path.realpath(folder_paths.get_output_directory()))

        for safe_sub in ["watch", "my_images", "subfolder/nested"]:
            res = sanitize_folder_path(safe_sub)
            res_norm = os.path.abspath(os.path.realpath(res))
            is_confined = (os.path.commonpath([inp, res_norm]) == inp) or (os.path.commonpath([out, res_norm]) == out)
            self.assertTrue(is_confined, f"Safe subfolder '{safe_sub}' failed confinement! Got: '{res_norm}'")

    def test_is_safe_external_image_url(self):
        from nodes.lora_loader import is_safe_external_image_url
        self.assertTrue(is_safe_external_image_url("https://image.civitai.com/xG1nkqKTMzGDvpLrqFT7WA/test.jpg"))
        self.assertTrue(is_safe_external_image_url("https://image.tmdb.org/t/p/w500/sample.jpg"))
        self.assertFalse(is_safe_external_image_url("file:///etc/passwd"))
        self.assertFalse(is_safe_external_image_url("file:///C:/Windows/system32/cmd.exe"))
        self.assertFalse(is_safe_external_image_url("http://127.0.0.1:8188/secret"))
        self.assertFalse(is_safe_external_image_url("http://localhost:8080/admin"))
        self.assertFalse(is_safe_external_image_url("http://169.254.169.254/latest/meta-data/"))
        self.assertFalse(is_safe_external_image_url("ftp://server/image.png"))
        self.assertFalse(is_safe_external_image_url(""))
        self.assertFalse(is_safe_external_image_url(None))

    def test_edge_cases_empty_or_none(self):
        self.assertEqual(parse_pretty_name(""), "")
        self.assertEqual(parse_pretty_name(None), "")
        self.assertEqual(parse_pretty_name("[ NONE ]"), "")
        self.assertEqual(parse_pretty_name("[ RANDOM ]"), "")

    def test_sanitize_image_loader_folder_confinement(self):
        from nodes.utils import sanitize_image_loader_folder
        import folder_paths
        inp = os.path.abspath(os.path.realpath(folder_paths.get_input_directory()))
        out = os.path.abspath(os.path.realpath(folder_paths.get_output_directory()))

        for bad in ["C:\\Windows", "/etc", "../../escape", "output/../../secret", "\\\\server\\share"]:
            res = sanitize_image_loader_folder(bad)
            res_norm = os.path.abspath(os.path.realpath(res))
            is_confined = (os.path.commonpath([inp, res_norm]) == inp) or (os.path.commonpath([out, res_norm]) == out)
            self.assertTrue(is_confined, f"Image folder '{bad}' escaped confinement: '{res_norm}'")

if __name__ == "__main__":
    unittest.main()

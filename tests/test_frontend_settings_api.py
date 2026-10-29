import os
import re
import unittest


WEB_ROOT = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "web"
)

# ComfyUI's settings API warns every time getSettingValue() receives a default
# value as its second argument. Settings definitions already carry defaults, so
# the argument is redundant and floods the browser console when called per item.
DEPRECATED_SECOND_ARGUMENT = re.compile(
    r"""getSettingValue\s*\??\.?\s*\(\s*(?:"[^"]*"|'[^']*'|`[^`]*`)\s*,"""
)


class TestFrontendSettingsApi(unittest.TestCase):
    def test_no_deprecated_default_value_argument(self):
        offenders = []
        for root, _dirs, files in os.walk(WEB_ROOT):
            for name in sorted(files):
                if not name.endswith(".js"):
                    continue
                path = os.path.join(root, name)
                with open(path, encoding="utf-8") as handle:
                    source = handle.read()
                for match in DEPRECATED_SECOND_ARGUMENT.finditer(source):
                    line_number = source.count("\n", 0, match.start()) + 1
                    relative = os.path.relpath(path, WEB_ROOT)
                    offenders.append(f"{relative}:{line_number}")

        self.assertEqual(
            offenders,
            [],
            msg=(
                "getSettingValue(id, defaultValue) is deprecated in ComfyUI and "
                "logs a console warning on every call. Read the setting default "
                "from its definition instead: "
                + ", ".join(offenders)
            ),
        )


if __name__ == "__main__":
    unittest.main()

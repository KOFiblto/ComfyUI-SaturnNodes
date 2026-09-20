import os
import sys
import threading
import webbrowser
from PIL import Image, ImageDraw
from .utils import get_leafflow_user_dir

USER_DIR = get_leafflow_user_dir()
ENV_FILE = os.path.join(USER_DIR, ".env")

def get_env_setting(key, default_val):
    if os.path.exists(ENV_FILE):
        try:
            with open(ENV_FILE, "r", encoding="utf-8") as f:
                for line in f:
                    if line.strip().startswith(f"{key}="):
                        return line.strip().split("=", 1)[1].strip()
        except Exception:
            pass
    return default_val

def is_tray_icon_enabled():
    val = get_env_setting("ENABLE_TRAY_ICON", "false").lower()
    if val not in ["true", "1", "yes"]:
        return False
    try:
        import pystray
        return True
    except ImportError:
        return False

class TrayIconManager:
    def __init__(self, pause_manager=None):
        self.pause_manager = pause_manager
        self._icon = None
        self._thread = None
        self._lock = threading.RLock()
        self._is_running = False

    def create_icon_image(self, color_hex="#059669", symbol="pause"):
        size = 64
        img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        draw = ImageDraw.Draw(img)

        # Draw rounded rectangle matching toolbar button styling
        draw.rounded_rectangle(
            [2, 2, size - 3, size - 3],
            radius=16,
            fill=color_hex,
            outline=(0, 0, 0, 60),
            width=1
        )

        if symbol == "play":
            # Play triangle icon (white)
            draw.polygon([(24, 18), (24, 46), (46, 32)], fill="white")
        else:
            # Pause two-bar icon (white)
            draw.rectangle([20, 18, 28, 46], fill="white")
            draw.rectangle([36, 18, 44, 46], fill="white")

        return img

    def get_current_colors(self):
        unpaused_color = get_env_setting("PAUSE_BUTTON_UNPAUSED_COLOR", "#059669")
        paused_color = get_env_setting("PAUSE_BUTTON_PAUSED_COLOR", "#ea580c")
        return unpaused_color, paused_color

    def get_status_info(self):
        if not self.pause_manager:
            return "Running", "#059669", "pause", "ComfyUI LeafFlow: Running"

        unpaused_color, paused_color = self.get_current_colors()
        is_paused = self.pause_manager.paused
        is_waiting = self.pause_manager.is_waiting
        mode = self.pause_manager.mode
        mode_label = "Instant" if mode == "instantly" else "Finish"

        if is_paused:
            if is_waiting:
                status_text = "Paused (Waiting)"
                color = paused_color
                symbol = "play"
                title = f"ComfyUI LeafFlow: Paused ({mode_label}) - Click to Continue"
            else:
                status_text = f"Pausing ({mode_label})..."
                color = paused_color
                symbol = "pause"
                title = f"ComfyUI LeafFlow: Pausing ({mode_label})... (Waiting to complete)"
        else:
            status_text = f"Running [Next Pause: {mode_label}]"
            color = unpaused_color
            symbol = "pause"
            title = f"ComfyUI LeafFlow: Running (Mode: {mode_label})"

        return status_text, color, symbol, title

    def build_menu(self):
        try:
            import pystray
        except ImportError:
            return None

        status_text, _, _, _ = self.get_status_info()
        is_paused = bool(self.pause_manager and self.pause_manager.paused)
        is_waiting = bool(self.pause_manager and self.pause_manager.is_waiting)
        current_mode = self.pause_manager.mode if self.pause_manager else "after_finish"

        def on_toggle_click(icon, item):
            if not self.pause_manager:
                return
            if self.pause_manager.paused:
                self.pause_manager.set_pause(False)
            else:
                self.pause_manager.set_pause(True)

        def on_pause_finish_click(icon, item):
            if self.pause_manager:
                self.pause_manager.set_pause(True, mode="after_finish")

        def on_pause_instant_click(icon, item):
            if self.pause_manager:
                self.pause_manager.set_pause(True, mode="instantly")

        def on_continue_click(icon, item):
            if self.pause_manager:
                self.pause_manager.set_pause(False)

        def on_set_mode_finish(icon, item):
            if self.pause_manager:
                self.pause_manager.set_mode("after_finish")

        def on_set_mode_instant(icon, item):
            if self.pause_manager:
                self.pause_manager.set_mode("instantly")

        def on_open_browser(icon, item):
            try:
                server_url = "http://127.0.0.1:8188"
                from server import PromptServer
                if hasattr(PromptServer, "instance") and hasattr(PromptServer.instance, "address"):
                    addr = PromptServer.instance.address
                    if addr and len(addr) >= 2:
                        host = addr[0] or "127.0.0.1"
                        port = addr[1]
                        server_url = f"http://{host}:{port}"
                webbrowser.open(server_url)
            except Exception as e:
                print(f"[LeafFlow] Error opening browser: {e}")

        def on_disable_tray(icon, item):
            self.disable_and_stop()

        if is_paused:
            mode_desc = "Instant" if current_mode == "instantly" else "After Current"
            status_display = f"Paused ({mode_desc})"
            if is_waiting:
                status_display = f"Pausing ({mode_desc})..."

            menu_items = [
                pystray.MenuItem(f"● Status: {status_display}", None, enabled=False),
                pystray.MenuItem("▶ Resume Queue", on_continue_click, default=True),
            ]
        else:
            menu_items = [
                pystray.MenuItem("● Status: Running", None, enabled=False),
                pystray.MenuItem("⏸ Pause (Instant)", on_pause_instant_click, default=False),
                pystray.MenuItem("⏳ Pause (After Current)", on_pause_finish_click, default=False),
            ]

        return pystray.Menu(*menu_items)

    def start(self):
        with self._lock:
            if self._is_running or self._icon is not None:
                return

            try:
                import pystray
            except ImportError:
                print("[LeafFlow] System tray icon disabled: 'pystray' is not installed. Install pystray ('pip install pystray') to enable system tray support.")
                return

            _, color, symbol, title = self.get_status_info()
            icon_img = self.create_icon_image(color, symbol)
            menu = self.build_menu()

            self._icon = pystray.Icon(
                name="ComfyUI-LeafFlow",
                icon=icon_img,
                title=title,
                menu=menu
            )

            def _run():
                try:
                    self._is_running = True
                    print("[LeafFlow] System tray icon started.")
                    self._icon.run()
                except Exception as e:
                    print(f"[LeafFlow] System tray icon error: {e}")
                finally:
                    self._is_running = False
                    self._icon = None

            self._thread = threading.Thread(target=_run, daemon=True)
            self._thread.start()

    def stop(self):
        with self._lock:
            if self._icon is not None:
                try:
                    self._icon.stop()
                except Exception:
                    pass
                self._icon = None
            self._is_running = False
            print("[LeafFlow] System tray icon stopped.")

    def update_status(self):
        with self._lock:
            if not self._is_running or self._icon is None:
                return

            try:
                _, color, symbol, title = self.get_status_info()
                self._icon.icon = self.create_icon_image(color, symbol)
                self._icon.title = title
                self._icon.menu = self.build_menu()
            except Exception as e:
                print(f"[LeafFlow] Error updating system tray status: {e}")

    def set_enabled(self, enabled):
        if enabled:
            if not self._is_running:
                self.start()
            else:
                self.update_status()
        else:
            if self._is_running:
                self.stop()

    def disable_and_stop(self):
        # Update .env setting and stop tray
        lines = []
        if os.path.exists(ENV_FILE):
            try:
                with open(ENV_FILE, "r", encoding="utf-8") as f:
                    lines = f.readlines()
            except Exception:
                lines = []

        new_lines = []
        has_tray = False
        for line in lines:
            if line.strip().startswith("ENABLE_TRAY_ICON="):
                new_lines.append("ENABLE_TRAY_ICON=false\n")
                has_tray = True
            else:
                new_lines.append(line)

        if not has_tray:
            new_lines.append("ENABLE_TRAY_ICON=false\n")

        try:
            with open(ENV_FILE, "w", encoding="utf-8") as f:
                f.writelines(new_lines)
        except Exception:
            pass

        self.stop()

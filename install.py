import os
import sys
import subprocess

def install():
    req_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "requirements.txt")
    if os.path.isfile(req_path):
        print(f"[SaturnNodes] Installing dependencies from {req_path}...")
        try:
            subprocess.check_call([sys.executable, "-m", "pip", "install", "-r", req_path])
            print("[SaturnNodes] Dependencies installed successfully.")
        except Exception as e:
            print(f"[SaturnNodes] Warning: Could not auto-install dependencies: {e}")

if __name__ == "__main__":
    install()

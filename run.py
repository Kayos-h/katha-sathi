"""Khata Sathi launcher - double-click this (or run: python run.py).

Starts the server, opens Khata Sathi in your browser, and keeps a
console window open with the phone address printed. Closing the
window stops Khata Sathi.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import app  # noqa: E402


if __name__ == "__main__":
    try:
       app.run(
    host="0.0.0.0",
    port=int(os.environ.get("PORT", "8787")),
    open_browser=False
)
    except KeyboardInterrupt:
        pass
    print()
    print("Khata Sathi stopped. Close this window.")
    try:
        input()
    except EOFError:
        pass

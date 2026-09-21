"""Khata Sathi - Local Development Runner (LEGACY / DEV ONLY).

NOTE: In production, Khata Sathi runs 100% serverlessly on Vercel.
This file is only used for local offline testing and is NOT required in production.
Your laptop or server does NOT need to run this command when deployed to Vercel.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import app  # noqa: E402


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "8787"))
    print("=" * 60)
    print("KHATA SATHI - LOCAL DEVELOPMENT SERVER")
    print("=" * 60)
    print(f"Running locally at http://localhost:{port}")
    print("NOTE: Production is hosted on Vercel and does not use this runner.\n")
    try:
        app.run(
            host="0.0.0.0",
            port=port,
            open_browser=False
        )
    except KeyboardInterrupt:
        pass
    print("\nKhata Sathi local dev server stopped.")

"""Vercel Serverless Function Entrypoint for Khata Sathi."""
import os
import sys

# Ensure module path is accessible
current_dir = os.path.dirname(os.path.abspath(__file__))
parent_dir = os.path.dirname(current_dir)
if parent_dir not in sys.path:
    sys.path.insert(0, parent_dir)
if current_dir not in sys.path:
    sys.path.insert(0, current_dir)

import app
import db

# Auto-initialize database tables on first cold start if DATABASE_URL is present
try:
    if os.environ.get("DATABASE_URL") or os.environ.get("POSTGRES_URL"):
        db.init()
except Exception as e:
    # Log database init attempt
    print("Database init status:", e)

# Handler for Vercel's BaseHTTPRequestHandler interface
handler = app.Handler

# WSGI application for WSGI-compatible serverless runners
wsgi_application = app.wsgi_app
app_instance = app.wsgi_app

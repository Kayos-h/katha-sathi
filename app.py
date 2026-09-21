"""Khata Sathi - Serverless HTTP Handler & API Layer.

Cloud-native: Supabase Auth & Google OAuth integration, strict multi-tenancy (user_id),
PostgreSQL database backend, and serverless-friendly sync polling.
Runs on Vercel Python Serverless or standalone.
"""
import base64
import hashlib
import hmac
import io
import json
import os
import re
import secrets
import sys
import time
import urllib.parse
import urllib.request
import urllib.error
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import db
import demo
import exporters
import photos

APP_DIR = os.path.dirname(os.path.abspath(__file__))
WEB_DIR = os.path.join(APP_DIR, "web")

SESSION_SECRET = os.environ.get("SESSION_SECRET", "khatasathi-cloud-secret-key-2083").strip().lstrip("\ufeff")
SESSION_TTL = 60 * 60 * 24 * 7  # 7 days

SUPABASE_URL = os.environ.get("SUPABASE_URL", "").strip().lstrip("\ufeff").rstrip("/")
SUPABASE_ANON_KEY = (os.environ.get("SUPABASE_ANON_KEY", "").strip().lstrip("\ufeff") or os.environ.get("SUPABASE_KEY", "").strip().lstrip("\ufeff"))
SUPABASE_JWT_SECRET = os.environ.get("SUPABASE_JWT_SECRET", "").strip().lstrip("\ufeff")

MONEY_NOTE = "Amounts are stored as plain numbers; the UI converts Devanagari digits."


# ---------------- authentication & session management ----------------

def hash_pin(pin, salt=None):
    salt = salt or secrets.token_hex(8)
    digest = hashlib.pbkdf2_hmac("sha256", pin.encode(), salt.encode(), 60000)
    return salt + "$" + digest.hex()


def verify_pin(pin, stored):
    try:
        salt, want = stored.split("$", 1)
    except ValueError:
        return False
    digest = hashlib.pbkdf2_hmac("sha256", pin.encode(), salt.encode(), 60000)
    return secrets.compare_digest(digest.hex(), want)


def new_session(user_id="default", email="", seller_name=""):
    """Generates a cryptographically signed, stateless session token."""
    payload = {
        "user_id": user_id,
        "email": email,
        "seller_name": seller_name,
        "exp": int(time.time() + SESSION_TTL),
        "nonce": secrets.token_hex(8),
    }
    raw = json.dumps(payload).encode("utf-8")
    b64_data = base64.urlsafe_b64encode(raw).decode("utf-8").rstrip("=")
    sig = hmac.new(SESSION_SECRET.encode("utf-8"), b64_data.encode("utf-8"), hashlib.sha256).hexdigest()
    return f"{b64_data}.{sig}"


def session_cookie(token, is_secure=False):
    secure_flag = "; Secure" if is_secure else ""
    return f"bs_session={token}; Path=/; Max-Age={SESSION_TTL}; HttpOnly; SameSite=Lax{secure_flag}"


def parse_jwt_payload(token):
    """Safely decodes payload from a standard JWT or HMAC token."""
    if not token or "." not in token:
        return None
    parts = token.split(".")
    # Standard JWT (3 parts: header.payload.signature)
    if len(parts) == 3:
        b64_payload = parts[1]
    # Stateless HMAC token (2 parts: payload.signature)
    elif len(parts) == 2:
        b64_payload = parts[0]
        sig = parts[1]
        expected_sig = hmac.new(SESSION_SECRET.encode("utf-8"), b64_payload.encode("utf-8"), hashlib.sha256).hexdigest()
        if not secrets.compare_digest(sig, expected_sig):
            return None
    else:
        return None

    try:
        padded = b64_payload + "=" * ((4 - len(b64_payload) % 4) % 4)
        raw = base64.urlsafe_b64decode(padded.encode("utf-8"))
        payload = json.loads(raw.decode("utf-8"))
        # Check expiration
        if payload.get("exp") and payload["exp"] < time.time():
            return None
        return payload
    except Exception:
        return None


def verify_token_user(token):
    """Extracts user information (user_id, email, seller_name) from token."""
    payload = parse_jwt_payload(token)
    if not payload:
        return None

    # Supabase JWT tokens contain 'sub' as user UUID
    user_id = payload.get("sub") or payload.get("user_id") or payload.get("id") or "default"
    email = payload.get("email") or ""
    user_meta = payload.get("user_metadata") or {}
    seller_name = payload.get("seller_name") or user_meta.get("full_name") or user_meta.get("name") or (email.split("@")[0] if email else "")

    return {
        "user_id": str(user_id),
        "email": str(email),
        "seller_name": str(seller_name),
    }


# ---------------- helpers ----------------

def jdump(obj):
    return json.dumps(obj, ensure_ascii=False).encode("utf-8")


def _quote_fn(name):
    return urllib.parse.quote(name)


def _qr_png_b64(url):
    try:
        import qrcode
        buf = io.BytesIO()
        qrcode.make(url, box_size=8, border=2).save(buf, "PNG")
        return base64.b64encode(buf.getvalue()).decode()
    except Exception:
        return None


def read_json(handler):
    n = int(handler.headers.get("Content-Length") or 0)
    if n <= 0 or n > 64 * 1024 * 1024:
        raise ValueError("Bad request size")
    raw = handler.rfile.read(n)
    return json.loads(raw.decode("utf-8"))


def parse_amount(val):
    DEV = {
        "०": "0", "१": "1", "२": "2", "३": "3", "४": "4",
        "५": "5", "६": "6", "७": "7", "८": "8", "९": "9",
    }
    s = "" if val is None else str(val).strip()
    for k, v in DEV.items():
        s = s.replace(k, v)
    s = s.replace("रू", "").replace("Rs", "").replace("rs", "").replace("NPR", "").replace(" ", "")
    s = s.replace(",", "")
    if not s:
        raise ValueError("Enter an amount")
    f = float(s)
    if f != f or f in (float("inf"), float("-inf")):
        raise ValueError("That amount isn't a number")
    return f


EXT_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".json": "application/json; charset=utf-8",
    ".webmanifest": "application/manifest+json",
    ".ico": "image/x-icon",
}


# ---------------- request handler ----------------

class Handler(BaseHTTPRequestHandler):
    server_version = "Khata Sathi Cloud/2.0"
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):
        pass

    def _send(self, code, body, ctype="application/json; charset=utf-8", extra=None):
        if isinstance(body, str):
            body = body.encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(body)

    def _redirect(self, url):
        self.send_response(302)
        self.send_header("Location", url)
        self.send_header("Cache-Control", "public, max-age=3600")
        self.end_headers()

    def _json(self, code, obj):
        body = jdump(obj)
        extra = {}
        if "token" in obj and isinstance(obj.get("token"), str):
            is_sec = self._is_secure()
            extra["Set-Cookie"] = session_cookie(obj["token"], is_sec)
        self._send(code, body, extra=extra)

    def _err(self, code, msg):
        self._json(code, {"error": msg})

    def _header(self, key):
        if not hasattr(self, "headers") or not self.headers:
            return ""
        key_lower = key.lower()
        if hasattr(self.headers, "items"):
            for k, v in self.headers.items():
                if str(k).lower() == key_lower:
                    return str(v)
        try:
            return str(self.headers.get(key) or "")
        except Exception:
            return ""

    def _is_secure(self):
        proto = self._header("X-Forwarded-Proto").lower()
        return proto == "https"

    def _token(self):
        auth = self._header("Authorization")
        if auth.startswith("Bearer "):
            return auth[7:].strip()
        cookie = self._header("Cookie")
        for part in cookie.split(";"):
            if part.strip().startswith("bs_session="):
                return part.strip().split("=", 1)[1]
        return ""

    def _get_auth_user(self):
        token = self._token()
        if not token:
            return None
        return verify_token_user(token)

    def _get_user_id(self):
        u = self._get_auth_user()
        if u and u.get("user_id"):
            return u["user_id"]
        return "default"

    def _authed(self):
        return self._get_auth_user() is not None

    def _app_url(self):
        host = self._header("X-Forwarded-Host") or self._header("Host") or "localhost"
        proto = "https" if self._is_secure() or "vercel.app" in host else "http"
        return f"{proto}://{host}"

    def _clean_path(self):
        params = self._get_query_params()
        if "__path" in params:
            raw_p = params["__path"].lstrip("/")
            if raw_p.startswith("photo/"):
                return "/" + raw_p
            return "/api/" + raw_p
        p = self.headers.get("x-matched-path") or self.headers.get("x-invoke-path") or self.headers.get("x-forwarded-uri") or self.path
        p = p.split("?")[0]
        if p.endswith("index.py") or p == "/api" or p == "/api/":
            matched = self.headers.get("x-matched-path") or self.headers.get("x-invoke-path")
            if matched and not matched.endswith("index.py"):
                p = matched.split("?")[0]
            else:
                p = self.path.split("?")[0].replace("/api/index.py", "/api").replace("/index.py", "")
                if not p:
                    p = "/"
        return p

    def _get_query_params(self):
        qs = ""
        if "?" in self.path:
            qs = self.path.split("?", 1)[1]
        elif "?" in (self.headers.get("x-matched-path") or ""):
            qs = self.headers.get("x-matched-path").split("?", 1)[1]
        elif "?" in (self.headers.get("x-invoke-path") or ""):
            qs = self.headers.get("x-invoke-path").split("?", 1)[1]
        params = {}
        if qs:
            for kv in qs.split("&"):
                if "=" in kv:
                    k, v = kv.split("=", 1)
                    params[k] = urllib.parse.unquote(v)
        return params

    # ---- GET ----

    def do_GET(self):
        path = self._clean_path()
        if path == "/":
            return self._serve_file("index.html")
        if path.startswith("/photo/"):
            return self._photo(path.split("/")[-1])
        if path == "/api/state":
            return self._api_state()
        if path == "/api/auth/config":
            return self._json(200, {
                "supabase_url": SUPABASE_URL,
                "supabase_anon_key": SUPABASE_ANON_KEY,
            })
        if path == "/api/auth/google-url":
            return self._api_google_url()
        if path == "/api/qr":
            return self._qr()
        if path in ("/api/sync/poll", "/api/events"):
            return self._sync_poll()
        if path.startswith("/api/"):
            return self._api_get(path)
        # static file
        fname = path.lstrip("/")
        if ".." in fname or "\\" in fname or fname.startswith("/"):
            return self._err(404, "Not found")
        return self._serve_file(fname)

    def _serve_file(self, fname):
        path = os.path.realpath(os.path.join(WEB_DIR, fname))
        if not path.startswith(os.path.realpath(WEB_DIR) + os.sep) or not os.path.isfile(path):
            return self._err(404, "Not found")
        ext = os.path.splitext(fname)[1].lower()
        ctype = EXT_TYPES.get(ext, "application/octet-stream")
        with open(path, "rb") as fh:
            body = fh.read()
        cache_header = "no-cache" if fname == "index.html" else "public, max-age=3600, stale-while-revalidate=86400"
        self._send(200, body, ctype, extra=[("Cache-Control", cache_header)])

    def _api_state(self):
        user = self._get_auth_user()
        if not user:
            return self._json(200, {
                "has_account": False,
                "authenticated": False,
                "user_id": None,
                "seller_name": "",
                "store_name": "",
            })
        uid = user["user_id"]
        settings = db.get_settings_dict(user_id=uid)
        seller = settings.get("seller_name") or user.get("seller_name") or ""
        store = settings.get("store_name") or ""
        return self._json(200, {
            "has_account": True,
            "authenticated": True,
            "user_id": uid,
            "email": user.get("email", ""),
            "seller_name": seller,
            "store_name": store or (seller + "'s shop" if seller else "Khata Sathi"),
        })

    def _api_google_url(self):
        app_url = self._app_url()
        if not SUPABASE_URL:
            # Fallback mock google auth for testing
            mock_tok = new_session(user_id="google_user_test", email="user@gmail.com", seller_name="Google User")
            return self._json(200, {"url": f"{app_url}/#access_token={mock_tok}&provider=google"})
        redirect_uri = f"{app_url}/"
        oauth_url = f"{SUPABASE_URL}/auth/v1/authorize?provider=google&redirect_to={urllib.parse.quote(redirect_uri, safe='')}"
        return self._json(200, {"url": oauth_url})

    def _photo(self, fname):
        # Photo feature is temporarily under construction
        return self._err(501, "Photo feature is temporarily under construction")

    def _qr(self):
        if not self._authed():
            return self._err(401, "Not signed in")
        url = self._app_url()
        qr_b64 = _qr_png_b64(url)
        return self._json(200, {"url": url, "qr_png_b64": qr_b64})

    def _sync_poll(self):
        if not self._authed():
            return self._err(401, "Not signed in")
        uid = self._get_user_id()
        params = self._get_query_params()
        try:
            since_id = int(params.get("since", 0))
        except ValueError:
            since_id = 0
        try:
            res = db.get_sync_events(since_id, user_id=uid)
            return self._json(200, res)
        except Exception:
            return self._json(200, {"events": [], "latest_id": since_id})

    def _api_get(self, path):
        if not self._authed():
            return self._err(401, "Not signed in")
        uid = self._get_user_id()
        params = self._get_query_params()
        try:
            if path == "/api/people":
                return self._json(200, {"people": db.list_people(user_id=uid)})
            if path == "/api/dashboard":
                return self._json(200, db.dashboard(user_id=uid))
            if path == "/api/day":
                d = params.get("date")
                return self._json(200, db.day_summary(d, user_id=uid))
            if path == "/api/person":
                pid = params.get("id")
                if not pid:
                    return self._err(400, "Missing id")
                return self._json(200, db.get_person(pid, user_id=uid))
            if path == "/api/ledger":
                pid = params.get("id")
                if not pid:
                    return self._err(400, "Missing id")
                return self._json(200, db.get_ledger(pid, user_id=uid))
            if path == "/api/openbills":
                pid = params.get("id")
                if not pid:
                    return self._err(400, "Missing id")
                return self._json(200, {"bills": db.open_bills(pid, user_id=uid), "total": db.get_person(pid, user_id=uid)["balance"]})
            if path == "/api/activity":
                limit = int(params.get("limit") or 30)
                pid = params.get("person")
                return self._json(200, {"items": db.get_activity(limit, pid, user_id=uid)})
            if path == "/api/search":
                q = params.get("q", "")
                return self._json(200, {"results": db.search_people(q, user_id=uid)})
            if path == "/api/audit":
                q = params.get("q", "")
                return self._json(200, {"items": db.audit_recent(200, q, user_id=uid)})
            if path == "/api/ai/status":
                return self._json(200, {"mode": "manual", "provider": None,
                                        "note": "AI bill reading arrives in v1.5."})
            if path == "/api/stats":
                return self._json(200, db.stats_counts(user_id=uid))
            if path == "/api/backup.json":
                snap = db.snapshot(user_id=uid)
                return self._send(
                    200, jdump(snap), "application/json; charset=utf-8",
                    {"Content-Disposition": 'attachment; filename="khatasathi-backup.json"'},
                )
            if path == "/api/export.csv":
                return self._api_export_csv(uid)
            if path == "/api/khata/pdf":
                return self._api_khata_file(params, "pdf", uid)
            if path == "/api/khata/xlsx":
                return self._api_khata_file(params, "xlsx", uid)
            if path == "/api/bill/pdf":
                return self._api_bill_pdf(params, uid)
            if path == "/api/galla":
                return self._json(200, db.galla_summary(params.get("date"), user_id=uid))
            if path in ("/api/galla/recent", "/api/galla/history"):
                days = int(params.get("days") or 30)
                return self._json(200, {"days": db.galla_recent(days, user_id=uid)})
            if path == "/api/galla/pdf":
                return self._api_galla_pdf(params, uid)
            if path == "/api/bill":
                bid = params.get("id")
                if not bid:
                    return self._err(400, "Missing id")
                b = db.get_bill_full(bid, user_id=uid)
                b["allocations"] = db.payment_alloc_for_bill(bid, user_id=uid)
                return self._json(200, b)
            if path == "/api/payment":
                pmt_id = params.get("id")
                if not pmt_id:
                    return self._err(400, "Missing id")
                return self._json(200, db.payment_detail(pmt_id, user_id=uid))
            return self._err(404, "Unknown API route")
        except ValueError as e:
            return self._err(404 if "not found" in str(e).lower() else 400, str(e))
        except Exception as e:
            return self._err(500, "Server error: " + str(e))

    def _api_khata_file(self, params, kind, uid):
        pid = params.get("id")
        if not pid:
            return self._err(400, "Missing id")
        data = db.khata_export(pid, user_id=uid)
        store = db.get_setting("store_name", "", user_id=uid) or ""
        if kind == "pdf":
            body, fname = exporters.khata_pdf(data, store)
            ctype = "application/pdf"
        else:
            body, fname = exporters.khata_xlsx(data, store)
            ctype = ("application/vnd.openxmlformats-officedocument."
                     "spreadsheetml.sheet")
        return self._send(200, body, ctype, {
            "Content-Disposition":
                "attachment; filename*=UTF-8''" + _quote_fn(fname),
        })

    def _api_bill_pdf(self, params, uid):
        bid = params.get("id")
        if not bid:
            return self._err(400, "Missing id")
        bill = db.get_bill_full(bid, user_id=uid)
        person = db.get_person(bill["person_id"], user_id=uid)
        store = db.get_setting("store_name", "", user_id=uid) or ""
        body, fname = exporters.bill_pdf(bill, person, store)
        return self._send(200, body, "application/pdf", {
            "Content-Disposition":
                "attachment; filename*=UTF-8''" + _quote_fn(fname),
        })

    def _api_galla_pdf(self, params, uid):
        data = db.galla_summary(params.get("date"), user_id=uid)
        store = db.get_setting("store_name", "", user_id=uid) or ""
        body, fname = exporters.galla_pdf(data, store)
        return self._send(200, body, "application/pdf", {
            "Content-Disposition":
                "attachment; filename*=UTF-8''" + _quote_fn(fname),
        })

    def _api_export_csv(self, uid):
        lines = ["person,kind,amount,remaining,status,note,date"]
        for p in db.list_people(user_id=uid):
            led = db.get_ledger(p["id"], user_id=uid)
            for r in led["rows"]:
                lines.append(",".join([
                    '"' + led["person"]["name"].replace('"', '""') + '"',
                    r["kind"], "%.2f" % r["amount"],
                    "%.2f" % r.get("remaining", 0),
                    r.get("status", ""),
                    '"' + (r.get("note") or "").replace('"', '""') + '"',
                    r["at"],
                ]))
        body = "\n".join(lines).encode("utf-8")
        return self._send(200, body, "text/csv; charset=utf-8",
                          {"Content-Disposition": 'attachment; filename="khatasathi-export.csv"'})

    # ---- POST ----

    def do_POST(self):
        path = self._clean_path()
        try:
            # Auth endpoints
            if path == "/api/auth/signup":
                return self._api_auth_signup()
            if path == "/api/auth/login":
                return self._api_auth_login()
            if path == "/api/auth/recover":
                return self._api_auth_recover()
            if path == "/api/setup":
                return self._api_setup()
            if path == "/api/login":
                return self._api_login()
            if path == "/api/reset-pin":
                return self._api_reset_pin()
            if path == "/api/logout":
                return self._json(200, {"ok": True})

            # Photo endpoints (Temporarily under construction)
            if path in ("/api/photo/check", "/api/photo/upload", "/api/photo/save"):
                return self._json(200, {
                    "ok": True,
                    "status": "disabled",
                    "message": "Photo upload is temporarily under construction",
                    "problems": [],
                    "duplicate": None,
                })

            if not self._authed():
                return self._err(401, "Not signed in")
            uid = self._get_user_id()

            if path == "/api/people/add":
                d = read_json(self)
                pid = db.create_person(d.get("name"), d.get("phone") or "", d.get("notes") or "", user_id=uid)
                return self._json(200, {"id": pid})
            if path == "/api/people/update":
                d = read_json(self)
                db.update_person(d.get("id"), d.get("name"), d.get("phone"), d.get("notes"), user_id=uid)
                return self._json(200, {"ok": True})
            if path == "/api/people/merge":
                d = read_json(self)
                db.merge_people(d.get("primary"), d.get("dup"), user_id=uid)
                return self._json(200, {"ok": True})
            if path == "/api/bills/add":
                return self._api_bill_add(uid)
            if path == "/api/bills/itemized/add":
                return self._api_bill_itemized_add(uid)
            if path == "/api/bills/update":
                d = read_json(self)
                db.update_bill(d.get("id"), d.get("amount"), d.get("note"), user_id=uid)
                return self._json(200, {"ok": True})
            if path == "/api/bills/void":
                d = read_json(self)
                db.set_bill_void(d.get("id"), True, user_id=uid)
                return self._json(200, {"ok": True})
            if path == "/api/bills/unvoid":
                d = read_json(self)
                db.set_bill_void(d.get("id"), False, user_id=uid)
                return self._json(200, {"ok": True})
            if path == "/api/payments/preview":
                d = read_json(self)
                out = db.payment_preview(d.get("person_id"), parse_amount(d.get("amount")),
                                         bill_id=d.get("bill_id"), user_id=uid)
                return self._json(200, out)
            if path == "/api/payments/add":
                return self._api_payment_add(uid)
            if path == "/api/payments/undo":
                d = read_json(self)
                db.undo_payment(d.get("id"), d.get("reason") or "", user_id=uid)
                return self._json(200, {"ok": True})
            if path == "/api/galla/open":
                d = read_json(self)
                out = db.galla_open(parse_amount(d.get("opening")),
                                    d.get("date"), d.get("note") or "", user_id=uid)
                return self._json(200, out)
            if path == "/api/galla/entry":
                d = read_json(self)
                direction = "in" if d.get("direction") == "in" else "out"
                if d.get("direction") not in ("in", "out"):
                    return self._err(400, "Direction must be 'in' or 'out'")
                out = db.galla_add_entry(direction, parse_amount(d.get("amount")),
                                         d.get("note") or "", d.get("date"), user_id=uid)
                return self._json(200, out)
            if path == "/api/galla/close":
                d = read_json(self)
                out = db.galla_close(parse_amount(d.get("closing")),
                                     d.get("date"), user_id=uid)
                return self._json(200, out)
            if path == "/api/galla/entry/undo":
                d = read_json(self)
                db.galla_undo_entry(d.get("id"), user_id=uid)
                return self._json(200, {"ok": True})
            if path == "/api/settings":
                d = read_json(self)
                for k in ("store_name", "seller_name", "theme"):
                    if k in d:
                        db.set_setting(k, d[k], user_id=uid)
                if "new_pin" in d and d["new_pin"]:
                    if "current_pin" not in d or not verify_pin(d["current_pin"], db.get_setting("pin", user_id=uid) or ""):
                        return self._err(400, "Current PIN is wrong")
                    db.set_setting("pin", hash_pin(str(d["new_pin"])), user_id=uid)
                return self._json(200, {"ok": True})
            if path == "/api/backup/restore":
                d = read_json(self)
                db.restore(d.get("snapshot") or {}, user_id=uid)
                return self._json(200, {"ok": True})
            if path == "/api/demo":
                demo.load_demo(user_id=uid)
                return self._json(200, {"ok": True})
            if path == "/api/demo/clear":
                db.clear_data(keep_settings=True, user_id=uid)
                db.set_setting("store_name", "", user_id=uid)
                return self._json(200, {"ok": True})
            if path == "/api/ai/status":
                return self._json(200, {"mode": "manual", "provider": None,
                                        "note": "AI bill reading arrives in v1.5."})
            return self._err(404, "Unknown API route")
        except ValueError as e:
            return self._err(400, str(e))
        except Exception as e:
            return self._err(500, "Server error: " + str(e))

    def _api_auth_signup(self):
        d = read_json(self)
        email = (d.get("email") or "").strip()
        password = str(d.get("password") or "").strip()
        seller_name = (d.get("seller_name") or d.get("name") or "").strip()
        store_name = (d.get("store_name") or "").strip()

        if not email or "@" not in email:
            return self._err(400, "A valid email address is required")
        if not password or len(password) < 6:
            return self._err(400, "Password must be at least 6 characters")
        if not seller_name:
            seller_name = email.split("@")[0]

        if SUPABASE_URL and SUPABASE_ANON_KEY:
            try:
                signup_payload = json.dumps({
                    "email": email,
                    "password": password,
                    "data": {"full_name": seller_name, "store_name": store_name},
                }).encode("utf-8")
                req = urllib.request.Request(
                    f"{SUPABASE_URL}/auth/v1/signup",
                    data=signup_payload,
                    headers={
                        "Content-Type": "application/json",
                        "apikey": SUPABASE_ANON_KEY,
                    },
                    method="POST",
                )
                with urllib.request.urlopen(req, timeout=12) as resp:
                    res = json.loads(resp.read().decode("utf-8"))
                user_id = res.get("id") or (res.get("user") or {}).get("id") or res.get("sub")
                token = res.get("access_token") or new_session(user_id=user_id, email=email, seller_name=seller_name)
                if user_id:
                    db.set_setting("seller_name", seller_name, user_id=user_id)
                    db.set_setting("store_name", store_name or (seller_name + "'s shop"), user_id=user_id)
                return self._json(200, {"ok": True, "token": token, "user": res})
            except urllib.error.HTTPError as e:
                try:
                    err_json = json.loads(e.read().decode("utf-8"))
                    msg = err_json.get("error_description") or err_json.get("msg") or err_json.get("message") or str(e)
                except Exception:
                    msg = str(e)
                return self._err(e.code, msg)
            except Exception as e:
                return self._err(500, f"Supabase auth error: {e}")

        # Local test fallback
        user_id = "usr_" + hashlib.md5(email.encode()).hexdigest()[:10]
        token = new_session(user_id=user_id, email=email, seller_name=seller_name)
        db.set_setting("seller_name", seller_name, user_id=user_id)
        db.set_setting("store_name", store_name or (seller_name + "'s shop"), user_id=user_id)
        return self._json(200, {"ok": True, "token": token, "user_id": user_id})

    def _api_auth_login(self):
        d = read_json(self)
        email = (d.get("email") or "").strip()
        password = str(d.get("password") or "").strip()

        if not email or not password:
            return self._err(400, "Email and password are required")

        if SUPABASE_URL and SUPABASE_ANON_KEY:
            try:
                login_payload = json.dumps({
                    "email": email,
                    "password": password,
                }).encode("utf-8")
                req = urllib.request.Request(
                    f"{SUPABASE_URL}/auth/v1/token?grant_type=password",
                    data=login_payload,
                    headers={
                        "Content-Type": "application/json",
                        "apikey": SUPABASE_ANON_KEY,
                    },
                    method="POST",
                )
                with urllib.request.urlopen(req, timeout=12) as resp:
                    res = json.loads(resp.read().decode("utf-8"))
                user_id = (res.get("user") or {}).get("id") or res.get("sub")
                token = res.get("access_token")
                return self._json(200, {"ok": True, "token": token, "user_id": user_id})
            except urllib.error.HTTPError as e:
                try:
                    err_json = json.loads(e.read().decode("utf-8"))
                    msg = err_json.get("error_description") or err_json.get("msg") or err_json.get("message") or "Invalid email or password"
                except Exception:
                    msg = "Invalid email or password"
                return self._err(e.code, msg)
            except Exception as e:
                return self._err(500, f"Supabase login error: {e}")

        # Local test fallback
        user_id = "usr_" + hashlib.md5(email.encode()).hexdigest()[:10]
        seller_name = db.get_setting("seller_name", email.split("@")[0], user_id=user_id)
        token = new_session(user_id=user_id, email=email, seller_name=seller_name)
        return self._json(200, {"ok": True, "token": token, "user_id": user_id})

    def _api_auth_recover(self):
        d = read_json(self)
        email = (d.get("email") or "").strip()
        if not email:
            return self._err(400, "Email is required")
        if SUPABASE_URL and SUPABASE_ANON_KEY:
            try:
                req = urllib.request.Request(
                    f"{SUPABASE_URL}/auth/v1/recover",
                    data=json.dumps({"email": email}).encode("utf-8"),
                    headers={"Content-Type": "application/json", "apikey": SUPABASE_ANON_KEY},
                    method="POST",
                )
                with urllib.request.urlopen(req, timeout=12):
                    pass
            except Exception:
                pass
        return self._json(200, {"ok": True, "message": "If that email exists, a password reset link has been sent."})

    def _api_setup(self):
        d = read_json(self)
        name = (d.get("name") or "").strip()
        pin = str(d.get("pin") or "").strip()
        store = (d.get("store_name") or "").strip()
        uid = (d.get("user_id") or "").strip() or ("usr_" + hashlib.md5(name.encode()).hexdigest()[:10])
        if not name:
            return self._err(400, "Seller name is required")
        if not re.fullmatch(r"\d{4,8}", pin):
            return self._err(400, "PIN must be 4-8 digits")
        db.set_setting("seller_name", name, user_id=uid)
        db.set_setting("store_name", store or (name + "'s shop"), user_id=uid)
        db.set_setting("pin", hash_pin(pin), user_id=uid)
        return self._json(200, {"ok": True, "token": new_session(user_id=uid, seller_name=name), "user_id": uid})

    def _api_login(self):
        d = read_json(self)
        pin = str(d.get("pin") or "").strip()
        uid = (d.get("user_id") or "").strip() or self._get_user_id()
        stored = db.get_setting("pin", user_id=uid)
        if not stored:
            # Check default
            stored = db.get_setting("pin", user_id="default")
            if stored:
                uid = "default"
        if not stored:
            return self._err(400, "No account yet - set one up first")
        if not verify_pin(pin, stored):
            return self._err(401, "Wrong PIN")
        seller_name = db.get_setting("seller_name", "", user_id=uid)
        return self._json(200, {"ok": True, "token": new_session(user_id=uid, seller_name=seller_name), "user_id": uid})

    def _api_reset_pin(self):
        d = read_json(self)
        uid = self._get_user_id()
        seller_name = str(db.get_setting("seller_name", user_id=uid) or "").strip()
        supplied_name = str(d.get("seller_name") or "").strip()
        new_pin = str(d.get("new_pin") or "").strip()
        confirm_pin = str(d.get("confirm_pin") or "").strip()
        if not supplied_name:
            return self._err(400, "Seller name is required")
        if supplied_name.casefold() != seller_name.casefold():
            return self._err(400, "Seller name does not match this shop")
        if not re.fullmatch(r"\d{4,8}", new_pin):
            return self._err(400, "PIN must be 4-8 digits")
        if new_pin != confirm_pin:
            return self._err(400, "PINs do not match")
        db.set_setting("pin", hash_pin(new_pin), user_id=uid)
        return self._json(200, {"ok": True, "token": new_session(user_id=uid, seller_name=seller_name)})

    def _api_bill_add(self, uid):
        d = read_json(self)
        person_id = d.get("person_id")
        person_name = (d.get("person_name") or "").strip()
        if not person_id and not person_name:
            return self._err(400, "Pick a person or type a new name")
        amount = parse_amount(d.get("amount"))
        paid_raw = str(d.get("paid_amount") or "").strip()
        paid_amount = parse_amount(paid_raw) if paid_raw else 0
        db.require_galla_open(user_id=uid)
        if not person_id:
            person_id = db.create_person(person_name, d.get("phone") or "", user_id=uid)
        res = db.create_bill(
            person_id, amount, photo="", note=d.get("note") or "",
            already_paid=bool(d.get("already_paid")), paid_amount=paid_amount,
            paid_note=d.get("paid_note") or "", user_id=uid,
        )
        res["person_id"] = person_id
        return self._json(200, res)

    def _api_bill_itemized_add(self, uid):
        d = read_json(self)
        person_id = d.get("person_id")
        person_name = (d.get("person_name") or "").strip()
        if not person_id and not person_name:
            return self._err(400, "Pick a person or type a new name")
        db.require_galla_open(user_id=uid)
        if not person_id:
            person_id = db.create_person(person_name, d.get("phone") or "", user_id=uid)
        paid_raw = str(d.get("paid_amount") or "").strip()
        paid_amount = parse_amount(paid_raw) if paid_raw else 0
        res = db.create_itemized_bill(
            person_id, d.get("items"), photo="", note=d.get("note") or "",
            already_paid=bool(d.get("already_paid")), paid_amount=paid_amount,
            paid_note=d.get("paid_note") or "", user_id=uid,
        )
        res["person_id"] = person_id
        return self._json(200, res)

    def _api_payment_add(self, uid):
        d = read_json(self)
        amount = parse_amount(d.get("amount"))
        db.require_galla_open(user_id=uid)
        res = db.record_payment(
            d.get("person_id"), amount, note=d.get("note") or "", photo="",
            bill_id=d.get("bill_id") or None, user_id=uid,
        )
        return self._json(200, res)


# WSGI application adapter for Vercel / serverless runtimes
def wsgi_app(environ, start_response):
    from io import BytesIO

    headers_in = {}
    for k, v in environ.items():
        if k.startswith("HTTP_"):
            name = k[5:].replace("_", "-").title()
            headers_in[name] = v
        elif k in ("CONTENT_TYPE", "CONTENT_LENGTH"):
            name = k.replace("_", "-").title()
            headers_in[name] = v

    class MockSocket:
        def __init__(self, rfile, wfile):
            self.rfile = rfile
            self.wfile = wfile

        def makefile(self, mode, *args, **kwargs):
            return self.rfile if "r" in mode else self.wfile

    rfile = environ.get("wsgi.input") or BytesIO(b"")
    wfile = BytesIO()

    try:
        handler = Handler(MockSocket(rfile, wfile), ("127.0.0.1", 80), None)
        path = environ.get("PATH_INFO", "/")
        query = environ.get("QUERY_STRING", "")
        handler.path = path + ("?" + query if query else "")
        handler.command = environ.get("REQUEST_METHOD", "GET")
        handler.headers = headers_in

        # Initialize schema
        try:
            db.init()
        except Exception:
            pass

        if handler.command == "GET":
            handler.do_GET()
        elif handler.command == "POST":
            handler.do_POST()
        elif handler.command == "OPTIONS":
            handler.send_response(200)
            handler.send_header("Access-Control-Allow-Origin", "*")
            handler.send_header("Access-Control-Allow-Headers", "Authorization, Content-Type")
            handler.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
            handler.end_headers()
        else:
            handler._err(405, "Method not allowed")
    except Exception as e:
        body = json.dumps({"error": f"Server error: {e}"}).encode("utf-8")
        start_response("500 Internal Server Error", [
            ("Content-Type", "application/json"),
            ("Content-Length", str(len(body)))
        ])
        return [body]

    wfile.seek(0)
    raw_response = wfile.read()
    if not raw_response:
        start_response("200 OK", [("Content-Length", "0")])
        return [b""]

    try:
        header_part, body_part = raw_response.split(b"\r\n\r\n", 1)
    except ValueError:
        header_part, body_part = raw_response, b""

    header_lines = header_part.decode("iso-8859-1").split("\r\n")
    status_line = header_lines[0]
    status = " ".join(status_line.split(" ")[1:]) if " " in status_line else "200 OK"

    response_headers = []
    for line in header_lines[1:]:
        if ":" in line:
            hn, hv = line.split(":", 1)
            response_headers.append((hn.strip(), hv.strip()))

    start_response(status, response_headers)
    return [body_part]


def run(host="0.0.0.0", port=8787, open_browser=False):
    db.init()
    server = ThreadingHTTPServer((host, port), Handler)
    print(f"Khata Sathi Cloud running at http://{host}:{port}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


def main():
    port = int(os.environ.get("PORT", 8787))
    run("0.0.0.0", port)


if __name__ == "__main__":
    main()


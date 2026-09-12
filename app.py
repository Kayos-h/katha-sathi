"""Khata Sathi - HTTP server (stdlib only) + API + SSE live sync.

Serves the web app, the photo API, and the event stream that keeps
every open screen (phone + laptop) in sync live. No dependencies.
"""
import base64
import hashlib
import io
import json
import os
import queue
import re
import secrets
import socket
import subprocess
import sys
import threading
import time
import webbrowser
import zlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import db
import demo
import exporters
import photos

APP_DIR = os.path.dirname(os.path.abspath(__file__))
WEB_DIR = os.path.join(APP_DIR, "web")

SESSIONS = {}          # token -> expires_at (epoch)
SESSION_TTL = 60 * 60 * 12  # 12h
SSE_CLIENTS = []       # list of (queue, token)
sse_lock = threading.Lock()

MONEY_NOTE = "Amounts are stored as plain numbers; the UI converts Devanagari digits."


# ---------------- SSE ----------------

def sse_broadcast(kind, payload):
    msg = json.dumps({"kind": kind, "payload": payload}, ensure_ascii=False)
    with sse_lock:
        dead = []
        for i, (q, _tok) in enumerate(SSE_CLIENTS):
            try:
                q.put_nowait(msg)
            except queue.Full:
                dead.append(i)
        for i in reversed(dead):
            try:
                SSE_CLIENTS.pop(i)
            except IndexError:
                pass


db.broadcast.sink = sse_broadcast  # db calls broadcast() after each change


# ---------------- auth ----------------

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


def auth_state():
    return {
        "has_account": db.get_setting("seller_name") is not None,
        "store_name": db.get_setting("store_name", ""),
        "seller_name": db.get_setting("seller_name", ""),
    }


def new_session():
    token = secrets.token_hex(16)
    SESSIONS[token] = time.time() + SESSION_TTL
    return token


def session_cookie(token):
    return "bs_session=%s; Path=/; Max-Age=%d; HttpOnly; SameSite=Lax" % (token, SESSION_TTL)


def check_session(token):
    exp = SESSIONS.get(token)
    if not exp or exp < time.time():
        SESSIONS.pop(token, None)
        return False
    return True


def drop_session(token):
    SESSIONS.pop(token, None)


# ---------------- helpers ----------------

def jdump(obj):
    return json.dumps(obj, ensure_ascii=False).encode("utf-8")


def _quote_fn(name):
    """RFC 5987-safe filename for Content-Disposition (Devanagari-safe)."""
    from urllib.parse import quote
    return quote(name)


def find_lan_ip():
    """The LAN address the phone should open (QR code target)."""
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("8.8.8.8", 80))  # never actually sends
        ip = s.getsockname()[0]
    except OSError:
        ip = "127.0.0.1"
    finally:
        s.close()
    return ip


def read_json(handler):
    n = int(handler.headers.get("Content-Length") or 0)
    if n <= 0 or n > 64 * 1024 * 1024:
        raise ValueError("Bad request size")
    raw = handler.rfile.read(n)
    return json.loads(raw.decode("utf-8"))


def parse_amount(val):
    """Accepts 1234, '1,234', 'रू 1,234', Devanagari digits, returns float or raises."""
    DEV = {
        "०": "0", "१": "1", "२": "2", "३": "3", "४": "4",
        "५": "5", "६": "6", "७": "7", "८": "8", "९": "9",
    }
    s = str(val or "").strip()
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


def gzip_if_wanted(handler, body, ctype):
    # No gzip: everything is served on the local network where compression
    # only adds CPU and decoding risk. Keep the helper for clarity of intent.
    return body, ctype, False


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
    server_version = "Khata Sathi/1"
    protocol_version = "HTTP/1.1"

    # ---- plumbing ----

    def log_message(self, fmt, *args):
        pass  # keep the console clean; the audit log is the record

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

    def _json(self, code, obj):
        body = jdump(obj)
        extra = {}
        if "token" in obj and isinstance(obj.get("token"), str):
            extra["Set-Cookie"] = session_cookie(obj["token"])
        self._send(code, body, extra=extra)

    def _err(self, code, msg):
        self._json(code, {"error": msg})

    # ---- auth gate ----

    def _token(self):
        auth = self.headers.get("Authorization") or ""
        if auth.startswith("Bearer "):
            return auth[7:].strip()
        return ""

    def _authed(self):
        if not auth_state()["has_account"]:
            return True  # setup not done: everything open so first-run works
        if check_session(self._token()):
            return True
        # plain <a href> downloads (PDF/Excel) can't send a Bearer header;
        # the session cookie set at login covers them.
        cookie = self.headers.get("Cookie") or ""
        for part in cookie.split(";"):
            if part.strip().startswith("bs_session="):
                if check_session(part.strip().split("=", 1)[1]):
                    return True
        return False

    # ---- GET ----

    def do_GET(self):
        path = self.path.split("?")[0]
        if path == "/":
            return self._serve_file("index.html")
        if path.startswith("/photo/"):
            return self._photo(path.split("/")[-1])
        if path == "/api/state":
            return self._json(200, auth_state())
        if path == "/api/qr":
            return self._qr()
        if path == "/api/events":
            return self._sse()
        if path.startswith("/api/"):
            return self._api_get(path)
        # static file (subdirectories like /views/ are fine; no .. escapes)
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
        self._send(200, body, ctype)

    def _photo(self, fname):
        # Photos are also loaded by plain <img> tags, which cannot send a
        # Bearer header, so a session cookie works too. Filenames are
        # unguessable (timestamp + random id).
        if auth_state()["has_account"]:
            ok = check_session(self._token())
            if not ok:
                cookie = self.headers.get("Cookie") or ""
                for part in cookie.split(";"):
                    if part.strip().startswith("bs_session="):
                        if check_session(part.strip().split("=", 1)[1]):
                            ok = True
            if not ok:
                return self._err(401, "Not signed in")
        data, ctype = photos.serve_photo(fname)
        if data is None:
            return self._err(404, "Photo not found")
        self._send(200, data, ctype or "image/jpeg")

    def _qr(self):
        if not self._authed():
            return self._err(401, "Not signed in")
        ip = find_lan_ip()
        port = self.server.server_address[1]
        url = "http://%s:%d" % (ip, port)
        qr_b64 = None
        try:
            import qrcode
            buf = io.BytesIO()
            qrcode.make(url, box_size=8, border=2).save(buf, "PNG")
            qr_b64 = base64.b64encode(buf.getvalue()).decode()
        except ImportError:
            pass
        return self._json(200, {"url": url, "qr_png_b64": qr_b64})

    # ---- SSE ----

    def _sse(self):
        # EventSource cannot send headers, so the token may also arrive as
        # ?token= or via the session cookie.
        token = self._token()
        qs = self.path.split("?", 1)[1] if "?" in self.path else ""
        for kv in qs.split("&"):
            if kv.startswith("token="):
                token = kv[6:]
        if auth_state()["has_account"]:
            ok = check_session(token)
            if not ok:
                cookie = self.headers.get("Cookie") or ""
                for part in cookie.split(";"):
                    if part.strip().startswith("bs_session="):
                        if check_session(part.strip().split("=", 1)[1]):
                            ok = True
            if not ok:
                return self._err(401, "Not signed in")
        q = queue.Queue(maxsize=200)
        with sse_lock:
            SSE_CLIENTS.append((q, token))
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Connection", "keep-alive")
        self.end_headers()
        try:
            self.wfile.write(b": hello\n\n")
            self.wfile.flush()
            while True:
                try:
                    msg = q.get(timeout=20)
                except queue.Empty:
                    self.wfile.write(b": keepalive\n\n")
                    self.wfile.flush()
                    continue
                # session expired mid-stream: close politely
                if auth_state()["has_account"] and not check_session(token):
                    break
                self.wfile.write(("data: " + msg + "\n\n").encode("utf-8"))
                self.wfile.flush()
        except (ConnectionAbortedError, BrokenPipeError, OSError):
            pass
        finally:
            with sse_lock:
                for i, (qq, tt) in enumerate(SSE_CLIENTS):
                    if qq is q:
                        SSE_CLIENTS.pop(i)
                        break

    # ---- GET api ----

    def _api_get(self, path):
        if not self._authed():
            return self._err(401, "Not signed in")
        qs = self.path.split("?", 1)[-1] if "?" in self.path else ""
        params = {}
        if qs:
            for kv in qs.split("&"):
                if "=" in kv:
                    k, v = kv.split("=", 1)
                    params[k] = v
        try:
            if path == "/api/people":
                return self._json(200, {"people": db.list_people()})
            if path == "/api/dashboard":
                return self._json(200, db.dashboard())
            if path == "/api/day":
                d = params.get("date")
                return self._json(200, db.day_summary(d))
            if path == "/api/person":
                pid = params.get("id")
                if not pid:
                    return self._err(400, "Missing id")
                return self._json(200, db.get_person(pid))
            if path == "/api/ledger":
                pid = params.get("id")
                if not pid:
                    return self._err(400, "Missing id")
                return self._json(200, db.get_ledger(pid))
            if path == "/api/openbills":
                pid = params.get("id")
                if not pid:
                    return self._err(400, "Missing id")
                return self._json(200, {"bills": db.open_bills(pid), "total": db.get_person(pid)["balance"]})
            if path == "/api/activity":
                limit = int(params.get("limit") or 30)
                pid = params.get("person")
                return self._json(200, {"items": db.get_activity(limit, pid)})
            if path == "/api/search":
                q = params.get("q", "")
                return self._json(200, {"results": db.search_people(q)})
            if path == "/api/audit":
                q = params.get("q", "")
                return self._json(200, {"items": db.audit_recent(200, q)})
            if path == "/api/ai/status":
                # reserved for the v1.5 AI reader; always manual for now
                return self._json(200, {"mode": "manual", "provider": None,
                                        "note": "AI bill reading arrives in v1.5 - the "
                                                "confirm screen will stay the same."})
            if path == "/api/stats":
                return self._json(200, db.stats_counts())
            if path == "/api/backup.json":
                snap = db.snapshot()
                return self._send(
                    200, jdump(snap), "application/json; charset=utf-8",
                    {"Content-Disposition": 'attachment; filename="khatasathi-backup.json"'},
                )
            if path == "/api/export.csv":
                return self._api_export_csv()
            if path == "/api/khata/pdf":
                return self._api_khata_file(params, "pdf")
            if path == "/api/khata/xlsx":
                return self._api_khata_file(params, "xlsx")
            if path == "/api/bill/pdf":
                return self._api_bill_pdf(params)
            if path == "/api/galla":
                return self._json(200, db.galla_summary(params.get("date")))
            if path == "/api/galla/recent":
                return self._json(200, {"days": db.galla_recent(
                    int(params.get("days") or 7))})
            if path == "/api/galla/pdf":
                return self._api_galla_pdf(params)
            if path == "/api/bill":
                bid = params.get("id")
                if not bid:
                    return self._err(400, "Missing id")
                b = db.get_bill_full(bid)
                b["allocations"] = db.payment_alloc_for_bill(bid)
                return self._json(200, b)
            if path == "/api/payment":
                pmt_id = params.get("id")
                if not pmt_id:
                    return self._err(400, "Missing id")
                return self._json(200, db.payment_detail(pmt_id))
            return self._err(404, "Unknown API route")
        except ValueError as e:
            return self._err(404 if "not found" in str(e).lower() else 400, str(e))
        except Exception as e:
            return self._err(500, "Server error: " + str(e))

    def _api_khata_file(self, params, kind):
        pid = params.get("id")
        if not pid:
            return self._err(400, "Missing id")
        data = db.khata_export(pid)
        store = db.get_setting("store_name", "")
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

    def _api_bill_pdf(self, params):
        bid = params.get("id")
        if not bid:
            return self._err(400, "Missing id")
        bill = db.get_bill_full(bid)
        person = db.get_person(bill["person_id"])
        store = db.get_setting("store_name", "")
        body, fname = exporters.bill_pdf(bill, person, store)
        return self._send(200, body, "application/pdf", {
            "Content-Disposition":
                "attachment; filename*=UTF-8''" + _quote_fn(fname),
        })

    def _api_galla_pdf(self, params):
        data = db.galla_summary(params.get("date"))
        store = db.get_setting("store_name", "")
        body, fname = exporters.galla_pdf(data, store)
        return self._send(200, body, "application/pdf", {
            "Content-Disposition":
                "attachment; filename*=UTF-8''" + _quote_fn(fname),
        })

    def _api_export_csv(self):
        lines = ["person,kind,amount,remaining,status,note,date"]
        for p in db.list_people():
            led = db.get_ledger(p["id"])
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
        path = self.path.split("?")[0]
        try:
            # auth routes are open (they create the session / account)
            if path == "/api/setup":
                return self._api_setup()
            if path == "/api/login":
                return self._api_login()
            if path == "/api/reset-pin":
                return self._api_reset_pin()
            if path == "/api/logout":
                drop_session(self._token())
                return self._json(200, {"ok": True})
            if path == "/api/photo/check":
                return self._api_photo_check()
            if not self._authed():
                return self._err(401, "Not signed in")
            if path == "/api/people/add":
                d = read_json(self)
                pid = db.create_person(d.get("name"), d.get("phone") or "", d.get("notes") or "")
                return self._json(200, {"id": pid})
            if path == "/api/people/update":
                d = read_json(self)
                db.update_person(d.get("id"), d.get("name"), d.get("phone"), d.get("notes"))
                return self._json(200, {"ok": True})
            if path == "/api/people/merge":
                d = read_json(self)
                db.merge_people(d.get("primary"), d.get("dup"))
                return self._json(200, {"ok": True})
            if path == "/api/bills/add":
                return self._api_bill_add()
            if path == "/api/bills/itemized/add":
                return self._api_bill_itemized_add()
            if path == "/api/bills/update":
                d = read_json(self)
                db.update_bill(d.get("id"), d.get("amount"), d.get("note"))
                return self._json(200, {"ok": True})
            if path == "/api/bills/void":
                d = read_json(self)
                db.set_bill_void(d.get("id"), True)
                return self._json(200, {"ok": True})
            if path == "/api/bills/unvoid":
                d = read_json(self)
                db.set_bill_void(d.get("id"), False)
                return self._json(200, {"ok": True})
            if path == "/api/payments/preview":
                d = read_json(self)
                out = db.payment_preview(d.get("person_id"), parse_amount(d.get("amount")),
                                         bill_id=d.get("bill_id"))
                return self._json(200, out)
            if path == "/api/payments/add":
                return self._api_payment_add()
            if path == "/api/payments/undo":
                d = read_json(self)
                db.undo_payment(d.get("id"), d.get("reason") or "")
                return self._json(200, {"ok": True})
            if path == "/api/galla/open":
                d = read_json(self)
                out = db.galla_open(parse_amount(d.get("opening")),
                                    d.get("date"), d.get("note") or "")
                return self._json(200, out)
            if path == "/api/galla/entry":
                d = read_json(self)
                direction = "in" if d.get("direction") == "in" else "out"
                if d.get("direction") not in ("in", "out"):
                    return self._err(400, "Direction must be 'in' or 'out'")
                out = db.galla_add_entry(direction, parse_amount(d.get("amount")),
                                         d.get("note") or "", d.get("date"))
                return self._json(200, out)
            if path == "/api/galla/close":
                d = read_json(self)
                out = db.galla_close(parse_amount(d.get("closing")),
                                     d.get("date"))
                return self._json(200, out)
            if path == "/api/galla/entry/undo":
                d = read_json(self)
                db.galla_undo_entry(d.get("id"))
                return self._json(200, {"ok": True})
            if path == "/api/settings":
                d = read_json(self)
                for k in ("store_name", "seller_name", "theme"):
                    if k in d:
                        db.set_setting(k, d[k])
                if "new_pin" in d and d["new_pin"]:
                    if "current_pin" not in d or not verify_pin(d["current_pin"], db.get_setting("pin") or ""):
                        return self._err(400, "Current PIN is wrong")
                    db.set_setting("pin", hash_pin(str(d["new_pin"])))
                return self._json(200, {"ok": True})
            if path == "/api/backup/restore":
                d = read_json(self)
                db.restore(d.get("snapshot") or {})
                return self._json(200, {"ok": True})
            if path == "/api/demo":
                demo.load_demo()
                return self._json(200, {"ok": True})
            if path == "/api/demo/clear":
                # removes ALL shop data (demo or real) but keeps the account;
                # demo.reload is the "start over with demo" path, this is
                # "remove the demo data and use the shop for real"
                db.clear_data(keep_settings=True)
                db.set_setting("store_name", "")
                return self._json(200, {"ok": True})
            if path == "/api/ai/status":
                # reserved for the v1.5 AI reader; always manual for now
                return self._json(200, {"mode": "manual", "provider": None,
                                        "note": "AI bill reading arrives in v1.5 - the "
                                                "confirm screen will stay the same."})
            return self._err(404, "Unknown API route")
        except ValueError as e:
            return self._err(400, str(e))
        except Exception as e:
            return self._err(500, "Server error: " + str(e))

    def _api_setup(self):
        d = read_json(self)
        name = (d.get("name") or "").strip()
        pin = str(d.get("pin") or "").strip()
        store = (d.get("store_name") or "").strip()
        if not name:
            return self._err(400, "Seller name is required")
        if not re.fullmatch(r"\d{4,8}", pin):
            return self._err(400, "PIN must be 4-8 digits")
        if auth_state()["has_account"]:
            return self._err(400, "Account already exists - sign in instead")
        db.set_setting("seller_name", name)
        db.set_setting("store_name", store or (name + "'s shop"))
        db.set_setting("pin", hash_pin(pin))
        return self._json(200, {"ok": True, "token": new_session()})

    def _api_login(self):
        d = read_json(self)
        pin = str(d.get("pin") or "").strip()
        stored = db.get_setting("pin")
        if not stored:
            return self._err(400, "No account yet - set one up first")
        if not verify_pin(pin, stored):
            return self._err(401, "Wrong PIN")
        return self._json(200, {"ok": True, "token": new_session()})

    def _api_reset_pin(self):
        d = read_json(self)
        if not auth_state()["has_account"]:
            return self._err(400, "No account yet - set one up first")
        seller_name = str(db.get_setting("seller_name") or "").strip()
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
        db.set_setting("pin", hash_pin(new_pin))
        SESSIONS.clear()
        return self._json(200, {"ok": True, "token": new_session()})

    def _api_photo_check(self):
        """Receives raw photo bytes; returns quality verdict + saves nothing."""
        n = int(self.headers.get("Content-Length") or 0)
        if n <= 0 or n > 40 * 1024 * 1024:
            return self._err(400, "No photo received or photo too large (max 40MB)")
        data = self.rfile.read(n)
        ext = photos.sniff_image(data)
        if not ext:
            return self._err(400, "That file isn't a photo (JPEG/PNG/WebP only)")
        ok, problems = photos.check_quality(data)
        dup = None
        if ok:
            is_dup = photos.duplicate_check(data)
            if is_dup:
                dup = "This exact photo was already used on another bill. " \
                      "Continue only if this is really a different purchase."
        return self._json(200, {"ok": ok, "problems": problems, "duplicate": dup})

    def _api_bill_add(self):
        d = read_json(self)
        person_id = d.get("person_id")
        person_name = (d.get("person_name") or "").strip()
        if not person_id and not person_name:
            return self._err(400, "Pick a person or type a new name")
        if not person_id:
            person_id = db.create_person(person_name, d.get("phone") or "")
        amount = parse_amount(d.get("amount"))
        photo = ""
        if d.get("photo_b64"):
            try:
                raw = base64.b64decode(d["photo_b64"])
            except Exception:
                return self._err(400, "Photo data couldn't be decoded")
            ext = photos.sniff_image(raw)
            if not ext:
                return self._err(400, "The attached file isn't a photo")
            photo = photos.save_photo(raw, ext)
        res = db.create_bill(
            person_id, amount, photo=photo, note=d.get("note") or "",
            already_paid=bool(d.get("already_paid")),
        )
        res["person_id"] = person_id
        return self._json(200, res)

    def _api_bill_itemized_add(self):
        """Estimate-form bill: person + line items (+ optional photo)."""
        d = read_json(self)
        person_id = d.get("person_id")
        person_name = (d.get("person_name") or "").strip()
        if not person_id and not person_name:
            return self._err(400, "Pick a person or type a new name")
        if not person_id:
            person_id = db.create_person(person_name, d.get("phone") or "")
        photo = ""
        if d.get("photo_b64"):
            try:
                raw = base64.b64decode(d["photo_b64"])
            except Exception:
                return self._err(400, "Photo data couldn't be decoded")
            ext = photos.sniff_image(raw)
            if not ext:
                return self._err(400, "The attached file isn't a photo")
            photo = photos.save_photo(raw, ext)
        res = db.create_itemized_bill(
            person_id, d.get("items"), photo=photo, note=d.get("note") or "",
            already_paid=bool(d.get("already_paid")),
        )
        res["person_id"] = person_id
        return self._json(200, res)

    def _api_payment_add(self):
        d = read_json(self)
        amount = parse_amount(d.get("amount"))
        photo = ""
        if d.get("photo_b64"):
            try:
                raw = base64.b64decode(d["photo_b64"])
            except Exception:
                return self._err(400, "Photo data couldn't be decoded")
            ext = photos.sniff_image(raw)
            if not ext:
                return self._err(400, "The attached file isn't a photo")
            photo = photos.save_photo(raw, ext)
        res = db.record_payment(
            d.get("person_id"), amount, note=d.get("note") or "", photo=photo,
            bill_id=d.get("bill_id") or None,
        )
        return self._json(200, res)


# ---------------- main ----------------

def run(host="0.0.0.0", port=8787, open_browser=True):
    db.init()
    # pick a free port if busy
    srv = None
    for p in ([port] + list(range(port, port + 20))):
        try:
            srv = ThreadingHTTPServer((host, p), Handler)
            break
        except OSError:
            continue
    if srv is None:
        print("Khata Sathi could not find a free port near", port)
        sys.exit(1)
    ip = find_lan_ip()
    actual_port = srv.server_address[1]
    url = "http://%s:%d" % (ip, actual_port)
    print("Khata Sathi is running.")
    print("  On this laptop :  http://localhost:%d" % actual_port)
    print("  On the phone   :  %s   (scan the QR in the app - top right \u2630)" % url)
    if open_browser:
        threading.Timer(0.5, lambda: webbrowser.open("http://localhost:%d" % actual_port)).start()
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    run(open_browser=("-no-browser" not in sys.argv))

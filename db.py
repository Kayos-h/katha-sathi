"""Khata Sathi - database layer (PostgreSQL / Cloud-Ready Multi-Tenant).

All persistent application data is stored in PostgreSQL via DATABASE_URL.
Every table is multi-tenant partitioned by user_id.
Every financial change writes an audit row. Amounts are plain floats rounded to 2 decimals.
Devanagari digits are converted in the UI, never stored.
"""
import json
import os
import re
import sqlite3
import time
import urllib.parse
import uuid
from datetime import datetime, timedelta

try:
    import psycopg2
    import psycopg2.extras
    HAS_PSYCOPG2 = True
except ImportError:
    HAS_PSYCOPG2 = False

SCHEMA = """
CREATE TABLE IF NOT EXISTS settings (
    user_id TEXT NOT NULL DEFAULT 'default',
    key TEXT NOT NULL,
    value TEXT,
    PRIMARY KEY (user_id, key)
);
CREATE TABLE IF NOT EXISTS people (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL DEFAULT 'default',
    name TEXT NOT NULL,
    phone TEXT DEFAULT '',
    notes TEXT DEFAULT '',
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS bills (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL DEFAULT 'default',
    person_id TEXT NOT NULL,
    amount DOUBLE PRECISION NOT NULL,
    remaining DOUBLE PRECISION NOT NULL,
    status TEXT NOT NULL DEFAULT 'open',
    already_paid INTEGER NOT NULL DEFAULT 0,
    photo TEXT DEFAULT '',
    note TEXT DEFAULT '',
    created_at TEXT NOT NULL,
    seq SERIAL
);
CREATE TABLE IF NOT EXISTS bill_items (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL DEFAULT 'default',
    bill_id TEXT NOT NULL,
    sn INTEGER NOT NULL,
    particulars TEXT DEFAULT '',
    qty DOUBLE PRECISION DEFAULT 1,
    rate DOUBLE PRECISION DEFAULT 0,
    amount DOUBLE PRECISION DEFAULT 0
);
CREATE TABLE IF NOT EXISTS payments (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL DEFAULT 'default',
    person_id TEXT NOT NULL,
    amount DOUBLE PRECISION NOT NULL,
    note TEXT DEFAULT '',
    photo TEXT DEFAULT '',
    created_at TEXT NOT NULL,
    seq SERIAL
);
CREATE TABLE IF NOT EXISTS payment_allocations (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL DEFAULT 'default',
    payment_id TEXT NOT NULL,
    bill_id TEXT NOT NULL,
    amount DOUBLE PRECISION NOT NULL
);
CREATE TABLE IF NOT EXISTS audit_log (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL DEFAULT 'default',
    at TEXT NOT NULL,
    action TEXT NOT NULL,
    entity_id TEXT,
    detail TEXT,
    seq SERIAL
);
CREATE TABLE IF NOT EXISTS galla_days (
    user_id TEXT NOT NULL DEFAULT 'default',
    date TEXT NOT NULL,
    opening DOUBLE PRECISION NOT NULL,
    closing DOUBLE PRECISION,
    closed_at TEXT,
    note TEXT DEFAULT '',
    PRIMARY KEY (user_id, date)
);
CREATE TABLE IF NOT EXISTS galla_entries (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL DEFAULT 'default',
    date TEXT NOT NULL,
    direction TEXT NOT NULL,
    amount DOUBLE PRECISION NOT NULL,
    note TEXT DEFAULT '',
    created_at TEXT NOT NULL,
    bill_id TEXT DEFAULT '',
    payment_id TEXT DEFAULT '',
    seq SERIAL
);
CREATE TABLE IF NOT EXISTS sync_events (
    id SERIAL PRIMARY KEY,
    user_id TEXT NOT NULL DEFAULT 'default',
    kind TEXT NOT NULL,
    payload TEXT DEFAULT '{}',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
"""

TABLES = [
    "settings", "people", "bills", "bill_items", "payments",
    "payment_allocations", "galla_days", "galla_entries", "audit_log"
]


def get_database_url():
    url = os.environ.get("DATABASE_URL", "").strip()
    if not url:
        url = os.environ.get("POSTGRES_URL", "").strip() or os.environ.get("POSTGRES_PRISMA_URL", "").strip()
    if url.startswith("postgres://"):
        url = "postgresql://" + url[11:]
    return url


# ---------------- In-Memory SQLite Test Compatibility Wrapper ----------------

_shared_test_conn = None

def _get_shared_test_conn():
    global _shared_test_conn
    if _shared_test_conn is None:
        _shared_test_conn = sqlite3.connect(
            "file:khatasathi_mem?mode=memory&cache=shared",
            uri=True,
            check_same_thread=False,
            timeout=30,
        )
        _shared_test_conn.row_factory = sqlite3.Row
        _shared_test_conn.execute("PRAGMA foreign_keys=OFF")
    return _shared_test_conn


class SQLiteCursorWrapper:
    def __init__(self, cur):
        self._cur = cur

    def execute(self, sql, params=None):
        s = sql
        s = re.sub(r"\bDOUBLE PRECISION\b", "REAL", s, flags=re.IGNORECASE)
        s = re.sub(r"\bSERIAL PRIMARY KEY\b", "INTEGER PRIMARY KEY AUTOINCREMENT", s, flags=re.IGNORECASE)
        s = re.sub(r"\bseq SERIAL\b", "seq INTEGER", s, flags=re.IGNORECASE)
        s = re.sub(r"\bILIKE\b", "LIKE", s, flags=re.IGNORECASE)
        s = re.sub(r"to_char\(created_at,\s*'[^']+'\)", "created_at", s, flags=re.IGNORECASE)
        s = re.sub(r"pg_database_size\(current_database\(\)\)\s*/\s*\(1024\.0\s*\*\s*1024\.0\)", "0.0", s, flags=re.IGNORECASE)
        s = s.replace("%s", "?")
        if params is None:
            self._cur.execute(s)
        else:
            self._cur.execute(s, tuple(params))
        return self

    def fetchone(self):
        r = self._cur.fetchone()
        if r is None:
            return None
        return dict(r)

    def fetchall(self):
        rows = self._cur.fetchall()
        return [dict(r) for r in rows]

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        pass


class SQLiteConnWrapper:
    def __init__(self, conn):
        self._conn = conn

    def cursor(self):
        return SQLiteCursorWrapper(self._conn.cursor())

    def commit(self):
        self._conn.commit()

    def rollback(self):
        self._conn.rollback()

    def close(self):
        # In-memory shared connection is preserved across calls during test runs
        pass


def connect():
    """Returns a PostgreSQL connection in production, or in-memory SQLite during local offline testing."""
    db_url = get_database_url()
    if db_url and (db_url.startswith("postgresql://") or db_url.startswith("postgres://")):
        if not HAS_PSYCOPG2:
            raise ImportError("psycopg2-binary is required for PostgreSQL connections.")
        if "sslmode=" not in db_url and "localhost" not in db_url and "127.0.0.1" not in db_url:
            sep = "&" if "?" in db_url else "?"
            db_url = f"{db_url}{sep}sslmode=require"
        conn = psycopg2.connect(
            db_url,
            cursor_factory=psycopg2.extras.RealDictCursor,
            connect_timeout=10,
        )
        conn.autocommit = False
        return conn

    # If running on Vercel or production and DATABASE_URL is missing, fail clearly with zero disk writes
    if os.environ.get("VERCEL") or os.environ.get("VERCEL_ENV") or os.environ.get("KHATASATHI_PROD"):
        raise RuntimeError(
            "DATABASE_URL is not configured. Please set the DATABASE_URL environment variable "
            "in your Vercel project settings to connect your cloud PostgreSQL database."
        )

    # Local offline fallback for automated test suite (ZERO filesystem writes)
    c = _get_shared_test_conn()
    return SQLiteConnWrapper(c)


def init():
    """Initializes the database schema if tables do not exist."""
    conn = connect()
    with conn.cursor() as cur:
        db_url = get_database_url()
        if not (db_url and (db_url.startswith("postgresql://") or db_url.startswith("postgres://"))):
            for stmt in SCHEMA.strip().split(";"):
                stmt = stmt.strip()
                if stmt:
                    cur.execute(stmt)
        else:
            cur.execute(SCHEMA)
            cur.execute("CREATE INDEX IF NOT EXISTS idx_settings_user ON settings(user_id);")
            cur.execute("CREATE INDEX IF NOT EXISTS idx_people_user ON people(user_id);")
            cur.execute("CREATE INDEX IF NOT EXISTS idx_bills_user_person ON bills(user_id, person_id, status);")
            cur.execute("CREATE INDEX IF NOT EXISTS idx_payments_user_person ON payments(user_id, person_id);")
            cur.execute("CREATE INDEX IF NOT EXISTS idx_galla_entries_user_date ON galla_entries(user_id, date);")
            cur.execute("CREATE INDEX IF NOT EXISTS idx_sync_events_user_id ON sync_events(user_id, id);")
    conn.commit()
    conn.close()


def new_id():
    return uuid.uuid4().hex[:12]


def now_iso():
    return datetime.now().strftime("%Y-%m-%dT%H:%M:%S")


def f2(x):
    try:
        return round(float(x) + 0.0, 2)
    except (TypeError, ValueError):
        return 0.0


# ---------------- settings ----------------

def get_setting(key, default=None, user_id="default"):
    conn = connect()
    with conn.cursor() as cur:
        cur.execute("SELECT value FROM settings WHERE user_id = %s AND key = %s", (user_id, key))
        row = cur.fetchone()
    conn.close()
    return row["value"] if row is not None else default


def set_setting(key, value, user_id="default"):
    conn = connect()
    with conn.cursor() as cur:
        cur.execute(
            "INSERT INTO settings (user_id, key, value) VALUES (%s, %s, %s) "
            "ON CONFLICT(user_id, key) DO UPDATE SET value = EXCLUDED.value",
            (user_id, key, str(value)),
        )
    conn.commit()
    conn.close()


# ---------------- audit + live events ----------------

def audit(conn, action, entity_id, detail, user_id="default"):
    with conn.cursor() as cur:
        cur.execute(
            "INSERT INTO audit_log (id, user_id, at, action, entity_id, detail) VALUES (%s,%s,%s,%s,%s,%s)",
            (new_id(), user_id, now_iso(), action, entity_id, json.dumps(detail, ensure_ascii=False)),
        )


def broadcast(kind, payload, user_id="default"):
    try:
        conn = connect()
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO sync_events (user_id, kind, payload) VALUES (%s, %s, %s)",
                (user_id, kind, json.dumps(payload, ensure_ascii=False)),
            )
        conn.commit()
        conn.close()
    except Exception:
        pass

    sink = getattr(broadcast, "sink", None)
    if sink:
        try:
            sink(kind, payload)
        except Exception:
            pass


def get_sync_events(since_id=0, user_id="default"):
    conn = connect()
    with conn.cursor() as cur:
        cur.execute(
            "SELECT id, kind, payload, to_char(created_at, 'YYYY-MM-DD\"T\"HH24:MI:SS') as at "
            "FROM sync_events WHERE user_id = %s AND id > %s ORDER BY id ASC LIMIT 50",
            (user_id, int(since_id)),
        )
        rows = cur.fetchall()
        cur.execute("SELECT COALESCE(MAX(id), 0) as max_id FROM sync_events WHERE user_id = %s", (user_id,))
        max_row = cur.fetchone()
    conn.close()
    events = []
    for r in rows:
        try:
            pl = json.loads(r["payload"]) if isinstance(r["payload"], str) else (r["payload"] or {})
        except Exception:
            pl = {}
        events.append({"id": r["id"], "kind": r["kind"], "payload": pl, "at": r.get("at", now_iso())})
    return {"events": events, "latest_id": max_row["max_id"] if max_row else 0}


def _emit_all(user_id="default"):
    broadcast("people", {}, user_id=user_id)
    broadcast("dash", {}, user_id=user_id)
    broadcast("ledger", {"all": True}, user_id=user_id)


# ---------------- people ----------------

def create_person(name, phone="", notes="", user_id="default"):
    name = (name or "").strip()
    if not name:
        raise ValueError("Name is required")
    conn = connect()
    pid = new_id()
    with conn.cursor() as cur:
        cur.execute(
            "INSERT INTO people (id, user_id, name, phone, notes, created_at) VALUES (%s,%s,%s,%s,%s,%s)",
            (pid, user_id, name, phone or "", notes or "", now_iso()),
        )
        audit(conn, "person_create", pid, {"name": name}, user_id=user_id)
    conn.commit()
    conn.close()
    broadcast("people", {}, user_id=user_id)
    return pid


def update_person(pid, name=None, phone=None, notes=None, user_id="default"):
    conn = connect()
    with conn.cursor() as cur:
        cur.execute("SELECT * FROM people WHERE user_id = %s AND id = %s", (user_id, pid))
        row = cur.fetchone()
        if row is None:
            conn.close()
            raise ValueError("Person not found")
        old = dict(row)
        new_name = old["name"] if name is None else name.strip()
        new_phone = old["phone"] if phone is None else phone.strip()
        new_notes = old["notes"] if notes is None else notes.strip()
        if not new_name:
            conn.close()
            raise ValueError("Name is required")
        cur.execute(
            "UPDATE people SET name = %s, phone = %s, notes = %s WHERE user_id = %s AND id = %s",
            (new_name, new_phone, new_notes, user_id, pid),
        )
        audit(conn, "person_update", pid, {
            "before": {"name": old["name"], "phone": old["phone"], "notes": old["notes"]},
            "after": {"name": new_name, "phone": new_phone, "notes": new_notes},
        }, user_id=user_id)
    conn.commit()
    conn.close()
    _emit_all(user_id=user_id)
    return True


def get_person(pid, user_id="default"):
    conn = connect()
    with conn.cursor() as cur:
        cur.execute("SELECT * FROM people WHERE user_id = %s AND id = %s", (user_id, pid))
        row = cur.fetchone()
        if row is None:
            conn.close()
            raise ValueError("Person not found")
        cur.execute(
            "SELECT COALESCE(SUM(amount),0) as s FROM bills WHERE user_id = %s AND person_id = %s AND status != 'void'",
            (user_id, pid),
        )
        lifetime_billed = cur.fetchone()["s"]
        cur.execute(
            "SELECT COALESCE(SUM(amount),0) as s FROM payments WHERE user_id = %s AND person_id = %s",
            (user_id, pid)
        )
        lifetime_paid = cur.fetchone()["s"]
        cur.execute(
            "SELECT COALESCE(SUM(remaining),0) as s FROM bills WHERE user_id = %s AND person_id = %s AND status = 'open'",
            (user_id, pid),
        )
        balance = cur.fetchone()["s"]
    conn.close()
    return {
        "id": row["id"], "name": row["name"], "phone": row["phone"] or "",
        "notes": row["notes"] or "", "created_at": row["created_at"],
        "lifetime_billed": f2(lifetime_billed), "lifetime_paid": f2(lifetime_paid),
        "balance": f2(balance),
    }


def list_people(user_id="default"):
    conn = connect()
    with conn.cursor() as cur:
        cur.execute(
            "SELECT p.id, p.name, p.phone, p.created_at,"
            " COALESCE((SELECT SUM(remaining) FROM bills b"
            "   WHERE b.user_id=p.user_id AND b.person_id=p.id AND b.status='open'), 0) AS balance,"
            " COALESCE((SELECT COUNT(*) FROM bills b"
            "   WHERE b.user_id=p.user_id AND b.person_id=p.id AND b.status='open'), 0) AS open_count,"
            " COALESCE((SELECT SUM(amount) FROM bills b"
            "   WHERE b.user_id=p.user_id AND b.person_id=p.id AND b.status!='void'), 0) AS lifetime_billed,"
            " COALESCE((SELECT SUM(amount) FROM payments m"
            "   WHERE m.user_id=p.user_id AND m.person_id=p.id), 0) AS lifetime_paid,"
            " COALESCE((SELECT MAX(created_at) FROM bills b"
            "   WHERE b.user_id=p.user_id AND b.person_id=p.id AND b.status!='void'), '') AS last_bill,"
            " COALESCE((SELECT MAX(created_at) FROM payments m"
            "   WHERE m.user_id=p.user_id AND m.person_id=p.id), '') AS last_pmt"
            " FROM people p WHERE p.user_id = %s ORDER BY LOWER(p.name)",
            (user_id,)
        )
        rows = cur.fetchall()
    conn.close()
    out = []
    for r in rows:
        out.append({
            "id": r["id"], "name": r["name"], "phone": r["phone"] or "",
            "created_at": r["created_at"],
            "balance": f2(r["balance"]),
            "open_count": r["open_count"],
            "lifetime_billed": f2(r["lifetime_billed"]),
            "lifetime_paid": f2(r["lifetime_paid"]),
            "last_activity": max(r["last_bill"] or "", r["last_pmt"] or ""),
        })
    return out


def _match_score(name, q):
    low = name.lower()
    if low == q:
        return 0
    if low.startswith(q):
        return 1
    if (" " + q) in low:
        return 2
    if q in low:
        return 3
    return 99


def search_people(q, limit=8, user_id="default"):
    q = (q or "").strip().lower()
    if not q:
        return []
    conn = connect()
    with conn.cursor() as cur:
        cur.execute(
            "SELECT p.id, p.name, p.phone,"
            " COALESCE((SELECT SUM(remaining) FROM bills b"
            "   WHERE b.user_id=p.user_id AND b.person_id=p.id AND b.status='open'), 0) AS balance,"
            " COALESCE((SELECT COUNT(*) FROM bills b"
            "   WHERE b.user_id=p.user_id AND b.person_id=p.id AND b.status='open'), 0) AS open_count"
            " FROM people p WHERE p.user_id = %s AND (p.name ILIKE %s OR p.phone ILIKE %s)",
            (user_id, "%" + q + "%", "%" + q + "%"),
        )
        rows = cur.fetchall()
    conn.close()
    hits = [dict(r) for r in rows]
    hits.sort(key=lambda h: _match_score(h["name"], q))
    out = []
    for h in hits[:limit]:
        out.append({
            "id": h["id"], "name": h["name"], "phone": h["phone"] or "",
            "balance": f2(h["balance"]), "open_count": h["open_count"],
        })
    return out


def merge_people(primary_id, dup_id, user_id="default"):
    if primary_id == dup_id:
        raise ValueError("Pick two different people to merge")
    conn = connect()
    with conn.cursor() as cur:
        cur.execute("SELECT * FROM people WHERE user_id = %s AND id = %s", (user_id, primary_id))
        primary = cur.fetchone()
        cur.execute("SELECT * FROM people WHERE user_id = %s AND id = %s", (user_id, dup_id))
        dup = cur.fetchone()
        if primary is None or dup is None:
            conn.close()
            raise ValueError("Person not found")
        cur.execute("UPDATE bills SET person_id = %s WHERE user_id = %s AND person_id = %s", (primary_id, user_id, dup_id))
        cur.execute("UPDATE payments SET person_id = %s WHERE user_id = %s AND person_id = %s", (primary_id, user_id, dup_id))
        cur.execute("DELETE FROM people WHERE user_id = %s AND id = %s", (user_id, dup_id))
        audit(conn, "person_merge", primary_id, {
            "kept": primary["name"], "merged_in": dup["name"], "merged_in_id": dup_id,
        }, user_id=user_id)
    conn.commit()
    conn.close()
    _emit_all(user_id=user_id)
    return True


# ---------------- bills ----------------

def _insert_payment_for_bill(conn, person_id, bill_id, amount, note, photo, when, user_id="default"):
    pmt_id = new_id()
    with conn.cursor() as cur:
        cur.execute(
            "INSERT INTO payments (id, user_id, person_id, amount, note, photo, created_at)"
            " VALUES (%s,%s,%s,%s,%s,%s,%s)",
            (pmt_id, user_id, person_id, f2(amount), note or "", photo or "", when),
        )
        cur.execute(
            "INSERT INTO payment_allocations (id, user_id, payment_id, bill_id, amount)"
            " VALUES (%s,%s,%s,%s,%s)",
            (new_id(), user_id, pmt_id, bill_id, f2(amount)),
        )
        audit(conn, "payment_create", pmt_id, {
            "person_id": person_id, "amount": f2(amount), "note": note or "",
            "photo": bool(photo), "bill_id": bill_id,
            "cleared": [{"bill_id": bill_id, "amount": f2(amount)}],
        }, user_id=user_id)
    return pmt_id


def create_bill(person_id, amount, photo="", note="", already_paid=False,
                created_at=None, paid_amount=0, paid_note="", require_galla=True,
                user_id="default"):
    amount = f2(amount)
    if amount <= 0:
        raise ValueError("Amount must be greater than zero")
    paid_amount = f2(paid_amount)
    if paid_amount < 0:
        raise ValueError("Paid amount can't be negative")
    if already_paid and paid_amount > 0:
        raise ValueError("Use either already paid or paid now, not both")
    if paid_amount > amount + 0.005:
        raise ValueError("Paid amount can't be more than the bill total")
    when = created_at or now_iso()
    conn = connect()
    with conn.cursor() as cur:
        cur.execute("SELECT id, name FROM people WHERE user_id = %s AND id = %s", (user_id, person_id))
        person = cur.fetchone()
        if person is None:
            conn.close()
            raise ValueError("Person not found")
        if require_galla and when[:10] == _today():
            try:
                _require_galla_open(conn, when[:10], user_id=user_id)
            except Exception:
                conn.close()
                raise
        bid = new_id()
        if already_paid:
            remaining, status = 0.0, "paid"
        elif paid_amount > 0:
            remaining = f2(amount - paid_amount)
            status = "paid" if remaining < 0.005 else "open"
        else:
            remaining, status = amount, "open"
        cur.execute(
            "INSERT INTO bills (id, user_id, person_id, amount, remaining, status, already_paid,"
            " photo, note, created_at) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)",
            (bid, user_id, person_id, amount, remaining, status, 1 if already_paid else 0,
             photo or "", note or "", when),
        )
        audit(conn, "bill_create", bid, {
            "person_id": person_id, "amount": amount, "already_paid": bool(already_paid),
            "paid_amount": paid_amount, "photo": bool(photo), "note": note or "",
        }, user_id=user_id)
    pmt_id = ""
    galla_entry_id = ""
    if paid_amount > 0:
        pmt_id = _insert_payment_for_bill(
            conn, person_id, bid, paid_amount,
            paid_note or "paid while making bill", "", when,
            user_id=user_id,
        )
        galla_entry_id = _galla_in_for_transaction(
            conn, paid_amount, when,
            "bill payment - " + person["name"],
            bill_id=bid, payment_id=pmt_id, require_open=require_galla,
            user_id=user_id,
        )
    elif already_paid:
        galla_entry_id = _galla_in_for_transaction(
            conn, amount, when,
            "counter sale - " + person["name"],
            bill_id=bid, require_open=require_galla,
            user_id=user_id,
        )
    conn.commit()
    conn.close()
    broadcast("ledger", {"person_id": person_id}, user_id=user_id)
    broadcast("dash", {}, user_id=user_id)
    broadcast("people", {}, user_id=user_id)
    if galla_entry_id:
        broadcast("galla", {"date": when[:10]}, user_id=user_id)
    galla_in = bool(galla_entry_id)
    return {"id": bid, "created_at": when, "galla_in": galla_in,
            "paid_amount": paid_amount, "payment_id": pmt_id,
            "remaining": remaining, "galla_entry_id": galla_entry_id}


def get_bill(bid, user_id="default"):
    conn = connect()
    with conn.cursor() as cur:
        cur.execute("SELECT * FROM bills WHERE user_id = %s AND id = %s", (user_id, bid))
        row = cur.fetchone()
    conn.close()
    if row is None:
        raise ValueError("Bill not found")
    return dict(row)


def update_bill(bid, amount=None, note=None, user_id="default"):
    conn = connect()
    with conn.cursor() as cur:
        cur.execute("SELECT * FROM bills WHERE user_id = %s AND id = %s", (user_id, bid))
        row = cur.fetchone()
        if row is None:
            conn.close()
            raise ValueError("Bill not found")
        if row["status"] == "void" and amount is not None:
            conn.close()
            raise ValueError("A voided bill can't be edited; un-void it first")
        old = dict(row)
        if amount is not None:
            amount = f2(amount)
            if amount <= 0:
                conn.close()
                raise ValueError("Amount must be greater than zero")
            paid_so_far = f2(old["amount"] - old["remaining"])
            if amount < paid_so_far - 0.005:
                conn.close()
                raise ValueError(
                    "This bill already has Rs. %s paid against it, so the amount "
                    "can't be lower than that." % f"{paid_so_far:,.2f}"
                )
            remaining = f2(amount - paid_so_far)
            status = "paid" if remaining < 0.005 else "open"
            cur.execute(
                "UPDATE bills SET amount = %s, remaining = %s, status = %s WHERE user_id = %s AND id = %s",
                (amount, remaining, status, user_id, bid),
            )
        if note is not None:
            cur.execute("UPDATE bills SET note = %s WHERE user_id = %s AND id = %s", (note, user_id, bid))
        cur.execute("SELECT * FROM bills WHERE user_id = %s AND id = %s", (user_id, bid))
        new = cur.fetchone()
        audit(conn, "bill_update", bid, {
            "before": {"amount": f2(old["amount"]), "note": old["note"]},
            "after": {"amount": f2(new["amount"]), "note": new["note"]},
        }, user_id=user_id)
    conn.commit()
    conn.close()
    broadcast("ledger", {"person_id": row["person_id"]}, user_id=user_id)
    broadcast("dash", {}, user_id=user_id)
    broadcast("people", {}, user_id=user_id)
    return True


def set_bill_void(bid, void=True, user_id="default"):
    conn = connect()
    with conn.cursor() as cur:
        cur.execute("SELECT * FROM bills WHERE user_id = %s AND id = %s", (user_id, bid))
        bill = cur.fetchone()
        if bill is None:
            conn.close()
            raise ValueError("Bill not found")
        galla_touched = False
        if void:
            if bill["status"] == "void":
                conn.close()
                raise ValueError("Bill is already void")
            cur.execute(
                "SELECT COALESCE(SUM(amount),0) as s FROM payment_allocations WHERE user_id = %s AND bill_id = %s",
                (user_id, bid),
            )
            linked = cur.fetchone()["s"]
            if f2(linked) > 0:
                conn.close()
                raise ValueError("A payment is linked to this bill. Undo that payment first.")
            cur.execute("UPDATE bills SET status = 'void', remaining = 0 WHERE user_id = %s AND id = %s", (user_id, bid))
            if bill["already_paid"]:
                cur.execute("SELECT * FROM galla_entries WHERE user_id = %s AND bill_id = %s", (user_id, bid))
                for e in cur.fetchall():
                    cur.execute("SELECT closing FROM galla_days WHERE user_id = %s AND date = %s", (user_id, e["date"]))
                    day = cur.fetchone()
                    if day is None or day["closing"] is not None:
                        continue
                    cur.execute("DELETE FROM galla_entries WHERE user_id = %s AND id = %s", (user_id, e["id"]))
                    audit(conn, "galla_entry_undo", e["id"], {
                        "date": e["date"], "direction": e["direction"],
                        "amount": f2(e["amount"]), "note": e["note"] or "",
                        "reason": "counter bill voided",
                    }, user_id=user_id)
                    galla_touched = True
            audit(conn, "bill_void", bid, {
                "person_id": bill["person_id"], "amount": f2(bill["amount"]),
            }, user_id=user_id)
        else:
            if bill["status"] != "void":
                conn.close()
                raise ValueError("Bill is not void")
            if bill["already_paid"]:
                remaining, status = 0.0, "paid"
                if bill["created_at"][:10] == _today():
                    try:
                        _require_galla_open(conn, _today(), user_id=user_id)
                    except Exception:
                        conn.close()
                        raise
            else:
                remaining, status = f2(bill["amount"]), "open"
            cur.execute(
                "UPDATE bills SET status = %s, remaining = %s WHERE user_id = %s AND id = %s",
                (status, remaining, user_id, bid),
            )
            if bill["already_paid"] and bill["created_at"][:10] == _today():
                cur.execute("SELECT name FROM people WHERE user_id = %s AND id = %s", (user_id, bill["person_id"]))
                person = cur.fetchone()
                galla_entry_id = _galla_in_for_transaction(
                    conn, bill["amount"], now_iso(),
                    "counter sale restored - " + (person["name"] if person else "bill"),
                    bill_id=bid, require_open=True, user_id=user_id,
                )
                galla_touched = bool(galla_entry_id)
            audit(conn, "bill_unvoid", bid, {
                "person_id": bill["person_id"], "amount": f2(bill["amount"]),
            }, user_id=user_id)
    conn.commit()
    conn.close()
    if galla_touched:
        broadcast("galla", {}, user_id=user_id)
    broadcast("ledger", {"person_id": bill["person_id"]}, user_id=user_id)
    broadcast("dash", {}, user_id=user_id)
    broadcast("people", {}, user_id=user_id)
    return True


def open_bills(person_id, user_id="default"):
    conn = connect()
    with conn.cursor() as cur:
        cur.execute(
            "SELECT id, amount, remaining, status, already_paid, photo, note, created_at"
            " FROM bills WHERE user_id = %s AND person_id = %s AND status = 'open' AND remaining > 0.004"
            " ORDER BY created_at, id",
            (user_id, person_id),
        )
        rows = cur.fetchall()
    conn.close()
    return [dict(r) for r in rows]


# ---------------- itemized bills ----------------

def next_bill_no(conn=None, user_id="default"):
    own = conn is None
    c = conn or connect()
    with c.cursor() as cur:
        cur.execute("SELECT COUNT(*) as c FROM bills WHERE user_id = %s", (user_id,))
        n = cur.fetchone()["c"]
    if own:
        c.close()
    return "INV-%04d" % (n + 1,)


def create_itemized_bill(person_id, items, photo="", note="", already_paid=False,
                          created_at=None, paid_amount=0, paid_note="",
                          require_galla=True, user_id="default"):
    clean = []
    for i, it in enumerate(items or []):
        part = str(it.get("particulars") or "").strip()
        qty = f2(it.get("qty") if it.get("qty") is not None else 1)
        rate = f2(it.get("rate"))
        amt = f2(it.get("amount"))
        if amt <= 0 and rate > 0:
            amt = f2(qty * rate)
        if not part or amt <= 0:
            continue
        clean.append({"sn": len(clean) + 1, "particulars": part,
                      "qty": qty, "rate": rate, "amount": amt})
    if not clean:
        raise ValueError("Add at least one item with particulars and an amount")
    total = f2(sum(c["amount"] for c in clean))
    paid_amount = f2(paid_amount)
    if paid_amount < 0:
        raise ValueError("Paid amount can't be negative")
    if already_paid and paid_amount > 0:
        raise ValueError("Use either already paid or paid now, not both")
    if paid_amount > total + 0.005:
        raise ValueError("Paid amount can't be more than the bill total")
    for c in clean:
        if c["qty"] <= 0:
            c["qty"] = 1
    when = created_at or now_iso()
    conn = connect()
    with conn.cursor() as cur:
        cur.execute("SELECT id, name FROM people WHERE user_id = %s AND id = %s", (user_id, person_id))
        person = cur.fetchone()
        if person is None:
            conn.close()
            raise ValueError("Person not found")
        if require_galla and when[:10] == _today():
            try:
                _require_galla_open(conn, when[:10], user_id=user_id)
            except Exception:
                conn.close()
                raise
        bid = new_id()
        bill_no = next_bill_no(conn, user_id=user_id)
        if already_paid:
            remaining, status = 0.0, "paid"
        elif paid_amount > 0:
            remaining = f2(total - paid_amount)
            status = "paid" if remaining < 0.005 else "open"
        else:
            remaining, status = total, "open"
        cur.execute(
            "INSERT INTO bills (id, user_id, person_id, amount, remaining, status, already_paid,"
            " photo, note, created_at) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)",
            (bid, user_id, person_id, total, remaining, status, 1 if already_paid else 0,
             photo or "", note or "", when),
        )
        for c in clean:
            cur.execute(
                "INSERT INTO bill_items (id, user_id, bill_id, sn, particulars, qty, rate, amount)"
                " VALUES (%s,%s,%s,%s,%s,%s,%s,%s)",
                (new_id(), user_id, bid, c["sn"], c["particulars"], c["qty"], c["rate"], c["amount"]),
            )
        audit(conn, "bill_create", bid, {
            "person_id": person_id, "amount": total, "already_paid": bool(already_paid),
            "paid_amount": paid_amount,
            "bill_no": bill_no, "items": [{"particulars": c["particulars"],
                                           "qty": c["qty"], "rate": c["rate"],
                                           "amount": c["amount"]} for c in clean],
            "photo": bool(photo), "note": note or "",
        }, user_id=user_id)
    pmt_id = ""
    galla_entry_id = ""
    if paid_amount > 0:
        pmt_id = _insert_payment_for_bill(
            conn, person_id, bid, paid_amount,
            paid_note or "paid while making bill", "", when,
            user_id=user_id,
        )
        galla_entry_id = _galla_in_for_transaction(
            conn, paid_amount, when,
            "bill payment - " + person["name"],
            bill_id=bid, payment_id=pmt_id, require_open=require_galla,
            user_id=user_id,
        )
    elif already_paid:
        galla_entry_id = _galla_in_for_transaction(
            conn, total, when,
            "counter sale - " + person["name"],
            bill_id=bid, require_open=require_galla,
            user_id=user_id,
        )
    conn.commit()
    conn.close()
    broadcast("ledger", {"person_id": person_id}, user_id=user_id)
    broadcast("dash", {}, user_id=user_id)
    broadcast("people", {}, user_id=user_id)
    if galla_entry_id:
        broadcast("galla", {"date": when[:10]}, user_id=user_id)
    galla_in = bool(galla_entry_id)
    return {"id": bid, "bill_no": bill_no, "amount": total, "created_at": when,
            "galla_in": galla_in, "paid_amount": paid_amount,
            "payment_id": pmt_id, "remaining": remaining,
            "galla_entry_id": galla_entry_id}


def bill_items(bid, user_id="default"):
    conn = connect()
    with conn.cursor() as cur:
        cur.execute(
            "SELECT sn, particulars, qty, rate, amount FROM bill_items"
            " WHERE user_id = %s AND bill_id = %s ORDER BY sn",
            (user_id, bid),
        )
        rows = cur.fetchall()
    conn.close()
    return [{"sn": r["sn"], "particulars": r["particulars"] or "",
             "qty": f2(r["qty"]), "rate": f2(r["rate"]), "amount": f2(r["amount"])}
            for r in rows]


def get_bill_full(bid, user_id="default"):
    b = get_bill(bid, user_id=user_id)
    b["items"] = bill_items(bid, user_id=user_id)
    conn = connect()
    with conn.cursor() as cur:
        cur.execute("SELECT created_at FROM bills WHERE user_id = %s AND id = %s", (user_id, bid))
        row = cur.fetchone()
        cur.execute("SELECT COUNT(*) as c FROM bills WHERE user_id = %s AND created_at <= %s", (user_id, row["created_at"]))
        n_before = cur.fetchone()["c"]
    conn.close()
    b["bill_no"] = "INV-%04d" % (n_before,)
    return b


# ---------------- payments ----------------

def _fifo_plan(bills, amount):
    plan = []
    left = f2(amount)
    for b in bills:
        if left <= 0.005:
            break
        apply_amt = f2(min(b["remaining"], left))
        if apply_amt <= 0.005:
            continue
        plan.append({
            "bill_id": b["id"], "bill_at": b["created_at"],
            "bill_amount": f2(b["amount"]), "bill_remaining": f2(b["remaining"]),
            "apply": apply_amt,
        })
        left = f2(left - apply_amt)
    return plan


def _open_bills(conn, person_id, user_id="default"):
    with conn.cursor() as cur:
        cur.execute(
            "SELECT * FROM bills WHERE user_id = %s AND person_id = %s AND status = 'open' AND remaining > 0.004"
            " ORDER BY created_at, id",
            (user_id, person_id),
        )
        return cur.fetchall()


def _bill_pay_plan(conn, person_id, bill_id, amount, user_id="default"):
    with conn.cursor() as cur:
        cur.execute("SELECT * FROM bills WHERE user_id = %s AND id = %s", (user_id, bill_id))
        b = cur.fetchone()
    if b is None or b["person_id"] != person_id:
        raise ValueError("Bill not found")
    if b["status"] != "open" or b["remaining"] <= 0.004:
        raise ValueError("That bill is already fully paid")
    if amount > b["remaining"] + 0.005:
        raise ValueError(
            "That's more than this bill's remaining Rs. %s — pay the rest of "
            "the balance from the person's account, not this bill."
            % f"{f2(b['remaining']):,.2f}")
    return [{
        "bill_id": b["id"], "bill_at": b["created_at"],
        "bill_amount": f2(b["amount"]), "bill_remaining": f2(b["remaining"]),
        "apply": amount,
    }]


def payment_preview(person_id, amount, bill_id=None, user_id="default"):
    amount = f2(amount)
    if amount <= 0:
        raise ValueError("Amount must be greater than zero")
    conn = connect()
    if bill_id:
        plan = _bill_pay_plan(conn, person_id, bill_id, amount, user_id=user_id)
        bills = _open_bills(conn, person_id, user_id=user_id)
        open_total = f2(sum(b["remaining"] for b in bills))
        conn.close()
        return {"ok": True, "plan": plan, "open_total": open_total, "bill_only": True}
    bills = _open_bills(conn, person_id, user_id=user_id)
    conn.close()
    open_total = f2(sum(b["remaining"] for b in bills))
    if open_total <= 0:
        raise ValueError("This person has no open bills to pay against")
    if amount > open_total + 0.005:
        raise ValueError(
            "That's more than the open balance of Rs. %s, and Khata Sathi can't "
            "hold extra money." % f"{open_total:,.2f}"
        )
    return {"ok": True, "plan": _fifo_plan(bills, amount), "open_total": open_total}


def record_payment(person_id, amount, note="", photo="", created_at=None, bill_id=None,
                   require_galla=True, user_id="default"):
    amount = f2(amount)
    if amount <= 0:
        raise ValueError("Amount must be greater than zero")
    when = created_at or now_iso()
    conn = connect()
    with conn.cursor() as cur:
        cur.execute("SELECT * FROM people WHERE user_id = %s AND id = %s", (user_id, person_id))
        person = cur.fetchone()
    if person is None:
        conn.close()
        raise ValueError("Person not found")
    if require_galla and when[:10] == _today():
        try:
            _require_galla_open(conn, when[:10], user_id=user_id)
        except Exception:
            conn.close()
            raise
    if bill_id:
        plan = _bill_pay_plan(conn, person_id, bill_id, amount, user_id=user_id)
    else:
        bills = _open_bills(conn, person_id, user_id=user_id)
        open_total = f2(sum(b["remaining"] for b in bills))
        if open_total <= 0:
            conn.close()
            raise ValueError("This person has no open bills to pay against")
        if amount > open_total + 0.005:
            conn.close()
            raise ValueError(
                "That's more than %s's open balance of Rs. %s, and Khata Sathi "
                "can't hold extra money." % (person["name"], f"{open_total:,.2f}")
            )
        plan = _fifo_plan(bills, amount)
    pmt_id = new_id()
    with conn.cursor() as cur:
        cur.execute(
            "INSERT INTO payments (id, user_id, person_id, amount, note, photo, created_at)"
            " VALUES (%s,%s,%s,%s,%s,%s,%s)",
            (pmt_id, user_id, person_id, amount, note or "", photo or "", when),
        )
        for a in plan:
            cur.execute(
                "INSERT INTO payment_allocations (id, user_id, payment_id, bill_id, amount)"
                " VALUES (%s,%s,%s,%s,%s)",
                (new_id(), user_id, pmt_id, a["bill_id"], a["apply"]),
            )
            cur.execute(
                "UPDATE bills SET remaining = remaining - %s,"
                " status = CASE WHEN remaining - %s < 0.005 THEN 'paid' ELSE status END"
                " WHERE user_id = %s AND id = %s",
                (a["apply"], a["apply"], user_id, a["bill_id"]),
            )
        audit(conn, "payment_create", pmt_id, {
            "person_id": person_id, "amount": amount, "note": note or "",
            "photo": bool(photo), "bill_id": bill_id or "",
            "cleared": [{"bill_id": a["bill_id"], "amount": a["apply"]} for a in plan],
        }, user_id=user_id)
    galla_entry_id = _galla_in_for_transaction(
        conn, amount, when,
        "payment - " + person["name"] + ((" - " + note) if note else ""),
        payment_id=pmt_id, require_open=require_galla, user_id=user_id,
    )
    conn.commit()
    conn.close()
    broadcast("ledger", {"person_id": person_id}, user_id=user_id)
    broadcast("dash", {}, user_id=user_id)
    broadcast("people", {}, user_id=user_id)
    if galla_entry_id:
        broadcast("galla", {"date": when[:10]}, user_id=user_id)
    return {"id": pmt_id, "created_at": when, "plan": plan,
            "galla_in": bool(galla_entry_id), "galla_entry_id": galla_entry_id}


def payment_detail(pmt_id, user_id="default"):
    conn = connect()
    with conn.cursor() as cur:
        cur.execute("SELECT * FROM payments WHERE user_id = %s AND id = %s", (user_id, pmt_id))
        p = cur.fetchone()
        if p is None:
            conn.close()
            raise ValueError("Payment not found")
        cur.execute(
            "SELECT pa.bill_id, pa.amount, b.created_at AS bill_at, b.amount AS bill_amount"
            " FROM payment_allocations pa JOIN bills b ON b.id=pa.bill_id AND b.user_id=pa.user_id"
            " WHERE pa.user_id = %s AND pa.payment_id = %s ORDER BY b.created_at",
            (user_id, pmt_id),
        )
        allocs = cur.fetchall()
    conn.close()
    return {
        "id": p["id"], "person_id": p["person_id"], "amount": f2(p["amount"]),
        "note": p["note"] or "", "photo": p["photo"] or "", "created_at": p["created_at"],
        "cleared": [
            {"bill_id": a["bill_id"], "apply": f2(a["amount"]),
             "bill_at": a["bill_at"], "bill_amount": f2(a["bill_amount"])}
            for a in allocs
        ],
    }


def payment_alloc_for_bill(bill_id, user_id="default"):
    conn = connect()
    with conn.cursor() as cur:
        cur.execute(
            "SELECT pa.amount, pa.payment_id, m.created_at AS paid_at, m.note AS pmt_note"
            " FROM payment_allocations pa JOIN payments m ON m.id=pa.payment_id AND m.user_id=pa.user_id"
            " WHERE pa.user_id = %s AND pa.bill_id = %s ORDER BY m.created_at",
            (user_id, bill_id),
        )
        rows = cur.fetchall()
    conn.close()
    return [
        {"payment_id": r["payment_id"], "apply": f2(r["amount"]),
         "paid_at": r["paid_at"], "note": r["pmt_note"] or ""}
        for r in rows
    ]


def khata_export(person_id, user_id="default"):
    led = get_ledger(person_id, user_id=user_id)
    person = get_person(person_id, user_id=user_id)
    led["person"]["lifetime_billed"] = person["lifetime_billed"]
    led["person"]["lifetime_paid"] = person["lifetime_paid"]
    return led


def undo_payment(pmt_id, reason="", user_id="default"):
    conn = connect()
    with conn.cursor() as cur:
        cur.execute("SELECT * FROM payments WHERE user_id = %s AND id = %s", (user_id, pmt_id))
        pmt = cur.fetchone()
        if pmt is None:
            conn.close()
            raise ValueError("Payment not found")
        cur.execute("SELECT * FROM galla_entries WHERE user_id = %s AND payment_id = %s", (user_id, pmt_id))
        galla_entries = cur.fetchall()
        for e in galla_entries:
            cur.execute("SELECT closing FROM galla_days WHERE user_id = %s AND date = %s", (user_id, e["date"]))
            day = cur.fetchone()
            if day is not None and day["closing"] is not None:
                conn.close()
                raise ValueError(
                    "This payment is already included in a closed galla day. "
                    "Closed drawer history is locked."
                )
        cur.execute("SELECT * FROM payment_allocations WHERE user_id = %s AND payment_id = %s", (user_id, pmt_id))
        allocs = cur.fetchall()
        for a in allocs:
            cur.execute(
                "UPDATE bills SET remaining = remaining + %s, status = 'open' WHERE user_id = %s AND id = %s",
                (a["amount"], user_id, a["bill_id"]),
            )
        for e in galla_entries:
            cur.execute("DELETE FROM galla_entries WHERE user_id = %s AND id = %s", (user_id, e["id"]))
            audit(conn, "galla_entry_undo", e["id"], {
                "date": e["date"], "direction": e["direction"],
                "amount": f2(e["amount"]), "note": e["note"] or "",
                "payment_id": pmt_id, "reason": "payment undone",
            }, user_id=user_id)
        cur.execute("DELETE FROM payment_allocations WHERE user_id = %s AND payment_id = %s", (user_id, pmt_id))
        cur.execute("DELETE FROM payments WHERE user_id = %s AND id = %s", (user_id, pmt_id))
        audit(conn, "payment_undo", pmt_id, {
            "person_id": pmt["person_id"], "amount": f2(pmt["amount"]),
            "reason": reason or "",
            "restored": [{"bill_id": a["bill_id"], "amount": f2(a["amount"])} for a in allocs],
        }, user_id=user_id)
    conn.commit()
    conn.close()
    broadcast("ledger", {"person_id": pmt["person_id"]}, user_id=user_id)
    broadcast("dash", {}, user_id=user_id)
    broadcast("people", {}, user_id=user_id)
    if galla_entries:
        broadcast("galla", {}, user_id=user_id)
    return True


# ---------------- ledger / activity ----------------

def get_ledger(person_id, user_id="default"):
    conn = connect()
    with conn.cursor() as cur:
        cur.execute("SELECT * FROM people WHERE user_id = %s AND id = %s", (user_id, person_id))
        person = cur.fetchone()
        if person is None:
            conn.close()
            raise ValueError("Person not found")
        cur.execute(
            "SELECT * FROM bills WHERE user_id = %s AND person_id = %s AND status != 'void'"
            " ORDER BY created_at, id",
            (user_id, person_id),
        )
        bills = cur.fetchall()
        cur.execute(
            "SELECT * FROM payments WHERE user_id = %s AND person_id = %s ORDER BY created_at, id",
            (user_id, person_id),
        )
        pmts = cur.fetchall()
        cur.execute(
            "SELECT COALESCE(SUM(amount),0) as s FROM bills WHERE user_id = %s AND person_id = %s AND status != 'void'",
            (user_id, person_id),
        )
        lifetime_billed = f2(cur.fetchone()["s"])
        cur.execute(
            "SELECT COALESCE(SUM(amount),0) as s FROM payments WHERE user_id = %s AND person_id = %s",
            (user_id, person_id),
        )
        lifetime_paid = f2(cur.fetchone()["s"])
    conn.close()
    rows = []
    for idx, b in enumerate(bills):
        rows.append({
            "kind": "bill", "id": b["id"], "amount": f2(b["amount"]),
            "remaining": f2(b["remaining"]), "status": b["status"],
            "already_paid": bool(b["already_paid"]), "photo": b["photo"] or "",
            "note": b["note"] or "", "at": b["created_at"], "seq": b.get("seq") or (idx + 1),
        })
    for idx, p in enumerate(pmts):
        rows.append({
            "kind": "payment", "id": p["id"], "amount": f2(p["amount"]),
            "photo": p["photo"] or "", "note": p["note"] or "", "at": p["created_at"],
            "seq": p.get("seq") or (idx + 1),
        })
    rows.sort(key=lambda r: (r["at"], 0 if r["kind"] == "bill" else 1, r["seq"]))
    running = 0.0
    for i, r in enumerate(rows, 1):
        r["sn"] = i
        if r["kind"] == "bill" and not r["already_paid"]:
            running = f2(running + r["amount"])
        elif r["kind"] == "payment":
            running = f2(running - r["amount"])
        r["balance_after"] = running
    balance = f2(sum(r["remaining"] for r in rows
                     if r["kind"] == "bill" and r["status"] == "open"))
    return {
        "person": {
            "id": person["id"], "name": person["name"], "phone": person["phone"] or "",
            "notes": person["notes"] or "", "created_at": person["created_at"],
            "lifetime_billed": lifetime_billed, "lifetime_paid": lifetime_paid,
        },
        "rows": rows,
        "balance": balance,
    }


def get_activity(limit=30, person_id=None, user_id="default"):
    conn = connect()
    inner = (
        "SELECT 'bill' AS kind, b.id, b.person_id, b.amount, b.remaining, b.status,"
        " b.already_paid, b.photo, b.note, b.created_at, p.name AS person_name"
        " FROM bills b JOIN people p ON p.id=b.person_id AND p.user_id=b.user_id"
        " WHERE b.user_id = %s AND b.status!='void'"
    )
    args = [user_id]
    if person_id:
        inner += " AND b.person_id = %s"
        args.append(person_id)
    inner += (
        " UNION ALL "
        "SELECT 'payment' AS kind, m.id, m.person_id, m.amount, m.amount,"
        " 'paid' AS status, 0 AS already_paid, m.photo, m.note, m.created_at,"
        " p.name AS person_name"
        " FROM payments m JOIN people p ON p.id=m.person_id AND p.user_id=m.user_id"
        " WHERE m.user_id = %s"
    )
    args.append(user_id)
    if person_id:
        inner += " AND m.person_id = %s"
        args.append(person_id)
    sql = "SELECT * FROM (%s) act ORDER BY created_at DESC, id LIMIT %s" % (inner, "%s")
    args.append(int(limit))
    with conn.cursor() as cur:
        cur.execute(sql, args)
        rows = cur.fetchall()
    conn.close()
    return [dict(r) for r in rows]


# ---------------- dashboard / day ----------------

def _day_totals(conn, d, user_id="default"):
    with conn.cursor() as cur:
        cur.execute(
            "SELECT COALESCE(SUM(amount),0) as s FROM bills"
            " WHERE user_id = %s AND status != 'void' AND SUBSTRING(created_at, 1, 10) = %s", (user_id, d),
        )
        billed = cur.fetchone()["s"]
        cur.execute(
            "SELECT COALESCE(SUM(amount),0) as s FROM bills"
            " WHERE user_id = %s AND already_paid = 1 AND SUBSTRING(created_at, 1, 10) = %s", (user_id, d),
        )
        counter_paid = cur.fetchone()["s"]
        cur.execute(
            "SELECT COALESCE(SUM(amount),0) as s FROM payments WHERE user_id = %s AND SUBSTRING(created_at, 1, 10) = %s",
            (user_id, d),
        )
        collected = cur.fetchone()["s"]
        cur.execute(
            "SELECT COUNT(*) as c FROM bills WHERE user_id = %s AND status != 'void' AND SUBSTRING(created_at, 1, 10) = %s",
            (user_id, d),
        )
        n_bills = cur.fetchone()["c"]
        cur.execute(
            "SELECT COUNT(*) as c FROM bills WHERE user_id = %s AND status != 'void' AND already_paid = 0"
            " AND SUBSTRING(created_at, 1, 10) = %s", (user_id, d),
        )
        n_bills_credit = cur.fetchone()["c"]
        cur.execute(
            "SELECT COUNT(*) as c FROM payments WHERE user_id = %s AND SUBSTRING(created_at, 1, 10) = %s", (user_id, d)
        )
        n_pmts = cur.fetchone()["c"]
    return {
        "date": d,
        "billed": f2(billed),
        "collected": f2(f2(collected) + f2(counter_paid)),
        "collected_payments": f2(collected),
        "collected_counter": f2(counter_paid),
        "n_bills": n_bills, "n_bills_credit": n_bills_credit,
        "n_payments": n_pmts,
    }


def day_summary(date=None, user_id="default"):
    d = str(date) if date else datetime.now().strftime("%Y-%m-%d")
    conn = connect()
    out = _day_totals(conn, d, user_id=user_id)
    conn.close()
    return out


def dashboard(user_id="default"):
    conn = connect()
    today = datetime.now().strftime("%Y-%m-%d")
    with conn.cursor() as cur:
        cur.execute(
            "SELECT COALESCE(SUM(remaining),0) as s FROM bills WHERE user_id = %s AND status = 'open'",
            (user_id,)
        )
        open_total = cur.fetchone()["s"]
        cur.execute(
            "SELECT COUNT(DISTINCT person_id) as c FROM bills"
            " WHERE user_id = %s AND status = 'open' AND remaining > 0.004",
            (user_id,)
        )
        people_open = cur.fetchone()["c"]
        cur.execute("SELECT COUNT(*) as c FROM people WHERE user_id = %s", (user_id,))
        total_people = cur.fetchone()["c"]
        cur.execute(
            "SELECT COUNT(*) as c FROM bills WHERE user_id = %s AND status = 'open' AND remaining > 0.004",
            (user_id,)
        )
        open_count = cur.fetchone()["c"]
        cur.execute(
            "SELECT created_at, remaining FROM bills WHERE user_id = %s AND status = 'open' AND remaining > 0.004",
            (user_id,)
        )
        aging_rows = cur.fetchall()
        cur.execute(
            "SELECT p.id, p.name, COALESCE(SUM(b.remaining),0) AS bal, COUNT(*) AS n"
            " FROM bills b JOIN people p ON p.id=b.person_id AND p.user_id=b.user_id"
            " WHERE b.user_id = %s AND b.status='open' AND b.remaining>0.004"
            " GROUP BY p.id, p.name ORDER BY bal DESC, LOWER(p.name) LIMIT 5",
            (user_id,)
        )
        top = cur.fetchall()

    chart = []
    for i in range(29, -1, -1):
        d = (datetime.now() - timedelta(days=i)).strftime("%Y-%m-%d")
        t = _day_totals(conn, d, user_id=user_id)
        chart.append({"date": d, "billed": t["billed"], "collected": t["collected"]})

    conn.close()

    buckets = {"0-7": 0.0, "8-15": 0.0, "16-30": 0.0, "31-60": 0.0, "60+": 0.0}
    now_t = time.time()
    for r in aging_rows:
        try:
            t = time.mktime(datetime.strptime(r["created_at"], "%Y-%m-%dT%H:%M:%S").timetuple())
            days = (now_t - t) / 86400.0
        except ValueError:
            days = 0.0
        amt = f2(r["remaining"])
        if days <= 7:
            buckets["0-7"] = f2(buckets["0-7"] + amt)
        elif days <= 15:
            buckets["8-15"] = f2(buckets["8-15"] + amt)
        elif days <= 30:
            buckets["16-30"] = f2(buckets["16-30"] + amt)
        elif days <= 60:
            buckets["31-60"] = f2(buckets["31-60"] + amt)
        else:
            buckets["60+"] = f2(buckets["60+"] + amt)

    return {
        "total_to_collect": f2(open_total),
        "people_open": people_open,
        "total_people": total_people,
        "open_count": open_count,
        "today": day_summary(today, user_id=user_id),
        "chart": chart,
        "aging": buckets,
        "top_debtors": [
            {"id": r["id"], "name": r["name"], "balance": f2(r["bal"]),
             "open_count": r["n"]}
            for r in top
        ],
    }


def audit_recent(limit=100, q="", user_id="default"):
    conn = connect()
    sql = "SELECT at, action, entity_id, detail FROM audit_log WHERE user_id = %s"
    args = [user_id]
    if q:
        sql += " AND (action ILIKE %s OR detail ILIKE %s)"
        args += ["%" + q + "%", "%" + q + "%"]
    sql += " ORDER BY at DESC, id DESC LIMIT %s"
    args.append(int(limit))
    with conn.cursor() as cur:
        cur.execute(sql, args)
        rows = cur.fetchall()
    conn.close()
    return [dict(r) for r in rows]


def stats_counts(user_id="default"):
    conn = connect()
    with conn.cursor() as cur:
        cur.execute("SELECT COUNT(*) as c FROM bills WHERE user_id = %s", (user_id,))
        n_bills = cur.fetchone()["c"]
        cur.execute("SELECT COUNT(*) as c FROM payments WHERE user_id = %s", (user_id,))
        n_pmts = cur.fetchone()["c"]
        cur.execute("SELECT COUNT(*) as c FROM people WHERE user_id = %s", (user_id,))
        n_people = cur.fetchone()["c"]
        cur.execute("SELECT COUNT(*) as c FROM audit_log WHERE user_id = %s", (user_id,))
        n_audit = cur.fetchone()["c"]
        cur.execute(
            "SELECT ("
            "  (SELECT COUNT(*) FROM bills WHERE user_id = %s AND photo IS NOT NULL AND photo != '') +"
            "  (SELECT COUNT(*) FROM payments WHERE user_id = %s AND photo IS NOT NULL AND photo != '')"
            ") as c",
            (user_id, user_id),
        )
        n_photos = cur.fetchone()["c"]
        try:
            cur.execute("SELECT pg_database_size(current_database()) / (1024.0 * 1024.0) as mb")
            db_mb = round(float(cur.fetchone()["mb"] or 0), 2)
        except Exception:
            db_mb = 0.0
    conn.close()
    return {
        "bills": n_bills, "payments": n_pmts, "people": n_people,
        "photos": n_photos, "audit": n_audit,
        "db_mb": db_mb,
    }


# ---------------- galla (cash drawer) ----------------

def _today():
    return datetime.now().strftime("%Y-%m-%d")


def _require_galla_open(conn, d, user_id="default"):
    with conn.cursor() as cur:
        cur.execute("SELECT closing FROM galla_days WHERE user_id = %s AND date = %s", (user_id, d))
        row = cur.fetchone()
    if row is None:
        raise ValueError("Open today's galla first (enter the morning cash)")
    if row["closing"] is not None:
        raise ValueError("Today's galla is already closed for the day")
    return row


def require_galla_open(date=None, user_id="default"):
    d = str(date) if date else _today()
    conn = connect()
    try:
        _require_galla_open(conn, d, user_id=user_id)
    finally:
        conn.close()
    return True


def _insert_galla_entry(conn, d, direction, amount, note="", created_at=None,
                        bill_id="", payment_id="", user_id="default"):
    eid = new_id()
    with conn.cursor() as cur:
        cur.execute(
            "INSERT INTO galla_entries"
            " (id, user_id, date, direction, amount, note, created_at, bill_id, payment_id)"
            " VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)",
            (eid, user_id, d, direction, f2(amount), note or "", created_at or now_iso(),
             bill_id or "", payment_id or ""),
        )
        audit(conn, "galla_entry", eid, {"date": d, "direction": direction,
                                         "amount": f2(amount), "note": note or "",
                                         "bill_id": bill_id or "",
                                         "payment_id": payment_id or ""}, user_id=user_id)
    return eid


def _galla_in_for_transaction(conn, amount, when, note, bill_id="",
                              payment_id="", require_open=True, user_id="default"):
    d = (when or now_iso())[:10]
    if d != _today():
        return ""
    if require_open:
        _require_galla_open(conn, d, user_id=user_id)
    else:
        with conn.cursor() as cur:
            cur.execute("SELECT closing FROM galla_days WHERE user_id = %s AND date = %s", (user_id, d))
            row = cur.fetchone()
        if row is None or row["closing"] is not None:
            return ""
    return _insert_galla_entry(
        conn, d, "in", amount, note, created_at=when,
        bill_id=bill_id, payment_id=payment_id, user_id=user_id,
    )


def galla_open(opening, date=None, note="", user_id="default"):
    opening = f2(opening)
    if opening < 0:
        raise ValueError("Opening cash can't be negative")
    d = str(date) if date else _today()
    conn = connect()
    with conn.cursor() as cur:
        cur.execute("SELECT * FROM galla_days WHERE user_id = %s AND date = %s", (user_id, d))
        row = cur.fetchone()
        if row is not None:
            conn.close()
            raise ValueError("This day's galla is already open with Rs. %s" %
                             f"{f2(row['opening']):,.2f}")
        cur.execute(
            "INSERT INTO galla_days (user_id, date, opening, closing, note) VALUES (%s,%s,%s,%s,%s)",
            (user_id, d, opening, None, note or ""),
        )
        audit(conn, "galla_open", d, {"opening": opening, "note": note or ""}, user_id=user_id)
    conn.commit()
    conn.close()
    broadcast("galla", {"date": d}, user_id=user_id)
    return {"date": d, "opening": opening}


def galla_add_entry(direction, amount, note="", date=None, bill_id="", payment_id="", user_id="default"):
    if direction not in ("in", "out"):
        raise ValueError("Direction must be 'in' or 'out'")
    amount = f2(amount)
    if amount <= 0:
        raise ValueError("Amount must be greater than zero")
    d = str(date) if date else _today()
    conn = connect()
    try:
        _require_galla_open(conn, d, user_id=user_id)
    except Exception:
        conn.close()
        raise
    eid = _insert_galla_entry(
        conn, d, direction, amount, note, bill_id=bill_id,
        payment_id=payment_id, user_id=user_id,
    )
    conn.commit()
    conn.close()
    broadcast("galla", {"date": d}, user_id=user_id)
    return {"id": eid, "date": d}


def galla_close(closing, date=None, user_id="default"):
    closing = f2(closing)
    if closing < 0:
        raise ValueError("Counted cash can't be negative")
    d = str(date) if date else _today()
    conn = connect()
    with conn.cursor() as cur:
        cur.execute("SELECT * FROM galla_days WHERE user_id = %s AND date = %s", (user_id, d))
        row = cur.fetchone()
        if row is None:
            conn.close()
            raise ValueError("Open today's galla first (enter the morning cash)")
        if row["closing"] is not None:
            conn.close()
            raise ValueError("Today's galla is already closed")
        cur.execute(
            "UPDATE galla_days SET closing = %s, closed_at = %s WHERE user_id = %s AND date = %s",
            (closing, now_iso(), user_id, d),
        )
        audit(conn, "galla_close", d, {"closing": closing, "opening": f2(row["opening"])}, user_id=user_id)
    conn.commit()
    conn.close()
    broadcast("galla", {"date": d}, user_id=user_id)
    return {"date": d, "closing": closing}


def galla_summary(date=None, user_id="default"):
    d = str(date) if date else _today()
    conn = connect()
    with conn.cursor() as cur:
        cur.execute("SELECT * FROM galla_days WHERE user_id = %s AND date = %s", (user_id, d))
        day = cur.fetchone()
        if day is None:
            conn.close()
            return {"date": d, "open": False}
        cur.execute(
            "SELECT id, direction, amount, note, created_at, bill_id, payment_id FROM galla_entries"
            " WHERE user_id = %s AND date = %s ORDER BY created_at, id",
            (user_id, d),
        )
        entries = cur.fetchall()
    conn.close()
    cash_in = f2(sum(e["amount"] for e in entries if e["direction"] == "in"))
    cash_out = f2(sum(e["amount"] for e in entries if e["direction"] == "out"))
    opening = f2(day["opening"])
    expected = f2(opening + cash_in - cash_out)
    closing = None if day["closing"] is None else f2(day["closing"])
    diff = None if closing is None else f2(closing - expected)
    return {
        "date": d, "open": True, "opening": opening,
        "entries": [{"id": e["id"], "direction": e["direction"],
                     "amount": f2(e["amount"]), "note": e["note"] or "",
                     "at": e["created_at"], "bill_id": e["bill_id"] or "",
                     "payment_id": e["payment_id"] or ""}
                    for e in entries],
        "cash_in": cash_in, "cash_out": cash_out, "expected": expected,
        "closing": closing, "difference": diff,
        "closed": day["closing"] is not None, "closed_at": day["closed_at"] or "",
        "note": day["note"] or "",
    }


def galla_recent(days=7, user_id="default"):
    conn = connect()
    with conn.cursor() as cur:
        cur.execute(
            "SELECT date, opening, closing FROM galla_days WHERE user_id = %s"
            " ORDER BY date DESC LIMIT %s",
            (user_id, int(days)),
        )
        rows = cur.fetchall()
    conn.close()
    out = []
    for r in rows:
        s = galla_summary(r["date"], user_id=user_id)
        out.append({"date": s["date"], "opening": s["opening"],
                    "cash_in": s["cash_in"], "cash_out": s["cash_out"],
                    "expected": s["expected"], "closing": s["closing"],
                    "difference": s["difference"]})
    return out


def galla_undo_entry(eid, user_id="default"):
    conn = connect()
    with conn.cursor() as cur:
        cur.execute("SELECT * FROM galla_entries WHERE user_id = %s AND id = %s", (user_id, eid))
        e = cur.fetchone()
        if e is None:
            conn.close()
            raise ValueError("Entry not found")
        if e["payment_id"]:
            conn.close()
            raise ValueError(
                "This entry came from a payment — undo that payment from the "
                "ledger and the cash comes out of galla with it.")
        if e["bill_id"]:
            conn.close()
            raise ValueError(
                "This entry came from a bill paid at the counter — void that bill "
                "instead and the cash comes out of the galla with it.")
        cur.execute("SELECT closing FROM galla_days WHERE user_id = %s AND date = %s", (user_id, e["date"]))
        day = cur.fetchone()
        if day is not None and day["closing"] is not None:
            conn.close()
            raise ValueError("That day is already closed — entries are locked")
        cur.execute("DELETE FROM galla_entries WHERE user_id = %s AND id = %s", (user_id, eid))
        audit(conn, "galla_entry_undo", eid, {"date": e["date"],
                                               "direction": e["direction"],
                                               "amount": f2(e["amount"]),
                                               "note": e["note"] or ""}, user_id=user_id)
    conn.commit()
    conn.close()
    broadcast("galla", {"date": e["date"]}, user_id=user_id)
    return True


def clear_data(keep_settings=True, user_id="default"):
    conn = connect()
    with conn.cursor() as cur:
        for t in ["audit_log", "galla_entries", "galla_days", "payment_allocations",
                  "bill_items", "payments", "bills", "people"]:
            cur.execute("DELETE FROM " + t + " WHERE user_id = %s", (user_id,))
        if not keep_settings:
            cur.execute("DELETE FROM settings WHERE user_id = %s", (user_id,))
        cur.execute("DELETE FROM sync_events WHERE user_id = %s", (user_id,))
        audit(conn, "data_clear", None, {"keep_settings": keep_settings}, user_id=user_id)
    conn.commit()
    conn.close()
    _emit_all(user_id=user_id)
    broadcast("galla", {}, user_id=user_id)
    return True


# ---------------- snapshot / restore ----------------

def snapshot(user_id="default"):
    out = {}
    conn = connect()
    with conn.cursor() as cur:
        for t in TABLES:
            cur.execute("SELECT * FROM " + t + " WHERE user_id = %s", (user_id,))
            rows = cur.fetchall()
            out[t] = [dict(r) for r in rows]
    conn.close()
    out["__meta__"] = {
        "app": "khatasathi", "format": 1, "exported_at": now_iso(),
        "photo_count": stats_counts(user_id=user_id)["photos"],
    }
    return out


def restore(data, user_id="default"):
    for t in TABLES:
        if t not in data:
            raise ValueError("Backup file is missing the '%s' table" % t)
    conn = connect()
    try:
        with conn.cursor() as cur:
            for t in ["audit_log", "galla_entries", "galla_days", "payment_allocations",
                      "bill_items", "payments", "bills", "people", "settings"]:
                cur.execute("DELETE FROM " + t + " WHERE user_id = %s", (user_id,))
            cur.execute("DELETE FROM sync_events WHERE user_id = %s", (user_id,))
            for t in ["settings", "people", "bills", "bill_items", "payments",
                      "payment_allocations", "galla_days", "galla_entries", "audit_log"]:
                for r in data[t]:
                    item_dict = {k: v for k, v in r.items() if k != "seq"}
                    item_dict["user_id"] = user_id
                    cols = list(item_dict.keys())
                    sql = "INSERT INTO %s (%s) VALUES (%s)" % (
                        t, ", ".join(cols), ", ".join(["%s"] * len(cols)))
                    cur.execute(sql, [item_dict[c] for c in cols])
        conn.commit()
    except Exception:
        conn.rollback()
        conn.close()
        raise
    conn.close()
    _emit_all(user_id=user_id)
    return True

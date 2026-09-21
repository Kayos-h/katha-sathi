"""Khata Sathi - database layer.

SQLite, one file. Every money change writes an audit row, so nothing
ever vanishes silently. Amounts are plain floats rounded to 2 decimals;
Devanagari digits are converted in the UI, never stored.
"""
import json
import os
import sqlite3
import time
import uuid
from datetime import datetime, timedelta

APP_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.environ.get("KHATASATHI_DATA", os.path.join(APP_DIR, "data"))
PHOTO_DIR = os.path.join(DATA_DIR, "photos")
BACKUP_DIR = os.path.join(DATA_DIR, "backups")
DB_PATH = os.path.join(DATA_DIR, "khatasathi.db")

SCHEMA = """
CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
);
CREATE TABLE IF NOT EXISTS people (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    phone TEXT DEFAULT '',
    notes TEXT DEFAULT '',
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS bills (
    id TEXT PRIMARY KEY,
    person_id TEXT NOT NULL REFERENCES people(id),
    amount REAL NOT NULL,
    remaining REAL NOT NULL,
    status TEXT NOT NULL DEFAULT 'open',
    already_paid INTEGER NOT NULL DEFAULT 0,
    photo TEXT DEFAULT '',
    note TEXT DEFAULT '',
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS bill_items (
    id TEXT PRIMARY KEY,
    bill_id TEXT NOT NULL REFERENCES bills(id),
    sn INTEGER NOT NULL,
    particulars TEXT DEFAULT '',
    qty REAL DEFAULT 1,
    rate REAL DEFAULT 0,
    amount REAL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS payments (
    id TEXT PRIMARY KEY,
    person_id TEXT NOT NULL REFERENCES people(id),
    amount REAL NOT NULL,
    note TEXT DEFAULT '',
    photo TEXT DEFAULT '',
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS payment_allocations (
    id TEXT PRIMARY KEY,
    payment_id TEXT NOT NULL REFERENCES payments(id),
    bill_id TEXT NOT NULL REFERENCES bills(id),
    amount REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS audit_log (
    id TEXT PRIMARY KEY,
    at TEXT NOT NULL,
    action TEXT NOT NULL,
    entity_id TEXT,
    detail TEXT
);
CREATE TABLE IF NOT EXISTS galla_days (
    date TEXT PRIMARY KEY,
    opening REAL NOT NULL,
    closing REAL,
    closed_at TEXT,
    note TEXT DEFAULT ''
);
CREATE TABLE IF NOT EXISTS galla_entries (
    id TEXT PRIMARY KEY,
    date TEXT NOT NULL,
    direction TEXT NOT NULL,     -- 'in' | 'out'
    amount REAL NOT NULL,
    note TEXT DEFAULT '',
    created_at TEXT NOT NULL,
    bill_id TEXT DEFAULT '',     -- set when bill activity put this cash in
    payment_id TEXT DEFAULT ''   -- set when a ledger/payment action put this cash in
);
"""

# items + galla travel with every snapshot so backups stay complete
TABLES = ["settings", "people", "bills", "bill_items", "payments",
          "payment_allocations", "galla_days", "galla_entries", "audit_log"]


def connect():
    os.makedirs(DATA_DIR, exist_ok=True)
    os.makedirs(PHOTO_DIR, exist_ok=True)
    conn = sqlite3.connect(DB_PATH, timeout=30)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def init():
    conn = connect()
    conn.executescript(SCHEMA)
    # older databases don't have the bill link on galla entries
    cols = [r[1] for r in conn.execute("PRAGMA table_info(galla_entries)")]
    if "bill_id" not in cols:
        conn.execute("ALTER TABLE galla_entries ADD COLUMN bill_id TEXT DEFAULT ''")
    if "payment_id" not in cols:
        conn.execute("ALTER TABLE galla_entries ADD COLUMN payment_id TEXT DEFAULT ''")
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

def get_setting(key, default=None):
    conn = connect()
    row = conn.execute("SELECT value FROM settings WHERE key=?", (key,)).fetchone()
    conn.close()
    return row["value"] if row is not None else default


def set_setting(key, value):
    conn = connect()
    conn.execute(
        "INSERT INTO settings (key, value) VALUES (?, ?) "
        "ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        (key, str(value)),
    )
    conn.commit()
    conn.close()


# ---------------- audit + live events ----------------

def audit(conn, action, entity_id, detail):
    conn.execute(
        "INSERT INTO audit_log (id, at, action, entity_id, detail) VALUES (?,?,?,?,?)",
        (new_id(), now_iso(), action, entity_id, json.dumps(detail, ensure_ascii=False)),
    )


def broadcast(kind, payload):
    sink = getattr(broadcast, "sink", None)
    if sink:
        try:
            sink(kind, payload)
        except Exception:
            pass


def _emit_all():
    broadcast("people", {})
    broadcast("dash", {})
    broadcast("ledger", {"all": True})


# ---------------- people ----------------

def create_person(name, phone="", notes=""):
    name = (name or "").strip()
    if not name:
        raise ValueError("Name is required")
    conn = connect()
    pid = new_id()
    conn.execute(
        "INSERT INTO people (id, name, phone, notes, created_at) VALUES (?,?,?,?,?)",
        (pid, name, phone or "", notes or "", now_iso()),
    )
    audit(conn, "person_create", pid, {"name": name})
    conn.commit()
    conn.close()
    broadcast("people", {})
    return pid


def update_person(pid, name=None, phone=None, notes=None):
    conn = connect()
    row = conn.execute("SELECT * FROM people WHERE id=?", (pid,)).fetchone()
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
    conn.execute(
        "UPDATE people SET name=?, phone=?, notes=? WHERE id=?",
        (new_name, new_phone, new_notes, pid),
    )
    audit(conn, "person_update", pid, {
        "before": {"name": old["name"], "phone": old["phone"], "notes": old["notes"]},
        "after": {"name": new_name, "phone": new_phone, "notes": new_notes},
    })
    conn.commit()
    conn.close()
    _emit_all()
    return True


def get_person(pid):
    conn = connect()
    row = conn.execute("SELECT * FROM people WHERE id=?", (pid,)).fetchone()
    if row is None:
        conn.close()
        raise ValueError("Person not found")
    lifetime_billed = conn.execute(
        "SELECT COALESCE(SUM(amount),0) s FROM bills WHERE person_id=? AND status!='void'",
        (pid,),
    ).fetchone()["s"]
    lifetime_paid = conn.execute(
        "SELECT COALESCE(SUM(amount),0) s FROM payments WHERE person_id=?", (pid,)
    ).fetchone()["s"]
    balance = conn.execute(
        "SELECT COALESCE(SUM(remaining),0) s FROM bills WHERE person_id=? AND status='open'",
        (pid,),
    ).fetchone()["s"]
    conn.close()
    return {
        "id": row["id"], "name": row["name"], "phone": row["phone"] or "",
        "notes": row["notes"] or "", "created_at": row["created_at"],
        "lifetime_billed": f2(lifetime_billed), "lifetime_paid": f2(lifetime_paid),
        "balance": f2(balance),
    }


def list_people():
    conn = connect()
    rows = conn.execute(
        "SELECT p.id, p.name, p.phone, p.created_at,"
        " COALESCE((SELECT SUM(remaining) FROM bills b"
        "   WHERE b.person_id=p.id AND b.status='open'), 0) AS balance,"
        " COALESCE((SELECT COUNT(*) FROM bills b"
        "   WHERE b.person_id=p.id AND b.status='open'), 0) AS open_count,"
        " COALESCE((SELECT SUM(amount) FROM bills b"
        "   WHERE b.person_id=p.id AND b.status!='void'), 0) AS lifetime_billed,"
        " COALESCE((SELECT SUM(amount) FROM payments m"
        "   WHERE m.person_id=p.id), 0) AS lifetime_paid,"
        " COALESCE((SELECT MAX(created_at) FROM bills b"
        "   WHERE b.person_id=p.id AND b.status!='void'), '') AS last_bill,"
        " COALESCE((SELECT MAX(created_at) FROM payments m"
        "   WHERE m.person_id=p.id), '') AS last_pmt"
        " FROM people p ORDER BY p.name COLLATE NOCASE"
    ).fetchall()
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
    if (" " + q) in low:  # start of a word inside the name
        return 2
    if q in low:
        return 3
    return 99


def search_people(q, limit=8):
    q = (q or "").strip().lower()
    if not q:
        return []
    conn = connect()
    rows = conn.execute(
        "SELECT p.id, p.name, p.phone,"
        " COALESCE((SELECT SUM(remaining) FROM bills b"
        "   WHERE b.person_id=p.id AND b.status='open'), 0) AS balance,"
        " COALESCE((SELECT COUNT(*) FROM bills b"
        "   WHERE b.person_id=p.id AND b.status='open'), 0) AS open_count"
        " FROM people p WHERE p.name LIKE ? OR p.phone LIKE ?",
        ("%" + q + "%", "%" + q + "%"),
    ).fetchall()
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


def merge_people(primary_id, dup_id):
    if primary_id == dup_id:
        raise ValueError("Pick two different people to merge")
    conn = connect()
    primary = conn.execute("SELECT * FROM people WHERE id=?", (primary_id,)).fetchone()
    dup = conn.execute("SELECT * FROM people WHERE id=?", (dup_id,)).fetchone()
    if primary is None or dup is None:
        conn.close()
        raise ValueError("Person not found")
    conn.execute("UPDATE bills SET person_id=? WHERE person_id=?", (primary_id, dup_id))
    conn.execute("UPDATE payments SET person_id=? WHERE person_id=?", (primary_id, dup_id))
    conn.execute("DELETE FROM people WHERE id=?", (dup_id,))
    audit(conn, "person_merge", primary_id, {
        "kept": primary["name"], "merged_in": dup["name"], "merged_in_id": dup_id,
    })
    conn.commit()
    conn.close()
    _emit_all()
    return True


# ---------------- bills ----------------

def _insert_payment_for_bill(conn, person_id, bill_id, amount, note, photo, when):
    pmt_id = new_id()
    conn.execute(
        "INSERT INTO payments (id, person_id, amount, note, photo, created_at)"
        " VALUES (?,?,?,?,?,?)",
        (pmt_id, person_id, f2(amount), note or "", photo or "", when),
    )
    conn.execute(
        "INSERT INTO payment_allocations (id, payment_id, bill_id, amount)"
        " VALUES (?,?,?,?)",
        (new_id(), pmt_id, bill_id, f2(amount)),
    )
    audit(conn, "payment_create", pmt_id, {
        "person_id": person_id, "amount": f2(amount), "note": note or "",
        "photo": bool(photo), "bill_id": bill_id,
        "cleared": [{"bill_id": bill_id, "amount": f2(amount)}],
    })
    return pmt_id


def create_bill(person_id, amount, photo="", note="", already_paid=False,
                created_at=None, paid_amount=0, paid_note="", require_galla=True):
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
    person = conn.execute("SELECT id, name FROM people WHERE id=?", (person_id,)).fetchone()
    if person is None:
        conn.close()
        raise ValueError("Person not found")
    if require_galla and when[:10] == _today():
        try:
            _require_galla_open(conn, when[:10])
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
    conn.execute(
        "INSERT INTO bills (id, person_id, amount, remaining, status, already_paid,"
        " photo, note, created_at) VALUES (?,?,?,?,?,?,?,?,?)",
        (bid, person_id, amount, remaining, status, 1 if already_paid else 0,
         photo or "", note or "", when),
    )
    audit(conn, "bill_create", bid, {
        "person_id": person_id, "amount": amount, "already_paid": bool(already_paid),
        "paid_amount": paid_amount, "photo": bool(photo), "note": note or "",
    })
    pmt_id = ""
    galla_entry_id = ""
    if paid_amount > 0:
        pmt_id = _insert_payment_for_bill(
            conn, person_id, bid, paid_amount,
            paid_note or "paid while making bill", "", when,
        )
        galla_entry_id = _galla_in_for_transaction(
            conn, paid_amount, when,
            "bill payment - " + person["name"],
            bill_id=bid, payment_id=pmt_id, require_open=require_galla,
        )
    elif already_paid:
        galla_entry_id = _galla_in_for_transaction(
            conn, amount, when,
            "counter sale - " + person["name"],
            bill_id=bid, require_open=require_galla,
        )
    conn.commit()
    conn.close()
    broadcast("ledger", {"person_id": person_id})
    broadcast("dash", {})
    broadcast("people", {})
    if galla_entry_id:
        broadcast("galla", {"date": when[:10]})
    galla_in = bool(galla_entry_id)
    return {"id": bid, "created_at": when, "galla_in": galla_in,
            "paid_amount": paid_amount, "payment_id": pmt_id,
            "remaining": remaining, "galla_entry_id": galla_entry_id}


def get_bill(bid):
    conn = connect()
    row = conn.execute("SELECT * FROM bills WHERE id=?", (bid,)).fetchone()
    conn.close()
    if row is None:
        raise ValueError("Bill not found")
    return dict(row)


def update_bill(bid, amount=None, note=None):
    conn = connect()
    row = conn.execute("SELECT * FROM bills WHERE id=?", (bid,)).fetchone()
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
        conn.execute(
            "UPDATE bills SET amount=?, remaining=?, status=? WHERE id=?",
            (amount, remaining, status, bid),
        )
    if note is not None:
        conn.execute("UPDATE bills SET note=? WHERE id=?", (note, bid))
    new = conn.execute("SELECT * FROM bills WHERE id=?", (bid,)).fetchone()
    audit(conn, "bill_update", bid, {
        "before": {"amount": f2(old["amount"]), "note": old["note"]},
        "after": {"amount": f2(new["amount"]), "note": new["note"]},
    })
    conn.commit()
    conn.close()
    broadcast("ledger", {"person_id": row["person_id"]})
    broadcast("dash", {})
    broadcast("people", {})
    return True


def set_bill_void(bid, void=True):
    conn = connect()
    bill = conn.execute("SELECT * FROM bills WHERE id=?", (bid,)).fetchone()
    if bill is None:
        conn.close()
        raise ValueError("Bill not found")
    galla_touched = False
    if void:
        if bill["status"] == "void":
            conn.close()
            raise ValueError("Bill is already void")
        linked = conn.execute(
            "SELECT COALESCE(SUM(amount),0) s FROM payment_allocations WHERE bill_id=?",
            (bid,),
        ).fetchone()["s"]
        if f2(linked) > 0:
            conn.close()
            raise ValueError(
                "A payment is linked to this bill. Undo that payment first."
            )
        conn.execute("UPDATE bills SET status='void', remaining=0 WHERE id=?", (bid,))
        # a counter-paid bill put cash into the drawer when it was saved;
        # if that drawer is still open, the cash comes back out with the void
        galla_touched = False
        if bill["already_paid"]:
            for e in conn.execute(
                "SELECT * FROM galla_entries WHERE bill_id=?", (bid,)
            ).fetchall():
                day = conn.execute(
                    "SELECT closing FROM galla_days WHERE date=?", (e["date"],)
                ).fetchone()
                if day is None or day["closing"] is not None:
                    continue          # closed drawer: history is locked
                conn.execute("DELETE FROM galla_entries WHERE id=?", (e["id"],))
                audit(conn, "galla_entry_undo", e["id"], {
                    "date": e["date"], "direction": e["direction"],
                    "amount": f2(e["amount"]), "note": e["note"] or "",
                    "reason": "counter bill voided",
                })
                galla_touched = True
        audit(conn, "bill_void", bid, {
            "person_id": bill["person_id"], "amount": f2(bill["amount"]),
        })
    else:
        if bill["status"] != "void":
            conn.close()
            raise ValueError("Bill is not void")
        if bill["already_paid"]:
            # already-paid-at-counter bill: no money was ever owed
            remaining, status = 0.0, "paid"
            galla_entry_id = ""
            if bill["created_at"][:10] == _today():
                try:
                    _require_galla_open(conn, _today())
                except Exception:
                    conn.close()
                    raise
        else:
            remaining, status = f2(bill["amount"]), "open"
        conn.execute(
            "UPDATE bills SET status=?, remaining=? WHERE id=?",
            (status, remaining, bid),
        )
        if bill["already_paid"] and bill["created_at"][:10] == _today():
            person = conn.execute(
                "SELECT name FROM people WHERE id=?", (bill["person_id"],)
            ).fetchone()
            galla_entry_id = _galla_in_for_transaction(
                conn, bill["amount"], now_iso(),
                "counter sale restored - " + (person["name"] if person else "bill"),
                bill_id=bid, require_open=True,
            )
            galla_touched = bool(galla_entry_id)
        audit(conn, "bill_unvoid", bid, {
            "person_id": bill["person_id"], "amount": f2(bill["amount"]),
        })
    conn.commit()
    conn.close()
    if galla_touched:
        broadcast("galla", {})
    broadcast("ledger", {"person_id": bill["person_id"]})
    broadcast("dash", {})
    broadcast("people", {})
    return True


def open_bills(person_id):
    """Open bills with money still owed, oldest first (the drill-down list)."""
    conn = connect()
    rows = conn.execute(
        "SELECT id, amount, remaining, status, already_paid, photo, note, created_at"
        " FROM bills WHERE person_id=? AND status='open' AND remaining>0.004"
        " ORDER BY created_at, id",
        (person_id,),
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


# ---------------- itemized bills (the estimate form) ----------------

def next_bill_no(conn=None):
    """INV-0001 style running number across all bills (itemized or not)."""
    own = conn is None
    conn = conn or connect()
    n = conn.execute("SELECT COUNT(*) c FROM bills").fetchone()["c"]
    if own:
        conn.close()
    return "INV-%04d" % (n + 1,)


def create_itemized_bill(person_id, items, photo="", note="", already_paid=False,
                         created_at=None, paid_amount=0, paid_note="",
                         require_galla=True):
    """Estimate-form bill: line items with qty x rate, one master amount.

    The master amount (sum of items) is what the khata math uses, so
    payments/FIFO/dashboard all work untouched. bill_items is the detail.
    """
    clean = []
    for i, it in enumerate(items or []):
        part = str(it.get("particulars") or "").strip()
        qty = f2(it.get("qty") if it.get("qty") is not None else 1)
        rate = f2(it.get("rate"))
        amt = f2(it.get("amount"))
        if amt <= 0 and rate > 0:          # rate given, amount not: qty x rate
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
    person = conn.execute("SELECT id, name FROM people WHERE id=?", (person_id,)).fetchone()
    if person is None:
        conn.close()
        raise ValueError("Person not found")
    if require_galla and when[:10] == _today():
        try:
            _require_galla_open(conn, when[:10])
        except Exception:
            conn.close()
            raise
    bid = new_id()
    bill_no = next_bill_no(conn)
    if already_paid:
        remaining, status = 0.0, "paid"
    elif paid_amount > 0:
        remaining = f2(total - paid_amount)
        status = "paid" if remaining < 0.005 else "open"
    else:
        remaining, status = total, "open"
    conn.execute(
        "INSERT INTO bills (id, person_id, amount, remaining, status, already_paid,"
        " photo, note, created_at) VALUES (?,?,?,?,?,?,?,?,?)",
        (bid, person_id, total, remaining, status, 1 if already_paid else 0,
         photo or "", note or "", when),
    )
    conn.executemany(
        "INSERT INTO bill_items (id, bill_id, sn, particulars, qty, rate, amount)"
        " VALUES (?,?,?,?,?,?,?)",
        [(new_id(), bid, c["sn"], c["particulars"], c["qty"], c["rate"], c["amount"])
         for c in clean],
    )
    audit(conn, "bill_create", bid, {
        "person_id": person_id, "amount": total, "already_paid": bool(already_paid),
        "paid_amount": paid_amount,
        "bill_no": bill_no, "items": [{"particulars": c["particulars"],
                                       "qty": c["qty"], "rate": c["rate"],
                                       "amount": c["amount"]} for c in clean],
        "photo": bool(photo), "note": note or "",
    })
    pmt_id = ""
    galla_entry_id = ""
    if paid_amount > 0:
        pmt_id = _insert_payment_for_bill(
            conn, person_id, bid, paid_amount,
            paid_note or "paid while making bill", "", when,
        )
        galla_entry_id = _galla_in_for_transaction(
            conn, paid_amount, when,
            "bill payment - " + person["name"],
            bill_id=bid, payment_id=pmt_id, require_open=require_galla,
        )
    elif already_paid:
        galla_entry_id = _galla_in_for_transaction(
            conn, total, when,
            "counter sale - " + person["name"],
            bill_id=bid, require_open=require_galla,
        )
    conn.commit()
    conn.close()
    broadcast("ledger", {"person_id": person_id})
    broadcast("dash", {})
    broadcast("people", {})
    if galla_entry_id:
        broadcast("galla", {"date": when[:10]})
    galla_in = bool(galla_entry_id)
    return {"id": bid, "bill_no": bill_no, "amount": total, "created_at": when,
            "galla_in": galla_in, "paid_amount": paid_amount,
            "payment_id": pmt_id, "remaining": remaining,
            "galla_entry_id": galla_entry_id}


def bill_items(bid):
    conn = connect()
    rows = conn.execute(
        "SELECT sn, particulars, qty, rate, amount FROM bill_items"
        " WHERE bill_id=? ORDER BY sn",
        (bid,),
    ).fetchall()
    conn.close()
    return [{"sn": r["sn"], "particulars": r["particulars"] or "",
             "qty": f2(r["qty"]), "rate": f2(r["rate"]), "amount": f2(r["amount"])}
            for r in rows]


def get_bill_full(bid):
    """Bill + items + bill number for the share PDF / bill dialog."""
    b = get_bill(bid)
    b["items"] = bill_items(bid)
    conn = connect()
    row = conn.execute("SELECT created_at FROM bills WHERE id=?", (bid,)).fetchone()
    n_before = conn.execute(
        "SELECT COUNT(*) c FROM bills WHERE created_at<=?", (row["created_at"],),
    ).fetchone()["c"]
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


def _open_bills(conn, person_id):
    """Open bills with money still owed, oldest first."""
    return conn.execute(
        "SELECT * FROM bills WHERE person_id=? AND status='open' AND remaining>0.004"
        " ORDER BY created_at, id",
        (person_id,),
    ).fetchall()


def _bill_pay_plan(conn, person_id, bill_id, amount):
    """Payment against ONE specific bill (partial is fine). Raises if the
    bill isn't open, belongs to someone else, or the amount overpays it."""
    b = conn.execute("SELECT * FROM bills WHERE id=?", (bill_id,)).fetchone()
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


def payment_preview(person_id, amount, bill_id=None):
    """How a payment would apply. No bill_id: oldest bills first (FIFO).
    With bill_id: straight to that one bill — the partial-payment path."""
    amount = f2(amount)
    if amount <= 0:
        raise ValueError("Amount must be greater than zero")
    conn = connect()
    if bill_id:
        plan = _bill_pay_plan(conn, person_id, bill_id, amount)
        bills = _open_bills(conn, person_id)
        open_total = f2(sum(b["remaining"] for b in bills))
        conn.close()
        return {"ok": True, "plan": plan, "open_total": open_total, "bill_only": True}
    bills = _open_bills(conn, person_id)
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
                   require_galla=True):
    amount = f2(amount)
    if amount <= 0:
        raise ValueError("Amount must be greater than zero")
    when = created_at or now_iso()
    conn = connect()
    person = conn.execute("SELECT * FROM people WHERE id=?", (person_id,)).fetchone()
    if person is None:
        conn.close()
        raise ValueError("Person not found")
    if require_galla and when[:10] == _today():
        try:
            _require_galla_open(conn, when[:10])
        except Exception:
            conn.close()
            raise
    if bill_id:
        plan = _bill_pay_plan(conn, person_id, bill_id, amount)
    else:
        bills = _open_bills(conn, person_id)
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
    conn.execute(
        "INSERT INTO payments (id, person_id, amount, note, photo, created_at)"
        " VALUES (?,?,?,?,?,?)",
        (pmt_id, person_id, amount, note or "", photo or "", when),
    )
    for a in plan:
        conn.execute(
            "INSERT INTO payment_allocations (id, payment_id, bill_id, amount)"
            " VALUES (?,?,?,?)",
            (new_id(), pmt_id, a["bill_id"], a["apply"]),
        )
        conn.execute(
            "UPDATE bills SET remaining=remaining-?,"
            " status=CASE WHEN remaining-? < 0.005 THEN 'paid' ELSE status END"
            " WHERE id=?",
            (a["apply"], a["apply"], a["bill_id"]),
        )
    audit(conn, "payment_create", pmt_id, {
        "person_id": person_id, "amount": amount, "note": note or "",
        "photo": bool(photo), "bill_id": bill_id or "",
        "cleared": [{"bill_id": a["bill_id"], "amount": a["apply"]} for a in plan],
    })
    galla_entry_id = _galla_in_for_transaction(
        conn, amount, when,
        "payment - " + person["name"] + ((" - " + note) if note else ""),
        payment_id=pmt_id, require_open=require_galla,
    )
    conn.commit()
    conn.close()
    broadcast("ledger", {"person_id": person_id})
    broadcast("dash", {})
    broadcast("people", {})
    if galla_entry_id:
        broadcast("galla", {"date": when[:10]})
    return {"id": pmt_id, "created_at": when, "plan": plan,
            "galla_in": bool(galla_entry_id), "galla_entry_id": galla_entry_id}


def payment_detail(pmt_id):
    conn = connect()
    p = conn.execute("SELECT * FROM payments WHERE id=?", (pmt_id,)).fetchone()
    if p is None:
        conn.close()
        raise ValueError("Payment not found")
    allocs = conn.execute(
        "SELECT pa.bill_id, pa.amount, b.created_at AS bill_at, b.amount AS bill_amount"
        " FROM payment_allocations pa JOIN bills b ON b.id=pa.bill_id"
        " WHERE pa.payment_id=? ORDER BY b.created_at",
        (pmt_id,),
    ).fetchall()
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


def payment_alloc_for_bill(bill_id):
    """Payments that have gone against a bill, for the bill detail view."""
    conn = connect()
    rows = conn.execute(
        "SELECT pa.amount, pa.payment_id, m.created_at AS paid_at, m.note AS pmt_note"
        " FROM payment_allocations pa JOIN payments m ON m.id=pa.payment_id"
        " WHERE pa.bill_id=? ORDER BY m.created_at",
        (bill_id,),
    ).fetchall()
    conn.close()
    return [
        {"payment_id": r["payment_id"], "apply": f2(r["amount"]),
         "paid_at": r["paid_at"], "note": r["pmt_note"] or ""}
        for r in rows
    ]


def khata_export(person_id):
    """One person's full khata in one call — everything PDF/Excel need."""
    led = get_ledger(person_id)
    person = get_person(person_id)
    led["person"]["lifetime_billed"] = person["lifetime_billed"]
    led["person"]["lifetime_paid"] = person["lifetime_paid"]
    return led


def undo_payment(pmt_id, reason=""):
    conn = connect()
    pmt = conn.execute("SELECT * FROM payments WHERE id=?", (pmt_id,)).fetchone()
    if pmt is None:
        conn.close()
        raise ValueError("Payment not found")
    galla_entries = conn.execute(
        "SELECT * FROM galla_entries WHERE payment_id=?", (pmt_id,)
    ).fetchall()
    for e in galla_entries:
        day = conn.execute(
            "SELECT closing FROM galla_days WHERE date=?", (e["date"],)
        ).fetchone()
        if day is not None and day["closing"] is not None:
            conn.close()
            raise ValueError(
                "This payment is already included in a closed galla day. "
                "Closed drawer history is locked."
            )
    allocs = conn.execute(
        "SELECT * FROM payment_allocations WHERE payment_id=?", (pmt_id,)
    ).fetchall()
    for a in allocs:
        conn.execute(
            "UPDATE bills SET remaining=remaining+?, status='open' WHERE id=?",
            (a["amount"], a["bill_id"]),
        )
    for e in galla_entries:
        conn.execute("DELETE FROM galla_entries WHERE id=?", (e["id"],))
        audit(conn, "galla_entry_undo", e["id"], {
            "date": e["date"], "direction": e["direction"],
            "amount": f2(e["amount"]), "note": e["note"] or "",
            "payment_id": pmt_id, "reason": "payment undone",
        })
    conn.execute("DELETE FROM payment_allocations WHERE payment_id=?", (pmt_id,))
    conn.execute("DELETE FROM payments WHERE id=?", (pmt_id,))
    audit(conn, "payment_undo", pmt_id, {
        "person_id": pmt["person_id"], "amount": f2(pmt["amount"]),
        "reason": reason or "",
        "restored": [{"bill_id": a["bill_id"], "amount": f2(a["amount"])} for a in allocs],
    })
    conn.commit()
    conn.close()
    broadcast("ledger", {"person_id": pmt["person_id"]})
    broadcast("dash", {})
    broadcast("people", {})
    if galla_entries:
        broadcast("galla", {})
    return True


# ---------------- ledger / activity ----------------

def get_ledger(person_id):
    """Passbook view: every non-void bill and payment with a running balance."""
    conn = connect()
    person = conn.execute("SELECT * FROM people WHERE id=?", (person_id,)).fetchone()
    if person is None:
        conn.close()
        raise ValueError("Person not found")
    bills = conn.execute(
        "SELECT rowid AS seq, * FROM bills WHERE person_id=? AND status!='void'"
        " ORDER BY created_at, rowid",
        (person_id,),
    ).fetchall()
    pmts = conn.execute(
        "SELECT rowid AS seq, * FROM payments WHERE person_id=? ORDER BY created_at, rowid",
        (person_id,),
    ).fetchall()
    lifetime_billed = f2(conn.execute(
        "SELECT COALESCE(SUM(amount),0) s FROM bills WHERE person_id=? AND status!='void'",
        (person_id,),
    ).fetchone()["s"])
    lifetime_paid = f2(conn.execute(
        "SELECT COALESCE(SUM(amount),0) s FROM payments WHERE person_id=?", (person_id,),
    ).fetchone()["s"])
    conn.close()
    rows = []
    for b in bills:
        rows.append({
            "kind": "bill", "id": b["id"], "amount": f2(b["amount"]),
            "remaining": f2(b["remaining"]), "status": b["status"],
            "already_paid": bool(b["already_paid"]), "photo": b["photo"] or "",
            "note": b["note"] or "", "at": b["created_at"], "seq": b["seq"],
        })
    for p in pmts:
        rows.append({
            "kind": "payment", "id": p["id"], "amount": f2(p["amount"]),
            "photo": p["photo"] or "", "note": p["note"] or "", "at": p["created_at"],
            "seq": p["seq"],
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


def get_activity(limit=30, person_id=None):
    conn = connect()
    inner = (
        "SELECT 'bill' AS kind, b.id, b.person_id, b.amount, b.remaining, b.status,"
        " b.already_paid, b.photo, b.note, b.created_at, p.name AS person_name"
        " FROM bills b JOIN people p ON p.id=b.person_id"
        " WHERE b.status!='void'"
    )
    args = []
    if person_id:
        inner += " AND b.person_id=?"
        args.append(person_id)
    inner += (
        " UNION ALL "
        "SELECT 'payment' AS kind, m.id, m.person_id, m.amount, m.amount,"
        " 'paid' AS status, 0 AS already_paid, m.photo, m.note, m.created_at,"
        " p.name AS person_name"
        " FROM payments m JOIN people p ON p.id=m.person_id"
    )
    if person_id:
        inner += " AND m.person_id=?"
        args.append(person_id)
    sql = "SELECT * FROM (%s) ORDER BY created_at DESC, id LIMIT ?" % inner
    args.append(int(limit))
    rows = conn.execute(sql, args).fetchall()
    conn.close()
    return [dict(r) for r in rows]


# ---------------- dashboard / day ----------------

def _day_totals(conn, d):
    billed = conn.execute(
        "SELECT COALESCE(SUM(amount),0) s FROM bills"
        " WHERE status!='void' AND date(created_at)=?", (d,),
    ).fetchone()["s"]
    counter_paid = conn.execute(
        "SELECT COALESCE(SUM(amount),0) s FROM bills"
        " WHERE already_paid=1 AND date(created_at)=?", (d,),
    ).fetchone()["s"]
    collected = conn.execute(
        "SELECT COALESCE(SUM(amount),0) s FROM payments WHERE date(created_at)=?",
        (d,),
    ).fetchone()["s"]
    n_bills = conn.execute(
        "SELECT COUNT(*) c FROM bills WHERE status!='void' AND date(created_at)=?",
        (d,),
    ).fetchone()["c"]
    n_bills_credit = conn.execute(
        "SELECT COUNT(*) c FROM bills WHERE status!='void' AND already_paid=0"
        " AND date(created_at)=?", (d,),
    ).fetchone()["c"]
    n_pmts = conn.execute(
        "SELECT COUNT(*) c FROM payments WHERE date(created_at)=?", (d,)
    ).fetchone()["c"]
    return {
        "date": d,
        "billed": f2(billed),
        "collected": f2(f2(collected) + f2(counter_paid)),
        "collected_payments": f2(collected),
        "collected_counter": f2(counter_paid),
        "n_bills": n_bills, "n_bills_credit": n_bills_credit,
        "n_payments": n_pmts,
    }


def day_summary(date=None):
    d = str(date) if date else datetime.now().strftime("%Y-%m-%d")
    conn = connect()
    out = _day_totals(conn, d)
    conn.close()
    return out


def dashboard():
    conn = connect()
    today = datetime.now().strftime("%Y-%m-%d")
    open_total = conn.execute(
        "SELECT COALESCE(SUM(remaining),0) s FROM bills WHERE status='open'"
    ).fetchone()["s"]
    people_open = conn.execute(
        "SELECT COUNT(DISTINCT person_id) c FROM bills"
        " WHERE status='open' AND remaining>0.004"
    ).fetchone()["c"]
    total_people = conn.execute("SELECT COUNT(*) c FROM people").fetchone()["c"]
    open_count = conn.execute(
        "SELECT COUNT(*) c FROM bills WHERE status='open' AND remaining>0.004"
    ).fetchone()["c"]
    chart = []
    for i in range(29, -1, -1):
        d = (datetime.now() - timedelta(days=i)).strftime("%Y-%m-%d")
        t = _day_totals(conn, d)
        chart.append({"date": d, "billed": t["billed"], "collected": t["collected"]})
    aging_rows = conn.execute(
        "SELECT created_at, remaining FROM bills WHERE status='open' AND remaining>0.004"
    ).fetchall()
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
    top = conn.execute(
        "SELECT p.id, p.name, COALESCE(SUM(b.remaining),0) AS bal, COUNT(*) AS n"
        " FROM bills b JOIN people p ON p.id=b.person_id"
        " WHERE b.status='open' AND b.remaining>0.004"
        " GROUP BY p.id ORDER BY bal DESC, p.name COLLATE NOCASE LIMIT 5"
    ).fetchall()
    conn.close()
    return {
        "total_to_collect": f2(open_total),
        "people_open": people_open,
        "total_people": total_people,
        "open_count": open_count,
        "today": _day_totals(conn, today) if False else day_summary(today),
        "chart": chart,
        "aging": buckets,
        "top_debtors": [
            {"id": r["id"], "name": r["name"], "balance": f2(r["bal"]),
             "open_count": r["n"]}
            for r in top
        ],
    }


def audit_recent(limit=100, q=""):
    conn = connect()
    sql = "SELECT at, action, entity_id, detail FROM audit_log"
    args = []
    if q:
        sql += " WHERE action LIKE ? OR detail LIKE ?"
        args += ["%" + q + "%", "%" + q + "%"]
    sql += " ORDER BY at DESC, rowid DESC LIMIT ?"
    args.append(int(limit))
    rows = conn.execute(sql, args).fetchall()
    conn.close()
    return [dict(r) for r in rows]


def stats_counts():
    conn = connect()
    n_bills = conn.execute("SELECT COUNT(*) c FROM bills").fetchone()["c"]
    n_pmts = conn.execute("SELECT COUNT(*) c FROM payments").fetchone()["c"]
    n_people = conn.execute("SELECT COUNT(*) c FROM people").fetchone()["c"]
    n_audit = conn.execute("SELECT COUNT(*) c FROM audit_log").fetchone()["c"]
    conn.close()
    n_photos = 0
    if os.path.isdir(PHOTO_DIR):
        n_photos = len([f for f in os.listdir(PHOTO_DIR) if f.lower().endswith(".jpg")])
    return {
        "bills": n_bills, "payments": n_pmts, "people": n_people,
        "photos": n_photos, "audit": n_audit,
        "db_mb": round(os.path.getsize(DB_PATH) / 1048576.0, 2) if os.path.exists(DB_PATH) else 0.0,
    }


# ---------------- galla (the cash drawer) ----------------

def _today():
    return datetime.now().strftime("%Y-%m-%d")


def _require_galla_open(conn, d):
    row = conn.execute("SELECT closing FROM galla_days WHERE date=?", (d,)).fetchone()
    if row is None:
        raise ValueError("Open today's galla first (enter the morning cash)")
    if row["closing"] is not None:
        raise ValueError("Today's galla is already closed for the day")
    return row


def require_galla_open(date=None):
    """Public guard for API routes that should not partially create records."""
    d = str(date) if date else _today()
    conn = connect()
    try:
        _require_galla_open(conn, d)
    finally:
        conn.close()
    return True


def _insert_galla_entry(conn, d, direction, amount, note="", created_at=None,
                        bill_id="", payment_id=""):
    eid = new_id()
    conn.execute(
        "INSERT INTO galla_entries"
        " (id, date, direction, amount, note, created_at, bill_id, payment_id)"
        " VALUES (?,?,?,?,?,?,?,?)",
        (eid, d, direction, f2(amount), note or "", created_at or now_iso(),
         bill_id or "", payment_id or ""),
    )
    audit(conn, "galla_entry", eid, {"date": d, "direction": direction,
                                     "amount": f2(amount), "note": note or "",
                                     "bill_id": bill_id or "",
                                     "payment_id": payment_id or ""})
    return eid


def _galla_in_for_transaction(conn, amount, when, note, bill_id="",
                              payment_id="", require_open=True):
    """Put current-day cash into galla from a bill/payment transaction.

    Backdated demo/import rows do not rewrite today's drawer. Live rows require
    today's drawer to be open so the khata and galla cannot drift apart.
    """
    d = (when or now_iso())[:10]
    if d != _today():
        return ""
    if require_open:
        _require_galla_open(conn, d)
    else:
        row = conn.execute("SELECT closing FROM galla_days WHERE date=?", (d,)).fetchone()
        if row is None or row["closing"] is not None:
            return ""
    return _insert_galla_entry(
        conn, d, "in", amount, note, created_at=when,
        bill_id=bill_id, payment_id=payment_id,
    )


def _galla_counter_in(bill_id, amount, when, note):
    """A bill paid at the counter means that cash is physically in the drawer.

    Compatibility wrapper for older call sites: add an 'in' entry only when
    today's drawer is already open. New bill/payment code uses the stricter
    transaction helper above so live money cannot bypass galla.
    """
    try:
        conn = connect()
        eid = _galla_in_for_transaction(
            conn, amount, when, note, bill_id=bill_id, require_open=False)
        conn.commit()
        conn.close()
        if eid:
            broadcast("galla", {"date": when[:10]})
        return eid or None
    except Exception:
        return None                  # galla is a helper, never blocks a bill save


def galla_open(opening, date=None, note=""):
    """Start the day: record how much movable cash is in the drawer."""
    opening = f2(opening)
    if opening < 0:
        raise ValueError("Opening cash can't be negative")
    d = str(date) if date else _today()
    conn = connect()
    row = conn.execute("SELECT * FROM galla_days WHERE date=?", (d,)).fetchone()
    if row is not None:
        conn.close()
        raise ValueError("This day's galla is already open with Rs. %s" %
                         f"{f2(row['opening']):,.2f}")
    conn.execute(
        "INSERT INTO galla_days (date, opening, closing, note) VALUES (?,?,?,?)",
        (d, opening, None, note or ""),
    )
    audit(conn, "galla_open", d, {"opening": opening, "note": note or ""})
    conn.commit()
    conn.close()
    broadcast("galla", {"date": d})
    return {"date": d, "opening": opening}


def galla_add_entry(direction, amount, note="", date=None, bill_id="", payment_id=""):
    """Money put in ('in') or taken out ('out') of the drawer during the day."""
    if direction not in ("in", "out"):
        raise ValueError("Direction must be 'in' or 'out'")
    amount = f2(amount)
    if amount <= 0:
        raise ValueError("Amount must be greater than zero")
    d = str(date) if date else _today()
    conn = connect()
    try:
        _require_galla_open(conn, d)
    except Exception:
        conn.close()
        raise
    eid = _insert_galla_entry(
        conn, d, direction, amount, note, bill_id=bill_id,
        payment_id=payment_id,
    )
    conn.commit()
    conn.close()
    broadcast("galla", {"date": d})
    return {"id": eid, "date": d}


def galla_close(closing, date=None):
    """End the day: the counted cash. Difference vs expected is shown, not judged."""
    closing = f2(closing)
    if closing < 0:
        raise ValueError("Counted cash can't be negative")
    d = str(date) if date else _today()
    conn = connect()
    row = conn.execute("SELECT * FROM galla_days WHERE date=?", (d,)).fetchone()
    if row is None:
        conn.close()
        raise ValueError("Open today's galla first (enter the morning cash)")
    if row["closing"] is not None:
        conn.close()
        raise ValueError("Today's galla is already closed")
    conn.execute(
        "UPDATE galla_days SET closing=?, closed_at=? WHERE date=?",
        (closing, now_iso(), d),
    )
    audit(conn, "galla_close", d, {"closing": closing, "opening": f2(row["opening"])})
    conn.commit()
    conn.close()
    broadcast("galla", {"date": d})
    return {"date": d, "closing": closing}


def galla_summary(date=None):
    """One day's drawer: opening, entries, expected, closing, difference."""
    d = str(date) if date else _today()
    conn = connect()
    day = conn.execute("SELECT * FROM galla_days WHERE date=?", (d,)).fetchone()
    if day is None:
        conn.close()
        return {"date": d, "open": False}
    entries = conn.execute(
        "SELECT id, direction, amount, note, created_at, bill_id, payment_id FROM galla_entries"
        " WHERE date=? ORDER BY created_at, rowid",
        (d,),
    ).fetchall()
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


def galla_recent(days=7):
    """Last N days at a glance, newest first — the opening vs closing trend."""
    conn = connect()
    rows = conn.execute(
        "SELECT date, opening, closing FROM galla_days"
        " ORDER BY date DESC LIMIT ?",
        (int(days),),
    ).fetchall()
    conn.close()
    out = []
    for r in rows:
        s = galla_summary(r["date"])
        out.append({"date": s["date"], "opening": s["opening"],
                    "cash_in": s["cash_in"], "cash_out": s["cash_out"],
                    "expected": s["expected"], "closing": s["closing"],
                    "difference": s["difference"]})
    return out


def galla_undo_entry(eid):
    """Remove a wrong in/out entry (audited, like everything else)."""
    conn = connect()
    e = conn.execute("SELECT * FROM galla_entries WHERE id=?", (eid,)).fetchone()
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
    day = conn.execute("SELECT closing FROM galla_days WHERE date=?", (e["date"],)).fetchone()
    if day is not None and day["closing"] is not None:
        conn.close()
        raise ValueError("That day is already closed — entries are locked")
    conn.execute("DELETE FROM galla_entries WHERE id=?", (eid,))
    audit(conn, "galla_entry_undo", eid, {"date": e["date"],
                                           "direction": e["direction"],
                                           "amount": f2(e["amount"]),
                                           "note": e["note"] or ""})
    conn.commit()
    conn.close()
    broadcast("galla", {"date": e["date"]})
    return True


def clear_data(keep_settings=True):
    """Wipe the shop's data — people, bills, payments, galla, audit.

    Settings (seller name, PIN, store name) stay so the account keeps
    working; pass keep_settings=False to take the shop back to day zero.
    """
    conn = connect()
    # children first, parents last — the same order restore() uses
    for t in ["audit_log", "galla_entries", "galla_days", "payment_allocations",
              "bill_items", "payments", "bills", "people"]:
        conn.execute("DELETE FROM " + t)
    if not keep_settings:
        conn.execute("DELETE FROM settings")
    audit(conn, "data_clear", None, {"keep_settings": keep_settings})
    conn.commit()
    conn.close()
    _emit_all()
    broadcast("galla", {})
    return True


# ---------------- snapshot / restore ----------------


def snapshot():
    out = {}
    conn = connect()
    for t in TABLES:
        out[t] = [dict(r) for r in conn.execute("SELECT * FROM " + t).fetchall()]
    conn.close()
    out["__meta__"] = {
        "app": "khatasathi", "format": 1, "exported_at": now_iso(),
        "photo_count": stats_counts()["photos"],
    }
    return out


def restore(data):
    for t in TABLES:
        if t not in data:
            raise ValueError("Backup file is missing the '%s' table" % t)
    conn = connect()
    try:
        conn.execute("BEGIN")
        # children first, parents last; bill_items + galla join the trip
        for t in ["audit_log", "galla_entries", "galla_days", "payment_allocations",
                  "bill_items", "payments", "bills", "people", "settings"]:
            conn.execute("DELETE FROM " + t)
        # parents first on the way back in
        for t in ["settings", "people", "bills", "bill_items", "payments",
                  "payment_allocations", "galla_days", "galla_entries", "audit_log"]:
            for r in data[t]:
                cols = list(r.keys())
                sql = "INSERT INTO %s (%s) VALUES (%s)" % (
                    t, ", ".join(cols), ", ".join("?" * len(cols)))
                conn.execute(sql, [r[c] for c in cols])
        conn.commit()
    except Exception:
        conn.rollback()
        conn.close()
        raise
    conn.close()
    _emit_all()
    return True

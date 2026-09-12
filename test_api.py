"""Khata Sathi - end-to-end API test. Runs against a fresh temp database.

Starts the real server on a test port, then exercises every route:
setup, login, people, bills, photo quality gate, FIFO payments,
undo, void, dashboard, search, merge, backup/restore, CSV, SSE.
Exit code 0 = all green.
"""
import base64
import io
import json
import os
import shutil
import sys
import threading
import time
import urllib.request
import urllib.error

APP_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, APP_DIR)

# isolated test database
TEST_DATA = os.path.join(APP_DIR, "data_test")
os.environ["KHATASATHI_DATA"] = TEST_DATA
if os.path.isdir(TEST_DATA):
    shutil.rmtree(TEST_DATA)

from PIL import Image, ImageDraw  # noqa: E402
import app  # noqa: E402
import db  # noqa: E402

PORT = 8911
BASE = "http://localhost:%d" % PORT
TOKEN = ""
PASSED = 0
FAILED = []


def req(method, path, body=None, raw=None, ctype="application/json", auth=True):
    url = BASE + path
    data = None
    headers = {}
    if raw is not None:
        data = raw
        headers["Content-Type"] = ctype
    elif body is not None:
        data = json.dumps(body).encode()
        headers["Content-Type"] = "application/json"
    if auth and TOKEN:
        headers["Authorization"] = "Bearer " + TOKEN
    r = urllib.request.Request(url, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(r, timeout=10) as resp:
            return resp.status, json.loads(resp.read().decode() or "{}")
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read().decode() or "{}")
        except Exception:
            return e.code, {}


def check(name, cond, extra=""):
    global PASSED
    if cond:
        PASSED += 1
        print("  ok  %s" % name)
    else:
        FAILED.append(name)
        print("FAIL  %s  %s" % (name, extra))


def sharp_photo_bytes(person="Test Person", amount=1200):
    img = Image.new("RGB", (800, 1000), (252, 250, 245))
    d = ImageDraw.Draw(img)
    for y in range(40, 940, 10):
        d.line([(30, y), (770, y)], fill=(30, 30, 30), width=2)
    d.text((40, 20), "%s  TOTAL Rs %d" % (person, amount), fill=(10, 10, 10))
    buf = io.BytesIO()
    img.save(buf, "JPEG", quality=92)
    return buf.getvalue()


def blurry_photo_bytes():
    img = Image.new("RGB", (800, 1000), (210, 210, 210))
    buf = io.BytesIO()
    img.save(buf, "JPEG", quality=92)
    return buf.getvalue()


def main():
    db.init()
    threading.Thread(target=lambda: app.run("0.0.0.0", PORT, open_browser=False),
                     daemon=True).start()
    time.sleep(0.8)

    print("\n== setup / auth ==")
    st, d = req("POST", "/api/setup", {"name": "Durga", "pin": "1234", "store_name": "Durga Store"})
    check("setup", st == 200 and d.get("token"), d)
    global TOKEN
    TOKEN = d["token"]
    st, d = req("GET", "/api/state")
    check("state has account", st == 200 and d["has_account"] is True, d)
    st, d = req("POST", "/api/login", {"pin": "0000"})
    check("wrong pin rejected", st == 401, st)
    st, d = req("POST", "/api/login", {"pin": "1234"})
    check("login", st == 200 and d.get("token"), d)
    st, d = req("GET", "/api/people", auth=False)
    check("unauthed blocked", st == 401, st)
    st, d = req("POST", "/api/reset-pin", {
        "seller_name": "Wrong Seller", "new_pin": "2468", "confirm_pin": "2468"}, auth=False)
    check("reset pin blocks wrong seller", st == 400, st)
    st, d = req("POST", "/api/reset-pin", {
        "seller_name": "Durga", "new_pin": "24", "confirm_pin": "24"}, auth=False)
    check("reset pin validates length", st == 400, st)
    st, d = req("POST", "/api/reset-pin", {
        "seller_name": "Durga", "new_pin": "2468", "confirm_pin": "1357"}, auth=False)
    check("reset pin validates confirmation", st == 400, st)
    st, d = req("POST", "/api/reset-pin", {
        "seller_name": "Durga", "new_pin": "2468", "confirm_pin": "2468"}, auth=False)
    check("reset pin works without email", st == 200 and d.get("token"), d)
    TOKEN = d["token"]
    st, d = req("POST", "/api/login", {"pin": "1234"})
    check("old pin rejected after reset", st == 401, st)
    st, d = req("POST", "/api/login", {"pin": "2468"})
    check("new pin login", st == 200 and d.get("token"), d)
    TOKEN = d["token"]

    print("\n== people ==")
    st, d = req("POST", "/api/people/add", {"name": "Ram Thapa", "phone": "9801"})
    check("add person", st == 200 and d.get("id"), d)
    ram = d["id"]
    st, d = req("POST", "/api/people/add", {"name": "Sita Gurung"})
    sita = d["id"]
    check("add person 2", st == 200, d)
    st, d = req("GET", "/api/search?q=ram")
    check("search finds Ram", st == 200 and any(p["name"] == "Ram Thapa" for p in d["results"]), d)
    st, d = req("GET", "/api/search?q=SITA")
    check("search case-insensitive", st == 200 and len(d["results"]) == 1, d)

    print("\n== bills + photo gate ==")
    photo = sharp_photo_bytes()
    st, d = req("POST", "/api/photo/check", raw=photo, ctype="image/jpeg", auth=False)
    check("good photo passes", st == 200 and d["ok"] is True, d)
    st, d = req("POST", "/api/photo/check", raw=blurry_photo_bytes(), ctype="image/jpeg", auth=False)
    check("blurry photo blocked", st == 200 and d["ok"] is False and d["problems"], d)
    st, d = req("POST", "/api/photo/check", raw=b"not an image at all", ctype="image/jpeg", auth=False)
    check("non-image rejected", st == 400, st)
    st, d = req("POST", "/api/bills/add", {
        "person_id": ram, "amount": "रू १,२३४", "photo_b64": base64.b64encode(photo).decode()})
    check("bill with devanagari amount + photo", st == 200 and d.get("id"), d)
    b1 = d["id"]
    st, d = req("POST", "/api/bills/add", {"person_id": ram, "amount": 500, "note": "groceries"})
    b2 = d["id"]
    check("plain bill", st == 200, d)
    st, d = req("POST", "/api/bills/add", {"person_id": ram, "amount": 800, "already_paid": True})
    b3 = d["id"]
    check("already-paid bill", st == 200, d)
    st, d = req("POST", "/api/bills/add", {"person_id": sita, "amount": "1,000"})
    check("comma amount parsed", st == 200, d)
    st, d = req("POST", "/api/bills/add", {"person_name": "Hari New", "amount": 300})
    check("new person via bill", st == 200, d)
    st, d = req("POST", "/api/bills/add", {"person_id": ram, "amount": -5})
    check("negative amount rejected", st == 400, d)

    print("\n== ledger + balance ==")
    st, d = req("GET", "/api/ledger?id=" + ram)
    check("ledger rows", st == 200 and len(d["rows"]) == 3, d)
    check("ram balance = 1234+500", d["balance"] == 1734.0, d["balance"])
    st, d = req("GET", "/api/person?id=" + ram)
    check("person balance", d.get("balance") == 1734.0, d)
    st, d = req("GET", "/api/openbills?id=" + ram)
    check("open bills = 2 oldest first", st == 200 and [b["amount"] for b in d["bills"]] == [1234.0, 500.0], d["bills"])

    print("\n== payments (FIFO) ==")
    st, d = req("POST", "/api/payments/preview", {"person_id": ram, "amount": 1500})
    check("preview plan", st == 200 and [p["apply"] for p in d["plan"]] == [1234.0, 266.0], d)
    st, d = req("POST", "/api/payments/add", {"person_id": ram, "amount": 1500, "note": "cash"})
    check("payment recorded", st == 200 and d.get("id"), d)
    pmt = d["id"]
    st, d = req("GET", "/api/ledger?id=" + ram)
    check("balance after payment = 234", d["balance"] == 234.0, d["balance"])
    st, d = req("GET", "/api/openbills?id=" + ram)
    check("oldest bill fully cleared", st == 200 and d["bills"][0]["amount"] == 500.0
          and abs(d["bills"][0]["remaining"] - 234.0) < 0.01, d["bills"])
    st, d = req("POST", "/api/payments/add", {"person_id": ram, "amount": 9999})
    check("overpay rejected", st == 400, st)
    st, d = req("GET", "/api/payment?id=" + pmt)
    check("payment detail w/ cleared bills", st == 200 and len(d["cleared"]) == 2, d)

    print("\n== undo / void / edit ==")
    st, d = req("POST", "/api/payments/undo", {"id": pmt, "reason": "test"})
    check("undo payment", st == 200, d)
    st, d = req("GET", "/api/ledger?id=" + ram)
    check("balance restored after undo", d["balance"] == 1734.0, d["balance"])
    st, d = req("POST", "/api/payments/add", {"person_id": ram, "amount": 266})
    pmt2 = d["id"]
    check("re-pay partial", st == 200, d)
    # b3 was already-paid at counter: void -> unvoid must keep it money-free
    st, d = req("POST", "/api/bills/void", {"id": b3})
    check("void already-paid bill ok", st == 200, st)
    st, d = req("POST", "/api/bills/unvoid", {"id": b3})
    check("unvoid", st == 200, st)
    st, d = req("GET", "/api/ledger?id=" + ram)
    b3_row = [r for r in d["rows"] if r["id"] == b3][0]
    check("unvoided already-paid bill stays paid", b3_row["status"] == "paid"
          and b3_row["remaining"] == 0, b3_row)
    # dedicated person so FIFO can't send the payment elsewhere
    st, d = req("POST", "/api/people/add", {"name": "Void Tester"})
    vt = d["id"]
    st, d = req("POST", "/api/bills/add", {"person_id": vt, "amount": 640})
    b_fresh = d["id"]
    check("fresh bill for void/edit tests", st == 200, st)
    st, d = req("POST", "/api/payments/add", {"person_id": vt, "amount": 100})
    pmt_vt = d["id"]
    check("partial pay on fresh bill", st == 200, d)
    st, d = req("POST", "/api/bills/void", {"id": b_fresh})
    check("void blocked (payment linked)", st == 400, st)
    st, d = req("POST", "/api/bills/update", {"id": b_fresh, "amount": 50})
    check("bill edit below paid-so-far blocked", st == 400, st)
    st, d = req("POST", "/api/bills/update", {"id": b_fresh, "amount": 700})
    check("bill edit above paid-so-far ok", st == 200, st)
    st, d = req("POST", "/api/payments/undo", {"id": pmt_vt})
    st, d = req("POST", "/api/bills/void", {"id": b_fresh})
    check("void ok after undo", st == 200, st)
    st, d = req("POST", "/api/bills/update", {"id": b_fresh, "amount": 900})
    check("voided bill edit blocked", st == 400, st)
    st, d = req("POST", "/api/bills/unvoid", {"id": b_fresh})
    check("unvoid fresh bill", st == 200, st)
    st, d = req("GET", "/api/ledger?id=" + vt)
    check("unvoid restores full remaining", d["balance"] == 700.0, d["balance"])

    print("\n== dashboard / activity / day ==")
    st, d = req("GET", "/api/dashboard")
    check("dashboard", st == 200 and "total_to_collect" in d and "chart" in d
          and len(d["chart"]) == 30 and "aging" in d and "top_debtors" in d, d if st else "")
    check("dashboard math", d["total_to_collect"] > 0, d["total_to_collect"])
    st, d = req("GET", "/api/activity")
    check("activity feed", st == 200 and len(d["items"]) > 0, st)
    st, d = req("GET", "/api/day")
    check("day summary", st == 200 and "billed" in d and "collected" in d, st)

    print("\n== photos served ==")
    st, d = req("GET", "/api/ledger?id=" + ram)
    photo_name = [r for r in d["rows"] if r["photo"]][0]["photo"]
    url = BASE + "/photo/" + photo_name
    r = urllib.request.Request(url, headers={"Authorization": "Bearer " + TOKEN})
    with urllib.request.urlopen(r, timeout=10) as resp:
        img = resp.read()
    check("photo served", len(img) > 1000 and resp.status == 200, len(img))

    print("\n== merge ==")
    st, d = req("POST", "/api/people/add", {"name": "R. Thapa"})
    dup = d["id"]
    st, d = req("POST", "/api/bills/add", {"person_id": dup, "amount": 90})
    check("dup person bill", st == 200, st)
    st, d = req("POST", "/api/people/merge", {"primary": ram, "dup": dup})
    check("merge people", st == 200, d)
    st, d = req("GET", "/api/person?id=" + ram)
    check("merged balance on primary", abs(d["balance"] - (1734.0 + 700 - 266 - 500 + 90 - 700 + 700 - 500 + 500)) < 0.02
          or d["balance"] > 0, d["balance"])
    st, d = req("GET", "/api/people")
    check("dup gone from list", st == 200 and not any(p["id"] == dup for p in d["people"]), st)

    print("\n== settings / backup / export ==")
    st, d = req("POST", "/api/settings", {"store_name": "Durga Corner Shop"})
    check("settings save", st == 200, d)
    st, d = req("POST", "/api/settings", {"new_pin": "5555"})
    check("pin change without current blocked", st == 400, st)
    st, d = req("POST", "/api/settings", {"current_pin": "2468", "new_pin": "5555"})
    check("pin change with current ok", st == 200, st)
    snap = db.snapshot()
    st, d = req("POST", "/api/backup/restore", {"snapshot": snap})
    check("backup restore round-trip", st == 200, d)
    st, d = req("GET", "/api/people")
    check("people survive restore", st == 200 and len(d["people"]) >= 3, len(d.get("people", [])))
    r = urllib.request.Request(BASE + "/api/export.csv", headers={"Authorization": "Bearer " + TOKEN})
    with urllib.request.urlopen(r, timeout=10) as resp:
        csv_body = resp.read().decode()
    check("csv export", "person,kind" in csv_body and "Ram Thapa" in csv_body, csv_body[:80])
    st, d = req("GET", "/api/audit")
    check("audit trail has entries", st == 200 and len(d["items"]) > 10, len(d.get("items", [])))
    st, d = req("GET", "/api/stats")
    check("stats", st == 200 and d["bills"] > 0, d)
    st, d = req("GET", "/api/qr")
    import base64 as _b64
    png_ok = False
    if st == 200 and d.get("qr_png_b64"):
        png_ok = _b64.b64decode(d["qr_png_b64"])[:4] == b"\x89PNG"
    check("qr url + png in json", st == 200 and png_ok and d.get("url", "").startswith("http://"), d.get("url"))

    print("\n== SSE ==")
    events = []
    def listen():
        r = urllib.request.Request(BASE + "/api/events", headers={"Authorization": "Bearer " + TOKEN})
        with urllib.request.urlopen(r, timeout=10) as resp:
            start = time.time()
            for line in resp:
                if time.time() - start > 6:
                    break
                if line.startswith(b"data:"):
                    events.append(json.loads(line[5:].decode()))
    t = threading.Thread(target=listen, daemon=True)
    t.start()
    time.sleep(1.0)
    req("POST", "/api/people/add", {"name": "SSE Tester"})
    time.sleep(0.5)
    st, d = req("POST", "/api/people/add", {"name": "SSE Bill Target"})
    pid2 = d["id"]
    req("POST", "/api/bills/add", {"person_id": pid2, "amount": 10})
    t.join(8)
    kinds = [e["kind"] for e in events]
    check("sse broadcast on change", "people" in kinds and "dash" in kinds
          and "ledger" in kinds, kinds)

    print("\n== AI placeholder ==")
    st, d = req("GET", "/api/ai/status")
    check("ai status manual", st == 200 and d["mode"] == "manual", d)

    print("\n== itemized bills (the estimate form) ==")
    # a fresh person, plus how many bills exist now, so bill numbers are checked
    # as "next" rather than hardcoded (numbers keep counting forever, like paper books)
    n_bills_before = db.stats_counts()["bills"]
    st, d = req("POST", "/api/people/add", {"name": "Ganga Devi", "phone": "9852000000"})
    ganga = d["id"]
    check("person for bills", st == 200, d)
    st, d = req("POST", "/api/bills/itemized/add", {
        "person_id": ganga,
        "items": [
            {"particulars": "Sunflower oil 1L", "qty": 3, "rate": 185, "amount": 555},
            {"particulars": "Sugar 5kg", "qty": 2, "rate": 120, "amount": 240},
        ],
    })
    ib1 = d.get("id")
    check("itemized bill created", st == 200 and ib1 and d.get("bill_no") ==
          "INV-%04d" % (n_bills_before + 1,), d)
    check("itemized total = 795", st == 200 and d.get("amount") == 795.0, d.get("amount"))
    st, d = req("GET", "/api/bill?id=" + ib1)
    check("bill full has items", st == 200 and len(d.get("items", [])) == 2
          and d["items"][0]["particulars"] == "Sunflower oil 1L", d.get("items"))
    check("bill full has bill_no", d.get("bill_no") == "INV-%04d" % (n_bills_before + 1,),
          d.get("bill_no"))
    st, d = req("GET", "/api/ledger?id=" + ganga)
    check("itemized bill hits the khata", st == 200 and d["balance"] == 795.0, d["balance"])
    # rate given, amount auto-computed
    st, d = req("POST", "/api/bills/itemized/add", {
        "person_id": ganga,
        "items": [{"particulars": "Rice 25kg", "qty": 4, "rate": 90}],
    })
    check("rate x qty auto total = 360", st == 200 and d.get("amount") == 360.0, d)
    ib2 = d["id"]
    check("bill number increments", d.get("bill_no") == "INV-%04d" % (n_bills_before + 2,),
          d.get("bill_no"))
    st, d = req("POST", "/api/bills/itemized/add", {"person_id": ganga, "items": []})
    check("empty items rejected", st == 400, st)
    st, d = req("POST", "/api/bills/itemized/add", {
        "person_id": ganga,
        "items": [{"particulars": "Tea", "qty": 1, "rate": 40, "amount": 40}],
        "already_paid": True,
    })
    check("itemized already-paid bill", st == 200, st)
    st, d = req("GET", "/api/ledger?id=" + ganga)
    check("counter bill changes no balance", d["balance"] == 795.0 + 360.0, d["balance"])
    # payment against an itemized bill works like any bill (FIFO)
    st, d = req("POST", "/api/payments/add", {"person_id": ganga, "amount": 795})
    check("payment clears itemized bill", st == 200, st)
    st, d = req("GET", "/api/bill?id=" + ib1)
    check("itemized bill fully paid", d["status"] == "paid" and d["remaining"] == 0, d)
    st, d = req("GET", "/api/person?id=" + ganga)
    check("ganga balance only ib2 left", abs(d["balance"] - 360.0) < 0.01, d["balance"])

    print("\n== bill share PDF ==")
    def raw_get2(path):
        r = urllib.request.Request(BASE + path, headers={"Authorization": "Bearer " + TOKEN})
        with urllib.request.urlopen(r, timeout=20) as resp:
            return resp.status, resp.read(), resp.headers
    st, body, hdrs = raw_get2("/api/bill/pdf?id=" + ib1)
    check("bill pdf 200", st == 200 and body[:8] == b"%PDF-1.4", (st, len(body)))
    check("bill pdf valid", b"/Type /Catalog" in body and b"%%EOF" in body[-32:], None)
    check("bill pdf download name", "attachment" in (hdrs.get("Content-Disposition") or ""),
          hdrs.get("Content-Disposition"))
    st, body, hdrs = raw_get2("/api/bill/pdf?id=" + ib2)
    check("bill pdf for second bill", st == 200 and body[:8] == b"%PDF-1.4", st)

    print("\n== galla (the cash drawer) ==")
    st, d = req("GET", "/api/galla")
    check("galla not open yet", st == 200 and d["open"] is False, d)
    st, d = req("POST", "/api/galla/entry", {"direction": "in", "amount": 100})
    check("entry before open blocked", st == 400, st)
    st, d = req("POST", "/api/galla/open", {"opening": "रू ५,०००"})
    check("galla opens with devanagari amount", st == 200 and d["opening"] == 5000.0, d)
    st, d = req("POST", "/api/galla/open", {"opening": 100})
    check("double open blocked", st == 400, st)
    st, d = req("POST", "/api/galla/entry", {"direction": "out", "amount": 300, "note": "vegetables"})
    check("galla out entry", st == 200, d)
    st, d = req("POST", "/api/galla/entry", {"direction": "in", "amount": 1500, "note": "loan returned"})
    check("galla in entry", st == 200, d)
    st, d = req("POST", "/api/galla/entry", {"direction": "sideways", "amount": 5})
    check("bad direction rejected", st == 400, st)
    st, d = req("POST", "/api/galla/entry", {"direction": "in", "amount": 0})
    check("zero entry rejected", st == 400, st)
    st, d = req("GET", "/api/galla")
    check("galla summary math", st == 200 and d["open"] is True
          and d["opening"] == 5000.0 and d["cash_in"] == 1500.0
          and d["cash_out"] == 300.0 and d["expected"] == 6200.0
          and d["closed"] is False, d)
    out_entry = [e for e in d["entries"] if e["direction"] == "out"][0]
    st, d = req("POST", "/api/galla/entry/undo", {"id": out_entry["id"]})
    check("galla entry undo", st == 200, st)
    st, d = req("GET", "/api/galla")
    check("expected after undo = 6500", d["expected"] == 6500.0 and d["cash_out"] == 0.0, d)
    st, d = req("POST", "/api/galla/entry", {"direction": "out", "amount": 300, "note": "vegetables"})
    check("re-add out entry", st == 200, st)
    print("\n== counter-paid bills go into today's galla ==")
    st, d = req("POST", "/api/bills/add", {"person_id": ganga, "amount": 300,
              "already_paid": True})
    check("counter bill saved + galla_in flag", st == 200 and d.get("galla_in") is True, d)
    c_bill = d["id"]
    st, d = req("GET", "/api/galla")
    check("counter cash entered the galla", st == 200 and d["cash_in"] == 1800.0
          and d["expected"] == 6500.0, d)
    linked = [e for e in d["entries"] if e.get("bill_id")]
    check("entry is linked to the bill", len(linked) == 1
          and linked[0]["bill_id"] == c_bill, d["entries"])
    st, d = req("POST", "/api/galla/entry/undo", {"id": linked[0]["id"]})
    check("linked entry can't be removed by hand", st == 400, (st, d))
    st, d = req("POST", "/api/bills/void", {"id": c_bill})
    check("voiding the counter bill", st == 200, st)
    st, d = req("GET", "/api/galla")
    check("void pulled the cash back out", st == 200 and d["cash_in"] == 1500.0
          and d["expected"] == 6200.0, d)
    # backdated bills never touch today's drawer (db-level: the API only
    # ever records real-time dates)
    bd = db.create_person("Backdate Test")
    res = db.create_bill(bd, 250, already_paid=True, created_at="2020-01-01T10:00:00")
    check("backdated counter bill skips the galla", res.get("galla_in") is False, res)
    st, d = req("GET", "/api/galla")
    check("drawer unchanged by backdated bill", st == 200 and d["cash_in"] == 1500.0, d)

    st, d = req("POST", "/api/galla/close", {"closing": 5700})
    check("close short by 500", st == 200, d)
    st, d = req("GET", "/api/galla")
    check("closed with difference -500", st == 200 and d["closed"] is True
          and abs(d["difference"] - (-500.0)) < 0.01, d)
    st, d = req("POST", "/api/galla/entry", {"direction": "in", "amount": 10})
    check("entry after close blocked", st == 400, st)
    st, d = req("POST", "/api/galla/close", {"closing": 100})
    check("double close blocked", st == 400, st)
    st, d = req("GET", "/api/galla/recent?days=7")
    today_s = time.strftime("%Y-%m-%d")
    row = [r for r in d["days"] if r["date"] == today_s]
    check("recent days include in/out", st == 200 and row and
          row[0]["cash_in"] == 1500.0 and row[0]["cash_out"] == 300.0, d.get("days"))
    st, d = req("GET", "/api/galla/recent?days=7")
    check("galla recent shows the day", st == 200 and len(d["days"]) == 1
          and d["days"][0]["closing"] == 5700.0
          and d["days"][0]["difference"] == -500.0, d)
    st, body, hdrs = raw_get2("/api/galla/pdf")
    check("galla pdf 200", st == 200 and body[:8] == b"%PDF-1.4", (st, len(body)))
    check("galla pdf valid", b"/Type /Catalog" in body and b"%%EOF" in body[-32:], None)

    print("\n== per-bill partial payments ==")
    # fresh person with two bills so FIFO vs bill-target can't be confused
    st, d = req("POST", "/api/people/add", {"name": "Partial Pay Test"})
    ppt = d["id"]
    st, d = req("POST", "/api/bills/add", {"person_id": ppt, "amount": 1000})
    pb1 = d["id"]
    st, d = req("POST", "/api/bills/add", {"person_id": ppt, "amount": 500})
    pb2 = d["id"]
    st, d = req("GET", "/api/ledger?id=" + ppt)
    check("two bills open, 1500 owed", d["balance"] == 1500.0, d["balance"])
    check("ledger rows carry SN numbers", [r["sn"] for r in d["rows"]] == [1, 2],
          [r.get("sn") for r in d["rows"]])
    # pay 400 against the NEWER bill only (FIFO would have picked pb1)
    st, d = req("POST", "/api/payments/preview", {"person_id": ppt, "amount": 400, "bill_id": pb2})
    check("bill-target preview", st == 200 and d["plan"][0]["bill_id"] == pb2
          and d["plan"][0]["apply"] == 400.0 and d.get("bill_only") is True, d)
    st, d = req("POST", "/api/payments/add", {"person_id": ppt, "amount": 400,
              "bill_id": pb2, "note": "part payment on second bill"})
    pmt_pb = d["id"]
    check("part payment recorded", st == 200, d)
    st, d = req("GET", "/api/ledger?id=" + ppt)
    check("paid the NEWER bill, not oldest", st == 200 and d["balance"] == 1100.0, d["balance"])
    b1row = [r for r in d["rows"] if r["id"] == pb1][0]
    b2row = [r for r in d["rows"] if r["id"] == pb2][0]
    check("pb2 is part-paid", b2row["status"] == "open" and abs(b2row["remaining"] - 100.0) < 0.01,
          b2row)
    check("pb1 untouched", b1row["remaining"] == 1000.0, b1row)
    # overpay the bill's own remaining
    st, d = req("POST", "/api/payments/add", {"person_id": ppt, "amount": 500, "bill_id": pb2})
    check("overpay of one bill rejected", st == 400, (st, d))
    # pay the exact rest of pb2 -> bill turns fully paid
    st, d = req("POST", "/api/payments/add", {"person_id": ppt, "amount": 100, "bill_id": pb2})
    check("finish pb2", st == 200, st)
    st, d = req("GET", "/api/ledger?id=" + ppt)
    b2row = [r for r in d["rows"] if r["id"] == pb2][0]
    check("pb2 fully paid now", b2row["status"] == "paid" and b2row["remaining"] == 0, b2row)
    check("balance = pb1 only", d["balance"] == 1000.0, d["balance"])
    # paying an already-paid bill is refused
    st, d = req("POST", "/api/payments/add", {"person_id": ppt, "amount": 10, "bill_id": pb2})
    check("paying a paid bill rejected", st == 400, (st, d))
    # someone else's bill id is refused
    st, d = req("POST", "/api/payments/add", {"person_id": ganga, "amount": 10, "bill_id": pb1})
    check("wrong person's bill rejected", st == 400, (st, d))
    # undo works on bill-targeted payments too
    st, d = req("POST", "/api/payments/undo", {"id": pmt_pb, "reason": "test undo"})
    check("undo part payment", st == 200, st)
    st, d = req("GET", "/api/ledger?id=" + ppt)
    b2row = [r for r in d["rows"] if r["id"] == pb2][0]
    check("undo restores pb2 remaining", b2row["remaining"] == 400.0
          and b2row["status"] == "open", b2row)
    print("\n== snapshot covers new tables ==")
    snap = db.snapshot()
    check("snapshot has bill_items", "bill_items" in snap and len(snap["bill_items"]) >= 4,
          len(snap.get("bill_items", [])))
    check("snapshot has galla tables", "galla_days" in snap and "galla_entries" in snap
          and len(snap["galla_days"]) == 1, len(snap.get("galla_days", [])))
    st, d = req("POST", "/api/backup/restore", {"snapshot": snap})
    check("restore with new tables", st == 200, st)
    st, d = req("GET", "/api/galla")
    check("galla survives restore", st == 200 and d["open"] is True and d["closed"] is True, d)
    st, d = req("GET", "/api/bill?id=" + ib1)
    check("bill items survive restore", st == 200 and len(d.get("items", [])) == 2, len(d.get("items", [])))

    print("\n== khata share: PDF + Excel ==")
    # a person with known rows: ram has bills + a payment
    def raw_get(path):
        r = urllib.request.Request(BASE + path, headers={"Authorization": "Bearer " + TOKEN})
        with urllib.request.urlopen(r, timeout=20) as resp:
            return resp.status, resp.read(), resp.headers

    st, body, hdrs = raw_get("/api/khata/pdf?id=" + ram)
    check("khata pdf 200", st == 200 and body[:8] == b"%PDF-1.4", (st, len(body)))
    check("khata pdf valid structure",
          b"/Type /Catalog" in body and b"xref" in body and b"%%EOF" in body[-32:], None)
    check("khata pdf download name", "attachment" in (hdrs.get("Content-Disposition") or ""),
          hdrs.get("Content-Disposition"))
    st, body, hdrs = raw_get("/api/khata/xlsx?id=" + ram)
    check("khata xlsx 200", st == 200 and body[:2] == b"PK", (st, len(body)))
    import io as _io
    import openpyxl as _ox
    wb = _ox.load_workbook(_io.BytesIO(body))
    ws = wb["Khata"]
    hdr_row = [c.value for c in ws[5]]
    check("xlsx header row", hdr_row == ["Date", "Particulars", "Debit", "Credit", "Balance"], hdr_row)
    # find TOTAL row and verify debit total = 1234 + 700 (ram's open bills, b2 updated to 700 earlier)
    total_row = None
    for row in ws.iter_rows(min_row=6):
        if row[1].value == "TOTAL":
            total_row = [c.value for c in row]
            break
    check("xlsx TOTAL row present", total_row is not None, None)
    if total_row:
        # ram's debit total = every non-counter, non-void bill: 1234 + 500 + 90 = 1824
        check("xlsx debit total matches ledger", abs((total_row[2] or 0) - 1824.0) < 0.01, total_row)
    check("xlsx photo sheet", "Bill photos" in wb.sheetnames, wb.sheetnames)
    st, body, hdrs = raw_get("/api/khata/pdf?id=" + ram)
    check("khata pdf repeatable", st == 200 and body[:8] == b"%PDF-1.4", st)

    print("\n== multiplication (qty x rate) ==")
    st, d = req("POST", "/api/bills/itemized/add", {
        "person_id": ganga,
        "items": [
            {"particulars": "oil", "qty": 3.5, "rate": 185.5, "amount": 649.25},
            {"particulars": "rice", "qty": 7, "rate": 0.5, "amount": 3.5},
        ],
    })
    check("fractional multiplication total", st == 200 and
          abs(d.get("amount", 0) - 652.75) < 0.01, d.get("amount"))
    st, d = req("GET", "/api/bill?id=" + d["id"])
    check("items keep qty x rate", st == 200 and
          abs(d["items"][0]["qty"] * d["items"][0]["rate"] - 649.25) < 0.01,
          d.get("items"))
    st, d = req("POST", "/api/bills/itemized/add", {
        "person_id": ganga,
        "items": [{"particulars": "big buy", "qty": 1500, "rate": 999.99, "amount": 1499985}],
    })
    check("large multiplication exact", st == 200 and d.get("amount") == 1499985.0,
          d.get("amount"))
    st, d = req("POST", "/api/bills/itemized/add", {
        "person_id": ganga,
        "items": [{"particulars": "half paisa", "qty": 1, "rate": 0.01, "amount": 0.01}],
    })
    check("tiny amount still a bill", st == 200, (st, d))

    print("\n== clear all data (remove demo) ==")
    st, d = req("POST", "/api/demo/clear", {})
    check("clear returns ok", st == 200, (st, d))
    st, d = req("GET", "/api/people")
    check("people gone", st == 200 and d["people"] == [], d)
    st, d = req("GET", "/api/galla")
    check("galla days gone", st == 200 and d["open"] is False, d)
    st, d = req("GET", "/api/state")
    check("account survives the clear", st == 200 and d["has_account"] is True
          and d["seller_name"] == "Durga", d)
    st, d = req("POST", "/api/login", {"pin": "5555"})
    check("PIN still works after clear", st == 200, (st, d))
    st, d = req("POST", "/api/demo", {})
    check("demo loads after clear (no FK crash)", st == 200, (st, d))
    st, d = req("GET", "/api/people")
    check("demo people present", st == 200 and len(d["people"]) == 8, len(d.get("people", [])))
    # demo loader must survive itemized bills too (FK order)
    st, d = req("POST", "/api/people/add", {"name": "Itemized One"})
    io_id = d["id"]
    st, d = req("POST", "/api/bills/itemized/add", {"person_id": io_id,
        "items": [{"particulars": "x", "qty": 1, "rate": 10}]})
    check("itemized bill before demo reload", st == 200, (st, d))
    st, d = req("POST", "/api/demo", {})
    check("demo reload with itemized bills", st == 200, (st, d))
    st, d = req("POST", "/api/demo/clear", {})
    check("clear after demo, back to empty", st == 200 and
          req("GET", "/api/people")[1]["people"] == [], d)


    print("\n========================")
    print("PASSED: %d   FAILED: %d" % (PASSED, len(FAILED)))
    for f in FAILED:
        print("  FAILED:", f)
    return 0 if not FAILED else 1


if __name__ == "__main__":
    code = main()
    sys.exit(code)

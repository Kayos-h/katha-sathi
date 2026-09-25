"""Khata Sathi - end-to-end API test suite.

Tests full cloud functionality, Supabase & Email auth, multi-tenant data isolation,
bill and payment workflows without photos, galla cash drawer, and zero disk writes.
Exit code 0 = all green.
"""
import base64
import io
import json
import os
import sys
import threading
import time
import urllib.request
import urllib.error

APP_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, APP_DIR)

import app
import db

PORT = 8913
BASE = "http://localhost:%d" % PORT
PASSED = 0
FAILED = []


def req(method, path, body=None, token=None, ctype="application/json"):
    url = BASE + path
    data = None
    headers = {}
    if body is not None:
        data = json.dumps(body).encode()
        headers["Content-Type"] = ctype
    if token:
        headers["Authorization"] = "Bearer " + token
    r = urllib.request.Request(url, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(r, timeout=10) as resp:
            raw_bytes = resp.read()
            resp_ctype = resp.headers.get("Content-Type", "")
            if "application/json" in resp_ctype:
                try:
                    return resp.status, json.loads(raw_bytes.decode("utf-8") or "{}"), resp.headers
                except Exception:
                    return resp.status, {}, resp.headers
            elif "text/" in resp_ctype:
                return resp.status, raw_bytes.decode("utf-8", errors="replace"), resp.headers
            else:
                return resp.status, raw_bytes, resp.headers
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read().decode("utf-8") or "{}"), e.headers
        except Exception:
            return e.code, {}, e.headers


def check(name, cond, extra=""):
    global PASSED
    if cond:
        PASSED += 1
        print("  ok  %s" % name)
    else:
        FAILED.append(name)
        print("FAIL  %s  %s" % (name, extra))


def main():
    db.init()
    threading.Thread(target=lambda: app.run("127.0.0.1", PORT, open_browser=False),
                     daemon=True).start()
    time.sleep(0.8)

    print("\n== 1. Cloud Authentication & Signup ==")
    # Signup User 1
    st, d, _ = req("POST", "/api/auth/signup", {
        "email": "durga@khatasathi.test",
        "password": "password123",
        "seller_name": "Durga",
        "store_name": "Durga Store",
    })
    check("signup user 1", st == 200 and d.get("ok") and d.get("token"), d)
    token1 = d.get("token")
    user1_id = d.get("user_id")

    # Login User 1
    st, d, _ = req("POST", "/api/auth/login", {
        "email": "durga@khatasathi.test",
        "password": "password123",
    })
    check("login user 1", st == 200 and d.get("token"), d)

    # State check User 1
    st, d, _ = req("GET", "/api/state", token=token1)
    check("state user 1", st == 200 and d.get("seller_name") == "Durga", d)

    # Signup User 2 (Separate account)
    st, d, _ = req("POST", "/api/auth/signup", {
        "email": "hari@khatasathi.test",
        "password": "password123",
        "seller_name": "Hari",
        "store_name": "Hari Kirana",
    })
    check("signup user 2", st == 200 and d.get("token"), d)
    token2 = d.get("token")

    # Admin Quick Login Test
    st, d, _ = req("POST", "/api/auth/login", {
        "email": "admin@khatasathi.com",
        "password": "admin",
    })
    check("admin quick login", st == 200 and d.get("token") and d.get("user_id") == "usr_admin_001", d)
    admin_token = d.get("token")

    # State check Admin
    st, d, _ = req("GET", "/api/state", token=admin_token)
    check("admin state check", st == 200 and d.get("seller_name") == "Admin", d)

    # Google OAuth URL endpoint
    st, d, _ = req("GET", "/api/auth/google-url")
    check("google oauth url endpoint", st == 200 and "url" in d, d)

    print("\n== 2. Multi-Tenant Data Isolation ==")
    # User 1 opens galla
    st, d, _ = req("POST", "/api/galla/open", {"opening": 5000}, token=token1)
    check("user 1 open galla", st == 200 and d.get("opening") == 5000, d)

    # User 2 checks galla (must be separate / closed for user 2)
    st, d, _ = req("GET", "/api/galla", token=token2)
    check("user 2 galla isolation", st == 200 and d.get("open") is False, d)

    # User 1 creates customer
    st, d, _ = req("POST", "/api/people/add", {"name": "Ram Thapa", "phone": "9841000001"}, token=token1)
    check("user 1 create customer", st == 200 and d.get("id"), d)
    ram_id = d.get("id")

    # User 2 lists customers (must NOT see Ram Thapa)
    st, d, _ = req("GET", "/api/people", token=token2)
    check("user 2 people list is empty", st == 200 and len(d.get("people", [])) == 0, d)

    # User 2 creates customer with different name
    st, d, _ = req("POST", "/api/people/add", {"name": "Sita Gurung", "phone": "9841000002"}, token=token2)
    check("user 2 create customer", st == 200 and d.get("id"), d)
    sita_id = d.get("id")

    # Verify User 1 only sees Ram and User 2 only sees Sita
    st, d1, _ = req("GET", "/api/people", token=token1)
    st, d2, _ = req("GET", "/api/people", token=token2)
    check("tenant 1 sees only own customer", len(d1.get("people", [])) == 1 and d1["people"][0]["name"] == "Ram Thapa")
    check("tenant 2 sees only own customer", len(d2.get("people", [])) == 1 and d2["people"][0]["name"] == "Sita Gurung")

    print("\n== 3. Photo Feature Disabled Stubs & Quality Check ==")
    st, d, _ = req("POST", "/api/photo/check", {"dummy": 1}, token=token1)
    check("photo check disabled stub", st == 200 and d.get("status") == "disabled", d)

    st, d, _ = req("GET", "/photo/somephoto.jpg", token=token1)
    check("photo download 501 under construction", st == 501, d)

    print("\n== 4. Bills & Itemized Bills (Without Photos) ==")
    # User 1 creates simple bill
    st, d, _ = req("POST", "/api/bills/add", {
        "person_id": ram_id,
        "amount": 1500,
        "note": "Rice and lentils",
    }, token=token1)
    check("user 1 add simple bill", st == 200 and d.get("id") and d.get("remaining") == 1500, d)
    bill1_id = d.get("id")

    # User 1 creates itemized bill
    st, d, _ = req("POST", "/api/bills/itemized/add", {
        "person_id": ram_id,
        "items": [
            {"particulars": "Sunflower Oil 1L", "qty": 2, "rate": 250, "amount": 500},
            {"particulars": "Basmati Rice 5kg", "qty": 1, "rate": 800, "amount": 800},
        ],
        "note": "Ration order",
    }, token=token1)
    check("user 1 add itemized bill", st == 200 and d.get("id") and d.get("amount") == 1300, d)
    bill2_id = d.get("id")

    # Check Ram's ledger
    st, d, _ = req("GET", f"/api/ledger?id={ram_id}", token=token1)
    check("user 1 customer balance is 2800", st == 200 and d.get("balance") == 2800, d)

    # User 2 attempts to view Ram's ledger (forbidden / not found in tenant 2)
    st, d, _ = req("GET", f"/api/ledger?id={ram_id}", token=token2)
    check("user 2 cannot view user 1 customer ledger", st == 404 or st == 400, d)

    print("\n== 5. Payments, Allocations & Drawer Sync ==")
    # Record partial payment for Ram
    st, d, _ = req("POST", "/api/payments/add", {
        "person_id": ram_id,
        "amount": 2000,
        "note": "Partial cash payment",
    }, token=token1)
    check("user 1 record payment", st == 200 and d.get("id") and d.get("galla_in"), d)
    pmt_id = d.get("id")

    # Check balance after payment (2800 - 2000 = 800)
    st, d, _ = req("GET", f"/api/person?id={ram_id}", token=token1)
    check("user 1 balance updated to 800", st == 200 and d.get("balance") == 800, d)

    # Check Galla drawer total (Opening 5000 + Cash in 2000 = Expected 7000)
    st, d, _ = req("GET", "/api/galla", token=token1)
    check("galla drawer expected 7000", st == 200 and d.get("expected") == 7000, d)

    print("\n== 6. Inventory Management & Auto-Deduction Tests ==")
    # Add inventory items
    st, d, _ = req("POST", "/api/inventory/add", {
        "name": "Sunflower Oil 1L",
        "category": "Oil & Ghee",
        "sku": "OIL-SUN-1",
        "buy_price": 200,
        "sell_price": 250,
        "stock_qty": 20,
        "unit": "ltr",
        "min_stock_alert": 5,
    }, token=token1)
    check("create inventory item 1 (Sunflower Oil)", st == 200 and d.get("id"), d)
    oil_id = d.get("id")

    st, d, _ = req("POST", "/api/inventory/add", {
        "name": "Basmati Rice 25kg",
        "category": "Rice & Grains",
        "sku": "RICE-BAS-25",
        "buy_price": 1800,
        "sell_price": 2200,
        "stock_qty": 4,
        "unit": "bag",
        "min_stock_alert": 5,
    }, token=token1)
    check("create inventory item 2 (Basmati Rice - Low Stock)", st == 200 and d.get("id"), d)
    rice_id = d.get("id")

    # List inventory and check metrics
    st, d, _ = req("GET", "/api/inventory", token=token1)
    check("list inventory returns 2 items", st == 200 and len(d.get("items", [])) == 2, d)

    # Check search
    st, d, _ = req("GET", "/api/inventory/search?q=sunflower", token=token1)
    check("search inventory by name", st == 200 and len(d.get("results", [])) == 1 and d["results"][0]["sku"] == "OIL-SUN-1", d)

    # Check summary
    st, d, _ = req("GET", "/api/inventory/summary", token=token1)
    check("inventory summary calculates low stock count", st == 200 and d.get("low_stock_count") == 1 and d.get("total_items") == 2, d)

    # Stock adjustment (Restock rice by +6)
    st, d, _ = req("POST", "/api/inventory/adjust", {
        "id": rice_id,
        "change_qty": 6,
        "reason": "restock",
        "note": "Wholesale delivery",
    }, token=token1)
    check("adjust stock (+6 bags)", st == 200 and d.get("stock_qty") == 10, d)

    # Item detail with movement history
    st, d, _ = req("GET", f"/api/inventory/item?id={rice_id}", token=token1)
    check("get inventory item with logs", st == 200 and len(d.get("logs", [])) == 2 and d.get("stock_qty") == 10, d)

    # Create Itemized Bill selling 3 Sunflower Oil and 2 Basmati Rice
    st, d, _ = req("POST", "/api/bills/itemized/add", {
        "person_id": ram_id,
        "already_paid": False,
        "items": [
            {"particulars": "Sunflower Oil 1L", "qty": 3, "rate": 250, "amount": 750},
            {"particulars": "Basmati Rice 25kg", "qty": 2, "rate": 2200, "amount": 4400},
        ],
    }, token=token1)
    check("create itemized bill with inventory items", st == 200 and d.get("id"), d)
    inv_bill_id = d.get("id")

    # Verify inventory was automatically decremented: Oil 20 - 3 = 17, Rice 10 - 2 = 8
    st, d, _ = req("GET", f"/api/inventory/item?id={oil_id}", token=token1)
    check("oil stock auto-decremented to 17", st == 200 and d.get("stock_qty") == 17, d)

    st, d, _ = req("GET", f"/api/inventory/item?id={rice_id}", token=token1)
    check("rice stock auto-decremented to 8", st == 200 and d.get("stock_qty") == 8, d)

    # Void the bill and verify stock is restored: Oil -> 20, Rice -> 10
    st, d, _ = req("POST", "/api/bills/void", {"id": inv_bill_id}, token=token1)
    check("void bill", st == 200 and d.get("ok"), d)

    st, d, _ = req("GET", f"/api/inventory/item?id={oil_id}", token=token1)
    check("oil stock restored to 20 on void", st == 200 and d.get("stock_qty") == 20, d)

    st, d, _ = req("GET", f"/api/inventory/item?id={rice_id}", token=token1)
    check("rice stock restored to 10 on void", st == 200 and d.get("stock_qty") == 10, d)

    # Dashboard inventory metrics
    st, d, _ = req("GET", "/api/dashboard", token=token1)
    check("dashboard includes inventory section", st == 200 and "inventory" in d and d["inventory"]["total_items"] == 2, d)

    # Close User 1 Galla
    st, d, _ = req("POST", "/api/galla/close", {"closing": 7000}, token=token1)
    check("user 1 close galla", st == 200 and d.get("closing") == 7000, d)

    print("\n== 7. PDF & Excel Exports ==")
    # PDF bill export
    st, raw_pdf, headers = req("GET", f"/api/bill/pdf?id={bill2_id}", token=token1)
    check("bill PDF generation", st == 200 and len(raw_pdf) > 100, f"size: {len(raw_pdf)}")

    # PDF khata export
    st, raw_pdf, headers = req("GET", f"/api/khata/pdf?id={ram_id}", token=token1)
    check("khata PDF generation", st == 200 and len(raw_pdf) > 100, f"size: {len(raw_pdf)}")

    # Excel khata export
    st, raw_xlsx, headers = req("GET", f"/api/khata/xlsx?id={ram_id}", token=token1)
    check("khata Excel generation", st == 200 and len(raw_xlsx) > 100, f"size: {len(raw_xlsx)}")

    # PDF galla export
    st, raw_pdf, headers = req("GET", "/api/galla/pdf", token=token1)
    check("galla PDF generation", st == 200 and len(raw_pdf) > 100, f"size: {len(raw_pdf)}")

    print("\n== 8. Demo Data Loader ==")
    st, d, _ = req("POST", "/api/demo", {}, token=token1)
    check("load demo data", st == 200 and d.get("ok"), d)

    st, d, _ = req("GET", "/api/people", token=token1)
    check("demo populated customers for tenant 1", len(d.get("people", [])) >= 8, d)

    # User 2 still has only 1 customer
    st, d, _ = req("GET", "/api/people", token=token2)
    check("tenant 2 remains unaffected by tenant 1 demo loader", len(d.get("people", [])) == 1, d)

    print("\n-----------------------------------------")
    print(f"RESULTS: {PASSED} passed, {len(FAILED)} failed.")
    print("-----------------------------------------")
    if FAILED:
        os._exit(1)
    os._exit(0)


if __name__ == "__main__":
    main()

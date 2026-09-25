"""Khata Sathi - demo data loader.

Builds a demo shop for the authenticated user: 8 people, ~30 bills, ~12 payments
spread over the last ~40 days so the dashboard, aging, and charts have data to display.
"""
import random
from datetime import datetime, timedelta

import db

PEOPLE = [
    ("Ram Thapa", "9841000001", "Ranirani shop regular"),
    ("Sita Gurung", "9841000002", ""),
    ("Hari Shrestha", "", "Pays every Friday"),
    ("Gita Adhikari", "9841000004", ""),
    ("Bikash Tamang", "", ""),
    ("Kanchha Kaka", "", "Old friend, never in a hurry"),
    ("Nepali Name", "9841000007", "Devanagari name test"),
    ("Anisha Rai", "9841000008", "Always clears in 3 days"),
]


def load_demo(user_id="default"):
    # wipe and rebuild for this specific user
    db.clear_data(keep_settings=True, user_id=user_id)

    now = datetime.now()
    made_people = []
    for name, phone, notes in PEOPLE:
        pid = db.create_person(name, phone, notes, user_id=user_id)
        made_people.append((pid, name))

    # bills: spread over 40 days
    random.seed(2083)
    for i in range(30):
        pid, name = random.choice(made_people)
        amount = float(random.choice([150, 220, 350, 420, 500, 680, 750, 980, 1200, 1500]))
        days_ago = random.randint(0, 40)
        when = (now - timedelta(days=days_ago)).strftime("%Y-%m-%dT%H:%M:%S")
        already = random.random() < 0.25
        db.create_bill(
            pid, amount, photo="", already_paid=already,
            created_at=when, require_galla=False, user_id=user_id,
        )

    # payments: each clears some of the older open bills
    for pid, name in made_people:
        open_now = db.open_bills(pid, user_id=user_id)
        if open_now and random.random() < 0.6:
            total = sum(b["remaining"] for b in open_now)
            part = random.choice([0.3, 0.5, 0.5, 0.7, 1.0])
            amt = round(total * part, 2)
            if amt > 0:
                when = (now - timedelta(days=random.randint(0, 12))).strftime("%Y-%m-%dT%H:%M:%S")
                db.record_payment(
                    pid, amt, note="demo payment", created_at=when,
                    require_galla=False, user_id=user_id,
                )

    # inventory products
    sample_inventory = [
        {"name": "Sunflower Cooking Oil (1L)", "sku": "OIL-SUN-1L", "category": "Groceries", "unit": "ltr", "buy_price": 220.0, "sell_price": 260.0, "stock_qty": 45.0, "min_stock_alert": 10.0},
        {"name": "Basmati Rice (25kg)", "sku": "RICE-BAS-25K", "category": "Grains", "unit": "bag", "buy_price": 2400.0, "sell_price": 2850.0, "stock_qty": 18.0, "min_stock_alert": 5.0},
        {"name": "Sugar Refined (1kg)", "sku": "SUG-REF-1K", "category": "Groceries", "unit": "kg", "buy_price": 95.0, "sell_price": 115.0, "stock_qty": 60.0, "min_stock_alert": 15.0},
        {"name": "Tata Tea Gold (500g)", "sku": "TEA-TAT-500", "category": "Beverages", "unit": "packet", "buy_price": 320.0, "sell_price": 380.0, "stock_qty": 30.0, "min_stock_alert": 8.0},
        {"name": "Wai Wai Noodles (Box)", "sku": "NDL-WAI-BOX", "category": "Snacks", "unit": "box", "buy_price": 550.0, "sell_price": 600.0, "stock_qty": 12.0, "min_stock_alert": 4.0},
    ]
    for item in sample_inventory:
        try:
            db.create_inventory_item(item, user_id=user_id)
        except Exception:
            pass

    db.set_setting("store_name", "Khata Sathi Demo Store", user_id=user_id)
    return {"people": len(made_people), "inventory": len(sample_inventory)}

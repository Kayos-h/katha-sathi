"""Khata Sathi - demo data loader.

Builds a fake shop: 8 people, ~30 bills, ~12 payments spread over the last
~40 days so the dashboard, aging and charts have something to show.
Photos are generated placeholder receipts (sharp enough to pass quality).
"""
import io
import random
from datetime import datetime, timedelta

import db
import photos

try:
    from PIL import Image, ImageDraw
    HAS_PIL = True
except ImportError:
    HAS_PIL = False

random.seed(2083)  # same demo shop every time

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


def _fake_receipt(person_name, amount):
    if not HAS_PIL:
        return None
    img = Image.new("RGB", (640, 900), (250, 248, 242))
    d = ImageDraw.Draw(img)
    d.rectangle([20, 20, 620, 880], outline=(20, 20, 20), width=3)
    d.text((50, 60), "BILLSATHI DEMO STORE", fill=(20, 20, 20))
    d.text((50, 120), "Khichhapokhari, Kathmandu", fill=(60, 60, 60))
    d.line([(50, 170), (590, 170)], fill=(20, 20, 20), width=3)
    for y in range(210, 700, 70):
        d.text((50, y), "Item .................. xxx", fill=(40, 40, 40))
        d.line([(50, y + 40), (590, y + 40)], fill=(200, 200, 200), width=1)
    d.line([(50, 720), (590, 720)], fill=(20, 20, 20), width=4)
    d.text((50, 740), "Customer: " + person_name, fill=(10, 10, 10))
    d.text((50, 790), "TOTAL: Rs %s" % format(amount, ",.0f"), fill=(10, 10, 10))
    buf = io.BytesIO()
    img.save(buf, "JPEG", quality=90)
    return buf.getvalue()


def load_demo():
    # wipe and rebuild (children first so foreign keys never complain)
    db.clear_data(keep_settings=True)

    now = datetime.now()
    made_people = []
    for name, phone, notes in PEOPLE:
        pid = db.create_person(name, phone, notes)
        made_people.append((pid, name))

    # bills: random spread over 40 days
    for i in range(30):
        pid, name = random.choice(made_people)
        amount = float(random.choice([150, 220, 350, 420, 500, 680, 750, 980, 1200, 1500]))
        days_ago = random.randint(0, 40)
        when = (now - timedelta(days=days_ago)).strftime("%Y-%m-%dT%H:%M:%S")
        already = random.random() < 0.25
        photo = ""
        if HAS_PIL and random.random() < 0.9:
            data = _fake_receipt(name, amount)
            if data:
                fname = photos.save_photo(data, ".jpg")
                photo = fname
        db.create_bill(pid, amount, photo=photo, already_paid=already,
                       created_at=when, require_galla=False)

    # payments: each clears some of the older open bills
    for pid, name in made_people:
        open_now = db.open_bills(pid)
        # pay some fraction of people, partial or full
        if open_now and random.random() < 0.6:
            total = sum(b["remaining"] for b in open_now)
            part = random.choice([0.3, 0.5, 0.5, 0.7, 1.0])
            amt = round(total * part, 2)
            if amt > 0:
                when = (now - timedelta(days=random.randint(0, 12))).strftime("%Y-%m-%dT%H:%M:%S")
                db.record_payment(pid, amt, note="demo payment", created_at=when,
                                  require_galla=False)

    db.set_setting("store_name", "Khata Sathi Demo Store")
    return {"people": len(made_people)}

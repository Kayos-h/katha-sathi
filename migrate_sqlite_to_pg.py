"""One-time migration script: SQLite (local) -> PostgreSQL (Cloud) + Cloud Photos.

Transfers all persistent shop records:
- Settings & Credentials
- Customers / People
- Bills & Itemized Bill Items
- Payments & Payment Allocations
- Galla / Cash drawer records (Days & Entries)
- Full Audit Log
- Uploads local photos from data/photos/ to Cloud Storage (Supabase/Blob)

Run this once before switching to Vercel production:
    python migrate_sqlite_to_pg.py --sqlite data/khatasathi.db --pg "postgresql://user:pass@host/db"
"""
import argparse
import os
import sqlite3
import sys

# Ensure khatasathi directory is in path
CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
if CURRENT_DIR not in sys.path:
    sys.path.insert(0, CURRENT_DIR)

import db
import photos

TABLES = [
    "settings",
    "people",
    "bills",
    "bill_items",
    "payments",
    "payment_allocations",
    "galla_days",
    "galla_entries",
    "audit_log",
]


def migrate(sqlite_path, database_url, upload_photos=True):
    print("=" * 60)
    print("KHATA SATHI: ONE-TIME SQLITE -> POSTGRESQL MIGRATION")
    print("=" * 60)

    if not os.path.exists(sqlite_path):
        print(f"Error: SQLite database file not found at '{sqlite_path}'")
        sys.exit(1)

    os.environ["DATABASE_URL"] = database_url
    print(f"\n[1/4] Connecting to SQLite at: {sqlite_path}")
    sq_conn = sqlite3.connect(sqlite_path)
    sq_conn.row_factory = sqlite3.Row

    print("[2/4] Connecting to PostgreSQL and initializing schema...")
    db.init()
    pg_conn = db.connect()

    print("[3/4] Migrating table data...")
    total_migrated = 0

    with pg_conn.cursor() as pg_cur:
        for table in TABLES:
            # Check if table exists in SQLite
            check_table = sq_conn.execute(
                "SELECT name FROM sqlite_master WHERE type='table' AND name=?", (table,)
            ).fetchone()
            if not check_table:
                print(f"  - Table '{table}': Not found in SQLite, skipping.")
                continue

            rows = sq_conn.execute(f"SELECT * FROM {table}").fetchall()
            if not rows:
                print(f"  - Table '{table}': 0 rows found.")
                continue

            # Fetch columns from first row (excluding SQLite specific rowid)
            cols = [col for col in rows[0].keys() if col != "rowid"]

            # Prepare PostgreSQL insert query with ON CONFLICT ignore
            placeholders = ", ".join(["%s"] * len(cols))
            col_names = ", ".join(cols)
            sql = f"INSERT INTO {table} ({col_names}) VALUES ({placeholders}) ON CONFLICT DO NOTHING"

            inserted = 0
            for r in rows:
                vals = [r[c] for c in cols]
                try:
                    pg_cur.execute(sql, vals)
                    inserted += 1
                except Exception as e:
                    print(f"    Warning inserting row into {table}: {e}")

            print(f"  ✓ Table '{table}': {inserted}/{len(rows)} rows migrated.")
            total_migrated += inserted

    pg_conn.commit()
    pg_conn.close()
    sq_conn.close()

    print(f"\nTotal records successfully migrated to PostgreSQL: {total_migrated}")

    # Step 4: Photo migration if local photos directory exists
    photo_dir = os.path.join(os.path.dirname(sqlite_path), "photos")
    if upload_photos and os.path.isdir(photo_dir):
        photo_files = [f for f in os.listdir(photo_dir) if f.lower().endswith((".jpg", ".png", ".webp"))]
        if photo_files:
            print(f"\n[4/4] Found {len(photo_files)} local photos in {photo_dir}. Uploading to Cloud Storage...")
            uploaded = 0
            for pf in photo_files:
                p_path = os.path.join(photo_dir, pf)
                try:
                    with open(p_path, "rb") as fh:
                        p_data = fh.read()
                    ext = os.path.splitext(pf)[1].lower()
                    photos.save_photo(p_data, ext)
                    uploaded += 1
                except Exception as e:
                    print(f"    Warning uploading {pf}: {e}")
            print(f"  ✓ Uploaded {uploaded}/{len(photo_files)} photos to Cloud Storage.")
        else:
            print("\n[4/4] No photo files found in photos directory.")
    else:
        print("\n[4/4] No local photo folder found to migrate.")

    print("\n" + "=" * 60)
    print("MIGRATION COMPLETED SUCCESSFULLY!")
    print("Your cloud database is ready for production operation on Vercel.")
    print("=" * 60)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Migrate Khata Sathi SQLite data to PostgreSQL")
    parser.add_argument(
        "--sqlite",
        default=os.path.join(CURRENT_DIR, "data", "khatasathi.db"),
        help="Path to local SQLite database (default: data/khatasathi.db)",
    )
    parser.add_argument(
        "--pg",
        default=os.environ.get("DATABASE_URL", ""),
        help="Target PostgreSQL DATABASE_URL (or set DATABASE_URL env var)",
    )
    parser.add_argument(
        "--no-photos",
        action="store_true",
        help="Skip uploading local photos to cloud storage",
    )

    args = parser.parse_args()
    if not args.pg:
        print("Error: Target PostgreSQL connection string is required.")
        print("Provide via --pg 'postgresql://...' or set DATABASE_URL environment variable.")
        sys.exit(1)

    migrate(args.sqlite, args.pg, upload_photos=not args.no_photos)

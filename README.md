# Khata Sathi

**Your bills, your khata — one place.**

The shop's credit notebook (khata), but the bills arrive as photos. Snap a bill on
the phone, it lands on the laptop instantly, every person gets a ledger, and every
rupee of a balance traces back to the bill photo it came from.

---

## Start it (the whole install)

Double-click **`KhataSathi.bat`**. That's it.

- The laptop app opens in your browser at `http://localhost:8787`
- First run asks your name + a 4-8 digit PIN (that's the only account — buyers never need one)
- The console window shows the phone address; **Connect phone** (top-right QR icon) shows a QR to scan with the phone camera. Both must be on the same Wi-Fi.
- On the phone: open the address → browser menu → **Add to Home Screen** → it becomes an app.

To stop: close the console window. Your data is safe (see below).

## What's where

| File | What it is |
|---|---|
| `KhataSathi.bat` | Double-click to start |
| `data/` | **Everything you own** — database, photos, in one folder. Copy this folder = full backup. |
| `web/` | The app itself (phone + laptop faces) |
| `app.py`, `db.py`, `photos.py`, `demo.py` | The server — plain Python, no install needed |
| `test_api.py` | 158 automated tests: `python test_api.py` |

Requires: Python 3.10+ with Pillow + qrcode (`pip install pillow qrcode`). Nothing else.

## The 30-second tour

1. **Add bill** (phone or laptop): take the bill photo — Khata Sathi checks it itself
   (too dark / blurry / tiny → it asks you to retake, in plain words). Type the name
   (existing people pop up as suggestions), type the amount — **Devanagari digits
   (रू १,२३४) convert automatically** — and check the photo beside the numbers before saving.
2. New name → new account, automatically. Old name → a new line in their **khata**.
3. **Got money**: type how much came in. Before saving, Khata Sathi shows exactly which
   bills get cleared — oldest first. Partial payments fine.
4. **Ledger** (nav): every person on the left, their full khata on the right →
   **S.N. / Date / Particulars / Debit / Credit / Remaining**, totals, share as PDF /
   Excel / text, print. Same numbers as the paper notebook.
5. Click anyone's balance → the open bills behind it, each with its photo and days owed.
6. **Dashboard** (laptop): total to collect, today's in/out, 30-day chart, aging of owed
   money, biggest balances, latest activity.
7. What happens on the phone appears on the laptop **by itself** — no refresh, ever.

## The खाता — a real paper ledger on screen

Every person's ledger is drawn like the actual khata notebook, on both the phone and
the laptop:

- Columns exactly like the paper: **मिति Date · विवरण Particulars · डेबिट Debit ·
  क्रेडिट Credit · बाँकी Balance**, with a red margin line down the date column.
- **Debit** = credit you gave (a bill). **Credit** = money that came in (a payment, or a
  bill paid at the counter). Balance = what they still owe after that line.
- The bottom of the page has the **जम्मा totals row** (total debit, total credit,
  balance) and the grand balance in big letters.
- Every bill line keeps its photo thumbnail (tap to enlarge) and status pill
  (open / part-paid / paid / counter / void).
- Tap a bill line → the **complete credit** of that bill: full amount, every payment
  applied against it, and what's still open.
- **Print** button (top right) prints the khata on paper — it prints just the ledger,
  nothing else, ready to pin in the shop.
- **Statement** button gives the same khata as copy-paste text for WhatsApp.

## Money rules (the important ones)

- **The confirm screen is the law.** Nothing saves without a human tap.
- A bill photo too bad to read later → Khata Sathi asks for a retake **before** accepting it.
- Payments clear the **oldest bills first**, and the payment record says which.
- **Pay one bill**: open a bill from the ledger, tap **Pay this bill**, pay any part of it.
  The bill shows part-paid, then paid when finished. Overpaying that one bill is refused;
  undo works like any payment.
- Undo a payment → balances come back exactly; the bills it cleared reopen.
- Void a bill only if no payment is linked (undo the payment first).
- "Already paid at counter" → no balance is owed, and the cash is added to
  today's galla automatically. Void the bill and it comes back out of the drawer.
- Every change lands in the **audit trail** (Settings) — nothing vanishes silently.
- Names in Nepali (Devanagari) or English both work everywhere, including search.
- One-tap **statement** per person — copy-paste and send.
- **Backup** (Settings) = one file with everything; **Restore** puts it back.
  **Export CSV** opens in Excel.
- Demo shop in Settings to explore safely (replaces data — it warns first). **Remove all data** (Settings) takes the shop back to empty
  while keeping your account and PIN.

## Two faces, one app

- **Laptop** = brain: dashboard, day-end totals, settings, everything.
- **Phone** = camera + quick lists: big Add button, people with balances, record payment.
- Both update live over the shop Wi-Fi (same address, QR connect).

## Where AI will go (v1.5, not built yet)

Settings → Bill reading already has its seat reserved: **Mode: Manual (default, never
removed) / AI** — and under AI, **Local (offline) / API (cloud)**. Manual stays as the
fallback if AI fails or reads badly. The confirm screen stays identical in all modes,
so plugging AI in changes nothing you see.

## If something goes wrong

- **Port busy** → Khata Sathi picks the next free port automatically; the console shows the real address.
- **Phone can't connect** → both devices must be on the same Wi-Fi; check the QR address again.
- **"Cannot reach the server"** → start `KhataSathi.bat` again; data is on disk, never lost by a restart.
- **Forgot PIN** → click **Reset PIN** on the PIN screen. No email is sent; type the seller name saved on this laptop and choose a new 4-8 digit PIN.

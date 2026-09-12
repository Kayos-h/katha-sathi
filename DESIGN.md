# Khata Sathi — Design Document

*"Your bill's companion" — the shop's khata (credit notebook), but the bills arrive as photos.*

Written: 9 Sep 2026 · Updated same day after the first review · **v1 BUILT & TESTED same day** · Status: v1 complete (details below)

---

## 1. What Khata Sathi is

A small shop runs on trust: regulars buy on credit (udhaar), the shopkeeper writes it
in a paper notebook (khata), and marks it paid when money comes back. That notebook has
problems: hard to read, easy to lose, no photos, no reminders, math mistakes.

Khata Sathi is that notebook as an app:

- The bill photo goes in from the phone.
- Khata Sathi reads the customer's name and the amount.
- A new name automatically gets a new account. An old name gets a new bill line.
- The shop laptop shows the same ledger, updating by itself.
- When money comes in, the balance drops — and every rupee of a balance can be traced
  back to the bill photo it came from.

## 2. The flow, step by step

1. Customer buys, gets a paper bill.
2. The bill photo goes into Khata Sathi from the phone — camera snap or gallery pick.
3. Khata Sathi reads the photo and fills in: name and total amount. The date is
   today, automatic — never typed, never read from the bill.
4. **Confirm screen** — everything is autofilled but always shown before saving,
   because a money app cannot save wrong numbers silently. While the name is being
   typed, existing people pop up as suggestions ("Ram Th" suggests *Ram Thapa — owes
   ₹1,200*) so the same person never gets two accounts.
5. New name → new account, automatic. Old name → new line in their ledger.
6. The laptop updates by itself. Phone and laptop use one address; the laptop shows a
   QR code so the phone connects by scanning once.
7. Customer pays → "Got money" records it → the balance drops. Payments clear the
   oldest bills first, and the app says which bills got cleared.
8. Click someone's balance → the open bills behind it, each with its photo and the
   part still unpaid.

## 3. Core features (must have — from the original plan)

| # | Feature |
|---|---------|
| 1 | Bill capture from phone camera or gallery |
| 2 | Auto-reading of name + total + date from the photo |
| 3 | Name autofill with suggestions; new names create accounts automatically |
| 4 | Per-person ledger in khata format — debit lines (bills) and credit lines (payments) with a running balance |
| 5 | Payments reduce the balance, oldest bills first; partial payments fine |
| 6 | Balance drill-down — click a balance, see the bills (with photos) it is made of |
| 7 | Live sync — what changes on the phone appears on the laptop by itself |
| 8 | Works on mobile and laptop from one address, no install needed |

## 4. QoL features — the full brainstorm

Marks: ★ = my pick for v1. Everything else is v1.5/v2 or rejected (sections 5 and 6).

### Fast entry
- ★ Fuzzy name suggestions while typing (stops "Ram Thapa" vs "R. Thapa" duplicates)
- ★ "Already paid" toggle on a bill — paid on the spot, photo kept as record only, no balance change
- Duplicate-photo warning — the same photo sent twice gets flagged
- Attach extra photos to one bill (long receipts)
- Big number pad for shop-speed entry

### Trust and safety (this is a money app)
- ★ Confirm screen before anything is saved
- ★ Every debit keeps its bill photo; every payment can keep a photo or a note ("paid by UPI")
- ★ Change trail — every edit/delete recorded (old value → new value, when); nothing vanishes silently
- ★ Day-end summary — total billed today, total collected today
- Shareable payment receipt

### Getting money back
- ★ Aging — days owed, oldest-first ordering
- One-tap WhatsApp-ready reminder text
- Optional due date per bill + overdue highlight

### Seeing clearly
- ★ Search by name, amount, or date
- ★ Dashboard — total to collect, today's in/out, top debtors
- ★ Share a statement as image/PDF (the dispute killer)
- ★ Export to Excel + one-click backup; daily auto-backup

### Accounts and people
- ★ Merge duplicate accounts (for when name variants slip through)
- Optional phone number per person
- PIN lock, dark mode

### Devices
- ★ QR code on the laptop screen — phone scans once, connected
- ★ Send confirmation — the phone shows "✓ received on laptop" the moment the bill lands
- ★ Installable on the phone home screen like a real app (no app store needed)
- Offline mode with queued entries (v2 — see section 6)

## 5. Why the ★ picks matter

Three of them carry the whole app:

1. **Confirm screen.** Photo reading is never perfect on crumpled thermal paper, and
   one wrong amount destroys trust in a money app forever. Autofill + one-tap fix is
   the law: fast like automatic, safe like manual.
2. **Fuzzy name suggestions.** The #1 way khata apps die in real shops is duplicate
   accounts — the same human saved as "Ram Thapa", "R. Thapa" and "Ram". Suggestions
   at the moment of typing, plus a merge tool as the safety net.
3. **Photo on every entry.** The paper khata's biggest fight is "I never took that
   much". Every debit has its bill photo; payments can have theirs. Trust on both sides.

The rest of the ★s are cheap and high value: aging and reminders get money back
faster, dashboard and search save scrolling, statement-share kills disputes, and
backup means a broken laptop is a bad day instead of a disaster.

## 6. What should NOT be built (it makes the app worse)

1. **Customer logins / OTP / passwords** — the customer's only job is handing over a
   photo; managing passwords for 200 regulars is friction that kills usage. Name +
   optional phone is enough. (v2 idea: a private link so a customer can view only
   their own ledger.)
2. **Full accounting** (double-entry books, tax reports) — this is a khata, not Tally.
   Complexity hides the one number that matters: who owes what.
3. **Inventory / stock management** — a different app entirely.
4. **Itemized line-item reading in v1** — name + total + date is the reliable 90% of a
   bill; line items on crumpled thermal paper are where reading fails. Items can come later.
5. **Two separate apps (native mobile + native desktop)** — two codebases, two sync
   problems. Instead: one web app, two faces (section 8) — the laptop gets a thin
   desktop shell (its own window, double-click to open), the phone stays a plain web
   page served by the laptop. Native feel, one app to maintain.
6. **Auto-saving what the photo reader found** — never, not once, without the confirm screen.
7. **Silent edits or hard deletes** — money history keeps its change trail.
8. **Storing bank/card details** — never; a note ("paid by UPI") is enough.
9. **Offline mode in v1** — genuinely useful for power cuts, but queued offline edits
   from two devices need conflict rules. v2, done properly.

## 7. Tricky parts and the plan for each

| Tricky part | Plan |
|---|---|
| Crumpled thermal photos | Confirm screen is the law; manual fix is always one tap away |
| Total vs subtotal vs tax on a bill | Confirm screen shows the photo beside the amount |
| Same person, different printed names | Suggestions while typing + merge tool |
| Bill with no readable name | Ask for the name before saving |
| Bill date vs entry date | Decided: only the real date — every entry is auto-stamped with the laptop clock the moment it's saved. Nothing to type, nothing to misread, no calendar math. If a bill's own date is ever wanted, it returns with the AI reader (v1.5) |
| Same photo sent twice | Image fingerprint check, gentle warning |
| Bill printed with Nepali digits (रू १,२३४) | Fixed 10-symbol lookup (०=0 … ९=9) converts them live — no AI, always on |
| Name written in Nepali (राम थापा) | Stored exactly as typed — Devanagari and Roman both work everywhere; search matches either. A fixed-mapping transliterator (राम थापा → Ram Thapa, no AI) can be added when needed |
| Nepali number words (एक हजार पाँच सय) on a bill | Rare on printed totals; a rule-based word→number parser can come later, still without AI |
| Receipt ink fading | Bonus: the photo archive outlives the paper |

## 8. Architecture — one app, two faces (decided)

One codebase. Two faces. The laptop is the brain, the phone is the camera.

- **The laptop** holds everything — the database (SQLite, one file), the photo folder,
  and the app itself (a small Python program, FastAPI). Double-click one file and
  Khata Sathi opens in its own window (a thin desktop shell — feels like a native
  desktop app, no browser tab, nothing to install). The same launcher packs into a
  single **.exe later with zero changes to the app**.
- **The phone** opens a web page served by the laptop (scan the QR on the laptop
  screen, once). No install, no app store. Its layout is phone-first: a big
  "Add bill" button, the people list, record payment — no dashboard, no clutter.
  The dashboard lives on the laptop, where there is room for it.
- **"Mobile sends the photo to the laptop"** — exactly how it works: the phone uploads
  the photo to the laptop over the shop Wi-Fi. The moment the laptop receives it, it
  appears on the laptop screen by itself, and the phone shows "✓ received on laptop".
  Both faces update live (Server-Sent Events — a simple always-open channel every
  browser supports).
- **One seller account** — the guard at the door. One login, the seller's; no buyer
  accounts, ever (buyers keep doing their only job: handing over the photo). Login is
  **name + PIN only** — no email, no passwords; it can grow into a full login if the
  cloud ever comes.
- **The v1 rule:** phone and laptop must be on the same shop Wi-Fi. Checking the
  ledger from outside the shop (home, mobile data) is the v2 cloud/tunnel question —
  kept out of v1 on purpose.

### Room for AI (manual first, AI later — decided)

The bill reader is a plug-in with one job: photo in → {name, total, date} out →
the SAME confirm screen, whichever mode is running.

- A "Bill reading" section will wait in Settings:
  - Mode: **Manual** (the default, always works, stays forever) / **AI**
  - If AI: Provider: **Local** (offline, runs on the laptop) / **API model**
    (cloud, needs a key + internet)
- Manual never disappears. If AI fails or reads badly, it falls back to manual —
  nothing breaks.
- None of this is built now. The only v1 duty is to keep the confirm screen the
  same for both modes, so adding AI later changes nothing the user sees.

**Data kept (plain words):**
- People — name, optional phone, notes
- Bills — person, amount, date (automatic — the real date it was recorded), photo,
  status (open / paid / voided), remaining amount
- Payments — person, amount, date, note, optional photo
- Payment→bill links — which bills a payment cleared, and how much of each
- Change trail — every change, old → new, when

**Screens (v1):**
1. Home — people with balances (cards on phone, table on laptop)
2. Add bill — camera → autofilled confirm screen
3. Person ledger — passbook style, running balance, photo thumbnails
4. Balance drill-down — open bills with photos and remaining amounts
5. Record payment — amount, note, preview: "clears 12 Aug ₹500 + part of 3 Sep ₹800"
6. Dashboard · Search · Settings (store name, currency, backup, PIN)

On the phone: home (people + balances), add bill, person ledger, record payment,
search. The dashboard, day-end, and settings-heavy views are laptop-first.

## 9. Version plan

- **v1.1 — SHIPPED 10 Sep 2026: renamed to Khata Sathi + the real खाता.** The person
  ledger is now drawn as the actual khata paper — मिति/विवरण/डेबिट/क्रेडिट/बाँकी
  columns, red margin line, जम्मा totals row, grand balance, Print button (prints just
  the ledger on paper), complete-credit box in the bill dialog (full amount → payments
  applied → remaining), statement in the same khata format. Works on both faces
  (phone + laptop), light + dark. Path: `capabilities_test/khatasathi`, launcher
  `KhataSathi.bat`. Math verified row-by-row in the browser (debit/credit totals match).
- **v1 — SHIPPED 9 Sep 2026 (as Billsathi).** Everything below in section 3 plus all ★ QoL picks:
  photo quality gate with plain-word retake, name suggestions, already-paid toggle,
  FIFO clearing preview, undo payment, void/unvoid with safety rules, merge duplicates,
  statement copy, aging, 30-day chart, dashboard, search, day-end, audit trail,
  backup/restore/CSV, demo shop, QR connect, live sync (SSE), dark mode, mobile +
  desktop faces, PWA install, Devanagari digits everywhere. Verified: 63/63 API
  tests + full browser walkthrough of every flow. See README.md to run it.

- **v1** — the whole core flow (section 3) + the approved ★ picks
- **v1.5** — AI bill reading (Manual stays the default; Local / API options in
  Settings) + reminder text, statement share, any ★s not picked
- **v2** — offline mode, remote access from outside the shop (cloud or tunnel),
  customer self-view link, multi-staff, due dates, multi-store

## 10. Decisions made (first review, 9 Sep 2026)

1. Photo reading — **manual first, AI later**; mode + provider options kept open (section 8)
2. App shape — **one web app, two faces**: laptop = brain + dashboard (thin desktop
   shell), phone = camera + quick lists (section 8)
3. QoL — **all ★ essentials into v1**
4. Accounts — **no buyer accounts**; one seller account only (PIN to start)
5. Building — nothing gets built until the green light
6. Currency — **Nepali rupee (रू / NPR)**, fixed
7. Desktop — **thin launcher now**; the same launcher packs into one .exe later
   with zero changes to the app
8. Seller login — **name + PIN only** (no email, no passwords)

## 11. Build defaults (no questions left — applied unless changed)

- Screen text in English; amounts shown as **रू 1,234**
- Dates like 12 Sep 2026; times on the shop's own clock
- First run asks for seller name + PIN (PIN stored hashed; changeable in Settings)
- Empty start, plus a "Load demo data" button in Settings to explore with fake
  people and bills before trusting it with real ones
- Database, photos, and backups live together in one `khatasathi` folder
- Amount fields accept Devanagari digits (१२३) and Arabic digits (123) alike —
  copy from the bill exactly as printed; converted live as you type
- No date is typed anywhere — every entry is automatically stamped with the real
  date it was made (the laptop's clock); the BS↔AD calendar table is shelved
  entirely. Names may be typed in Nepali (Devanagari) or English — both work in
  the ledger and in search

**Ready to build v1 on the word "go".**

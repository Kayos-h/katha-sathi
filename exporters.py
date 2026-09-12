"""Khata Sathi - share exporters: PDF and Excel.

PDF: pages drawn with Pillow and wrapped in a minimal PDF container, so it
works with zero new dependencies. Each khata page looks like the app's khata:
title strip, meta line, table (Date | Particulars | Debit | Credit | Balance),
totals row, grand balance. Bill photos follow on their own pages, captioned.

Excel: one sheet per person khata via openpyxl, styled: header fill, borders,
money formats, totals row, auto column widths.

Both take data from db.khata_export() so the numbers can never disagree
with the app.
"""
import io
import os
import zlib
from datetime import datetime

from PIL import Image, ImageDraw, ImageFont

import db

# ---------- shared money/date formatting (plain, ASCII for pdf) ----------

def _money_plain(v):
    v = round(float(v or 0), 2)
    s = format(int(v), ",d") if v == int(v) else format(v, ",.2f")
    return "Rs " + s


def _date_plain(iso):
    if not iso:
        return ""
    try:
        d = datetime.strptime(iso[:10], "%Y-%m-%d")
        return d.strftime("%d %b %Y")
    except ValueError:
        return iso[:10]


def _pick_font(size, bold=False):
    """Segoe UI for Latin; Nirmala for any Devanagari that slips through."""
    candidates = [
        r"C:\Windows\Fonts\segoeuib.ttf" if bold else r"C:\Windows\Fonts\segoeui.ttf",
        r"C:\Windows\Fonts\arialbd.ttf" if bold else r"C:\Windows\Fonts\arial.ttf",
    ]
    for path in candidates:
        if os.path.exists(path):
            try:
                return ImageFont.truetype(path, size)
            except OSError:
                continue
    return ImageFont.load_default()


def _pick_dev_font(size):
    path = r"C:\Windows\Fonts\Nirmala.ttc"
    if os.path.exists(path):
        try:
            return ImageFont.truetype(path, size)
        except OSError:
            pass
    return _pick_font(size, True)


def _has_devanagari(s):
    return any(0x0900 <= ord(ch) <= 0x097F for ch in str(s))


def _font_for(text, size, bold=False):
    if _has_devanagari(text):
        return _pick_dev_font(size)
    return _pick_font(size, bold)


# =====================================================================
# PDF: image pages wrapped in a minimal but valid PDF 1.4 file
# =====================================================================

A4_W, A4_H = 1240, 1754  # 150dpi-ish A4 ratio
MARGIN = 70
RED = (189, 67, 57)
INK = (35, 30, 24)
MUTED = (122, 112, 95)
PAPER = (255, 253, 246)
RULE = (222, 213, 190)
HEAD_BG = (247, 242, 229)
GREEN = (21, 115, 71)

COLS = [MARGIN, MARGIN + 150, MARGIN + 560, MARGIN + 760, MARGIN + 960, A4_W - MARGIN]
# date | particulars | debit | credit | balance


def _new_page():
    img = Image.new("RGB", (A4_W, A4_H), PAPER)
    return img, ImageDraw.Draw(img)


def _table_header(d, y):
    d.rectangle([COLS[0], y, COLS[-1], y + 34], fill=HEAD_BG)
    d.line([COLS[0], y, COLS[-1], y], fill=INK, width=2)
    d.line([COLS[0], y + 34, COLS[-1], y + 34], fill=INK, width=2)
    labels = ["Date", "Particulars", "Debit", "Credit", "Balance"]
    f = _pick_font(17, True)
    aligns = ["l", "l", "r", "r", "r"]
    for i, lab in enumerate(labels):
        w = d.textlength(lab, font=f)
        x = COLS[i] + (8 if aligns[i] == "l" else COLS[i + 1] - COLS[i] - 10 - w)
        d.text((x, y + 8), lab, font=f, fill=INK)
    return y + 34


def _row(d, y, cells, bold=False, muted=False, strike=False):
    f = _font_for(cells[1], 17, bold)
    fn = _pick_font(17, bold)
    fill = MUTED if muted else INK
    # date
    d.text((COLS[0] + 8, y + 7), cells[0], font=fn, fill=fill)
    # particulars (may contain Devanagari name or plain text)
    pf = _font_for(cells[1], 17, bold)
    d.text((COLS[1] + 8, y + 7), cells[1], font=pf, fill=fill)
    if strike:
        w = d.textlength(cells[1], font=pf)
        d.line([COLS[1] + 8, y + 16, COLS[1] + 8 + w, y + 16], fill=fill, width=2)
    # money cells
    for i, txt in ((2, cells[2]), (3, cells[3]), (4, cells[4])):
        if txt:
            w = d.textlength(txt, font=fn)
            d.text((COLS[i + 1] - 10 - w, y + 7), txt, font=fn, fill=fill)
    d.line([COLS[0], y, COLS[0], y + ROW_H], fill=RULE, width=1)
    d.line([COLS[-1], y, COLS[-1], y + ROW_H], fill=RULE, width=1)
    d.line([COLS[0], y + ROW_H, COLS[-1], y + ROW_H], fill=RULE, width=1)
    return y + ROW_H


ROW_H = 42


def _pdf_from_jpegs(jpeg_pages, widths, heights):
    """Minimal valid PDF from a list of JPEG byte strings."""
    npages = len(jpeg_pages)
    # object numbering: 1 catalog, 2 pages, then per page: img, content, page
    objects = {}  # num -> bytes (full object body without "N 0 obj"/"endobj")

    def build():
        buf = bytearray(b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n")
        offsets = {}

        def add(num, body):
            offsets[num] = len(buf)
            buf.extend(("%d 0 obj\n" % num).encode())
            buf.extend(body)
            buf.extend(b"\nendobj\n")

        # placeholders written at the end so we can compute offsets
        page_nums = []
        obj_count = 3  # 1 catalog, 2 pages
        per_page = []
        for i in range(npages):
            img_num = obj_count; obj_count += 1
            content_num = obj_count; obj_count += 1
            page_num = obj_count; obj_count += 1
            per_page.append((img_num, content_num, page_num))

        kids = " ".join("%d 0 R" % p[2] for p in per_page)
        add(1, b"<< /Type /Catalog /Pages 2 0 R >>")
        add(2, ("<< /Type /Pages /Kids [%s] /Count %d >>" % (kids, npages)).encode())

        for i, (img_num, content_num, page_num) in enumerate(per_page):
            w, h = widths[i], heights[i]
            data = jpeg_pages[i]
            img_body = (b"<< /Type /XObject /Subtype /Image /Width " + str(w).encode() +
                        b" /Height " + str(h).encode() +
                        b" /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length " +
                        str(len(data)).encode() + b" >>\nstream\n" + data + b"\nendstream")
            add(img_num, img_body)

            content = ("q\n%d 0 0 %d 0 0 cm\n/I%d Do\nQ\n" % (595, 842, i + 1)).encode()
            add(content_num, b"<< /Length " + str(len(content)).encode() + b" >>\nstream\n" + content + b"endstream")

            page_body = (b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] "
                         b"/Resources << /XObject << /I" + str(i + 1).encode() +
                         b" " + str(img_num).encode() + b" 0 R >> >> /Contents " +
                         str(content_num).encode() + b" 0 R >>")
            add(page_num, page_body)

        xref_pos = len(buf)
        total = max(offsets) + 1
        buf.extend(("xref\n0 %d\n" % total).encode())
        buf.extend(b"0000000000 65535 f \n")
        for num in range(1, total):
            buf.extend(("%010d 00000 n \n" % offsets[num]).encode())
        buf.extend(("trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n" % (total, xref_pos)).encode())
        return bytes(buf)

    return build()


def _safe_filename(name):
    """Download-safe filename part: keep letters (any script), digits, space, dash."""
    cleaned = "".join(c if (c.isalnum() or c in " -_") else "" for c in str(name))
    cleaned = cleaned.strip().replace(" ", "-") or "khata"
    return cleaned[:60]


def khata_pdf(data, store_name=""):
    """Render one person's khata as PDF bytes. Returns (bytes, filename)."""
    p = data["person"]
    rows = data["rows"]
    safe_name = _safe_filename(p["name"])

    png_pages = []

    # ---- page 1..n: the khata table ----
    img, d = _new_page()
    y = MARGIN
    # header strip
    f_big = _font_for(p["name"], 34, True)
    d.text((MARGIN, y), "KHATA", font=_pick_font(34, True), fill=INK)
    nw = d.textlength(p["name"], font=f_big)
    d.text((MARGIN + 170, y), "- " + p["name"], font=f_big, fill=RED)
    d.text((MARGIN, y + 46), (store_name or "Khata Sathi") + "  ·  generated " +
           datetime.now().strftime("%d %b %Y, %H:%M"), font=_pick_font(16), fill=MUTED)
    y += 84
    meta = "Phone: " + (p.get("phone") or "-") + "    Since: " + _date_plain(p.get("created_at")) + \
           "    Entries: " + str(len(rows))
    d.text((MARGIN, y), meta, font=_pick_font(16), fill=MUTED)
    y += 30
    d.line([MARGIN, y, A4_W - MARGIN, y], fill=INK, width=3)
    y += 6

    y = _table_header(d, y)

    total_dr, total_cr = 0.0, 0.0
    photo_bills = []
    for r in rows:
        if y + ROW_H + 130 > A4_H - MARGIN:  # need room for totals too
            png_pages.append(img)
            img, d = _new_page()
            y = _table_header(d, MARGIN)
        is_pay = r["kind"] == "payment"
        counter = (not is_pay) and r.get("already_paid")
        date_c = _date_plain(r["at"])
        part = "Payment received" if is_pay else ("Bill - paid at counter" if counter else "Bill - credit given")
        if r.get("note"):
            part += " - " + r["note"]
        if r.get("photo"):
            part += "  [photo]"
            photo_bills.append((r, ))
        debit = "" if (is_pay or counter) else _money_plain(r["amount"])
        credit = _money_plain(r["amount"]) if (is_pay or counter) else ""
        if not is_pay and not counter and r.get("status") != "void":
            total_dr += r["amount"]
        if is_pay or counter:
            total_cr += r["amount"]
        bal = _money_plain(r.get("balance_after", 0))
        y = _row(d, y, [date_c, part, debit, credit, bal],
                 muted=r.get("status") == "void", strike=r.get("status") == "void")

    # totals row
    if y + 60 > A4_H - MARGIN:
        png_pages.append(img)
        img, d = _new_page()
        y = _table_header(d, MARGIN)
    d.rectangle([COLS[0], y, COLS[-1], y + 46], fill=HEAD_BG)
    d.line([COLS[0], y, COLS[-1], y], fill=INK, width=3)
    d.line([COLS[0], y + 46, COLS[-1], y + 46], fill=INK, width=3)
    f_t = _pick_font(18, True)
    d.text((COLS[0] + 8, y + 12), "TOTAL", font=f_t, fill=INK)
    for i, txt in ((2, _money_plain(total_dr)), (3, _money_plain(total_cr)), (4, _money_plain(data["balance"]))):
        w = d.textlength(txt, font=f_t)
        d.text((COLS[i + 1] - 10 - w, y + 12), txt, font=f_t, fill=INK)
    y += 66
    grand_lbl = "BALANCE OWED" if data["balance"] > 0.004 else "ALL CLEAR"
    f_g = _pick_font(22, True)
    gw = d.textlength(grand_lbl + "  " + _money_plain(data["balance"]), font=f_g)
    d.text((A4_W - MARGIN - gw, y), grand_lbl + "  " + _money_plain(data["balance"]),
           font=f_g, fill=RED if data["balance"] > 0.004 else GREEN)
    png_pages.append(img)

    # ---- photo pages: bill photos, 2 per page ----
    pairs = [photo_bills[i:i + 2] for i in range(0, len(photo_bills), 2)]
    for pair in pairs:
        img, d = _new_page()
        y = MARGIN
        d.text((MARGIN, y), "Bill photos - " + p["name"], font=_pick_font(26, True), fill=INK)
        y += 50
        for (r,) in pair:
            path = db.PHOTO_DIR + os.sep + r["photo"]
            try:
                if not os.path.exists(path):
                    raise FileNotFoundError
                ph = Image.open(path)
                ph.load()
                ph = ph.convert("RGB")
                # fit in a box 520x600
                max_w, max_h = 500, 580
                scale = min(max_w / ph.width, max_h / ph.height, 1.0)
                ph = ph.resize((max(1, int(ph.width * scale)), max(1, int(ph.height * scale))))
                cap = _date_plain(r["at"]) + "  -  " + _money_plain(r["amount"]) + \
                      ("  - " + r["note"] if r.get("note") else "")
                d.text((MARGIN, y), cap, font=_pick_font(17), fill=MUTED)
                y += 26
                img.paste(ph, (MARGIN, y))
                y += ph.height + 26
            except Exception:
                d.text((MARGIN, y), "photo missing: " + str(r.get("photo")), font=_pick_font(16), fill=MUTED)
                y += 30
        png_pages.append(img)

    # to JPEG pages
    jpegs, widths, heights = [], [], []
    for pg in png_pages:
        buf = io.BytesIO()
        pg.save(buf, "JPEG", quality=88)
        jpegs.append(buf.getvalue())
        widths.append(pg.width)
        heights.append(pg.height)

    pdf_bytes = _pdf_from_jpegs(jpegs, widths, heights)
    return pdf_bytes, "khata-%s.pdf" % safe_name


# =====================================================================
# Bill PDF: the estimate form - S.N. | PARTICULARS | QTY | RATE | AMOUNT
# (matches the shop's printed form: Brought to, ESTIMATE box, totals,
#  "Goods once sold..." note, THANK YOU, signature)
# =====================================================================

BILL_BLUE = (37, 78, 122)


def bill_pdf(bill, person, store_name=""):
    """One itemized bill as PDF bytes, laid out like the shop's estimate form."""
    safe_name = _safe_filename(person["name"])
    img, d = _new_page()

    # form border, like the printed sheet
    d.rectangle([MARGIN - 20, MARGIN - 20, A4_W - MARGIN + 20, A4_H - MARGIN + 20],
                outline=BILL_BLUE, width=4)

    y = MARGIN
    # top-left: Brought to / seller; top-right: ESTIMATE box
    d.text((MARGIN, y), "Brought to:", font=_pick_font(19, True), fill=INK)
    d.text((MARGIN, y + 30), person["name"], font=_font_for(person["name"], 24), fill=INK)
    phone = (person.get("phone") or "").strip()
    if phone:
        d.text((MARGIN, y + 66), "Phone: " + phone, font=_pick_font(16), fill=MUTED)
    store = (store_name or "").strip()
    if store:
        d.text((MARGIN, y + 92), store, font=_pick_font(16, True), fill=MUTED)

    box_w, box_h = 300, 64
    bx = A4_W - MARGIN - box_w
    d.rectangle([bx, y, bx + box_w, y + box_h], fill=BILL_BLUE)
    tw = d.textlength("ESTIMATE", font=_pick_font(30, True))
    d.text((bx + (box_w - tw) / 2, y + 14), "ESTIMATE", font=_pick_font(30, True),
           fill=(255, 255, 255))
    # bill no + date under the box, like the printed form
    bill_no = bill.get("bill_no") or ""
    when = bill.get("created_at") or ""
    d.text((bx, y + box_h + 14), "Bill No.: " + bill_no, font=_pick_font(17), fill=INK)
    d.text((bx, y + box_h + 40), "Date: " + _date_plain(when), font=_pick_font(17), fill=INK)

    y += 150
    d.line([MARGIN, y, A4_W - MARGIN, y], fill=RULE, width=2)
    y += 14

    # item table: S.N. | PARTICULARS | QTY. | RATE | AMOUNT (Rs)
    cols = [MARGIN, MARGIN + 70, MARGIN + 620, MARGIN + 780, MARGIN + 950, A4_W - MARGIN]
    head_h, row_h = 40, 42
    d.rectangle([cols[0], y, cols[-1], y + head_h], fill=HEAD_BG)
    labels = ["S.N.", "PARTICULARS", "QTY.", "RATE", "AMOUNT"]
    aligns = ["c", "l", "r", "r", "r"]
    for i, lab in enumerate(labels):
        f = _pick_font(17, True)
        w = d.textlength(lab, font=f)
        if aligns[i] == "l":
            x = cols[i] + 10
        elif aligns[i] == "c":
            x = cols[i] + (cols[i + 1] - cols[i] - w) / 2
        else:
            x = cols[i + 1] - 10 - w
        d.text((x, y + 11), lab, font=f, fill=INK)
    y += head_h

    for it in bill.get("items") or []:
        # wrap long particulars within the column
        pf = _font_for(it["particulars"], 17)
        part = str(it["particulars"])
        max_w = cols[2] - cols[1] - 20
        while d.textlength(part, font=pf) > max_w and len(part) > 4:
            part = part[:-2]
        if part != str(it["particulars"]):
            part = part + "…"
        qty = ("%g" % it["qty"]) if it.get("qty") else ""
        rate = ("%g" % it["rate"]) if it.get("rate") else ""
        amt = _money_plain(it["amount"])
        f_num = _pick_font(17)
        for i, (txt, al) in enumerate([(str(it["sn"]), "c"), (part, "l"),
                                       (qty, "r"), (rate, "r"), (amt, "r")]):
            w = d.textlength(txt, font=f_num)
            x = (cols[i] + (cols[i + 1] - cols[i] - w) / 2 if al == "c"
                 else cols[i] + 10 if al == "l" else cols[i + 1] - 10 - w)
            d.text((x, y + 11), txt, font=f_num, fill=INK)
        for c in cols:
            d.line([c, y, c, y + row_h], fill=RULE, width=1)
        d.line([cols[0], y + row_h, cols[-1], y + row_h], fill=RULE, width=1)
        y += row_h

    # TOTAL row
    d.rectangle([cols[0], y, cols[-1], y + 46], fill=HEAD_BG)
    d.line([cols[0], y, cols[-1], y], fill=INK, width=3)
    d.line([cols[0], y + 46, cols[-1], y + 46], fill=INK, width=3)
    f_t = _pick_font(19, True)
    d.text((cols[0] + 10, y + 12), "TOTAL", font=f_t, fill=INK)
    tot = _money_plain(bill.get("amount", 0))
    tw = d.textlength(tot, font=f_t)
    d.text((cols[-1] - 10 - tw, y + 12), tot, font=f_t, fill=INK)
    y += 70

    # in-words line
    words = _money_words(bill.get("amount", 0))
    if words:
        d.text((MARGIN, y), "In words: " + words, font=_pick_font(16, True), fill=INK)
        y += 34

    if bill.get("note"):
        note = str(bill["note"])
        nf = _font_for(note, 16)
        d.text((MARGIN, y), "Note: " + note, font=nf, fill=MUTED)
        y += 30

    # footer, like the printed form
    fy = A4_H - MARGIN - 150
    d.text((MARGIN, fy), "THANK YOU!", font=_pick_font(22, True), fill=INK)
    d.text((MARGIN + 330, fy), "Goods once sold will not be taken back. E.&O.E.",
           font=_pick_font(14), fill=MUTED)
    d.text((A4_W - MARGIN - 180, fy - 26), "SIGNATURE", font=_pick_font(16, True), fill=MUTED)
    d.line([A4_W - MARGIN - 220, fy + 6, A4_W - MARGIN, fy + 6], fill=RULE, width=2)

    # JPEG -> PDF (photo of the paper bill, if any, follows as page 2)
    pages = [(img, "page")]
    photo_name = (bill.get("photo") or "").strip()
    if photo_name:
        path = db.PHOTO_DIR + os.sep + photo_name
        try:
            if not os.path.exists(path):
                raise FileNotFoundError
            ph = Image.open(path)
            ph.load()
            ph = ph.convert("RGB")
            max_w, max_h = 1000, 1500
            scale = min(max_w / ph.width, max_h / ph.height, 1.0)
            ph = ph.resize((max(1, int(ph.width * scale)), max(1, int(ph.height * scale))))
            pimg, pd = _new_page()
            pd.text((MARGIN, MARGIN), "Bill photo - " + person["name"],
                    font=_pick_font(26, True), fill=INK)
            pimg.paste(ph, (MARGIN, MARGIN + 56))
            pages.append((pimg, "photo"))
        except Exception:
            pass
    jpegs, widths, heights = [], [], []
    for pg, _tag in pages:
        buf = io.BytesIO()
        pg.save(buf, "JPEG", quality=88)
        jpegs.append(buf.getvalue())
        widths.append(pg.width)
        heights.append(pg.height)
    pdf_bytes = _pdf_from_jpegs(jpegs, widths, heights)
    fname = "bill-%s-%s.pdf" % (bill_no.replace("INV-", "") if bill_no else "na",
                                safe_name)
    return pdf_bytes, fname


ONES = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine",
        "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen",
        "Seventeen", "Eighteen", "Nineteen"]
TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty",
        "Ninety"]


def _three_digits(n):
    out = []
    if n >= 100:
        out.append(ONES[n // 100] + " Hundred")
        n %= 100
    if n >= 20:
        out.append(TENS[n // 10] + (" " + ONES[n % 10] if n % 10 else ""))
    elif n:
        out.append(ONES[n])
    return " ".join(out)


def _money_words(v):
    """Amount in words, lakh-crore style (Nepali/Indian money speech)."""
    try:
        v = int(round(float(v or 0)))
    except (TypeError, ValueError):
        return ""
    if v <= 0:
        return ""
    crore, rest = divmod(v, 10000000)
    lakh, rest = divmod(rest, 100000)
    thousand, rest = divmod(rest, 1000)
    parts = []
    if crore:
        parts.append(_three_digits(crore) + " Crore")
    if lakh:
        parts.append(_three_digits(lakh) + " Lakh")
    if thousand:
        parts.append(_three_digits(thousand) + " Thousand")
    if rest:
        parts.append(_three_digits(rest))
    return ", ".join(parts) + " Rupees Only"


# =====================================================================
# Galla PDF: one day's cash drawer — every in/out, exact spending, closing
# =====================================================================

def galla_pdf(data, store_name=""):
    """One day's galla as PDF bytes: entries table + where-the-money-went box."""
    d_ = data["date"]
    img, d = _new_page()
    y = MARGIN

    d.text((MARGIN, y), "GALLA", font=_pick_font(34, True), fill=INK)
    d.text((MARGIN + 150, y), "- the day's cash drawer", font=_pick_font(20), fill=MUTED)
    d.text((MARGIN, y + 46), (store_name or "Khata Sathi") + "  ·  " +
           _date_plain(d_) + "  ·  generated " +
           datetime.now().strftime("%d %b %Y, %H:%M"), font=_pick_font(16), fill=MUTED)
    y += 84
    d.line([MARGIN, y, A4_W - MARGIN, y], fill=INK, width=3)
    y += 10

    if not data.get("open"):
        d.text((MARGIN, y), "The galla was never opened on this day.",
               font=_pick_font(18), fill=MUTED)
        buf = io.BytesIO()
        img.save(buf, "JPEG", quality=88)
        return _pdf_from_jpegs([buf.getvalue()], [img.width], [img.height]), \
            "galla-%s.pdf" % d_

    # entries table: time | direction | note | amount
    cols = [MARGIN, MARGIN + 170, MARGIN + 300, MARGIN + 800, A4_W - MARGIN]
    d.rectangle([cols[0], y, cols[-1], y + 38], fill=HEAD_BG)
    for i, lab in enumerate(["Time", "In/Out", "Note", "Amount"]):
        f = _pick_font(16, True)
        w = d.textlength(lab, font=f)
        x = cols[i] + 10 if i < 3 else cols[i + 1] - 10 - w
        d.text((x, y + 10), lab, font=f, fill=INK)
    y += 38

    d.text((cols[0] + 10, y + 10), "morning", font=_pick_font(16), fill=MUTED)
    d.text((cols[1] + 10, y + 10), "opening", font=_pick_font(16), fill=MUTED)
    d.text((cols[2] + 10, y + 10), "cash at the start of the day",
           font=_pick_font(16), fill=MUTED)
    tw = d.textlength(_money_plain(data["opening"]), font=_pick_font(16, True))
    d.text((cols[-1] - 10 - tw, y + 10), _money_plain(data["opening"]),
           font=_pick_font(16, True), fill=INK)
    d.line([cols[0], y + 40, cols[-1], y + 40], fill=RULE, width=1)
    y += 40

    for e in data.get("entries", []):
        f = _font_for(e.get("note") or "", 16)
        t = (e.get("at") or "")[11:16] or "-"
        d.text((cols[0] + 10, y + 10), t, font=_pick_font(16), fill=INK)
        is_in = e["direction"] == "in"
        d.text((cols[1] + 10, y + 10), "IN" if is_in else "OUT",
               font=_pick_font(16, True), fill=GREEN if is_in else RED)
        d.text((cols[2] + 10, y + 10), e.get("note") or "", font=f, fill=INK)
        amt = _money_plain(e["amount"])
        w = d.textlength(amt, font=_pick_font(16, True))
        d.text((cols[-1] - 10 - w, y + 10), amt, font=_pick_font(16, True),
               fill=GREEN if is_in else RED)
        d.line([cols[0], y + 40, cols[-1], y + 40], fill=RULE, width=1)
        y += 40

    # where the money went: the box the vendor shares
    y += 16
    box_x2 = MARGIN + 560
    d.rectangle([MARGIN, y, box_x2, y + 208], fill=HEAD_BG)
    f_h = _pick_font(18, True)
    d.text((MARGIN + 16, y + 14), "WHERE THE MONEY WENT", font=f_h, fill=INK)
    yy = y + 50
    rows = [
        ("Opening cash (morning)", _money_plain(data["opening"]), INK),
        ("Cash put in", "+" + _money_plain(data["cash_in"]), GREEN),
        ("Cash taken out / spent", "-" + _money_plain(data["cash_out"]), RED),
        ("Expected in drawer", _money_plain(data["expected"]), INK),
    ]
    for lab, val, color in rows:
        d.text((MARGIN + 16, yy), lab, font=_pick_font(16), fill=MUTED)
        w = d.textlength(val, font=_pick_font(16, True))
        d.text((box_x2 - 16 - w, yy), val, font=_pick_font(16, True), fill=color)
        yy += 34

    # closing + difference card on the right
    cx = MARGIN + 600
    if data.get("closed"):
        diff = data.get("difference") or 0.0
        if abs(diff) < 0.005:
            d.rectangle([cx, y, A4_W - MARGIN, y + 208], fill=(219, 240, 228))
            verdict, color, vline = "ALL COUNTED — EXACT", GREEN, "The drawer matches the book."
        elif diff > 0:
            d.rectangle([cx, y, A4_W - MARGIN, y + 208], fill=(253, 246, 178))
            verdict, color, vline = "SURPLUS", (146, 64, 14), "More cash than the book says."
        else:
            d.rectangle([cx, y, A4_W - MARGIN, y + 208], fill=(253, 232, 232))
            verdict, color, vline = "SHORT", RED, "Less cash than the book says — recount."
        d.text((cx + 20, y + 14), verdict, font=_pick_font(22, True), fill=color)
        big = _money_plain(abs(diff))
        wb = d.textlength(big, font=_pick_font(34, True))
        d.text((cx + 20 + (A4_W - MARGIN - cx - 40 - wb) / 2, y + 60), big,
               font=_pick_font(34, True), fill=color)
        d.text((cx + 20, y + 128), vline, font=_pick_font(15), fill=MUTED)
        wcl = _money_plain(data["closing"])
        wc = d.textlength("Counted at closing: " + wcl, font=_pick_font(16, True))
        d.text((cx + (A4_W - MARGIN - cx - wc) / 2, y + 170),
               "Counted at closing: " + wcl, font=_pick_font(16, True), fill=INK)
    else:
        d.rectangle([cx, y, A4_W - MARGIN, y + 208], fill=HEAD_BG)
        d.text((cx + 20, y + 14), "DAY NOT CLOSED", font=_pick_font(20, True), fill=MUTED)
        d.text((cx + 20, y + 60), "Count the cash at the end of the day and close",
               font=_pick_font(15), fill=MUTED)
        d.text((cx + 20, y + 84), "the galla — then this sheet shows the verdict.",
               font=_pick_font(15), fill=MUTED)
        big = _money_plain(data["expected"])
        wb = d.textlength(big, font=_pick_font(28, True))
        d.text((cx + 20 + (A4_W - MARGIN - cx - 40 - wb) / 2, y + 130), big,
               font=_pick_font(28, True), fill=INK)
        d.text((cx + 20, y + 180), "expected in the drawer right now",
               font=_pick_font(14), fill=MUTED)

    d.text((MARGIN, A4_H - MARGIN - 20), (store_name or "Khata Sathi") +
           " — galla for " + _date_plain(d_), font=_pick_font(14), fill=MUTED)

    buf = io.BytesIO()
    img.save(buf, "JPEG", quality=88)
    return _pdf_from_jpegs([buf.getvalue()], [img.width], [img.height]), \
        "galla-%s.pdf" % d_

# =====================================================================
# Excel via openpyxl
# =====================================================================

def khata_xlsx(data, store_name=""):  # noqa: C901 (long, linear, fine)
    import openpyxl
    from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
    from openpyxl.utils import get_column_letter

    p = data["person"]
    rows = data["rows"]
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Khata"

    thin = Side(style="thin", color="C8BFA8")
    border = Border(left=thin, right=thin, top=thin, bottom=thin)
    head_fill = PatternFill("solid", fgColor="F2EDDD")
    total_fill = PatternFill("solid", fgColor="E4DCC2")
    red_font = Font(color="B3362B", bold=True)
    green_font = Font(color="157347", bold=True)

    # title block
    ws["A1"] = "KHATA - " + p["name"]
    ws["A1"].font = Font(size=15, bold=True)
    ws["A2"] = (store_name or "Khata Sathi") + "  ·  generated " + datetime.now().strftime("%d %b %Y, %H:%M")
    ws["A2"].font = Font(size=9, color="7A7060")
    ws["A3"] = "Phone: %s   Since: %s" % (p.get("phone") or "-", _date_plain(p.get("created_at")))
    ws["A3"].font = Font(size=9, color="7A7060")

    headers = ["Date", "Particulars", "Debit", "Credit", "Balance"]
    hr = 5
    for c, h in enumerate(headers, 1):
        cell = ws.cell(row=hr, column=c, value=h)
        cell.font = Font(bold=True)
        cell.fill = head_fill
        cell.border = border

    total_dr, total_cr = 0.0, 0.0
    r_out = hr + 1
    for r in rows:
        is_pay = r["kind"] == "payment"
        counter = (not is_pay) and r.get("already_paid")
        part = "Payment received" if is_pay else ("Bill - paid at counter" if counter else "Bill - credit given")
        if r.get("note"):
            part += " - " + r["note"]
        if r.get("photo"):
            part += " [photo]"
        debit = None if (is_pay or counter) else r["amount"]
        credit = r["amount"] if (is_pay or counter) else None
        if not is_pay and not counter and r.get("status") != "void":
            total_dr += r["amount"]
        if is_pay or counter:
            total_cr += r["amount"]
        ws.cell(row=r_out, column=1, value=_date_plain(r["at"])).border = border
        c2 = ws.cell(row=r_out, column=2, value=part)
        c2.border = border
        if r.get("status") == "void":
            c2.font = Font(strike=True, color="A89F8C")
        if debit is not None:
            c3 = ws.cell(row=r_out, column=3, value=debit)
            c3.number_format = '#,##0.00'
            c3.border = border
            c3.font = red_font
        else:
            ws.cell(row=r_out, column=3, value="").border = border
        if credit is not None:
            c4 = ws.cell(row=r_out, column=4, value=credit)
            c4.number_format = '#,##0.00'
            c4.border = border
            c4.font = green_font
        else:
            ws.cell(row=r_out, column=4, value="").border = border
        c5 = ws.cell(row=r_out, column=5, value=r.get("balance_after", 0))
        c5.number_format = '#,##0.00'
        c5.border = border
        r_out += 1

    # totals
    ws.cell(row=r_out, column=2, value="TOTAL").font = Font(bold=True)
    ws.cell(row=r_out, column=2).fill = total_fill
    for col, val in ((3, total_dr), (4, total_cr), (5, data["balance"])):
        c = ws.cell(row=r_out, column=col, value=val)
        c.number_format = '#,##0.00'
        c.font = Font(bold=True)
        c.fill = total_fill
    for col in range(1, 6):
        ws.cell(row=r_out, column=col).border = border
    r_out += 2
    owe = data["balance"] > 0.004
    c = ws.cell(row=r_out, column=2, value="BALANCE OWED" if owe else "ALL CLEAR")
    grand_font = Font(bold=True, size=12, color="B3362B" if owe else "157347")
    c.font = grand_font
    c2 = ws.cell(row=r_out, column=3, value=data["balance"])
    c2.number_format = '#,##0.00'
    c2.font = grand_font

    widths = [14, 46, 13, 13, 13]
    for i, w in enumerate(widths, 1):
        ws.column_dimensions[get_column_letter(i)].width = w
    ws.freeze_panes = "A6"

    # ---- sheet 2: bill photos list ----
    w2 = wb.create_sheet("Bill photos")
    w2.append(["Date", "Amount (Rs)", "Note", "Photo file"])
    for cell_r in w2[1]:
        cell_r.font = Font(bold=True)
        cell_r.fill = head_fill
    for r in rows:
        if r.get("photo") and r["kind"] == "bill":
            w2.append([_date_plain(r["at"]), r["amount"], r.get("note") or "", r["photo"]])
    for i, w in enumerate([14, 13, 30, 44], 1):
        w2.column_dimensions[get_column_letter(i)].width = w

    out = io.BytesIO()
    wb.save(out)
    return out.getvalue(), "khata-%s.xlsx" % _safe_filename(p["name"])

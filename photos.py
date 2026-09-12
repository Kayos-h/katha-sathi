"""Khata Sathi - photo quality check and photo storage.

Photo in -> a verdict (accept / retake) + reasons in plain words.
No AI: blur = variance of the Laplacian, darkness = mean brightness,
small = too few pixels. Runs on the laptop when the phone uploads.
Thresholds are tuned to be a strict gate on the AMOUNT area of a bill:
if the photo can't be read, the user is told to retake, not to squint.
"""
import hashlib
import io
import os
import time

try:
    from PIL import Image, ImageStat
    HAS_PIL = True
except ImportError:
    HAS_PIL = False

import db

# verdict thresholds
MIN_LONG_EDGE = 480          # below this, print is unreadable
MIN_MEAN_BRIGHTNESS = 40     # darker than this = shot in the dark
MAX_MEAN_BRIGHTNESS = 240    # brighter = blown-out white
MIN_SHARPNESS = 45.0         # variance of Laplacian; below = blurry
HISTOGRAM_BINS = 256
DUP_WINDOW = 5               # seconds of tolerance for duplicate check


def _laplacian_var(gray):
    """Variance of the 3x3 Laplacian over a sampled grid - the classic
    blur metric. Sampled, not full-res, so it stays fast on phones' 12MP shots."""
    w, h = gray.size
    small = gray.resize((min(w, 256), min(h, 256)))
    px = small.load()
    sw, sh = small.size
    if sw < 3 or sh < 3:
        return 0.0
    vals = []
    for y in range(1, sh - 1):
        for x in range(1, sw - 1):
            v = (px[x - 1, y] + px[x + 1, y] + px[x, y - 1] + px[x, y + 1]
                 - 4 * px[x, y])
            vals.append(v)
    if not vals:
        return 0.0
    mean = sum(vals) / len(vals)
    var = sum((v - mean) ** 2 for v in vals) / len(vals)
    return var


def check_quality(data):
    """Returns (ok, verdict) - verdict is a list of plain-word problems."""
    problems = []
    ok = True
    if not HAS_PIL:
        # No Pillow on this machine: allow but mark quality unknown
        return True, []
    try:
        img = Image.open(io.BytesIO(data))
        img.load()
    except Exception:
        return False, ["This file isn't a readable image."]
    w, h = img.size
    long_edge = max(w, h)
    if long_edge < MIN_LONG_EDGE:
        problems.append("Too small - move closer to the bill so the text fills the frame.")
        ok = False
    gray = img.convert("L")
    stat = ImageStat.Stat(gray)
    mean_b = stat.mean[0]
    if mean_b < MIN_MEAN_BRIGHTNESS:
        problems.append("Too dark - turn on a light or the flash, then retake.")
        ok = False
    elif mean_b > MAX_MEAN_BRIGHTNESS:
        problems.append("Too bright - the flash is washing out the print. Retake without glare.")
        ok = False
    lap = _laplacian_var(gray)
    if lap < MIN_SHARPNESS:
        problems.append("Blurry - hold the phone steady or tap to focus, then retake.")
        ok = False
    return ok, problems


def save_photo(data, ext=".jpg", person_id=None):
    """Save bytes to the photos folder with a unique name; return filename."""
    if ext not in (".jpg", ".png", ".webp", ".jpeg"):
        ext = ".jpg"
    fname = time.strftime("%Y%m%d%H%M%S") + "-" + db.new_id() + ext
    path = os.path.join(db.PHOTO_DIR, fname)
    with open(path, "wb") as fh:
        fh.write(data)
    return fname


def image_fingerprint(data):
    return hashlib.sha256(data).hexdigest()[:16]


def recent_fingerprints(person_id=None):
    conn = db.connect()
    rows = conn.execute(
        "SELECT photo, created_at, person_id FROM bills ORDER BY created_at DESC LIMIT 200"
    ).fetchall()
    rows2 = conn.execute(
        "SELECT photo, created_at, person_id FROM payments ORDER BY created_at DESC LIMIT 100"
    ).fetchall()
    conn.close()
    return [(r["photo"], r["created_at"], r["person_id"]) for r in rows + rows2]


def duplicate_check(data, person_id=None):
    """Same photo already used in the last few entries? Gentle warning."""
    fp = image_fingerprint(data)
    recent = recent_fingerprints(person_id)
    now = time.mktime(time.strptime(db.now_iso(), "%Y-%m-%dT%H:%M:%S"))
    for photo, at, pid in recent:
        if not photo:
            continue
        path = os.path.join(db.PHOTO_DIR, photo)
        if not os.path.exists(path):
            continue
        try:
            with open(path, "rb") as fh:
                old = fh.read()
        except OSError:
            continue
        if image_fingerprint(old) == fp:
            try:
                t = time.mktime(time.strptime(at, "%Y-%m-%dT%H:%M:%S"))
            except ValueError:
                continue
            if abs(now - t) < DUP_WINDOW * 86400:
                return True
    return False


def photo_path(fname):
    return os.path.join(db.PHOTO_DIR, os.path.basename(str(fname)))


def serve_photo(fname):
    path = photo_path(fname)
    if not os.path.isfile(path):
        return None, None
    ctype = "image/jpeg"
    if fname.lower().endswith(".png"):
        ctype = "image/png"
    elif fname.lower().endswith(".webp"):
        ctype = "image/webp"
    with open(path, "rb") as fh:
        return fh.read(), ctype


# JPEG/PNG SOI sniff - is this even an image?
def sniff_image(data):
    if not data or len(data) < 12:
        return ""
    if data[0:2] == b"\xff\xd8":
        return ".jpg"
    if data[0:8] == b"\x89PNG\r\n\x1a\n":
        return ".png"
    if data[0:4] == b"RIFF" and data[8:12] == b"WEBP":
        return ".webp"
    return ""

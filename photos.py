"""Khata Sathi - photo management (Temporarily Disabled / Under Construction).

Notice: The photo clicking and uploading feature is temporarily disabled for cloud infrastructure upgrade.
All photo operations operate in-memory or return safe stubs with ZERO local filesystem writes.
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

FEATURE_ENABLED = False
FEATURE_STATUS_MESSAGE = "Photo feature — Under Construction"

# verdict thresholds
MIN_LONG_EDGE = 480
MIN_MEAN_BRIGHTNESS = 40
MAX_MEAN_BRIGHTNESS = 240
MIN_SHARPNESS = 45.0
HISTOGRAM_BINS = 256
DUP_WINDOW = 5


def _laplacian_var(gray):
    """Variance of the 3x3 Laplacian over a sampled grid - classic blur metric."""
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
    """Returns (ok, verdict) - in-memory quality validation."""
    problems = []
    ok = True
    if not HAS_PIL:
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


def sniff_image(data):
    """Returns extension if bytes start with JPEG/PNG/WebP magic header, else None."""
    if not data or len(data) < 12:
        return None
    if data[:3] == b"\xff\xd8\xff":
        return ".jpg"
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        return ".png"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return ".webp"
    return None


def duplicate_check(data, user_id="default"):
    """Duplicate checker stub with zero disk operations."""
    return False


def save_photo(data, ext=".jpg", user_id="default"):
    """Photo upload is temporarily under construction; returns empty string."""
    return ""


def get_photo_url(fname, user_id="default"):
    """Returns empty string or placeholder while feature is under construction."""
    return ""


def serve_photo(fname, user_id="default"):
    """Returns (None, 'image/jpeg') with zero filesystem operations."""
    return None, "image/jpeg"

# ============================================================
# utils/photo_utils.py — Secure JPEG photo handling (shared)
#
# - Accepts JPEG only; the caller enforces the size limit while reading.
# - RE-ENCODES every upload into a brand-new JPEG, so hidden payloads and
#   EXIF/GPS metadata are never stored.
# - Files get random names and live OUTSIDE the frontend folder.
# ============================================================

import io
import os
import re
import secrets
from pathlib import Path
from typing import Optional

from PIL import Image, ImageOps, UnidentifiedImageError

MAX_PHOTO_BYTES = 2 * 1024 * 1024      # hard limit: 2 MB
MAX_PHOTO_SIDE  = 800                  # stored size: at most 800 x 800 px
MIN_PHOTO_SIDE  = 64
Image.MAX_IMAGE_PIXELS = 25_000_000    # refuse decompression bombs

_NAME_RE = re.compile(r"^[0-9a-f]{32}\.jpg$")


def private_root() -> Path:
    """backend/private_uploads (override with PRIVATE_UPLOAD_DIR in .env)."""
    return Path(os.getenv("PRIVATE_UPLOAD_DIR") or Path(__file__).resolve().parent.parent / "private_uploads")


def process_jpeg(data: bytes) -> bytes:
    """Validate and re-encode. Raises ValueError with a user-safe message."""
    if data[:3] != b"\xff\xd8\xff":
        raise ValueError("The file is not a valid JPEG image.")
    try:
        with Image.open(io.BytesIO(data)) as im:
            if im.format != "JPEG":
                raise ValueError("The file is not a valid JPEG image.")
            im.load()                                   # fully decode: rejects truncated/corrupt files
            im = ImageOps.exif_transpose(im)            # apply phone rotation, then metadata is dropped
            if min(im.size) < MIN_PHOTO_SIDE:
                raise ValueError(f"The image is too small (minimum {MIN_PHOTO_SIDE} px).")
            im = im.convert("RGB")
            im.thumbnail((MAX_PHOTO_SIDE, MAX_PHOTO_SIDE))
            out = io.BytesIO()
            im.save(out, format="JPEG", quality=85, optimize=True)   # no exif= argument => metadata dropped
            return out.getvalue()
    except ValueError:
        raise
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError, SyntaxError):
        raise ValueError("The file is not a valid JPEG image.")


def safe_path(folder: Path, filename: Optional[str]) -> Optional[Path]:
    """Return a path inside `folder` for a stored filename, or None if it looks wrong."""
    if not filename or not _NAME_RE.fullmatch(filename):
        return None
    path = (folder / filename).resolve()
    return path if path.parent == folder.resolve() else None


def write_photo(folder: Path, clean: bytes) -> str:
    """Write the cleaned JPEG atomically under a random name and return that name."""
    folder.mkdir(parents=True, exist_ok=True)
    name = secrets.token_hex(16) + ".jpg"
    dest, tmp = folder / name, folder / (name + ".tmp")
    try:
        tmp.write_bytes(clean)
        os.replace(tmp, dest)
    except OSError:
        remove_file(tmp)
        raise
    try:
        os.chmod(dest, 0o600)
    except OSError:
        pass
    return name


def remove_file(path: Optional[Path]) -> None:
    try:
        if path and path.exists():
            path.unlink()
    except OSError:
        pass

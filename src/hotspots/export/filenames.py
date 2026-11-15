"""Safe download file names (Requirement 18.3, Property 35).

A name uses only ASCII letters, digits, hyphens and underscores before the extension, has at most
`MAX_STEM_CHARS` characters before the extension and depends only on its inputs.
"""

from __future__ import annotations

import re
import unicodedata
from datetime import date
from typing import Final

MAX_STEM_CHARS: Final[int] = 100
"""Most characters allowed before the file extension."""

FALLBACK_STEM: Final[str] = "export"

_UNSAFE_RUN = re.compile(r"[^A-Za-z0-9_-]+")
_EXTENSION = re.compile(r"[a-z0-9]{1,10}")


def sanitize_filename(text: str, max_chars: int = MAX_STEM_CHARS) -> str:
    """Reduce `text` to letters, digits, hyphens and underscores, at most `max_chars` long.

    Accents are folded to ASCII where possible. Every other run of characters becomes one hyphen,
    and leading or trailing hyphens and underscores are removed. Returns `FALLBACK_STEM` when
    nothing is left. The result never contains a dot, a slash or a space.
    """
    if max_chars < 1:
        raise ValueError("max_chars must be at least 1")
    folded = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode("ascii")
    cleaned = _UNSAFE_RUN.sub("-", folded).strip("-_")[:max_chars].strip("-_")
    return cleaned or FALLBACK_STEM[:max_chars]


def export_filename(kind: str, area_name: str, start: date, end: date, extension: str) -> str:
    """File name `<kind>_<area>_<start>_<end>.<extension>`, for example for the hotspot CSV.

    Dates are `YYYY-MM-DD` (local standard time, UTC-8). The area part is shortened first when
    the name would pass `MAX_STEM_CHARS` before the extension. `extension` must be 1 to 10
    lowercase letters or digits.
    """
    if not _EXTENSION.fullmatch(extension):
        raise ValueError("extension must be 1 to 10 lowercase letters or digits")
    kind_part = sanitize_filename(kind, 30)
    dates_part = f"{start.isoformat()}_{end.isoformat()}"
    room = MAX_STEM_CHARS - len(kind_part) - len(dates_part) - 2
    area_part = sanitize_filename(area_name, max(room, 1))
    stem = f"{kind_part}_{area_part}_{dates_part}"
    return f"{sanitize_filename(stem)}.{extension}"

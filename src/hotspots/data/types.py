"""Small value types shared by the data access layer and its callers."""

from __future__ import annotations

from typing import NamedTuple

BASE_YEAR = 2000
"""`month_index` counts months since January of this year (2000-01 is index 0)."""


class YearMonth(NamedTuple):
    """A calendar month on the fixed UTC-8 local-day convention."""

    year: int
    month: int

    @property
    def index(self) -> int:
        """Months since 2000-01."""
        return month_index_of(self.year, self.month)

    def __str__(self) -> str:
        return f"{self.year:04d}-{self.month:02d}"

    @classmethod
    def from_index(cls, index: int) -> YearMonth:
        """Inverse of `index`."""
        year, month0 = divmod(int(index), 12)
        return cls(BASE_YEAR + year, month0 + 1)

    @classmethod
    def parse(cls, text: str) -> YearMonth:
        """Parse `YYYY-MM`. Raises `ValueError` on any other shape."""
        year_text, sep, month_text = text.strip().partition("-")
        if not sep or len(year_text) != 4 or len(month_text) != 2:
            raise ValueError(f"expected YYYY-MM, got {text!r}")
        year, month = int(year_text), int(month_text)
        if not 1 <= month <= 12:
            raise ValueError(f"month must be 1 to 12, got {text!r}")
        return cls(year, month)


def month_index_of(year: int, month: int) -> int:
    """Months since 2000-01 for a calendar month (`year * 12 + month - 1` minus the base)."""
    return year * 12 + month - 1 - BASE_YEAR * 12


class BBox(NamedTuple):
    """Bounding box in EPSG:4326 degrees. All four edges are inclusive in queries."""

    west: float
    south: float
    east: float
    north: float


class DataUnavailableError(RuntimeError):
    """A delivered data file is missing or unreadable, or a requested value does not exist."""

"""Write `docs/submission/data_and_references.md` (Requirement 33.6).

Run: `uv run python -m hotspots.references`

The file lists the NASA FIRMS products used (sensor, satellite, processing type and version as
found in the delivered detections file), the citation text used in the CSV headers, the
challenge page, the references cited elsewhere in this repository, and every pinned library
from `uv.lock` and `web/package-lock.json`. Output is deterministic: no timestamps, sorted lists.
"""

from __future__ import annotations

import json
import re
import sys
import tomllib
from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Final

from hotspots.config import AppConfig, ConfigErrors, load_config
from hotspots.data.store import DataStore
from hotspots.data.types import DataUnavailableError
from hotspots.export.hotspots_csv import CITATION_LINE

CHALLENGE_URL: Final[str] = (
    "https://www.spaceappschallenge.org/2026/challenges/modis-and-viirs-hot-spots/"
)
FIRMS_URL: Final[str] = "https://firms.modaps.eosdis.nasa.gov/"
README_NAME: Final[str] = "DATA_README.md"
DEFAULT_OUTPUT: Final[Path] = Path("docs/submission/data_and_references.md")
PRODUCTS_SQL: Final[str] = (
    "SELECT sensor_family, satellite, source, version, count(*), "
    "min(acq_date_local), max(acq_date_local) FROM {src} "
    "GROUP BY sensor_family, satellite, source, version "
    "ORDER BY sensor_family, satellite, source, version"
)


class ReferencesError(Exception):
    """A clear, user-facing failure (missing input file, unreadable lock file)."""


@dataclass(frozen=True)
class Product:
    """One FIRMS product row as it appears in the delivered detections file."""

    sensor_family: str
    satellite: str
    source: str
    version: str
    rows: int
    first_date: str
    last_date: str


@dataclass(frozen=True)
class Library:
    """A pinned library."""

    name: str
    version: str


# --- parsing ---------------------------------------------------------------------------------


def parse_uv_lock(path: Path) -> list[Library]:
    """Pinned Python packages from `uv.lock`, sorted by name then version, without duplicates.

    The project itself (a `virtual` or `editable` source) is left out.
    """
    try:
        data = tomllib.loads(path.read_text(encoding="utf-8"))
    except (OSError, tomllib.TOMLDecodeError) as exc:
        raise ReferencesError(f"cannot read {path}: {exc}") from exc
    found: set[tuple[str, str]] = set()
    for pkg in data.get("package", []):
        source = pkg.get("source", {})
        name, version = pkg.get("name"), pkg.get("version")
        if not name or not version or "virtual" in source or "editable" in source:
            continue
        found.add((str(name), str(version)))
    return _sorted(found)


def parse_package_lock(path: Path) -> list[Library]:
    """Pinned npm packages from a lockfileVersion 2 or 3 `package-lock.json`.

    The name is the part of the key after the last `node_modules/`. Linked entries and the root
    project are left out.
    """
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ReferencesError(f"cannot read {path}: {exc}") from exc
    packages: dict[str, Any] = data.get("packages", {})
    found: set[tuple[str, str]] = set()
    for key, entry in packages.items():
        if not key or "node_modules/" not in key or entry.get("link"):
            continue
        name = entry.get("name") or key.rsplit("node_modules/", 1)[1]
        version = entry.get("version")
        if name and version:
            found.add((str(name), str(version)))
    return _sorted(found)


def _sorted(found: set[tuple[str, str]]) -> list[Library]:
    return [Library(n, v) for n, v in sorted(found, key=lambda t: (t[0].lower(), t[0], t[1]))]


def read_build_line(readme: Path) -> str | None:
    """The `**Build date:**` value from the delivered data README, or None if absent."""
    match = re.search(r"^\*\*Build date:\*\*\s*(.+?)\s*$", _read_readme(readme), re.MULTILINE)
    return match.group(1) if match else None


def _read_readme(readme: Path) -> str:
    if not readme.is_file():
        raise ReferencesError(
            f"{README_NAME} not found at {readme}. It ships with the delivered data files. "
            "Put the data folder in place (see the README) or set HOTSPOTS_DATA_DIR."
        )
    try:
        return readme.read_text(encoding="utf-8")
    except OSError as exc:
        raise ReferencesError(f"cannot read {readme}: {exc}") from exc


def read_products(cfg: AppConfig) -> list[Product]:
    """Distinct FIRMS products in the delivered detections file, read through the access layer."""
    store = DataStore(cfg)
    try:
        rows = store.raw_query("detections", PRODUCTS_SQL)
    except DataUnavailableError as exc:
        raise ReferencesError(f"cannot read product versions: {exc}") from exc
    finally:
        store.close()
    return [
        Product(str(a), str(b), str(c), str(d), int(e), str(f), str(g))
        for a, b, c, d, e, f, g in rows
    ]


# --- rendering -------------------------------------------------------------------------------


def render(
    *,
    build_line: str | None,
    products: Sequence[Product],
    python_libs: Sequence[Library],
    npm_libs: Sequence[Library],
) -> str:
    """Build the Markdown document. Pure and deterministic."""
    out: list[str] = ["# NASA data and references", ""]
    out += [
        "Generated by `uv run python -m hotspots.references`. Do not edit by hand.",
        "",
        "## NASA data used",
        "",
        "NASA Earthdata Fire Information for Resource Management System (FIRMS) active-fire"
        " detections from MODIS (Terra, Aqua) and VIIRS (Suomi NPP, NOAA-20, NOAA-21):"
        f" {FIRMS_URL}",
        "",
        "The app reads delivered, fixed files built from FIRMS downloads. It does not call FIRMS."
        " Processing types: SP = standard processing, NRT = near real time. The table is read"
        " from the `source` and `version` columns of the delivered detections file. VIIRS"
        " satellites appear under their file labels (SNPP, N20, N21).",
        "",
    ]
    if build_line:
        out += [f"Delivered data build date (from `{README_NAME}`): {build_line}", ""]
    if products:
        out += [
            "| Sensor | Satellite | Processing | Version | Detections kept"
            " | First local date | Last local date |",
            "|---|---|---|---|---:|---|---|",
        ]
        out += [
            f"| {p.sensor_family} | {p.satellite} | {p.source} | {p.version} | {p.rows:,} |"
            f" {p.first_date} | {p.last_date} |"
            for p in products
        ]
    else:
        out += ["Product versions were not available from the detections file."]
    out += [
        "",
        "Detections are filtered raw detections (low confidence and static sources removed).",
        "Only monthly counts are harmonized. Counts are cell-days. Days use a fixed UTC-8.",
        "",
        "## Citation",
        "",
        CITATION_LINE,
        "",
        "## Challenge",
        "",
        f"- NASA Space Apps Challenge 2026, MODIS and VIIRS Hot Spots: {CHALLENGE_URL}",
        "",
        "## Other references",
        "",
        f"- NASA FIRMS: {FIRMS_URL}",
        f"- Delivered data documentation: `{README_NAME}` in the data folder (pipeline,"
        " filters, harmonization method, validation numbers).",
        "- Methodology of this app: `docs/methodology.md`.",
        "",
        "## Pinned libraries",
        "",
        "### Python (`uv.lock`)",
        "",
        f"{len(python_libs)} packages.",
        "",
        *[f"- {lib.name} {lib.version}" for lib in python_libs],
        "",
        "### JavaScript (`web/package-lock.json`)",
        "",
        f"{len(npm_libs)} packages.",
        "",
        *[f"- {lib.name} {lib.version}" for lib in npm_libs],
        "",
    ]
    return "\n".join(out)


def generate(
    *,
    readme: Path,
    uv_lock: Path,
    package_lock: Path,
    products: Sequence[Product],
) -> str:
    """Read the inputs and return the document text."""
    return render(
        build_line=read_build_line(readme),
        products=products,
        python_libs=parse_uv_lock(uv_lock),
        npm_libs=parse_package_lock(package_lock),
    )


def main(argv: Sequence[str] | None = None) -> int:
    """Write the references file. Returns the process exit code."""
    _ = argv
    cfg = load_config(require_data=False)
    if isinstance(cfg, ConfigErrors):
        print(cfg.format(), file=sys.stderr)
        return 2
    root = Path.cwd()
    try:
        readme = cfg.data_dir / README_NAME
        _read_readme(readme)  # fail early with a clear message
        text = generate(
            readme=readme,
            uv_lock=root / "uv.lock",
            package_lock=root / "web" / "package-lock.json",
            products=read_products(cfg),
        )
    except ReferencesError as exc:
        print(f"Cannot write references: {exc}", file=sys.stderr)
        return 1
    target = root / DEFAULT_OUTPUT
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(text, encoding="utf-8", newline="\n")
    print(f"Wrote {DEFAULT_OUTPUT}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

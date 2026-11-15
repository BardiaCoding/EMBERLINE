"""Tests for `hotspots.references` using small fixture lock files (no delivered data)."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from hotspots import references
from hotspots.export.hotspots_csv import CITATION_LINE
from hotspots.references import Product, ReferencesError

UV_LOCK = """
version = 1

[[package]]
name = "zeta"
version = "1.0.0"
source = { registry = "https://pypi.org/simple" }

[[package]]
name = "Alpha"
version = "2.1"
source = { registry = "https://pypi.org/simple" }

[[package]]
name = "hotspots"
version = "0.1.0"
source = { virtual = "." }
"""

PKG_LOCK = {
    "name": "web",
    "lockfileVersion": 3,
    "packages": {
        "": {"name": "web", "version": "0.1.0"},
        "node_modules/react": {"version": "19.0.0"},
        "node_modules/@scope/b": {"version": "1.2.3"},
        "node_modules/react/node_modules/inner": {"version": "0.5.0"},
        "node_modules/linked": {"link": True, "resolved": "../x"},
    },
}

PRODUCTS = [Product("MODIS", "Aqua", "SP", "6.03", 1234, "2002-07-04", "2022-12-22")]


def _write_inputs(tmp_path: Path) -> tuple[Path, Path, Path]:
    readme = tmp_path / "DATA_README.md"
    readme.write_text("# Fixture\n**Build date:** 2026-01-01\n", encoding="utf-8")
    uv = tmp_path / "uv.lock"
    uv.write_text(UV_LOCK, encoding="utf-8")
    npm = tmp_path / "package-lock.json"
    npm.write_text(json.dumps(PKG_LOCK), encoding="utf-8")
    return readme, uv, npm


def test_parse_uv_lock_sorted_and_skips_project(tmp_path: Path) -> None:
    _, uv, _ = _write_inputs(tmp_path)
    libs = references.parse_uv_lock(uv)
    assert [(lib.name, lib.version) for lib in libs] == [("Alpha", "2.1"), ("zeta", "1.0.0")]


def test_parse_package_lock_sorted_and_nested(tmp_path: Path) -> None:
    _, _, npm = _write_inputs(tmp_path)
    libs = references.parse_package_lock(npm)
    assert [(lib.name, lib.version) for lib in libs] == [
        ("@scope/b", "1.2.3"),
        ("inner", "0.5.0"),
        ("react", "19.0.0"),
    ]


def test_output_has_nasa_section_citation_and_is_deterministic(tmp_path: Path) -> None:
    readme, uv, npm = _write_inputs(tmp_path)
    first = references.generate(readme=readme, uv_lock=uv, package_lock=npm, products=PRODUCTS)
    second = references.generate(readme=readme, uv_lock=uv, package_lock=npm, products=PRODUCTS)
    assert first == second
    assert "## NASA data used" in first
    assert "| MODIS | Aqua | SP | 6.03 |" in first
    assert CITATION_LINE in first
    assert references.CHALLENGE_URL in first
    assert "2026-01-01" in first
    assert first.index("- Alpha 2.1") < first.index("- zeta 1.0.0")


def test_missing_readme_gives_clear_error(tmp_path: Path) -> None:
    _, uv, npm = _write_inputs(tmp_path)
    with pytest.raises(ReferencesError, match="DATA_README.md not found"):
        references.generate(
            readme=tmp_path / "nope" / "DATA_README.md",
            uv_lock=uv,
            package_lock=npm,
            products=PRODUCTS,
        )


def test_unreadable_lock_gives_clear_error(tmp_path: Path) -> None:
    with pytest.raises(ReferencesError, match="cannot read"):
        references.parse_uv_lock(tmp_path / "missing.lock")

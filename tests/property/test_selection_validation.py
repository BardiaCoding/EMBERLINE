# Feature: harmonized-fire-calendar, Property 27: Selection validation reports the right reason
"""Property 27: for any selection, `validate_selection` accepts it when it has no defect and,
when exactly one defect is present, reports exactly that defect.

Defects: self-intersection, fewer than 3 distinct vertices, zero area, more than 1000
vertices, coordinates out of range, malformed GeoJSON, circle radius out of range, and no
overlap with the extent. When a shape has two defects, the first failing check in the order
documented in `hotspots.geometry` decides. Messages never echo submitted coordinates.

Shapes are synthetic (not NASA data).

**Validates: Requirements 11.7, 13.1, 13.2, 13.4, 13.5, 13.6, 29.4, 29.6**
"""

from __future__ import annotations

import math
import re
from collections.abc import Iterator
from typing import Any

import pytest
from hypothesis import given
from shapely.geometry.base import BaseGeometry

import hotspots.geometry as g
from hotspots.geometry import CircleSpec, SelectionValidation, validate_selection
from tests.property.strategies.selection_validation import (
    EXTENT,
    STAGE_REASON,
    STAGES,
    CircleCase,
    Defective,
    circle_defects,
    count_positions,
    defect_pairs,
    earlier_stage,
    polygon_of,
    regular_ring,
    single_defects,
    valid_circles,
    valid_geometries,
)

NUMBER = re.compile(r"-?\d+(?:\.\d+)?")


def _numbers(value: Any) -> Iterator[float]:
    """Every finite number in a nested submitted value (strings and booleans are skipped)."""
    if isinstance(value, bool):
        return
    if isinstance(value, int | float):
        if math.isfinite(value):
            yield float(value)
    elif isinstance(value, dict):
        for item in value.values():
            yield from _numbers(item)
    elif isinstance(value, list | tuple):
        for item in value:
            yield from _numbers(item)


def _assert_messages_do_not_echo(result: SelectionValidation, submitted: Any) -> None:
    """A number in a message must be a limit, the extent or the vertex count, never an input."""
    allowed = {
        EXTENT.west,
        EXTENT.south,
        EXTENT.east,
        EXTENT.north,
        float(g.MAX_VERTICES),
        float(g.MIN_DISTINCT_VERTICES),
        g.MIN_RADIUS_KM,
        g.MAX_RADIUS_KM,
        -90.0,
        90.0,
        -180.0,
        180.0,
    }
    if result.vertex_count is not None:
        allowed.add(float(result.vertex_count))
    inputs = set(_numbers(submitted))
    for issue in result.issues:
        for token in NUMBER.findall(issue.message):
            value = float(token)
            assert value in allowed or value not in inputs, (token, issue.message)


def _expected_error_code(reason: str) -> str:
    return g.ERROR_CODE_OUTSIDE_COVERAGE if reason == "outside_extent" else "invalid_geometry"


def _documented_reason_order() -> list[str]:
    """Reason codes of the numbered checks in the `hotspots.geometry` module docstring."""
    return re.findall(r"^\d+\. `(\w+)`", g.__doc__ or "", flags=re.MULTILINE)


# --- accepted shapes ---------------------------------------------------------------------


@given(valid_geometries)
def test_valid_shapes_are_accepted(geometry: dict[str, Any]) -> None:
    result = validate_selection(geometry, extent=EXTENT)

    assert result.ok, result.issues
    assert result.issues == ()
    assert result.reason is None
    assert result.error_code is None
    assert result.vertex_count == count_positions(geometry)
    assert isinstance(result.polygon, BaseGeometry)
    assert result.polygon.is_valid
    assert result.polygon.area > 0.0


@given(valid_circles())
def test_valid_circles_are_accepted(circle: CircleSpec) -> None:
    result = validate_selection(extent=EXTENT, circle=circle)

    assert result.ok, result.issues
    assert result.issues == ()
    assert result.vertex_count == g.CIRCLE_VERTICES + 1  # 64 distinct plus the closing position
    assert result.polygon is not None


# --- exactly one defect ------------------------------------------------------------------


@given(single_defects)
def test_one_defect_gives_that_reason(defect: Defective) -> None:
    result = validate_selection(defect.geometry, extent=EXTENT)

    assert not result.ok
    assert result.polygon is None
    assert len(result.issues) == 1
    assert result.issues[0].field == g.GEOMETRY_FIELD
    assert result.issues[0].reason == defect.reason
    assert result.reason == defect.reason
    assert result.reason in g.SELECTION_REASONS
    assert result.error_code == _expected_error_code(defect.reason)
    assert result.issues[0].message
    _assert_messages_do_not_echo(result, defect.geometry)


@given(circle_defects)
def test_circle_defects_report_each_bad_field(case: CircleCase) -> None:
    result = validate_selection(extent=EXTENT, circle=case.circle)

    assert not result.ok
    assert result.polygon is None
    assert [(i.field, i.reason) for i in result.issues] == case.expected
    assert result.reason == case.expected[0][1]
    assert result.error_code == _expected_error_code(case.expected[0][1])
    _assert_messages_do_not_echo(result, [case.circle.lat, case.circle.lon, case.circle.radius_km])


# --- order of the checks -----------------------------------------------------------------


def test_documented_order_matches_the_stages_used_here() -> None:
    assert _documented_reason_order() == [STAGE_REASON[s] for s in STAGES]


@given(defect_pairs())
def test_first_failing_check_decides(pair: tuple[dict[str, Any], str, str]) -> None:
    geometry, stage_a, stage_b = pair

    result = validate_selection(geometry, extent=EXTENT)

    expected = STAGE_REASON[earlier_stage(stage_a, stage_b)]
    assert not result.ok
    assert len(result.issues) == 1
    assert result.reason == expected, (stage_a, stage_b)
    _assert_messages_do_not_echo(result, geometry)


# --- limits written down in the requirements ---------------------------------------------


@pytest.mark.parametrize(
    ("positions", "ok"),
    [(g.MAX_VERTICES, True), (g.MAX_VERTICES + 1, False)],
)
def test_vertex_limit_is_1000_positions(positions: int, ok: bool) -> None:
    geometry = polygon_of(regular_ring(-120.0, 37.0, 0.5, positions - 1))
    result = validate_selection(geometry, extent=EXTENT)

    assert result.ok is ok
    assert result.reason == (None if ok else "too_many_vertices")

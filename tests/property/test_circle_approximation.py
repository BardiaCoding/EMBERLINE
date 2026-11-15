# Feature: harmonized-fire-calendar, Property 29: Circle approximation within 0.5 % of radius  # noqa: E501
"""Property 29: every vertex of the 64-vertex circle is within 0.5 % of the radius.

**Validates: Requirements 12.1**

Distances use the haversine formula on the sphere of `EARTH_RADIUS_KM`, the same sphere as
`circle_polygon`. The polygon area is also compared with the area of the spherical cap.
"""

from __future__ import annotations

import math

from hypothesis import given
from hypothesis import strategies as st

from hotspots.geometry import (
    CIRCLE_VERTICES,
    EARTH_RADIUS_KM,
    circle_polygon,
    geodesic_area_km2,
    haversine_km,
)

# California region extent (data-contract.md, measured values), EPSG:4326 degrees.
centre_lat = st.floats(min_value=32.5, max_value=42.2, allow_nan=False)
centre_lon = st.floats(min_value=-124.4, max_value=-114.0, allow_nan=False)
radius_km = st.floats(min_value=1.0, max_value=500.0, allow_nan=False)


@given(centre_lat, centre_lon, radius_km)
def test_circle_vertices_within_half_percent_of_radius(
    lat: float, lon: float, radius: float
) -> None:
    polygon = circle_polygon(lat, lon, radius)
    ring = list(polygon.exterior.coords)

    assert len(ring) == CIRCLE_VERTICES + 1
    assert ring[0] == ring[-1]
    assert len(set(ring)) == CIRCLE_VERTICES

    for vlon, vlat in ring:
        distance = haversine_km(lat, lon, vlat, vlon)
        assert abs(distance - radius) <= 0.005 * radius


@given(centre_lat, centre_lon, radius_km)
def test_circle_area_close_to_spherical_cap(lat: float, lon: float, radius: float) -> None:
    delta = radius / EARTH_RADIUS_KM
    cap_area = 2.0 * math.pi * EARTH_RADIUS_KM**2 * (1.0 - math.cos(delta))
    area = geodesic_area_km2(circle_polygon(lat, lon, radius))

    # Straight edges in lon/lat differ slightly from great-circle edges; 1 % is generous.
    assert abs(area - cap_area) <= 0.01 * cap_area

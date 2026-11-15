"""Application configuration: loading and validation.

`load_config` reads one YAML file and returns either an `AppConfig` or a `ConfigErrors`
holding every invalid field with its reason, so a bad file is fixed in one pass
(Requirements 1.2, 1.5, 1.6, 1.8). Validation only looks at file metadata (existence).
No data file is opened here.

The file is chosen by, in order: the `path` argument, the `HOTSPOTS_CONFIG` environment
variable, then `config/app.yaml`. A relative `data_dir` is resolved against the current
working directory (the project root when started with `uv run` or the Docker image).
"""

from __future__ import annotations

import copy
import math
import os
import re
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Final

import yaml
from shapely.geometry import LinearRing, MultiPoint, Polygon

CONFIG_ENV_VAR: Final[str] = "HOTSPOTS_CONFIG"
DEFAULT_CONFIG_PATH: Final[str] = "config/app.yaml"

GRID_FILENAME: Final[str] = "harmonized_monthly_grid.parquet"
DETECTIONS_FILENAME: Final[str] = "detections_harmonized.parquet"

DEFAULT_RECORD_START: Final[str] = "2000-11"
DEFAULT_EXCLUDED_CELLS: Final[tuple[str, ...]] = ("38.7000_-117.4000",)
DEFAULT_WATCH_THRESHOLD: Final[float] = 90.0
DEFAULT_CSV_AVG_BYTES_PER_ROW: Final[float] = 0.0

REGION_NAME_MAX_LEN: Final[int] = 100

EXAMPLE_AREAS_MIN: Final[int] = 3
EXAMPLE_AREAS_MAX: Final[int] = 5
EXAMPLE_NAME_MAX_LEN: Final[int] = 60
EXAMPLE_DESCRIPTION_MAX_LEN: Final[int] = 160  # code points
MIN_RING_POSITIONS: Final[int] = 4

_YEAR_MONTH_RE: Final[re.Pattern[str]] = re.compile(r"^\d{4}-(0[1-9]|1[0-2])$")
_BASELINE_START_LITERAL: Final[str] = "record_start"


@dataclass(frozen=True)
class ConfigError:
    """One invalid field and the reason it is invalid."""

    field: str
    reason: str


@dataclass(frozen=True)
class ConfigErrors:
    """Every invalid field found in one run. Never empty."""

    errors: tuple[ConfigError, ...]

    def format(self) -> str:
        """Human-readable report, one line per error."""
        lines = [f"Invalid configuration ({len(self.errors)} problem(s)):"]
        lines.extend(f"  - {e.field}: {e.reason}" for e in self.errors)
        return "\n".join(lines)

    def as_pairs(self) -> list[tuple[str, str]]:
        """The errors as `(field, reason)` tuples."""
        return [(e.field, e.reason) for e in self.errors]


@dataclass(frozen=True)
class Extent:
    """Region extent in EPSG:4326 degrees."""

    west: float
    south: float
    east: float
    north: float


@dataclass(frozen=True)
class RegionConfig:
    name: str
    extent: Extent


@dataclass(frozen=True)
class BaselineConfig:
    """Baseline period. `start` is a resolved `YYYY-MM` (never the literal `record_start`)."""

    start: str
    exclude_incomplete: bool


@dataclass(frozen=True)
class ExampleAreaConfig:
    """One example area: a GeoJSON `Polygon` (EPSG:4326, `[lon, lat]` positions) with text.

    `name` is stored trimmed. `description` and `geometry` are kept exactly as configured.
    """

    name: str
    description: str
    geometry: dict[str, Any]


@dataclass(frozen=True)
class AppConfig:
    region: RegionConfig
    data_dir: Path
    record_start: str
    excluded_cells: tuple[str, ...]
    baseline: BaselineConfig
    watch_threshold: float
    csv_avg_bytes_per_row: float
    example_areas: tuple[ExampleAreaConfig, ...] = ()

    @property
    def grid_path(self) -> Path:
        return self.data_dir / GRID_FILENAME

    @property
    def detections_path(self) -> Path:
        return self.data_dir / DETECTIONS_FILENAME


def resolve_config_path(path: str | os.PathLike[str] | None = None) -> Path:
    """Pick the config file: explicit argument, then `HOTSPOTS_CONFIG`, then the default."""
    if path is not None:
        return Path(path)
    env = os.environ.get(CONFIG_ENV_VAR, "").strip()
    return Path(env) if env else Path(DEFAULT_CONFIG_PATH)


def load_config(
    path: str | os.PathLike[str] | None = None, *, require_data: bool = True
) -> AppConfig | ConfigErrors:
    """Load and validate the app configuration.

    Returns an `AppConfig`, or a `ConfigErrors` listing every invalid field at once.
    With `require_data=False`, a data folder or Parquet file that does not exist is not an
    error: the API uses this to start in the "data unavailable" state (Requirement 32.7).
    """
    cfg_path = resolve_config_path(path)
    try:
        text = cfg_path.read_text(encoding="utf-8")
    except FileNotFoundError:
        return _fail("config", f"file not found: {cfg_path}")
    except OSError as exc:
        return _fail("config", f"cannot read {cfg_path}: {exc.strerror or exc}")
    try:
        raw = yaml.safe_load(text)
    except yaml.YAMLError as exc:
        return _fail("config", f"invalid YAML in {cfg_path}: {exc}")
    if not isinstance(raw, Mapping):
        return _fail("config", "top level must be a mapping of settings")
    return validate_config(raw, require_data=require_data)


def validate_config(
    raw: Mapping[str, Any], *, require_data: bool = True
) -> AppConfig | ConfigErrors:
    """Validate an already parsed config mapping. Pure apart from file existence checks."""
    errors: list[ConfigError] = []

    def err(field: str, reason: str) -> None:
        errors.append(ConfigError(field, reason))

    region, extent = _validate_region(raw.get("region"), err)
    data_dir = _validate_data_dir(raw.get("data_dir"), err, require_data)
    record_start = _validate_record_start(raw, err)
    excluded_cells = _validate_excluded_cells(raw, err)
    baseline = _validate_baseline(raw.get("baseline"), record_start, err)
    watch_threshold = _validate_watch_threshold(raw, err)
    csv_bytes = _validate_csv_bytes(raw, err)
    example_areas = _validate_example_areas(raw.get("example_areas"), extent, err)

    if errors or region is None or data_dir is None:
        return ConfigErrors(tuple(errors))
    assert record_start is not None and baseline is not None  # no errors were recorded
    assert watch_threshold is not None and csv_bytes is not None
    return AppConfig(
        region=region,
        data_dir=data_dir,
        record_start=record_start,
        excluded_cells=excluded_cells,
        baseline=baseline,
        watch_threshold=watch_threshold,
        csv_avg_bytes_per_row=csv_bytes,
        example_areas=example_areas,
    )


# --- helpers -----------------------------------------------------------------------------

_ErrFn = Callable[[str, str], None]


def _fail(field: str, reason: str) -> ConfigErrors:
    return ConfigErrors((ConfigError(field, reason),))


def _is_number(value: object) -> bool:
    return isinstance(value, int | float) and not isinstance(value, bool) and math.isfinite(value)


def _validate_region(value: object, err: _ErrFn) -> tuple[RegionConfig | None, Extent | None]:
    """Return the region (None if any part is invalid) and the extent when it is valid.

    The extent is returned on its own so a bad `name` does not hide extent-dependent
    errors (example areas outside the extent) from the same pass.
    """
    if value is None:
        err("region", "required field is missing")
        return None, None
    if not isinstance(value, Mapping):
        err("region", "must be a mapping with `name` and `extent`")
        return None, None

    name = value.get("name")
    name_ok = False
    if name is None:
        err("region.name", "required field is missing")
    elif not isinstance(name, str):
        err("region.name", "must be a string")
    elif not name.strip():
        err("region.name", "must not be blank")
    elif len(name.strip()) > REGION_NAME_MAX_LEN:
        err("region.name", f"must be at most {REGION_NAME_MAX_LEN} characters")
    else:
        name_ok = True

    extent = _validate_extent(value.get("extent"), err)
    if not name_ok or extent is None:
        return None, extent
    assert isinstance(name, str)
    return RegionConfig(name=name.strip(), extent=extent), extent


def _validate_extent(value: object, err: _ErrFn) -> Extent | None:
    if value is None:
        err("region.extent", "required field is missing")
        return None
    if not isinstance(value, Mapping):
        err("region.extent", "must be a mapping with west, south, east, north")
        return None

    limits = {"west": 180.0, "east": 180.0, "south": 90.0, "north": 90.0}
    nums: dict[str, float] = {}
    ok = True
    for key, limit in limits.items():
        v = value.get(key)
        field = f"region.extent.{key}"
        if v is None:
            err(field, "required field is missing")
            ok = False
        elif not _is_number(v):
            err(field, "must be a finite number")
            ok = False
        elif not -limit <= float(v) <= limit:
            axis = "longitude" if key in ("west", "east") else "latitude"
            err(field, f"{axis} must be between {-limit:g} and {limit:g}, got {v}")
            ok = False
        else:
            nums[key] = float(v)
    # Check ordering for each axis whose two values are valid, so every problem is reported.
    ordered = True
    for low, high in (("west", "east"), ("south", "north")):
        if low in nums and high in nums and nums[low] >= nums[high]:
            err("region.extent", f"{low} ({nums[low]}) must be less than {high} ({nums[high]})")
            ordered = False
    if not ok or not ordered:
        return None
    return Extent(west=nums["west"], south=nums["south"], east=nums["east"], north=nums["north"])


def _validate_data_dir(value: object, err: _ErrFn, require_data: bool = True) -> Path | None:
    if value is None:
        err("data_dir", "required field is missing")
        return None
    if not isinstance(value, str) or not value.strip():
        err("data_dir", "must be a non-blank path string")
        return None
    data_dir = Path(value.strip()).expanduser()
    if not require_data:
        return data_dir
    if not data_dir.is_dir():
        err("data_dir", f"folder not found: {data_dir}")
        return data_dir
    for filename in (GRID_FILENAME, DETECTIONS_FILENAME):
        if not (data_dir / filename).is_file():
            err("data_dir", f"missing file: {data_dir / filename}")
    return data_dir


def _validate_record_start(raw: Mapping[str, Any], err: _ErrFn) -> str | None:
    value = raw.get("record_start", DEFAULT_RECORD_START)
    if not isinstance(value, str) or not _YEAR_MONTH_RE.match(value.strip()):
        err("record_start", f"must be a valid year-month in YYYY-MM format, got {value!r}")
        return None
    return value.strip()


def _validate_excluded_cells(raw: Mapping[str, Any], err: _ErrFn) -> tuple[str, ...]:
    value = raw.get("excluded_cells", list(DEFAULT_EXCLUDED_CELLS))
    if not isinstance(value, list):
        err("excluded_cells", "must be a list of cell_id strings")
        return ()
    cells: list[str] = []
    for i, item in enumerate(value):
        if not isinstance(item, str) or not item.strip():
            err(f"excluded_cells[{i}]", f"must be a non-blank string, got {item!r}")
        else:
            cells.append(item.strip())
    return tuple(cells)


def _validate_baseline(
    value: object, record_start: str | None, err: _ErrFn
) -> BaselineConfig | None:
    if value is None:
        value = {}
    if not isinstance(value, Mapping):
        err("baseline", "must be a mapping with `start` and `exclude_incomplete`")
        return None

    ok = True
    start_raw = value.get("start", _BASELINE_START_LITERAL)
    start: str | None = None
    if start_raw == _BASELINE_START_LITERAL:
        start = record_start  # None when record_start itself is invalid (already reported)
    elif not isinstance(start_raw, str) or not _YEAR_MONTH_RE.match(start_raw.strip()):
        err("baseline.start", f"must be 'record_start' or YYYY-MM, got {start_raw!r}")
        ok = False
    elif record_start is not None and start_raw.strip() < record_start:
        err("baseline.start", f"must not be before record_start ({record_start})")
        ok = False
    else:
        start = start_raw.strip()

    exclude_incomplete = value.get("exclude_incomplete", True)
    if not isinstance(exclude_incomplete, bool):
        err("baseline.exclude_incomplete", "must be true or false")
        ok = False

    if not ok or start is None:
        return None
    assert isinstance(exclude_incomplete, bool)
    return BaselineConfig(start=start, exclude_incomplete=exclude_incomplete)


def _validate_watch_threshold(raw: Mapping[str, Any], err: _ErrFn) -> float | None:
    value = raw.get("watch_threshold", DEFAULT_WATCH_THRESHOLD)
    if not _is_number(value) or not 0 < float(value) < 100:
        err("watch_threshold", f"must be a number greater than 0 and less than 100, got {value!r}")
        return None
    return float(value)


def _validate_csv_bytes(raw: Mapping[str, Any], err: _ErrFn) -> float | None:
    value = raw.get("csv_avg_bytes_per_row", DEFAULT_CSV_AVG_BYTES_PER_ROW)
    if not _is_number(value) or float(value) < 0:
        err("csv_avg_bytes_per_row", f"must be a number that is 0 or more, got {value!r}")
        return None
    return float(value)


def _validate_example_areas(
    value: object, extent: Extent | None, err: _ErrFn
) -> tuple[ExampleAreaConfig, ...]:
    """Validate the optional `example_areas` list (Requirements 1.9, 1.10).

    Absent (or null) means no example areas. Every bad entry is reported with its position,
    for example `example_areas[2].name`. `extent` is None when the region extent is invalid
    (already reported), in which case the inside-the-extent check is skipped.
    """
    if value is None:
        return ()
    if not isinstance(value, list):
        err("example_areas", "must be a list of entries with name, description and geometry")
        return ()

    count_ok = EXAMPLE_AREAS_MIN <= len(value) <= EXAMPLE_AREAS_MAX
    if not count_ok:
        err(
            "example_areas",
            f"must have {EXAMPLE_AREAS_MIN} to {EXAMPLE_AREAS_MAX} entries, got {len(value)}",
        )

    areas: list[ExampleAreaConfig] = []
    all_ok = count_ok
    for i, item in enumerate(value):
        prefix = f"example_areas[{i}]"
        if not isinstance(item, Mapping):
            err(prefix, "must be a mapping with name, description and geometry")
            all_ok = False
            continue
        name = _validate_example_name(item.get("name"), f"{prefix}.name", err)
        description = _validate_example_description(
            item.get("description"), f"{prefix}.description", err
        )
        geometry_ok = _validate_example_geometry(
            item.get("geometry"), extent, f"{prefix}.geometry", err
        )
        if name is None or description is None or not geometry_ok:
            all_ok = False
            continue
        areas.append(
            ExampleAreaConfig(
                name=name,
                description=description,
                geometry=copy.deepcopy(dict(item["geometry"])),
            )
        )
    return tuple(areas) if all_ok else ()


def _validate_example_name(value: object, field: str, err: _ErrFn) -> str | None:
    if value is None:
        err(field, "required field is missing")
    elif not isinstance(value, str):
        err(field, "must be a string")
    elif not value.strip():
        err(field, "must not be blank")
    elif len(value.strip()) > EXAMPLE_NAME_MAX_LEN:
        err(field, f"must be at most {EXAMPLE_NAME_MAX_LEN} characters")
    else:
        return value.strip()
    return None


def _validate_example_description(value: object, field: str, err: _ErrFn) -> str | None:
    if value is None:
        err(field, "required field is missing")
    elif not isinstance(value, str):
        err(field, "must be a string")
    elif len(value) > EXAMPLE_DESCRIPTION_MAX_LEN:
        err(
            field,
            f"must be at most {EXAMPLE_DESCRIPTION_MAX_LEN} characters, got {len(value)}",
        )
    else:
        return value
    return None


def _validate_example_geometry(
    value: object, extent: Extent | None, field: str, err: _ErrFn
) -> bool:
    """Check one GeoJSON Polygon. Reports the first problem found and returns validity."""
    reason = _polygon_problem(value, extent)
    if reason is not None:
        err(field, reason)
        return False
    return True


def _polygon_problem(value: object, extent: Extent | None) -> str | None:
    """Return the first reason a GeoJSON Polygon is invalid, or None when it is valid."""
    if value is None:
        return "required field is missing"
    if not isinstance(value, Mapping):
        return "must be a GeoJSON Polygon mapping with `type` and `coordinates`"
    if value.get("type") != "Polygon":
        return f"type must be 'Polygon', got {value.get('type')!r}"
    rings = value.get("coordinates")
    if not isinstance(rings, list) or not rings:
        return "coordinates must be a non-empty list of rings"

    parsed: list[list[tuple[float, float]]] = []
    for r, ring in enumerate(rings):
        label = "ring" if len(rings) == 1 else f"ring {r}"
        problem = _ring_problem(ring, extent, label)
        if problem is not None:
            return problem
        parsed.append([(float(p[0]), float(p[1])) for p in ring])

    if not Polygon(parsed[0], parsed[1:]).is_valid:
        return "holes must lie inside the outer ring and must not overlap or touch badly"
    return None


def _ring_problem(ring: object, extent: Extent | None, label: str) -> str | None:
    if not isinstance(ring, list):
        return f"{label} must be a list of [longitude, latitude] positions"
    if len(ring) < MIN_RING_POSITIONS:
        return f"{label} must have at least {MIN_RING_POSITIONS} positions, got {len(ring)}"

    points: list[tuple[float, float]] = []
    for k, pos in enumerate(ring):
        if not isinstance(pos, list | tuple) or len(pos) < 2 or not all(_is_number(c) for c in pos):
            return f"{label} position {k} must be [longitude, latitude] with finite numbers"
        lon, lat = float(pos[0]), float(pos[1])
        if not -180 <= lon <= 180:
            return f"{label} position {k}: longitude must be between -180 and 180, got {lon:g}"
        if not -90 <= lat <= 90:
            return f"{label} position {k}: latitude must be between -90 and 90, got {lat:g}"
        points.append((lon, lat))

    if points[0] != points[-1]:
        return f"{label} is not closed: first and last positions differ"
    if MultiPoint(points).convex_hull.area == 0:
        return f"{label} has zero area"
    if not LinearRing(points).is_simple:
        return f"{label} is self-intersecting"
    if extent is not None:
        for k, (lon, lat) in enumerate(points):
            if not (extent.west <= lon <= extent.east and extent.south <= lat <= extent.north):
                return (
                    f"{label} position {k} ({lon:g}, {lat:g}) is outside the region extent "
                    f"(west {extent.west:g}, south {extent.south:g}, "
                    f"east {extent.east:g}, north {extent.north:g})"
                )
    return None

"""Hypothesis generators for app configuration (Property 1). All values are synthetic.

- `app_configs(data_dir)` draws a valid raw config mapping (what `yaml.safe_load` returns).
- `mutations()` draws a compatible set of independent defects. Each `Mutation` injects one
  defect into a raw config and names the exact fields `validate_config` must report for it.

Two defects are compatible when they touch different parts of the config (their `group`
paths do not contain one another) and neither needs a part that the other breaks
(`needs_valid`): an example area can only be "outside the region extent" while the whole
region validates.
"""

from __future__ import annotations

import string
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Final

from hypothesis import strategies as st

RawConfig = dict[str, Any]
Path_ = tuple[str | int, ...]

NONEXISTENT_DIR: Final[str] = "/nonexistent/hotspots-test-data-dir"
N_EXAMPLE_MUTATED: Final[int] = 3  # valid configs with example areas always have 3 or more

_WORD = st.text(alphabet=string.ascii_letters + string.digits + " ", min_size=1, max_size=30)
_CELL_ID = st.text(alphabet=string.ascii_letters + string.digits + "._-", min_size=1, max_size=20)


def _year_month(index: int) -> str:
    return f"{index // 12:04d}-{index % 12 + 1:02d}"


def _rect_ring(west: float, south: float, east: float, north: float) -> list[list[float]]:
    return [[west, south], [east, south], [east, north], [west, north], [west, south]]


@st.composite
def _extents(draw: st.DrawFn) -> dict[str, float]:
    """A valid extent in 0.1 degree steps, kept inside +-179 / +-89 so points can fall outside."""
    west = draw(st.integers(-1790, 1700))
    east = draw(st.integers(west + 20, 1790))
    south = draw(st.integers(-890, 800))
    north = draw(st.integers(south + 20, 890))
    return {"west": west / 10, "south": south / 10, "east": east / 10, "north": north / 10}


@st.composite
def example_area(draw: st.DrawFn, extent: dict[str, float]) -> dict[str, Any]:
    """A valid example area: a rectangle inside `extent`, a name without surrounding
    whitespace (the config trims names) and a description of up to 160 characters."""
    w0, e0 = round(extent["west"] * 10), round(extent["east"] * 10)
    s0, n0 = round(extent["south"] * 10), round(extent["north"] * 10)
    west = draw(st.integers(w0, e0 - 1))
    east = draw(st.integers(west + 1, e0))
    south = draw(st.integers(s0, n0 - 1))
    north = draw(st.integers(south + 1, n0))
    ring = _rect_ring(west / 10, south / 10, east / 10, north / 10)
    return {
        "name": draw(_WORD).strip() or "Area",
        "description": draw(st.text(alphabet=string.ascii_letters + " ", max_size=160)),
        "geometry": {"type": "Polygon", "coordinates": [ring]},
    }


@st.composite
def app_configs(draw: st.DrawFn, data_dir: str | Path) -> RawConfig:
    """A valid raw config. `data_dir` must hold both Parquet files (a fixture folder).

    Optional keys (`record_start`, `excluded_cells`, `baseline`, `watch_threshold`,
    `csv_avg_bytes_per_row`, `example_areas`) are present or absent, so defaults get covered.
    """
    extent = draw(_extents())
    name = draw(_WORD).strip() or "Region"
    cfg: RawConfig = {
        "region": {"name": f" {name} " if draw(st.booleans()) else name, "extent": extent},
        "data_dir": str(data_dir),
    }

    record_idx = draw(st.integers(1990 * 12, 2030 * 12 + 11))
    if draw(st.booleans()):
        cfg["record_start"] = _year_month(record_idx)
    else:
        record_idx = 2000 * 12 + 10  # default 2000-11

    if draw(st.booleans()):
        start: str = draw(
            st.one_of(
                st.just("record_start"),
                st.integers(record_idx, record_idx + 600).map(_year_month),
            )
        )
        baseline: dict[str, Any] = {}
        if draw(st.booleans()):
            baseline["start"] = start
        if draw(st.booleans()):
            baseline["exclude_incomplete"] = draw(st.booleans())
        cfg["baseline"] = baseline

    if draw(st.booleans()):
        cfg["excluded_cells"] = draw(st.lists(_CELL_ID, max_size=4))
    if draw(st.booleans()):
        cfg["watch_threshold"] = draw(
            st.one_of(
                st.integers(1, 99),
                st.floats(0.001, 99.999, allow_nan=False, allow_infinity=False),
            )
        )
    if draw(st.booleans()):
        cfg["csv_avg_bytes_per_row"] = draw(
            st.one_of(
                st.integers(0, 10_000),
                st.floats(0, 10_000, allow_nan=False, allow_infinity=False),
            )
        )
    if draw(st.integers(0, 4)) > 0:  # present most of the time
        cfg["example_areas"] = draw(st.lists(example_area(extent), min_size=3, max_size=5))
    return cfg


# --- mutations ---------------------------------------------------------------------------


@dataclass(frozen=True)
class Mutation:
    """One injected defect.

    `fields` are the exact `ConfigError.field` values it must produce. `group` is the config
    path it breaks. `needs_valid` lists config paths that must stay valid for the defect to
    be reported. `requires` lists top-level keys that must exist for the defect to apply.
    """

    name: str
    group: Path_
    fields: tuple[str, ...]
    apply: Callable[[RawConfig], None] = field(compare=False, repr=False)
    needs_valid: tuple[Path_, ...] = ()
    requires: tuple[str, ...] = ()

    def applicable(self, cfg: RawConfig) -> bool:
        return all(key in cfg for key in self.requires)


def _within(inner: Path_, outer: Path_) -> bool:
    return inner[: len(outer)] == outer


def compatible(a: Mutation, b: Mutation) -> bool:
    """True when `a` and `b` can be applied together and each still reports its own fields."""
    if _within(a.group, b.group) or _within(b.group, a.group):
        return False
    return not (
        any(_within(b.group, need) for need in a.needs_valid)
        or any(_within(a.group, need) for need in b.needs_valid)
    )


def _set(path: Path_, value: Any) -> Callable[[RawConfig], None]:
    """Set the value at `path`, creating missing mappings on the way."""

    def apply(cfg: RawConfig) -> None:
        node: Any = cfg
        for key in path[:-1]:
            node = node.setdefault(key, {}) if isinstance(node, dict) else node[key]
        node[path[-1]] = value

    return apply


def _delete(path: Path_) -> Callable[[RawConfig], None]:
    def apply(cfg: RawConfig) -> None:
        node: Any = cfg
        for key in path[:-1]:
            node = node[key]
        del node[path[-1]]

    return apply


def _field(path: Path_) -> str:
    out = ""
    for part in path:
        out += f"[{part}]" if isinstance(part, int) else (f".{part}" if out else part)
    return out


def _value_mutation(
    name: str,
    path: Path_,
    value: Any,
    *,
    fields: tuple[str, ...] | None = None,
    needs_valid: tuple[Path_, ...] = (),
    requires: tuple[str, ...] = (),
) -> Mutation:
    return Mutation(
        name,
        path,
        fields if fields is not None else (_field(path),),
        _set(path, value),
        needs_valid,
        requires,
    )


def _missing_mutation(name: str, path: Path_, requires: tuple[str, ...] = ()) -> Mutation:
    def apply(cfg: RawConfig) -> None:
        node: Any = cfg
        for key in path[:-1]:
            node = node[key]
        node.pop(path[-1], None)

    return Mutation(name, path, (_field(path),), apply, (), requires)


def _insert_excluded(value: Any) -> Callable[[RawConfig], None]:
    def apply(cfg: RawConfig) -> None:
        cells = cfg.setdefault("excluded_cells", ["38.7000_-117.4000"])
        cells.insert(0, value)

    return apply


def _extent_equal_west_east(cfg: RawConfig) -> None:
    extent = cfg["region"]["extent"]
    extent["west"] = extent["east"]


def _set_start_before_record(cfg: RawConfig) -> None:
    cfg.setdefault("baseline", {})["start"] = "0001-01"


def _too_many_areas(cfg: RawConfig) -> None:
    areas = cfg["example_areas"]
    while len(areas) < 6:
        areas.append(dict(areas[0]))


def _too_few_areas(count: int) -> Callable[[RawConfig], None]:
    def apply(cfg: RawConfig) -> None:
        del cfg["example_areas"][count:]

    return apply


def _outside_extent_for(index: int) -> Callable[[RawConfig], None]:
    def apply(cfg: RawConfig) -> None:
        extent = cfg["region"]["extent"]
        w, s = extent["west"] - 0.5, extent["south"]
        ring = [[w, s], [w + 0.4, s], [w + 0.4, s + 0.1], [w, s]]
        cfg["example_areas"][index]["geometry"]["coordinates"] = [ring]

    return apply


_BAD_GEOMETRIES: Final[dict[str, Any]] = {
    "point": {"type": "Point", "coordinates": [0, 0]},
    "too_few_positions": {"type": "Polygon", "coordinates": [[[0, 0], [1, 0], [0, 0]]]},
    "not_closed": {"type": "Polygon", "coordinates": [[[0, 0], [1, 0], [1, 1], [0, 1]]]},
    "bowtie": {"type": "Polygon", "coordinates": [[[0, 0], [1, 1], [1, 0], [0, 1], [0, 0]]]},
    "zero_area": {"type": "Polygon", "coordinates": [[[0, 0], [1, 1], [2, 2], [0, 0]]]},
    "longitude_out_of_range": {
        "type": "Polygon",
        "coordinates": [[[0, 0], [200, 0], [200, 1], [0, 0]]],
    },
}


def _example_mutations(i: int) -> list[Mutation]:
    base: Path_ = ("example_areas", i)
    req = ("example_areas",)
    out: list[Mutation] = [
        _value_mutation(f"example[{i}] not a mapping", base, "oops", requires=req),
        _missing_mutation(f"example[{i}] name missing", (*base, "name"), req),
        _value_mutation(f"example[{i}] name blank", (*base, "name"), "   ", requires=req),
        _value_mutation(f"example[{i}] name long", (*base, "name"), "n" * 61, requires=req),
        _value_mutation(f"example[{i}] name int", (*base, "name"), 7, requires=req),
        _missing_mutation(f"example[{i}] description missing", (*base, "description"), req),
        _value_mutation(
            f"example[{i}] description long", (*base, "description"), "d" * 161, requires=req
        ),
        _value_mutation(f"example[{i}] description int", (*base, "description"), 7, requires=req),
        _missing_mutation(f"example[{i}] geometry missing", (*base, "geometry"), req),
        Mutation(
            f"example[{i}] geometry outside extent",
            (*base, "geometry"),
            (_field((*base, "geometry")),),
            _outside_extent_for(i),
            needs_valid=(("region",),),
            requires=req,
        ),
    ]
    out.extend(
        _value_mutation(
            f"example[{i}] geometry {kind}", (*base, "geometry"), geometry, requires=req
        )
        for kind, geometry in _BAD_GEOMETRIES.items()
    )
    return out


def catalogue(empty_dir: str | Path | None = None) -> list[Mutation]:
    """Every defect the generator can inject. `empty_dir` is an existing folder with no files."""
    cat: list[Mutation] = [
        _missing_mutation("region missing", ("region",)),
        _value_mutation("region not a mapping", ("region",), ["a"]),
        _missing_mutation("region.name missing", ("region", "name")),
        _value_mutation("region.name blank", ("region", "name"), "  "),
        _value_mutation("region.name long", ("region", "name"), "r" * 101),
        _value_mutation("region.name int", ("region", "name"), 5),
        _missing_mutation("region.extent missing", ("region", "extent")),
        Mutation(
            "region.extent west equals east",
            ("region", "extent"),
            ("region.extent",),
            _extent_equal_west_east,
        ),
        _value_mutation("region.extent.west text", ("region", "extent", "west"), "far west"),
        _value_mutation("region.extent.north out of range", ("region", "extent", "north"), 91),
        _missing_mutation("region.extent.south missing", ("region", "extent", "south")),
        _missing_mutation("data_dir missing", ("data_dir",)),
        _value_mutation("data_dir blank", ("data_dir",), "  "),
        _value_mutation("data_dir int", ("data_dir",), 3),
        _value_mutation("data_dir nonexistent", ("data_dir",), NONEXISTENT_DIR),
        _value_mutation("record_start month 13", ("record_start",), "2000-13"),
        _value_mutation("record_start short", ("record_start",), "2000-1"),
        _value_mutation("record_start int", ("record_start",), 200011),
        _value_mutation("excluded_cells not a list", ("excluded_cells",), "38.7_-117.4"),
        Mutation(
            "excluded_cells[0] blank",
            ("excluded_cells", 0),
            ("excluded_cells[0]",),
            _insert_excluded("  "),
        ),
        Mutation(
            "excluded_cells[0] int",
            ("excluded_cells", 0),
            ("excluded_cells[0]",),
            _insert_excluded(12),
        ),
        _value_mutation("baseline not a mapping", ("baseline",), "yearly"),
        _value_mutation("baseline.start bad format", ("baseline", "start"), "2000/11"),
        Mutation(
            "baseline.start before record_start",
            ("baseline", "start"),
            ("baseline.start",),
            _set_start_before_record,
            needs_valid=(("record_start",),),
        ),
        _value_mutation(
            "baseline.exclude_incomplete text", ("baseline", "exclude_incomplete"), "no"
        ),
        _value_mutation("example_areas not a list", ("example_areas",), "all of them"),
        Mutation(
            "example_areas too many",
            ("example_areas",),
            ("example_areas",),
            _too_many_areas,
            requires=("example_areas",),
        ),
        *(
            Mutation(
                f"example_areas too few ({n})",
                ("example_areas",),
                ("example_areas",),
                _too_few_areas(n),
                requires=("example_areas",),
            )
            for n in (0, 1, 2)
        ),
    ]
    cat.extend(
        _value_mutation(f"watch_threshold {value!r}", ("watch_threshold",), value)
        for value in (0, 100, -5, 150, "high", True, float("nan"), float("inf"))
    )
    cat.extend(
        _value_mutation(f"csv_avg_bytes_per_row {value!r}", ("csv_avg_bytes_per_row",), value)
        for value in (-1, "many", float("nan"), False)
    )
    if empty_dir is not None:
        cat.append(_value_mutation("data_dir without files", ("data_dir",), str(empty_dir)))
    for i in range(N_EXAMPLE_MUTATED):
        cat.extend(_example_mutations(i))
    return cat


@st.composite
def mutations(
    draw: st.DrawFn, empty_dir: str | Path | None = None, max_size: int = 5
) -> list[Mutation]:
    """A pairwise-compatible set of 0 to `max_size` defects. Empty means a valid config."""
    candidates = draw(
        st.lists(
            st.sampled_from(catalogue(empty_dir)), max_size=max_size, unique_by=lambda m: m.name
        )
    )
    chosen: list[Mutation] = []
    for m in candidates:
        if all(compatible(m, other) for other in chosen):
            chosen.append(m)
    return chosen

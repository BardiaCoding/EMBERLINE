"""Unit tests for `season_tracker` and `POST /api/v1/season` (task 27.1).

Synthetic values only (TEST FIXTURE, not NASA data).
"""

from __future__ import annotations

from collections.abc import Callable, Iterator
from pathlib import Path
from typing import Any

import numpy as np
import pytest
import yaml
from fastapi.testclient import TestClient

from hotspots.api.main import create_app
from hotspots.areastats import ProvisionalMonth, ZeroFilledSeries
from hotspots.data.types import YearMonth
from hotspots.stats import season_tracker
from tests.fixtures import default_grid_rows, write_fixture_dir

PROJECT_CONFIG = Path(__file__).resolve().parents[2] / "config" / "app.yaml"


def _series(
    value: Callable[[YearMonth], float],
    first: YearMonth,
    last: YearMonth,
    provisional: tuple[YearMonth, float] | None = None,
) -> ZeroFilledSeries:
    months = [YearMonth.from_index(i) for i in range(first.index, last.index + 1)]
    n = len(months)
    prov = (
        ()
        if provisional is None
        else (ProvisionalMonth(provisional[0], provisional[1], 0, 0, None),)
    )
    return ZeroFilledSeries(
        months=months,
        harmonized=np.array([value(m) for m in months], dtype=np.float64),
        raw_modis=np.zeros(n, dtype=np.int64),
        raw_viirs=np.zeros(n, dtype=np.int64),
        frp_sum_mw=np.full(n, np.nan),
        provisional=prov,
    )


def _year_scaled(m: YearMonth) -> float:
    return float(m.year - 2000)  # every month of a year has the same value


def test_cumulative_curves_and_total_preservation() -> None:
    s = _series(_year_scaled, YearMonth(2001, 1), YearMonth(2010, 12))
    t = season_tracker(s)
    assert [c.season_year for c in t.curves] == list(range(2001, 2011))
    for c in t.curves:
        assert c.complete
        assert c.cumulative[-1] == 12.0 * (c.season_year - 2000)
        assert all(b >= a for a, b in zip(c.cumulative, c.cumulative[1:], strict=False))


def test_envelope_over_complete_seasons_and_percent_of_median() -> None:
    s = _series(_year_scaled, YearMonth(2001, 1), YearMonth(2010, 12), None)
    t = season_tracker(s, season_year=2010)
    assert t.envelope is not None and t.n_envelope_years == 10
    last = t.envelope[11]
    assert (last.p10, last.median, last.p90) == (
        pytest.approx(12 * 1.9),
        66.0,
        pytest.approx(12 * 9.1),
    )
    assert t.count == 120.0 and t.median_cumulative == 66.0
    assert t.percent_of_median == pytest.approx(100 * 120 / 66)


def test_fewer_than_five_season_years_gives_no_envelope() -> None:
    s = _series(_year_scaled, YearMonth(2001, 1), YearMonth(2005, 12))
    t = season_tracker(s)
    assert t.n_envelope_years == 5 and t.envelope is not None
    s4 = _series(_year_scaled, YearMonth(2001, 1), YearMonth(2004, 12))
    t4 = season_tracker(s4)
    assert t4.envelope is None and t4.percent_of_median is None and t4.reason
    assert t4.selected[-1] == 48.0


def test_in_progress_season_stops_at_latest_complete_month() -> None:
    s = _series(
        lambda m: 1.0,
        YearMonth(2001, 1),
        YearMonth(2010, 10),
        provisional=(YearMonth(2010, 11), 7.0),
    )
    t = season_tracker(s)
    assert t.season_year == 2010
    assert len(t.selected) == 10 and t.through == YearMonth(2010, 10)
    assert t.provisional_month == YearMonth(2010, 11) and t.provisional_count == 7.0
    assert t.n_envelope_years == 9
    assert t.envelope is not None and t.median_cumulative == 10.0 and t.percent_of_median == 100.0


def test_zero_median_gives_null_percent() -> None:
    s = _series(lambda m: 0.0 if m.year < 2010 else 3.0, YearMonth(2001, 1), YearMonth(2010, 3))
    t = season_tracker(s)
    assert t.median_cumulative == 0.0 and t.count == 9.0
    assert t.percent_of_median is None


def test_start_month_maps_months_the_same_in_every_year() -> None:
    s = _series(lambda m: float(m.month), YearMonth(2001, 1), YearMonth(2010, 12))
    t = season_tracker(s, season_start_month=7)
    curve = next(c for c in t.curves if c.season_year == 2005)
    assert curve.cumulative[0] == 7.0 and curve.cumulative[5] == 7 + 8 + 9 + 10 + 11 + 12
    assert t.envelope is not None and t.envelope[0].median == 7.0
    # Season 2010 (Jul 2010 to Jun 2011) is in progress: six months.
    assert t.season_year == 2010 and len(t.selected) == 6


def test_season_starting_before_the_series_has_no_curve_and_baseline_years_limit_envelope() -> None:
    s = _series(lambda m: 1.0, YearMonth(2000, 11), YearMonth(2010, 12))
    assert all(c.season_year != 2000 for c in season_tracker(s).curves)
    limited = season_tracker(s, baseline_years=range(2003, 2008))
    assert limited.n_envelope_years == 5
    short = season_tracker(s, baseline_years=range(2003, 2007))
    assert short.envelope is None


def test_unknown_season_year_and_empty_series() -> None:
    s = _series(lambda m: 1.0, YearMonth(2001, 1), YearMonth(2005, 12))
    t = season_tracker(s, season_year=1999)
    assert t.season_year is None and t.selected == () and t.reason
    empty = season_tracker(_series(lambda m: 1.0, YearMonth(2001, 2), YearMonth(2001, 1)))
    assert empty.season_year is None and empty.reason


def test_invalid_start_month() -> None:
    s = _series(lambda m: 1.0, YearMonth(2001, 1), YearMonth(2002, 12))
    with pytest.raises(ValueError):
        season_tracker(s, season_start_month=13)


# --- API ----------------------------------------------------------------------------------
@pytest.fixture
def client(tmp_path: Path) -> Iterator[TestClient]:
    raw = yaml.safe_load(PROJECT_CONFIG.read_text(encoding="utf-8"))
    raw["data_dir"] = str(write_fixture_dir(tmp_path, default_grid_rows()))
    path = tmp_path / "app.yaml"
    path.write_text(yaml.safe_dump(raw), encoding="utf-8")
    with TestClient(create_app(path)) as c:
        yield c


def _post(client: TestClient, **extra: Any) -> Any:
    return client.post("/api/v1/season", json={"start": "2000-01-01", "end": "2026-12-31", **extra})


def test_api_season_response(client: TestClient) -> None:
    r = _post(client)
    assert r.status_code == 200
    body = r.json()
    assert body["season_start_month"] == 1 and body["season_year"] == 2026
    assert body["through"] == "2026-10"  # 2026-11 is provisional and not in the curve
    assert len(body["selected"]) == 10
    assert body["provisional_month"] == "2026-11"
    assert body["envelope"] is not None and len(body["envelope"]) == 12
    assert body["n_envelope_years"] >= 5
    for p in body["envelope"]:
        assert p["p10"] <= p["median"] <= p["p90"]
    assert all(a <= b for a, b in zip(body["selected"], body["selected"][1:], strict=False))


def test_api_season_start_month_and_year(client: TestClient) -> None:
    body = _post(client, season_start_month=7, season_year=2010).json()
    assert body["season_year"] == 2010 and len(body["selected"]) == 12
    assert body["envelope"][0]["calendar_month"] == 7
    assert body["envelope"][6]["calendar_month"] == 1


def test_api_season_rejects_bad_start_month(client: TestClient) -> None:
    assert _post(client, season_start_month=13).status_code == 422

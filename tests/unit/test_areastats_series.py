"""Unit tests for `zero_filled_series` (task 7.4). Synthetic arrays only, not NASA data."""

from __future__ import annotations

import numpy as np
import pytest

from hotspots.areastats import zero_filled_series
from hotspots.data.types import YearMonth

START = YearMonth(2000, 11)
MONTHS = [YearMonth(2000, 10), YearMonth(2000, 11), YearMonth(2000, 12), YearMonth(2001, 1)]


def _arrays() -> dict[str, np.ndarray]:
    harm = np.array([[1.0, 2.0, 0.0, 4.0], [0.5, 0.0, 3.0, 1.5], [10.0, 10.0, 10.0, 10.0]])
    return {
        "harm": harm,
        "raw_modis": np.array([[1, 2, 0, 4], [1, 0, 3, 1], [9, 9, 9, 9]], dtype=np.int32),
        "raw_viirs": np.array([[0, 0, 0, 1], [0, 0, 0, 2], [5, 5, 5, 5]], dtype=np.int32),
        "frp_sum": np.array([[5.0, 6.0, 0.0, 8.0], [1.0, 0.0, 0.0, 2.0], [0.0, 0.0, 0.0, 0.0]]),
        "frp_known": np.array(
            [
                [True, True, False, True],
                [True, False, False, True],
                [False, False, False, False],
            ]
        ),
    }


def _run(mask: list[bool], complete: list[bool], start: YearMonth = START):
    a = _arrays()
    return zero_filled_series(
        a["harm"],
        np.array(mask),
        MONTHS,
        np.array(complete),
        start,
        raw_modis=a["raw_modis"],
        raw_viirs=a["raw_viirs"],
        frp_sum=a["frp_sum"],
        frp_known=a["frp_known"],
    )


def test_sums_selected_cells_and_drops_months_before_record_start() -> None:
    s = _run([True, True, False], [True, True, True, True])
    assert s.months == MONTHS[1:]
    assert s.harmonized.tolist() == [2.0, 3.0, 5.5]
    assert s.provisional == ()


def test_raw_series_stay_separate() -> None:
    s = _run([True, True, False], [True, True, True, True])
    assert s.raw_modis.tolist() == [2, 3, 5]
    assert s.raw_viirs.tolist() == [0, 0, 3]
    assert not np.array_equal(s.raw_modis + s.raw_viirs, s.raw_modis)


def test_empty_selection_is_all_zero_with_null_frp() -> None:
    s = _run([False, False, False], [True, True, True, True])
    assert s.harmonized.tolist() == [0.0, 0.0, 0.0]
    assert s.raw_modis.tolist() == [0, 0, 0]
    assert s.raw_viirs.tolist() == [0, 0, 0]
    assert np.isnan(s.frp_sum_mw).all()


def test_frp_sum_is_null_when_no_data_and_zero_free() -> None:
    s = _run([True, True, False], [True, True, True, True])
    # 2000-11: cell 0 only (6.0). 2000-12: nobody known, null (not 0). 2001-01: 8 + 2.
    assert s.frp_sum_mw[0] == 6.0
    assert np.isnan(s.frp_sum_mw[1])
    assert s.frp_sum_mw[2] == 10.0


def test_incomplete_month_is_returned_separately() -> None:
    s = _run([True, True, False], [True, True, True, False])
    assert s.months == [YearMonth(2000, 11), YearMonth(2000, 12)]
    assert len(s.harmonized) == 2
    assert len(s.provisional) == 1
    p = s.provisional[0]
    assert p.month == YearMonth(2001, 1)
    assert p.harmonized == 5.5
    assert (p.raw_modis, p.raw_viirs) == (5, 3)
    assert p.frp_sum_mw == 10.0


def test_incomplete_month_before_record_start_is_dropped_everywhere() -> None:
    s = _run([True, True, True], [False, True, True, True])
    assert YearMonth(2000, 10) not in s.months
    assert s.provisional == ()


def test_provisional_month_without_frp_has_none() -> None:
    s = _run([False, False, True], [True, True, False, True])
    assert s.provisional[0].frp_sum_mw is None


def test_shape_mismatch_raises() -> None:
    a = _arrays()
    with pytest.raises(ValueError):
        zero_filled_series(
            a["harm"],
            np.array([True, False]),
            MONTHS,
            np.ones(4, dtype=bool),
            YearMonth(2000, 11),
            raw_modis=a["raw_modis"],
            raw_viirs=a["raw_viirs"],
            frp_sum=a["frp_sum"],
            frp_known=a["frp_known"],
        )

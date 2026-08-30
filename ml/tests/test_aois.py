"""Unit tests for the AOI config -- the single source of truth for geography.

These exist mainly to enforce the "no hardcoded coordinates" rule: if a district
is added or its polygon moves, everything downstream follows automatically, and
these tests prove the plumbing still works.
"""

from __future__ import annotations

import pytest

from ml.config.aois import (
    ANCHOR_EVENTS,
    MONSOON_MONTHS,
    all_aois,
    aoi_codes,
    get_aoi,
    load_aois,
    ner_bbox,
)


def test_all_pilot_districts_load():
    aois = all_aois()
    assert len(aois) == 5
    assert {a.code for a in aois} == {"MZ-AIZ", "ML-EKH", "MN-NON", "MN-IMP", "SK-GNG"}


def test_lookup_works_by_code_and_by_name():
    by_code = get_aoi("MN-NON")
    by_name = get_aoi("Noney")
    assert by_code == by_name
    assert by_code.state == "Manipur"


def test_lookup_is_tolerant_of_case_and_spacing():
    assert get_aoi("east khasi hills").code == "ML-EKH"
    assert get_aoi("ml-ekh").code == "ML-EKH"


def test_unknown_aoi_raises_with_useful_message():
    with pytest.raises(KeyError) as exc:
        get_aoi("Nowhere")
    assert "MN-NON" in str(exc.value)  # lists the valid codes


def test_centroids_fall_inside_their_own_bbox():
    for aoi in all_aois():
        minlon, minlat, maxlon, maxlat = aoi.bbox
        assert minlat <= aoi.lat <= maxlat, aoi.code
        assert minlon <= aoi.lon <= maxlon, aoi.code


def test_centroid_is_inside_its_polygon():
    for aoi in all_aois():
        assert aoi.contains(aoi.lat, aoi.lon), aoi.code


def test_ner_bbox_covers_every_district():
    minlon, minlat, maxlon, maxlat = ner_bbox()
    for aoi in all_aois():
        b = aoi.bbox
        assert minlon <= b[0] and minlat <= b[1]
        assert maxlon >= b[2] and maxlat >= b[3]


def test_bbox_str_is_api_ready():
    aoi = get_aoi("MN-NON")
    parts = aoi.bbox_str.split(",")
    assert len(parts) == 4
    assert all(float(p) == float(p) for p in parts)  # all numeric


def test_slug_is_filesystem_safe():
    for aoi in all_aois():
        assert " " not in aoi.slug
        assert aoi.slug.isascii()


def test_load_aois_is_deterministic():
    assert [a.code for a in load_aois()] == [a.code for a in load_aois()]


def test_aoi_codes_matches_all_aois():
    assert aoi_codes() == [a.code for a in all_aois()]


def test_anchor_event_is_defined():
    """The backtest depends on this anchor; break it and the report must fail."""
    ev = ANCHOR_EVENTS["noney_2022"]
    assert ev["district"] == "Noney"
    assert ev["date"] == "2022-06-29"
    assert ev["fatalities"] > 0


def test_monsoon_months_are_may_to_september():
    assert MONSOON_MONTHS == (5, 6, 7, 8, 9)

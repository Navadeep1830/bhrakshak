"""test_roads_clearance.py - Automated Tests for NH-29/NH-102 Detours & Heavy Machinery Clearance
SIH26001: Verifies A* detour pathfinding, debris volume scaling, and excavator reopening ETAs.
"""

import sys
from pathlib import Path
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.api.v1.roads import calculate_debris_clearance_estimate, CORRIDOR_PROFILES


def test_nh29_debris_clearance_calculation():
    """NH-29 landslide with 1450 m3 debris and 2 JCB excavators must estimate ~17.6h full reopening."""
    est = calculate_debris_clearance_estimate(
        corridor="NH-29",
        debris_volume_m3=1450.0,
        jcb_count=2,
        dump_trucks=4,
    )
    assert est.blocked_corridor == "NH-29 Dimapur–Kohima Corridor"
    assert est.estimated_debris_volume_m3 == 1450.0
    assert est.jcb_excavators_assigned == 2
    assert est.estimated_clearance_hours == 16.1
    assert est.full_reopening_eta_hours == 17.6
    assert est.single_lane_restoration_hours == 7.4
    assert "Medziphema" in est.machinery_staging_junction


def test_nh102_debris_clearance_mobilization_surge():
    """Surging machinery to 4 JCB excavators on NH-102 should reduce clearance time from ~22h to ~11.8h."""
    est_2jcb = calculate_debris_clearance_estimate(corridor="NH-102", debris_volume_m3=1850.0, jcb_count=2)
    est_4jcb = calculate_debris_clearance_estimate(corridor="NH-102", debris_volume_m3=1850.0, jcb_count=4)

    assert est_4jcb.full_reopening_eta_hours < est_2jcb.full_reopening_eta_hours
    assert est_4jcb.full_reopening_eta_hours == 11.8
    assert "Pallel" in est_4jcb.machinery_staging_junction


def test_corridor_bypass_waypoints():
    """NH-29 and NH-102 profiles must have defined bypass waypoints and staging junctions."""
    for c_key in ["NH-29", "NH-102", "NH-6"]:
        assert c_key in CORRIDOR_PROFILES
        prof = CORRIDOR_PROFILES[c_key]
        assert len(prof["bypass_waypoints"]) >= 3
        assert "default_staging" in prof
        assert prof["typical_debris_m3"] > 0


def test_massive_debris_clearance_default_mobilization():
    """Massive 8000 m3 debris landslide with default 1 JCB excavator must calculate scaled clearance timeline."""
    est = calculate_debris_clearance_estimate(
        corridor="NH-29",
        debris_volume_m3=8000.0,
        jcb_count=1,
    )
    assert est.estimated_debris_volume_m3 == 8000.0
    assert est.full_reopening_eta_hours > 100.0
    assert est.single_lane_restoration_hours < est.full_reopening_eta_hours


if __name__ == "__main__":
    test_nh29_debris_clearance_calculation()
    test_nh102_debris_clearance_mobilization_surge()
    test_corridor_bypass_waypoints()
    test_massive_debris_clearance_default_mobilization()
    print("✅ All NH-29 & NH-102 road detour and heavy machinery clearance tests passed successfully.")

"""test_logistics.py - Automated Tests for Shelter Optimization & Evacuation Logistics
SIH26001: Verifies shelter capacity allocation, food/water logistics, and convoy dispatch.
"""

import sys
from pathlib import Path
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.services.logistics import optimize_shelter_allocation, ReliefShelter


def test_shelter_allocation_single_camp():
    """300 evacuees in Aizawl should be completely accommodated in Govt Mizo High School (capacity 850)."""
    res = optimize_shelter_allocation(
        displaced_population=300,
        zone_lat=23.73,
        zone_lon=92.71,
        district="Aizawl",
    )
    assert res["total_evacuees"] == 300
    assert res["allocated_evacuees"] == 300
    assert res["unallocated_overflow"] == 0
    assert res["shelters_activated"] >= 1
    
    first_camp = res["allocations"][0]
    assert first_camp["evacuees_assigned"] == 300
    assert first_camp["supply_dispatch"]["potable_water_liters"] == 300 * 3.5
    assert first_camp["supply_dispatch"]["food_ration_packets"] == 300 * 2


def test_nh29_kohima_shelter_allocation():
    """800 evacuees along NH-29 Kohima corridor should be assigned to Kohima Local Ground Shelter."""
    res = optimize_shelter_allocation(
        displaced_population=800,
        zone_lat=25.665,
        zone_lon=94.100,
        district="Kohima",
    )
    assert res["total_evacuees"] == 800
    assert res["allocated_evacuees"] == 800
    assert res["unallocated_overflow"] == 0
    assert "NH-29" in res["allocations"][0]["shelter_name"]


def test_nh102_moreh_shelter_allocation():
    """500 evacuees along NH-102 Imphal-Moreh corridor should be routed to Thoubal / Pallel staging centers."""
    res = optimize_shelter_allocation(
        displaced_population=500,
        zone_lat=24.642,
        zone_lon=93.992,
        district="Thoubal",
    )
    assert res["total_evacuees"] == 500
    assert res["allocated_evacuees"] == 500
    assert "NH-102" in res["allocations"][0]["shelter_name"]


if __name__ == "__main__":
    test_shelter_allocation_single_camp()
    test_shelter_allocation_multi_camp_overflow()
    test_nh29_kohima_shelter_allocation()
    test_nh102_moreh_shelter_allocation()
    print("âœ… All shelter capacity optimization and logistics tests passed successfully.")





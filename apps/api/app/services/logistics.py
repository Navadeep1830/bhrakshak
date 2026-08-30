"""logistics.py - Emergency Logistics, Shelter Optimization & Supply Dispatch
SIH26001: Automated Shelter Allocation, Capacity Optimization & Emergency Convoy Routing.
"""

from dataclasses import dataclass
import math
from typing import Any
import networkx as nx


@dataclass
class ReliefShelter:
    id: str
    name: str
    district: str
    lat: float
    lon: float
    capacity_persons: int
    occupied: int = 0
    medical_staff: int = 4
    water_reserve_liters: float = 5000.0
    ration_packets: int = 1500


DEFAULT_SHELTERS: list[ReliefShelter] = [
    ReliefShelter("SH-AIZ-01", "Govt Mizo High School Relief Camp", "Aizawl", 23.732, 92.715, 850, 120),
    ReliefShelter("SH-AIZ-02", "Durtlang Community Hall Shelter", "Aizawl", 23.785, 92.730, 600, 45),
    ReliefShelter("SH-EKH-01", "Sohra Civil Hospital Staging Camp", "East Khasi Hills", 25.280, 91.720, 700, 80),
    ReliefShelter("SH-EKH-02", "Shillong Indoor Stadium Relief Hub", "East Khasi Hills", 25.570, 91.885, 1500, 210),
    ReliefShelter("SH-NON-01", "Tupul Railway Station Emergency Camp", "Noney", 24.810, 93.680, 500, 150),
    ReliefShelter("SH-NON-02", "Noney Bazar Community Center", "Noney", 24.835, 93.620, 450, 30),
    ReliefShelter("SH-GAN-01", "Paljor Stadium Emergency Evacuation Shelter", "Gangtok", 27.332, 88.612, 1200, 190),
    ReliefShelter("SH-GAN-02", "Tadong Higher Secondary Shelter", "Gangtok", 27.310, 88.600, 650, 50),
    # NH-29 Arterial Corridor Shelters (Dimapur - Kohima)
    ReliefShelter("SH-KOH-01", "Kohima Local Ground Emergency Shelter (NH-29)", "Kohima", 25.670, 94.105, 1100, 150),
    ReliefShelter("SH-DIM-01", "Medziphema Community Camp (NH-29 Bypass)", "Dimapur", 25.755, 93.870, 800, 90),
    # NH-102 Arterial Corridor Shelters (Imphal - Moreh)
    ReliefShelter("SH-THB-01", "Thoubal College Relief Hub (NH-102)", "Thoubal", 24.640, 93.990, 900, 110),
    ReliefShelter("SH-TEN-01", "Pallel Staging Center (NH-102 Bypass)", "Tengnoupal", 24.520, 94.020, 650, 40),
]


def _haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    R = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = math.radians(lat2 - lat1), math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * R * math.asin(math.sqrt(a))


def optimize_shelter_allocation(
    displaced_population: int,
    zone_lat: float,
    zone_lon: float,
    district: str | None = None,
    shelters: list[ReliefShelter] | None = None,
) -> dict[str, Any]:
    """Optimizes shelter allocation and relief resource provisioning for evacuated villagers."""
    all_shelters = [s for s in (shelters or DEFAULT_SHELTERS) if (district is None or s.district == district)]
    if not all_shelters:
        all_shelters = shelters or DEFAULT_SHELTERS

    # Sort shelters by spatial proximity
    sorted_shelters = sorted(all_shelters, key=lambda s: _haversine_km(zone_lat, zone_lon, s.lat, s.lon))

    remaining = displaced_population
    allocations = []
    
    for s in sorted_shelters:
        if remaining <= 0:
            break
        available_slots = max(0, s.capacity_persons - s.occupied)
        if available_slots <= 0:
            continue
            
        assigned = min(remaining, available_slots)
        dist_km = round(_haversine_km(zone_lat, zone_lon, s.lat, s.lon), 1)
        travel_time_min = int(dist_km * 2.8) # Mountain convoy speed proxy
        
        # Calculate supply requirements
        water_req_l = assigned * 3.5  # 3.5L potable water per person/day
        food_packets_req = assigned * 2
        
        allocations.append({
            "shelter_id": s.id,
            "shelter_name": s.name,
            "district": s.district,
            "distance_km": dist_km,
            "estimated_transit_min": travel_time_min,
            "evacuees_assigned": assigned,
            "capacity_total": s.capacity_persons,
            "capacity_after_allocation_pct": round(((s.occupied + assigned) / s.capacity_persons) * 100, 1),
            "medical_support_available": s.medical_staff > 0,
            "supply_dispatch": {
                "potable_water_liters": water_req_l,
                "food_ration_packets": food_packets_req,
                "emergency_blankets": assigned,
                "first_aid_kits": max(1, assigned // 50),
            },
        })
        remaining -= assigned

    return {
        "total_evacuees": displaced_population,
        "allocated_evacuees": displaced_population - remaining,
        "unallocated_overflow": max(0, remaining),
        "shelters_activated": len(allocations),
        "allocations": allocations,
    }

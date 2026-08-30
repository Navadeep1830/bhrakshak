"""incident_command.py - Incident Command & Emergency Response Orchestration Router
SIH26001: Tracks NDRF/SDRF search-and-rescue team deployment, camp capacities, and emergency supply convoy dispatches.
"""

from dataclasses import dataclass
import datetime
from typing import Any, Literal
import uuid

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

router = APIRouter(prefix="/incident-command", tags=["incident_command"])

# In-Memory Incident Command State (backed by persistent logs and mock DB tables)
ACTIVE_TEAMS: list[dict[str, Any]] = [
    {
        "team_id": "NDRF-12-BN-A",
        "agency": "NDRF",
        "battalion": "12th Battalion Itanagar / Imphal Detachment",
        "commander": "Insp. R. K. Singh",
        "personnel_count": 35,
        "assigned_district": "Noney",
        "assigned_sector": "Tupul Railway Yard KM 8.2",
        "equipment": ["Inflatable Rescue Boats", "Acoustic Victim Search Cameras", "Hydraulic Cutters", "Satellite Comms Pack"],
        "status": "ON_SITE",
        "lat": 24.8105,
        "lon": 93.6820,
        "last_checkin": datetime.datetime.now(datetime.timezone.utc).isoformat(),
    },
    {
        "team_id": "SDRF-MN-QRT-01",
        "agency": "SDRF",
        "battalion": "Manipur State Disaster Response Force QRT-1",
        "commander": "Sub-Insp. L. Meitei",
        "personnel_count": 20,
        "assigned_district": "Noney",
        "assigned_sector": "Ijei River Downstream Choke Point",
        "equipment": ["Heavy Earth Excavation Support", "Dewatering Pumps", "Medical Trauma Kit"],
        "status": "EN_ROUTE",
        "lat": 24.7950,
        "lon": 93.6650,
        "last_checkin": datetime.datetime.now(datetime.timezone.utc).isoformat(),
    },
    {
        "team_id": "NDRF-01-BN-B",
        "agency": "NDRF",
        "battalion": "1st Battalion Guwahati / Kohima Staging",
        "commander": "Asst. Comdt. V. Sharma",
        "personnel_count": 40,
        "assigned_district": "Kohima",
        "assigned_sector": "NH-29 Paglapahar Landslide Corridor",
        "equipment": ["Search & Rescue K9 Unit", "Thermal Drone Recon Kit", "High-Angle Rope Rescue"],
        "status": "ON_SITE",
        "lat": 25.6650,
        "lon": 94.1005,
        "last_checkin": datetime.datetime.now(datetime.timezone.utc).isoformat(),
    },
    {
        "team_id": "SDRF-MZ-PLT-02",
        "agency": "SDRF",
        "battalion": "Mizoram SDRF Platoon 2",
        "commander": "Sub-Insp. K. Lalthanga",
        "personnel_count": 25,
        "assigned_district": "Aizawl",
        "assigned_sector": "Durtlang Ridge Slope Failure",
        "equipment": ["Pneumatic Shoring Kit", "Satellite Phones", "Portable Power Generators"],
        "status": "STANDBY",
        "lat": 23.7325,
        "lon": 92.7155,
        "last_checkin": datetime.datetime.now(datetime.timezone.utc).isoformat(),
    },
]

RELIEF_SHELTERS: list[dict[str, Any]] = [
    {
        "camp_id": "CAMP-NONEY-01",
        "name": "Tupul Railway Station Emergency Relief Camp",
        "district": "Noney",
        "lat": 24.8100,
        "lon": 93.6800,
        "max_capacity": 500,
        "current_occupancy": 380,
        "available_beds": 120,
        "trauma_medical_ready": True,
        "potable_water_liters": 4500,
        "ration_packets_remaining": 1200,
        "status": "OPERATIONAL",
    },
    {
        "camp_id": "CAMP-AIZAWL-01",
        "name": "Govt Mizo High School Relief Camp",
        "district": "Aizawl",
        "lat": 23.7150,
        "lon": 92.7320,
        "max_capacity": 850,
        "current_occupancy": 420,
        "available_beds": 430,
        "trauma_medical_ready": True,
        "potable_water_liters": 8200,
        "ration_packets_remaining": 2100,
        "status": "OPERATIONAL",
    },
    {
        "camp_id": "CAMP-KOHIMA-01",
        "name": "Jotsoma Community Hall Evacuation Shelter",
        "district": "Kohima",
        "lat": 25.6700,
        "lon": 94.0850,
        "max_capacity": 600,
        "current_occupancy": 210,
        "available_beds": 390,
        "trauma_medical_ready": True,
        "potable_water_liters": 6000,
        "ration_packets_remaining": 1500,
        "status": "OPERATIONAL",
    },
    {
        "camp_id": "CAMP-EKH-01",
        "name": "Sohra Civil Hospital Staging Shelter",
        "district": "East Khasi Hills",
        "lat": 25.2800,
        "lon": 91.7200,
        "max_capacity": 700,
        "current_occupancy": 150,
        "available_beds": 550,
        "trauma_medical_ready": True,
        "potable_water_liters": 9500,
        "ration_packets_remaining": 3000,
        "status": "OPERATIONAL",
    },
]

SUPPLY_DISPATCHES: list[dict[str, Any]] = [
    {
        "dispatch_id": "DISPATCH-2026-0801",
        "destination_camp_id": "CAMP-NONEY-01",
        "supply_type": "Trauma Medical Kits & Blood Units",
        "quantity": 150,
        "unit": "Units",
        "convoy_lead": "Imphal District Health Convoy 4",
        "status": "IN_TRANSIT",
        "dispatched_at": "2026-08-30T07:15:00Z",
        "eta_minutes": 25,
    },
    {
        "dispatch_id": "DISPATCH-2026-0802",
        "destination_camp_id": "CAMP-KOHIMA-01",
        "supply_type": "Heavy JCB Earthmover & Fuel Bowsers",
        "quantity": 2,
        "unit": "Excavator Vehicles",
        "convoy_lead": "PWD Medziphema Logistics Base",
        "status": "STAGED",
        "dispatched_at": "2026-08-30T08:00:00Z",
        "eta_minutes": 45,
    },
    {
        "dispatch_id": "DISPATCH-2026-0803",
        "destination_camp_id": "CAMP-AIZAWL-01",
        "supply_type": "Potable Water Tanker (10,000L)",
        "quantity": 1,
        "unit": "Tanker Vehicle",
        "convoy_lead": "PHED Aizawl Supply Column",
        "status": "DELIVERED",
        "dispatched_at": "2026-08-30T05:30:00Z",
        "eta_minutes": 0,
    },
]


# Pydantic Schemas for Requests & Responses
class TeamDeployIn(BaseModel):
    team_id: str
    target_sector: str
    target_district: str
    lat: float
    lon: float
    status: Literal["STANDBY", "EN_ROUTE", "ON_SITE", "RECOVERY_OPS"] = "EN_ROUTE"


class ShelterUpdateIn(BaseModel):
    camp_id: str
    current_occupancy: int
    water_liters: int | None = None
    ration_packets: int | None = None


class DispatchCreateIn(BaseModel):
    destination_camp_id: str
    supply_type: str
    quantity: int
    unit: str
    convoy_lead: str
    eta_minutes: int = 30


@router.get("/teams")
async def list_rescue_teams(district: str | None = None) -> list[dict[str, Any]]:
    """Returns real-time NDRF and SDRF search-and-rescue team deployment statuses."""
    if district:
        return [t for t in ACTIVE_TEAMS if t["assigned_district"].lower() == district.lower()]
    return ACTIVE_TEAMS


@router.post("/teams/deploy")
async def deploy_rescue_team(payload: TeamDeployIn) -> dict[str, Any]:
    """Dispatches or re-assigns an NDRF/SDRF unit to a high-risk landslide sector."""
    for team in ACTIVE_TEAMS:
        if team["team_id"] == payload.team_id:
            team["assigned_sector"] = payload.target_sector
            team["assigned_district"] = payload.target_district
            team["lat"] = payload.lat
            team["lon"] = payload.lon
            team["status"] = payload.status
            team["last_checkin"] = datetime.datetime.now(datetime.timezone.utc).isoformat()
            return {"status": "success", "message": f"Team {payload.team_id} successfully deployed to {payload.target_sector}", "team": team}
    raise HTTPException(status_code=404, detail=f"Team {payload.team_id} not found in roster.")


@router.get("/shelters")
async def list_relief_shelters(district: str | None = None) -> list[dict[str, Any]]:
    """Returns designated relief camp capacities, bed occupancy, and water/food reserves."""
    if district:
        return [s for s in RELIEF_SHELTERS if s["district"].lower() == district.lower()]
    return RELIEF_SHELTERS


@router.post("/shelters/update")
async def update_shelter_capacity(payload: ShelterUpdateIn) -> dict[str, Any]:
    """Updates real-time evacuee occupancy and supply levels for a designated relief shelter."""
    for shelter in RELIEF_SHELTERS:
        if shelter["camp_id"] == payload.camp_id:
            shelter["current_occupancy"] = payload.current_occupancy
            shelter["available_beds"] = max(0, shelter["max_capacity"] - payload.current_occupancy)
            if payload.water_liters is not None:
                shelter["potable_water_liters"] = payload.water_liters
            if payload.ration_packets is not None:
                shelter["ration_packets_remaining"] = payload.ration_packets
            return {"status": "success", "message": f"Shelter {payload.camp_id} capacity updated.", "shelter": shelter}
    raise HTTPException(status_code=404, detail=f"Shelter {payload.camp_id} not found.")


@router.get("/dispatches")
async def list_supply_dispatches() -> list[dict[str, Any]]:
    """Lists active emergency supply convoy dispatches and arrival ETAs."""
    return SUPPLY_DISPATCHES


@router.post("/dispatches/create")
async def create_supply_dispatch(payload: DispatchCreateIn) -> dict[str, Any]:
    """Initiates an emergency supply convoy dispatch order to a relief shelter."""
    new_id = f"DISPATCH-2026-{uuid.uuid4().hex[:4].upper()}"
    dispatch_entry = {
        "dispatch_id": new_id,
        "destination_camp_id": payload.destination_camp_id,
        "supply_type": payload.supply_type,
        "quantity": payload.quantity,
        "unit": payload.unit,
        "convoy_lead": payload.convoy_lead,
        "status": "IN_TRANSIT",
        "dispatched_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "eta_minutes": payload.eta_minutes,
    }
    SUPPLY_DISPATCHES.append(dispatch_entry)
    return {"status": "success", "dispatch_id": new_id, "dispatch": dispatch_entry}


@router.get("/summary")
async def get_incident_command_summary() -> dict[str, Any]:
    """Aggregates high-level Incident Command metrics for District Collector & DDMA briefings."""
    total_capacity = sum(s["max_capacity"] for s in RELIEF_SHELTERS)
    total_evacuees = sum(s["current_occupancy"] for s in RELIEF_SHELTERS)
    available_beds = sum(s["available_beds"] for s in RELIEF_SHELTERS)
    total_water_l = sum(s["potable_water_liters"] for s in RELIEF_SHELTERS)
    total_rations = sum(s["ration_packets_remaining"] for s in RELIEF_SHELTERS)
    
    deployed_teams = [t for t in ACTIVE_TEAMS if t["status"] in ("ON_SITE", "EN_ROUTE")]
    active_personnel = sum(t["personnel_count"] for t in deployed_teams)
    in_transit_convoys = [d for d in SUPPLY_DISPATCHES if d["status"] == "IN_TRANSIT"]

    return {
        "generated_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "shelter_overview": {
            "total_shelters": len(RELIEF_SHELTERS),
            "total_capacity": total_capacity,
            "current_evacuees_sheltered": total_evacuees,
            "occupancy_rate_pct": round((total_evacuees / max(1, total_capacity)) * 100, 1),
            "available_beds": available_beds,
            "stockpiles": {
                "potable_water_liters": total_water_l,
                "food_ration_packets": total_rations,
            },
        },
        "response_force": {
            "total_rescue_teams": len(ACTIVE_TEAMS),
            "active_deployed_teams": len(deployed_teams),
            "deployed_personnel_count": active_personnel,
            "agencies": ["NDRF", "SDRF"],
        },
        "logistics_convoys": {
            "total_dispatches": len(SUPPLY_DISPATCHES),
            "convoys_in_transit": len(in_transit_convoys),
        },
    }


class AITriageRequestIn(BaseModel):
    report_text: str
    lat: float
    lon: float
    district: str = "Noney"
    incident_sector: str = "Tupul Railway Corridor KM 8.2"


@router.post("/ai-triage-dispatch")
async def ai_triage_and_dispatch(payload: AITriageRequestIn) -> dict[str, Any]:
    """Autonomous Multi-Agent AI Incident Commander:
    1. TriageAgent: Detects language (8 NER languages) and emergency priority.
    2. ResourceAllocationAgent: Dispatches nearest NDRF battalion, JCB excavators, and detour routing.
    3. OrderDraftingAgent: Drafts official bilingual DDMA Action Order under DM Act 2005 with SHA-256 token.
    """
    from app.services.incident_commander import incident_commander
    return incident_commander.coordinate_incident(
        report_text=payload.report_text,
        user_lat=payload.lat,
        user_lon=payload.lon,
        district=payload.district,
        incident_sector=payload.incident_sector,
    )

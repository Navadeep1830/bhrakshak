"""evacuation.py — Safest-route evacuation + shelter registry endpoints.

PS bullets served:
  * "Pathway model. Landslide affected avoid and get to safest place
     possible during landslide — flat areas. SAFEST."
  * GIS visualisation of vulnerable villages / infrastructure.
"""

import math
import uuid

from fastapi import APIRouter, Depends, HTTPException
from geoalchemy2 import WKTElement
from geoalchemy2 import functions as gfunc
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.models import RiskCell, Shelter, Zone
from app.services.evacuation import haversine_km, plan_evacuation

router = APIRouter(prefix="/evacuation", tags=["evacuation"])


class ShelterIn(BaseModel):
    name: str
    district: str
    lat: float
    lon: float
    capacity: int = 200
    occupancy: int = 0
    shelter_type: str = "community_hall"
    has_medical: bool = False
    water_liters: int = 0
    ration_packets: int = 0
    elevation_m: float | None = None
    slope_deg: float | None = None
    distance_to_steep_slope_m: float | None = None


async def _load_zone_field(db: AsyncSession, lat: float, lon: float, radius_km: float) -> list[dict]:
    """Live hazard field around (lat, lon) in ONE query: every zone whose
    centroid falls within radius, with its fused level + susceptibility."""
    radius_deg = radius_km / 110.574
    rows = (
        await db.execute(
            select(
                Zone.zone_code,
                Zone.susc_mean,
                Zone.population,
                RiskCell.hazard_level,
                gfunc.ST_Y(gfunc.ST_Centroid(Zone.geom)).label("clat"),
                gfunc.ST_X(gfunc.ST_Centroid(Zone.geom)).label("clon"),
            )
            .join(RiskCell, RiskCell.zone_id == Zone.id)
            .where(
                gfunc.ST_DWithin(
                    gfunc.ST_Centroid(Zone.geom),
                    WKTElement(f"POINT({lon} {lat})", srid=4326),
                    radius_deg,
                )
            )
        )
    ).all()
    out = []
    for code, susc, pop, lvl, clat, clon in rows:
        out.append({
            "zone_code": code,
            "susc_mean": float(susc or 40),
            "population": pop,
            "hazard_level": int(lvl or 0),
            "centroid_lat": float(clat),
            "centroid_lon": float(clon),
            "radius_km": 3.0,  # hex circumradius ≈ 3 km
        })
    return out


@router.get("/safe-route")
async def safe_route(
    lat: float,
    lon: float,
    population: int | None = None,
    db: AsyncSession = Depends(get_db),
):
    """Pathway model: from (lat, lon) to the SAFEST reachable shelter.

    Safety is scored on flatness (distance to steep slopes), free capacity,
    medical support and site slope — then A* routes around live hazard cells
    rather than taking the shortest path through them.
    """
    if not (-90 <= lat <= 90 and -180 <= lon <= 180):
        raise HTTPException(422, "invalid coordinates")

    zone_rows = await _load_zone_field(db, lat, lon, radius_km=6.0)
    shelters = (
        await db.execute(
            select(
                Shelter.id, Shelter.name, Shelter.district, Shelter.capacity,
                Shelter.occupancy, Shelter.shelter_type, Shelter.has_medical,
                Shelter.slope_deg, Shelter.distance_to_steep_slope_m,
                gfunc.ST_Y(Shelter.geom).label("slat"),
                gfunc.ST_X(Shelter.geom).label("slon"),
            ).where(Shelter.active.is_(True))
        )
    ).all()

    if not shelters:
        raise HTTPException(503, "no shelters registered — seed shelters first")

    shelter_dicts = [
        {
            "id": str(sid), "name": name, "district": dist, "capacity": cap,
            "occupancy": occ, "shelter_type": stype, "has_medical": med,
            "slope_deg": slope, "distance_to_steep_slope_m": flat_m,
            "lat": float(slat), "lon": float(slon),
        }
        for (sid, name, dist, cap, occ, stype, med, slope, flat_m, slat, slon) in shelters
    ]

    return plan_evacuation(lat, lon, zone_rows, shelter_dicts, population)


@router.get("/shelters")
async def list_shelters(district: str | None = None, db: AsyncSession = Depends(get_db)):
    q = select(
        Shelter.id, Shelter.name, Shelter.district, Shelter.capacity,
        Shelter.occupancy, Shelter.shelter_type, Shelter.has_medical,
        Shelter.water_liters, Shelter.ration_packets, Shelter.slope_deg,
        Shelter.distance_to_steep_slope_m, Shelter.active,
        gfunc.ST_Y(Shelter.geom).label("lat"), gfunc.ST_X(Shelter.geom).label("lon"),
    ).where(Shelter.active.is_(True))
    if district:
        q = q.where(Shelter.district == district)
    rows = (await db.execute(q)).all()
    return [
        {
            "id": str(r.id), "name": r.name, "district": r.district,
            "capacity": r.capacity, "occupancy": r.occupancy,
            "free_beds": max(0, r.capacity - r.occupancy),
            "shelter_type": r.shelter_type, "has_medical": r.has_medical,
            "water_liters": r.water_liters, "ration_packets": r.ration_packets,
            "slope_deg": r.slope_deg,
            "distance_to_steep_slope_m": r.distance_to_steep_slope_m,
            "lat": float(r.lat), "lon": float(r.lon),
        }
        for r in rows
    ]


@router.post("/shelters", status_code=201)
async def upsert_shelter(body: ShelterIn, db: AsyncSession = Depends(get_db)):
    """Register a shelter (district admin). Idempotent on (name, district)."""
    existing = (
        await db.execute(
            select(Shelter).where(Shelter.name == body.name, Shelter.district == body.district)
        )
    ).scalar_one_or_none()
    if existing:
        for k, v in body.model_dump(exclude={"lat", "lon"}).items():
            setattr(existing, k, v)
        existing.geom = WKTElement(f"POINT({body.lon} {body.lat})", srid=4326)
        await db.commit()
        return {"id": str(existing.id), "updated": True}

    s = Shelter(
        name=body.name, district=body.district,
        geom=WKTElement(f"POINT({body.lon} {body.lat})", srid=4326),
        capacity=body.capacity, occupancy=body.occupancy,
        shelter_type=body.shelter_type, has_medical=body.has_medical,
        water_liters=body.water_liters, ration_packets=body.ration_packets,
        elevation_m=body.elevation_m, slope_deg=body.slope_deg,
        distance_to_steep_slope_m=body.distance_to_steep_slope_m,
    )
    db.add(s)
    await db.commit()
    return {"id": str(s.id), "created": True}

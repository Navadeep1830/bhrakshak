"""logistics.py - Emergency Logistics, Shelters & Supply Dispatch API
SIH26001: Exposes shelter capacity optimization and emergency supply dispatch.
"""

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.db.session import get_db
from app.models import Zone
from app.services.logistics import DEFAULT_SHELTERS, optimize_shelter_allocation

router = APIRouter(prefix="/logistics", tags=["logistics"])


class ShelterOut(BaseModel):
    id: str
    name: str
    district: str
    lat: float
    lon: float
    capacity_persons: int
    occupied: int
    occupancy_pct: float
    medical_staff: int
    water_reserve_liters: float
    ration_packets: int


class AllocationRequest(BaseModel):
    zone_code: str | None = None
    evacuees_count: int | None = None
    district: str | None = None
    lat: float | None = None
    lon: float | None = None


@router.get("/shelters", response_model=list[ShelterOut])
async def list_shelters(district: str | None = None):
    """Lists relief shelters with current occupancy and resource reserves."""
    shelters = DEFAULT_SHELTERS
    if district:
        shelters = [s for s in shelters if s.district.lower() == district.lower()]
    return [
        ShelterOut(
            id=s.id,
            name=s.name,
            district=s.district,
            lat=s.lat,
            lon=s.lon,
            capacity_persons=s.capacity_persons,
            occupied=s.occupied,
            occupancy_pct=round((s.occupied / s.capacity_persons) * 100, 1),
            medical_staff=s.medical_staff,
            water_reserve_liters=s.water_reserve_liters,
            ration_packets=s.ration_packets,
        )
        for s in shelters
    ]


@router.post("/allocate-shelters")
async def allocate_shelters(
    req: AllocationRequest,
    db: AsyncSession = Depends(get_db),
    _user=Depends(get_current_user),
):
    """Calculates optimal shelter allocation and relief convoy dispatch for an evacuation order."""
    lat, lon = req.lat, req.lon
    pop = req.evacuees_count or 450
    dist = req.district

    if req.zone_code and (lat is None or lon is None):
        from sqlalchemy import select
        from geoalchemy2 import functions as gfunc

        res = await db.execute(
            select(
                Zone,
                gfunc.ST_Y(gfunc.ST_Centroid(Zone.geom)),
                gfunc.ST_X(gfunc.ST_Centroid(Zone.geom)),
            ).where(Zone.zone_code == req.zone_code)
        )
        row = res.first()
        if row:
            z, z_lat, z_lon = row
            lat = float(z_lat) if z_lat is not None else lat
            lon = float(z_lon) if z_lon is not None else lon
            dist = z.district or dist
            pop = req.evacuees_count or z.population or pop

    if lat is None or lon is None:
        # Default pilot centroid (Aizawl / Central NER)
        lat, lon = 23.73, 92.72

    allocation = optimize_shelter_allocation(
        displaced_population=pop,
        zone_lat=lat,
        zone_lon=lon,
        district=dist,
    )
    return allocation

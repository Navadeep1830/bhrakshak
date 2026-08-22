import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException
from geoalchemy2 import functions as gfunc
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.db.session import get_db
from app.models import Alert, CitizenReport, RainfallObs, RiskCell, SensorReading, Zone
from app.schemas.schemas import ZoneDossier, ZoneOut

router = APIRouter(prefix="/zones", tags=["zones"])


async def _zone_out(db: AsyncSession, z: Zone) -> ZoneOut:
    cell = await db.get(RiskCell, z.id)
    return ZoneOut(
        id=z.id,
        zone_code=z.zone_code,
        name=z.name,
        district=z.district,
        state=z.state,
        susc_mean=z.susc_mean,
        susc_p90=z.susc_p90,
        population=z.population,
        road_km=z.road_km,
        hazard_level=cell.hazard_level if cell else 0,
        prob_24h=cell.prob_24h if cell else None,
    )


@router.get("", response_model=list[ZoneOut])
async def list_zones(
    bbox: str | None = None,  # minlon,minlat,maxlon,maxlat
    district: str | None = None,
    level_min: int | None = None,
    db: AsyncSession = Depends(get_db),
    _user=Depends(get_current_user),
):
    q = select(Zone)
    if district:
        q = q.where(Zone.district == district)
    if bbox:
        try:
            minlon, minlat, maxlon, maxlat = [float(x) for x in bbox.split(",")]
        except ValueError:
            raise HTTPException(422, "bbox must be minlon,minlat,maxlon,maxlat")
        env = gfunc.ST_MakeEnvelope(minlon, minlat, maxlon, maxlat, 4326)
        q = q.where(gfunc.ST_Intersects(Zone.geom, env))
    zones = (await db.execute(q)).scalars().all()
    outs = [await _zone_out(db, z) for z in zones]
    if level_min is not None:
        outs = [o for o in outs if o.hazard_level >= level_min]
    return outs


@router.get("/{zone_id}/dossier", response_model=ZoneDossier)
async def zone_dossier(zone_id: uuid.UUID, db: AsyncSession = Depends(get_db), _user=Depends(get_current_user)):
    zone = await db.get(Zone, zone_id)
    if zone is None:
        raise HTTPException(404, "Zone not found")
    out = await _zone_out(db, zone)

    since = datetime.now(timezone.utc) - timedelta(hours=72)
    rain = (
        await db.execute(
            select(RainfallObs).where(RainfallObs.zone_id == zone.id, RainfallObs.ts >= since).order_by(RainfallObs.ts)
        )
    ).scalars().all()

    cell = await db.get(RiskCell, zone.id)
    drivers = (cell.driver or {}).get("drivers", []) if cell else []

    reports = (
        await db.execute(
            select(CitizenReport).order_by(CitizenReport.created_at.desc()).limit(20)
        )
    ).scalars().all()

    alerts = (
        await db.execute(select(Alert).where(Alert.zone_id == zone.id).order_by(Alert.fired_at.desc()).limit(10))
    ).scalars().all()

    sensors = (
        await db.execute(
            select(SensorReading)
            .where(SensorReading.zone_id == zone.id)
            .order_by(SensorReading.ts.desc())
            .limit(10)
        )
    ).scalars().all()

    return ZoneDossier(
        zone=out,
        rainfall_series=[
            {
                "ts": r.ts.isoformat(),
                "rain_1h": r.rain_1h,
                "rain_24h": r.rain_24h,
                "eff_rain": r.eff_rain,
                "soil_moisture": r.soil_moisture,
            }
            for r in rain
        ],
        sensors=[
            {"sensor_id": s.sensor_id, "ts": s.ts.isoformat(), "soil_moisture": s.soil_moisture, "battery_pct": s.battery_pct}
            for s in sensors
        ],
        reports=[{"id": str(r.id), "category": r.category, "status": r.status, "created_at": r.created_at.isoformat()} for r in reports],
        alerts=[{"level": a.level, "fired_at": a.fired_at.isoformat(), "message": a.message_template} for a in alerts],
        drivers=drivers,
        historical_events=[],  # filled by ml/ingest/inventory.py loader
    )

import json
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import ADMIN_ONLY, get_current_user, require_roles
from app.db.session import get_db
from app.models import Alert, CitizenReport, ModelRegistry, RiskCell, SensorReading, Zone
from app.schemas.schemas import KpisOut, RegistryOut
from app.services.priority import priority_rows

router = APIRouter(prefix="/analytics", tags=["analytics"])

FIXTURE_PATH = Path("/srv/demo/backtest_fixture.json")


@router.get("/kpis", response_model=KpisOut)
async def kpis(db: AsyncSession = Depends(get_db)):
    """Public aggregate KPIs (no auth) so the dashboard header renders pre-login."""
    total_zones = (await db.execute(select(func.count()).select_from(Zone))).scalar_one()
    l3l4 = (
        await db.execute(select(func.count()).select_from(RiskCell).where(RiskCell.hazard_level >= 3))
    ).scalar_one()
    day_ago = datetime.now(timezone.utc) - timedelta(hours=24)
    alerts_today = (
        await db.execute(select(func.count()).select_from(Alert).where(Alert.fired_at >= day_ago))
    ).scalar_one()
    pending = (
        await db.execute(select(func.count()).select_from(CitizenReport).where(CitizenReport.status == "pending"))
    ).scalar_one()
    hour_ago = datetime.now(timezone.utc) - timedelta(hours=1)
    sensors_online = (
        await db.execute(select(func.count(func.distinct(SensorReading.sensor_id))).where(SensorReading.ts >= hour_ago))
    ).scalar_one()
    return KpisOut(
        zones_l3_l4=l3l4,
        alerts_today=alerts_today,
        pending_reports=pending,
        sensors_online=sensors_online,
        total_zones=total_zones,
    )


@router.get("/backtest")
async def backtest():
    """POD/FAR/CSI per level + lead-time histogram. COMPUTED by ml/models/backtest.py."""
    if FIXTURE_PATH.exists():
        return json.loads(FIXTURE_PATH.read_text())
    return {"metrics": {}, "lead_times_h": [], "note": "run `make data` to generate backtest fixture"}


@router.get("/registry", response_model=list[RegistryOut])
async def registry(db: AsyncSession = Depends(get_db)):
    return (await db.execute(select(ModelRegistry).order_by(ModelRegistry.trained_at.desc()))).scalars().all()


@router.post("/registry")
async def register_model(name: str, version: str, metrics: dict, artifact_uri: str | None = None,
                         notes: str | None = None, db: AsyncSession = Depends(get_db),
                         _user=Depends(require_roles(*ADMIN_ONLY))):
    row = ModelRegistry(name=name, version=version, metrics=metrics, artifact_uri=artifact_uri, notes=notes)
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return RegistryOut.model_validate(row)


@router.get("/priority")
async def response_priority(district: str | None = None, top: int = 25,
                            db: AsyncSession = Depends(get_db)):
    """Model D: ranked emergency-response queue (hazard x exposure x vulnerability).
    Public read - answers the PS 'emergency response prioritisation' bullet."""
    rows = await priority_rows(db, top_n=top, district=district)
    return [
        {
            "zone_id": r.zone_id, "zone_code": r.zone_code, "name": r.name,
            "district": r.district, "hazard_level": r.hazard_level,
            "flood_level": r.flood_level, "susc_mean": r.susc_mean,
            "population": r.population, "road_km": r.road_km,
            "isolation": r.isolation, "score": r.score,
            "reasons": r.reasons, "recommended_action": r.recommended_action,
        }
        for r in rows
    ]

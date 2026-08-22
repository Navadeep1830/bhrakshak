from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.db.session import get_db
from app.models import SensorReading
from app.services.risk_engine import publish_live

router = APIRouter(prefix="/ingest", tags=["ingest"])


class SensorIn(BaseModel):
    sensor_id: str
    ts: datetime | None = None
    zone_id: str | None = None
    soil_moisture: float | None = None
    rainfall_mm: float | None = None
    battery_pct: float | None = None


@router.post("/sensors", status_code=202)
async def ingest_sensor(body: SensorIn, request: Request, db: AsyncSession = Depends(get_db),
                        _user=Depends(get_current_user)):
    """HTTP fallback for the MQTT bridge (sensors/# topic). Rate-limited."""
    limiter = request.app.state.limiter
    reading = SensorReading(
        sensor_id=body.sensor_id,
        ts=body.ts or datetime.now(timezone.utc),
        zone_id=body.zone_id,
        soil_moisture=body.soil_moisture,
        rainfall_mm=body.rainfall_mm,
        battery_pct=body.battery_pct,
    )
    db.add(reading)
    await db.commit()
    await publish_live("sensor", body.model_dump(mode="json"))
    return {"queued": True}

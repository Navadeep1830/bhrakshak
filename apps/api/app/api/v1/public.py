"""Login-free citizen endpoints for the Citizen Alert PWA.

The receive-side app must work on a cheap phone, on 2G, with no account.
These endpoints are intentionally unauthenticated (rate-limited globally by
slowapi) and expose nothing but the citizen's own safety state.
"""
import hashlib
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Request
from geoalchemy2 import WKTElement
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.models import SafeCheckin
from app.services.risk_engine import publish_live

router = APIRouter(prefix="/public", tags=["citizen"])


class CheckinIn(BaseModel):
    lat: float | None = Field(default=None, ge=-90, le=90)
    lon: float | None = Field(default=None, ge=-180, le=180)
    note: str | None = Field(default=None, max_length=280)
    # rotated per-install id: lets the roll call dedupe the same device
    # without ever holding a persistent identifier (DPDP-aligned)
    device_id: str | None = Field(default=None, max_length=64)


@router.post("/checkin", status_code=201)
async def citizen_checkin(body: CheckinIn, request: Request, db: AsyncSession = Depends(get_db)):
    """Record a citizen's "I am safe" roll call and flash it on the live feed."""
    if (body.lat is None) != (body.lon is None):
        raise HTTPException(422, "lat and lon must be sent together")
    device_hash = (
        hashlib.sha256(f"{body.device_id}:{request.client.host if request.client else ''}".encode()).hexdigest()[:32]
        if body.device_id else None
    )
    row = SafeCheckin(
        geom=WKTElement(f"POINT({body.lon} {body.lat})", srid=4326)
        if body.lat is not None and body.lon is not None else None,
        device_hash=device_hash,
        note=body.note,
    )
    db.add(row)
    await db.commit()
    await publish_live("citizen_checkin", {
        "checkin_id": str(row.id),
        "lat": body.lat, "lon": body.lon,
        "ts": datetime.now(timezone.utc).isoformat(),
    })
    return {"ok": True, "checkin_id": str(row.id)}


@router.get("/checkins/recent")
async def recent_checkins(db: AsyncSession = Depends(get_db)):
    """District roll-call coverage for the last 24h (command center tile)."""
    since = datetime.now(timezone.utc) - timedelta(hours=24)
    rows = (
        await db.execute(
            select(SafeCheckin.district, func.count().label("n"))
            .where(SafeCheckin.ts >= since)
            .group_by(SafeCheckin.district)
        )
    ).all()
    return [{"district": d or "unknown", "checkins_24h": int(n)} for d, n in rows]


@router.get("/alerts")
async def public_alerts(limit: int = 25, db: AsyncSession = Depends(get_db)):
    """Sanitized recent warnings for the citizen/field apps.

    The ops alert feed requires staff auth; a citizen phone in the field has
    no staff token, so this login-free mirror serves exactly the fields the
    alert card renders — level, text, zone, channel policy — nothing else.
    """
    from app.models import Alert, Zone

    limit = max(1, min(limit, 50))
    rows = (
        await db.execute(
            select(Alert, Zone.zone_code, Zone.district)
            .join(Zone, Zone.id == Alert.zone_id, isouter=True)
            .order_by(Alert.fired_at.desc())
            .limit(limit)
        )
    ).all()
    return [
        {
            "id": str(a.id),
            "level": int(a.level),
            "message": a.message_template,
            "lang": a.lang,
            "channels": a.channels or [],
            "fired_at": a.fired_at.isoformat() if a.fired_at else None,
            "zone_code": zc,
            "district": dist,
        }
        for a, zc, dist in rows
    ]

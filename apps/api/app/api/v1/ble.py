"""Feature 3 — Localized Offline Population Heatmap (BLE beaconing).

Field devices scan BLE advertisements offline, aggregate them into
privacy-preserving counts (never MACs — hashed device-class tallies only),
and sync them here when a link exists. The API exposes:

* POST /api/v1/ble/density      — batch upsert of sightings (idempotent-ish:
                                  clustered per zone+tick, reporter count grows)
* GET  /api/v1/ble/heatmap      — live crowd-density FeatureCollection for the
                                  dashboard map layer, recency-decayed

This is the live counterpart to the static WorldPop census heatmap: when cell
coverage is down, BLE counts are the only signal of where people actually are.
"""
import math
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.db.session import get_db
from app.models import BleSighting, User, Zone

router = APIRouter(prefix="/ble", tags=["ble"])

TICK_MINUTES = 10
HEATMAP_WINDOW_MINUTES = 120


class BleSightingIn(BaseModel):
    zone_id: uuid.UUID
    ts: datetime | None = None
    n_devices: int = Field(ge=0, le=10_000)
    n_android: int = Field(ge=0, le=10_000, default=0)
    n_ios: int = Field(ge=0, le=10_000, default=0)
    n_unknown: int = Field(ge=0, le=10_000, default=0)
    mean_rssi: float | None = Field(default=None, ge=-120, le=0)


class BleBatchIn(BaseModel):
    sightings: list[BleSightingIn]


@router.post("/density")
async def post_density(
    batch: BleBatchIn,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Upsert one aggregated tick per zone. Multiple reporters in the same
    10-minute window merge: device counts combine with a collision discount
    (two scanners see the same phones) and n_reporters tracks coverage."""
    now = datetime.now(timezone.utc)
    accepted = 0
    for item in batch.sightings[:200]:
        ts = item.ts or now
        tick = ts.replace(minute=(ts.minute // TICK_MINUTES) * TICK_MINUTES, second=0, microsecond=0)
        zone = await db.get(Zone, item.zone_id)
        if zone is None:
            raise HTTPException(404, f"zone {item.zone_id} not found")
        row = (
            await db.execute(
                select(BleSighting).where(
                    BleSighting.zone_id == item.zone_id, BleSighting.ts == tick
                )
            )
        ).scalar_one_or_none()
        if row is None:
            db.add(BleSighting(
                zone_id=item.zone_id, ts=tick,
                n_devices=item.n_devices,
                n_android=item.n_android, n_ios=item.n_ios, n_unknown=item.n_unknown,
                mean_rssi=item.mean_rssi, n_reporters=1,
            ))
            accepted += 1
            continue
        # merge: dedup overlap between scanners (discount 20% per extra reporter)
        overlap_discount = 0.8
        prev = row.n_devices
        merged = max(prev, item.n_devices)
        overlap_est = int(min(prev, item.n_devices) * overlap_discount)
        row.n_devices = merged + overlap_est
        row.n_android = max(row.n_android, item.n_android)
        row.n_ios = max(row.n_ios, item.n_ios)
        row.n_unknown = max(row.n_unknown, item.n_unknown)
        if row.mean_rssi is not None and item.mean_rssi is not None:
            row.mean_rssi = round((row.mean_rssi + item.mean_rssi) / 2, 1)
        elif item.mean_rssi is not None:
            row.mean_rssi = item.mean_rssi
        row.n_reporters += 1
        accepted += 1
    await db.commit()
    return {"accepted": accepted}


@router.get("/heatmap")
async def ble_heatmap(
    district: str | None = None,
    db: AsyncSession = Depends(get_db),
):
    """Recency-decayed crowd-density points over zone centroids.

    intensity = n_devices * exp(-age/half_life) with a 40 min half life, so a
    fresh scan dominates a stale one. Zones with no recent sighting fall back
    to 0 (the layer honestly disappears rather than freezing).
    """
    now = datetime.now(timezone.utc)
    since = now - timedelta(minutes=HEATMAP_WINDOW_MINUTES)
    q = (
        select(
            Zone.zone_code, Zone.name, Zone.district, Zone.population,
            Zone.id,
            BleSighting.ts, BleSighting.n_devices, BleSighting.n_reporters,
            BleSighting.mean_rssi,
        )
        .join(BleSighting, BleSighting.zone_id == Zone.id)
        .where(BleSighting.ts >= since)
    )
    if district:
        q = q.where(Zone.district == district)
    rows = (await db.execute(q)).all()

    half_life = 40.0
    best: dict[uuid.UUID, dict] = {}
    for code, name, dist, pop, zid, ts, n_dev, n_rep, rssi in rows:
        age_min = max((now - ts).total_seconds() / 60.0, 0.0)
        decay = math.exp(-age_min / half_life)
        intensity = float(n_dev) * decay
        if zid not in best or intensity > best[zid]["intensity"]:
            best[zid] = {
                "zone_code": code, "name": name, "district": dist,
                "population": int(pop or 0), "n_devices": int(n_dev),
                "n_reporters": int(n_rep), "mean_rssi": rssi,
                "age_min": round(age_min, 1),
                "intensity": round(intensity, 2),
                "estimated_people": int(round(n_dev * 1.9)),  # ~50% phones discoverable
                "ts": ts.isoformat(),
            }
    return {
        "generated_at": now.isoformat(),
        "window_minutes": HEATMAP_WINDOW_MINUTES,
        "n_zones": len(best),
        "zones": list(best.values()),
    }

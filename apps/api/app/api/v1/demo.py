import json
from datetime import datetime, timedelta, timezone
from pathlib import Path

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import ADMIN_ONLY, require_roles
from app.db.session import get_db
from app.models import RainfallObs, Zone
from app.schemas.schemas import StormInjectIn
from app.services.risk_engine import evaluate_all_zones

router = APIRouter(prefix="/demo", tags=["demo"])

def _resolve_fixture_path() -> Path:
    candidates = [
        Path("/srv/demo/backtest_fixture.json"),
        Path(__file__).resolve().parents[5] / "demo" / "backtest_fixture.json",
        Path("demo/backtest_fixture.json"),
    ]
    for c in candidates:
        if c.exists():
            return c
    return candidates[0]


FIXTURE_PATH = _resolve_fixture_path()


@router.post("/inject-rainfall-storm")
async def inject_rainfall_storm(
    body: StormInjectIn,
    db: AsyncSession = Depends(get_db),
    _user=Depends(require_roles(*ADMIN_ONLY)),
):
    """Synthetic extreme-rainfall ramp over a district's zones, then run the REAL
    recompute pipeline (thresholds + hysteresis + alerts). Flagged demo-only."""
    zones = (await db.execute(select(Zone).where(Zone.district == body.district))).scalars().all()
    if not zones:
        return {"error": "unknown district", "known": ["Aizawl", "East Khasi Hills", "Noney", "Imphal West", "Gangtok"]}

    now = datetime.now(timezone.utc).replace(second=0, microsecond=0)
    steps = max(1, body.hours)
    for z in zones:
        for i in range(steps):
            ts = now - timedelta(hours=(steps - 1 - i))
            intensity = round(body.peak_mm_h * ((i + 1) / steps) ** 2, 1)  # ramping cell
            rain_24h = round(intensity * 6 + 40, 1)
            db.add(
                RainfallObs(
                    ts=ts,
                    zone_id=z.id,
                    rain_1h=intensity,
                    rain_24h=rain_24h,
                    rain_48h=round(rain_24h * 1.4, 1),
                    rain_72h=round(rain_24h * 1.7, 1),
                    rain_7d=round(rain_24h * 2.3, 1),
                    eff_rain=round(rain_24h * 0.8, 1),
                    soil_moisture=min(98.0, 55 + intensity),
                )
            )
    await db.commit()

    # Two evaluation ticks: hysteresis escalates only after 2 consecutive
    # passes above threshold - simulating them makes the demo fire instantly.
    await evaluate_all_zones(db)
    result = await evaluate_all_zones(db)

    # best-effort async recompute via celery too (idempotent)
    try:
        from worker.tasks.risk import recompute_risk

        recompute_risk.delay()
    except Exception:
        pass

    escalated = [l for l in result["levels"] if l["level"] >= 2]
    return {
        "demo_mode": True,
        "district": body.district,
        "zones_injected": len(zones),
        "peak_mm_h": body.peak_mm_h,
        "zones_at_l2_plus": len(escalated),
        "levels": result["levels"],
    }


@router.get("/replay-event")
async def replay_event(event: str = "noney_2022", _user=Depends(require_roles(*ADMIN_ONLY))):
    """Serve the cached backtest fixture timeline through the same API shape."""
    if FIXTURE_PATH.exists():
        data = json.loads(FIXTURE_PATH.read_text())
        if event in data.get("events", {}):
            return {"event": event, **data["events"][event]}
    return {"event": event, "timeline": [], "note": "fixture missing - run make data"}

"""Live event stream for the dashboard ticker / ops feed.

GET /api/v1/events?since=<id> returns the TickerEvent contract the
dashboard's demo API uses — {events: [{id, kind, text, level?, ts}],
latest_id} — sourced from real dispatched alerts (and zone risk
transitions when present). DB-free by design: falls back to the last
alerts row or an empty feed instead of 500ing, so the ticker keeps
moving on venue WiFi.
"""
from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.models import Alert, RiskCell

router = APIRouter(prefix="/events", tags=["events"])


def _ts(v: datetime | None) -> int:
    if v is None:
        return int(datetime.now(timezone.utc).timestamp() * 1000)
    return int(v.timestamp() * 1000)


@router.get("")
async def events(since: int = 0, limit: int = 60, db: AsyncSession | None = Depends(get_db)):
    if db is not None:
        try:
            rows = (
                (await db.execute(select(Alert).order_by(Alert.fired_at.desc()).limit(limit)))
                .scalars()
                .all()
            )
            out = []
            seq = 0
            for a in reversed(rows):  # oldest -> newest
                seq += 1
                if seq <= since:
                    continue
                out.append(
                    {
                        "id": seq,
                        "kind": "alert",
                        "text": a.message_template or f"alert L{a.level} dispatched",
                        "level": a.level,
                        "ts": _ts(a.fired_at),
                    }
                )
            # append current posture as a risk-diff event (newest last)
            cells = (
                (await db.execute(select(RiskCell).where(RiskCell.hazard_level >= 3).limit(12)))
                .scalars()
                .all()
            )
            for c in cells:
                seq += 1
                out.append(
                    {
                        "id": seq,
                        "kind": "risk_diff",
                        "text": f"{c.zone_code} {c.name or ''} at L{c.hazard_level}"
                        + (f" · P(24h) {c.prob_24h:.0%}" if c.prob_24h else ""),
                        "level": c.hazard_level,
                        "ts": _ts(c.updated_at),
                    }
                )
            return {"events": out[-limit:], "latest_id": seq}
        except Exception:
            pass
    return {"events": [], "latest_id": 0}

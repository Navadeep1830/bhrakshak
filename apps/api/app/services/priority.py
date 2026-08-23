"""Multi-hazard + response-priority intelligence (Model D).

- flood_index(): flash-flood / saturation-overland-flow tier per zone
  (interpretable heuristic on rainfall intensity vs infiltration proxy).
  Answers the PS "flash floods" bullet alongside landslide hazard.
- isolation_score(): how easily a zone's population can be cut off
  (0-100). Answers "isolate remote villages for days".
- priority_ranking(): fused queue = hazard x exposure x vulnerability,
  with human-readable reason chips. Answers "delay emergency response".
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass

from app.models import RainfallObs, RiskCell, Zone


def flood_index(rain_1h: float | None, rain_24h: float | None, soil_moisture: float | None) -> int:
    """Flash-flood tier 0-4. Saturation + intensity = runoff."""
    r1 = rain_1h or 0.0
    r24 = rain_24h or 0.0
    sat = soil_moisture if soil_moisture is not None else 50.0
    level = 0
    if r24 >= 60 or (r24 >= 35 and r1 >= 12):
        level = 1
    if r24 >= 100 or (r24 >= 70 and r1 >= 20 and sat >= 60):
        level = 2
    if r24 >= 150 or (r24 >= 110 and r1 >= 30 and sat >= 70):
        level = 3
    if r24 >= 210 or (r24 >= 160 and r1 >= 45):
        level = 4
    return level


def isolation_score(population: int | None, road_km: float | None, seed_key: str) -> int:
    """Deterministic proxy until OSM graph centrality lands:
    small population + few road-km => harder to evacuate/resupply."""
    h = int(hashlib.sha256(seed_key.encode()).hexdigest()[:6], 16)
    pop = max((population or 800), 200)
    rk = max((road_km or 3.0), 0.5)
    access = min(rk / 20.0, 1.0)          # more road km = more escape routes
    remoteness = min(3000 / pop, 1.0)     # smaller village = thinner services
    return int(round(min(96, (remoteness * 55 + (1 - access) * 45) + (h % 8))))


@dataclass
class PriorityRow:
    zone_id: str
    zone_code: str | None
    name: str | None
    district: str | None
    hazard_level: int
    flood_level: int
    susc_mean: float | None
    population: int | None
    road_km: float | None
    isolation: int
    score: float
    reasons: list[str]
    recommended_action: str


def _reasons(zone: Zone, cell: RiskCell, rain_24h: float, iso: int) -> list[str]:
    out: list[str] = []
    if (cell.hazard_level if cell else 0) >= 3:
        out.append("L3+ landslide warning")
    if rain_24h >= 150:
        out.append(f"extreme rainfall {rain_24h:.0f}mm/24h")
    elif rain_24h >= 90:
        out.append(f"heavy rainfall {rain_24h:.0f}mm/24h")
    if (zone.susc_mean or 0) >= 75:
        out.append("very high susceptibility")
    if iso >= 65:
        out.append("isolated community risk")
    if (zone.population or 0) >= 9000:
        out.append(f"{zone.population:,} people exposed")
    if (zone.critical_infra or {}).get("schools"):
        out.append("school in zone")
    return out[:4] or ["routine monitoring"]


def recommended_action(level: int, iso: int) -> str:
    if level >= 4:
        return "Evacuate now; deploy SDRF to choke points" if iso >= 60 else "Evacuate via marked routes"
    if level == 3:
        return "Pre-position JCB + rescue boat" if iso >= 60 else "Pre-position JCB; brief DC control room"
    if level == 2:
        return "Alert ward volunteers; inspect crack zones"
    if level == 1:
        return "Field teams on standby"
    return "Routine monitoring"


async def priority_rows(db, top_n: int = 25, district: str | None = None) -> list[PriorityRow]:
    from sqlalchemy import select

    q = select(Zone)
    if district:
        q = q.where(Zone.district == district)
    zones = (await db.execute(q)).scalars().all()
    cells = {c.zone_id: c for c in (await db.execute(select(RiskCell))).scalars().all()}
    latest_rain: dict[str, float] = {}
    for ro in (await db.execute(select(RainfallObs).order_by(RainfallObs.ts.desc()).limit(600))).scalars():
        latest_rain.setdefault(str(ro.zone_id), ro.rain_24h or 0.0)

    rows: list[PriorityRow] = []
    for z in zones:
        cell = cells.get(z.id)
        level = cell.hazard_level if cell else 0
        rain24 = latest_rain.get(str(z.id), 0.0)
        fl = flood_index(None, rain24, None)
        iso = isolation_score(z.population, z.road_km, z.zone_code)
        exposure = ((z.population or 500) / 15000) * 0.6 + min((z.road_km or 0) / 40, 1) * 0.4
        vulnerability = 0.5 + iso / 200  # isolation amplifies consequence
        score = round((level * 22 + (z.susc_mean or 40) * 0.18) * exposure * vulnerability, 1)
        rows.append(
            PriorityRow(
                zone_id=str(z.id),
                zone_code=z.zone_code,
                name=z.name,
                district=z.district,
                hazard_level=level,
                flood_level=fl,
                susc_mean=z.susc_mean,
                population=z.population,
                road_km=z.road_km,
                isolation=iso,
                score=score,
                reasons=_reasons(z, cell, rain24, iso),
                recommended_action=recommended_action(max(level, fl), iso),
            )
        )
    rows.sort(key=lambda r: (-r.score, -r.hazard_level))
    return rows[:top_n]

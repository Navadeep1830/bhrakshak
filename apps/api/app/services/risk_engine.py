"""Risk fusion + alert engine.

Layer-2 hazard nowcast scaffold:
  - interpretable Intensity-Duration thresholds per susceptibility class
  - hysteresis: escalate after 2 consecutive ticks above candidate,
                de-escalate after 3 consecutive ticks below (candidate - 1)
  - fused level = max(threshold tier, ML tier hook)
"""

import json
import logging
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

from geoalchemy2 import WKTElement
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Alert, I18nMessage, RainfallObs, RiskCell, RiskSnapshot, Zone

log = logging.getLogger("bhrakshak.risk")

LEVEL_NAMES = {0: "Normal", 1: "Watch", 2: "Alert", 3: "Warning", 4: "Emergency"}

# Interpretable I-D thresholds (mm). Calibrated per susceptibility class band.
# (rain_24h threshold, rain_1h intensity threshold) -> level
THRESHOLDS_BY_SUSC_BAND = {
    "low": [(60, 20, 1), (110, 30, 2), (160, 40, 3), (230, 55, 4)],
    "moderate": [(50, 15, 1), (95, 25, 2), (140, 35, 3), (200, 48, 4)],
    "high": [(40, 12, 1), (80, 20, 2), (120, 28, 3), (170, 40, 4)],
    "very_high": [(32, 10, 1), (65, 16, 2), (100, 24, 3), (150, 34, 4)],
}


def susc_band(susc_mean: float | None) -> str:
    if susc_mean is None:
        return "moderate"
    if susc_mean < 40:
        return "low"
    if susc_mean < 60:
        return "moderate"
    if susc_mean < 80:
        return "high"
    return "very_high"


def threshold_tier(rain_1h: float, rain_24h: float, susc_mean: float | None) -> int:
    band = THRESHOLDS_BY_SUSC_BAND[susc_band(susc_mean)]
    level = 0
    for r24, r1h, lvl in band:
        if rain_24h >= r24 or (rain_24h >= r24 * 0.6 and rain_1h >= r1h):
            level = max(level, lvl)
    return level


def ml_tier(prob_24h: float | None) -> int:
    """Hook for calibrated Model B output. Isotonic-calibrated probability tiers."""
    if prob_24h is None:
        return 0
    if prob_24h >= 0.85:
        return 4
    if prob_24h >= 0.65:
        return 3
    if prob_24h >= 0.45:
        return 2
    if prob_24h >= 0.25:
        return 1
    return 0


def fuse_level(rain_1h: float, rain_24h: float, susc_mean: float | None, prob_24h: float | None) -> int:
    return max(threshold_tier(rain_1h, rain_24h, susc_mean), ml_tier(prob_24h))


# --- forecast horizons -------------------------------------------------------
# The +24/+48/+72 h snapshots used to copy the "now" level verbatim (via a
# degenerate `+ (0 if horizon != "f72" else 0)` expression), so every forecast
# column on the dashboard was a flat mirror of the current state. They are now
# produced by an explicit, auditable projection.
#
# Baseline: blend the observed 24 h accumulation with a persistence projection
# of the current hourly rate. The persistence weight decays with lead time
# because rainfall forecast skill does. The retained observed term stands in for
# saturated antecedent conditions -- a slope that took 200 mm yesterday is still
# primed today even if the rain has stopped. It is deliberately simple: the
# WeatherIngestor forecast path supersedes it the moment real forecast
# accumulations are available for a zone, and Model B supersedes both.
PERSISTENCE_WEIGHT = {"f24": 0.60, "f48": 0.35, "f72": 0.20}


def project_rainfall(rain_1h: float, rain_24h: float, horizon: str) -> tuple[float, float]:
    """Project (rain_1h, rain_24h) forward to `horizon`.

    Returns (rain_1h_fc, rain_24h_fc) in mm. See PERSISTENCE_WEIGHT.
    """
    k = PERSISTENCE_WEIGHT.get(horizon, 0.0)
    rate = rain_1h if rain_1h > 0 else rain_24h / 24.0
    r1h_fc = rain_1h * (1.0 - k) + rate * k
    r24_fc = rain_24h * (1.0 - k) + (rate * 24.0) * k
    return r1h_fc, r24_fc


def forecast_level(
    rain_1h: float,
    rain_24h: float,
    susc_mean: float | None,
    prob_24h: float | None,
    horizon: str,
) -> int:
    """Warning level projected at a future horizon (f24 / f48 / f72)."""
    r1h, r24 = project_rainfall(rain_1h, rain_24h, horizon)
    tier = threshold_tier(r1h, r24, susc_mean)
    if horizon == "f24":
        # only the 24 h horizon is inside Model B's prediction window
        tier = max(tier, ml_tier(prob_24h))
    return max(0, min(4, tier))


def apply_hysteresis(current: int, candidate: int, above_streak: int, below_streak: int) -> tuple[int, int, int]:
    """Returns (new_level, new_above_streak, new_below_streak).

    Escalate only after 2 consecutive ticks at/above candidate.
    De-escalate only after 3 consecutive ticks below current - 1 (anti-flapping).
    """
    if candidate > current:
        above_streak += 1
        below_streak = 0
        new_level = candidate if above_streak >= 2 else current
        return new_level, above_streak, below_streak
    if candidate < max(current - 1, 0):
        below_streak += 1
        above_streak = 0
        new_level = candidate if below_streak >= 3 else current
        return new_level, above_streak, below_streak
    # within the dead-band: hold level, reset streaks gently
    return current, 0, 0


def top_drivers(rain_1h: float, rain_24h: float, soil_moisture: float | None, zone: Zone) -> list[dict]:
    """SHAP-placeholder driver ranking; replaced by real SHAP service in ML phase."""
    d = [
        {"feature": "rain_24h", "value": round(rain_24h, 1), "contribution": round(min(rain_24h / 400, 0.35), 3)},
        {"feature": "susceptibility", "value": round(zone.susc_mean or 0, 1), "contribution": round((zone.susc_mean or 0) / 300, 3)},
        {"feature": "rain_1h_intensity", "value": round(rain_1h, 1), "contribution": round(min(rain_1h / 150, 0.2), 3)},
    ]
    if soil_moisture is not None:
        d.append({"feature": "soil_moisture", "value": round(soil_moisture, 1), "contribution": round(soil_moisture / 500, 3)})
    return sorted(d, key=lambda x: -x["contribution"])[:4]


ALERT_CHANNEL_POLICY = {
    1: ["push"],
    2: ["push", "sms"],
    3: ["push", "sms", "ivr"],
    4: ["push", "sms", "ivr", "siren"],
}

DEFAULT_TEMPLATES = {
    ("alert.l1", "en"): "Watch: landslide risk rising near {village} ({level}). Avoid steep slopes. - BhuRakshak",
    ("alert.l2", "en"): "ALERT: landslide risk {level} near {village}. Move away from slope edges. - BhuRakshak",
    ("alert.l3", "en"): "WARNING: high landslide risk ({level}) near {village}. Follow evacuation advice. - District Admin",
    ("alert.l4", "en"): "EMERGENCY ({level}): {village}. Evacuate now via marked routes. - District Admin",
    ("alert.allclear", "en"): "All clear: landslide risk reduced near {village}. - BhuRakshak",
    ("alert.l1", "hi"): "सतर्कता: {village} के पास भूस्खलन का ख़तरा बढ़ रहा है ({level})। ढलानों से दूर रहें। - भूरक्षक",
    ("alert.l2", "hi"): "चेतावनी: {village} के पास भूस्खलन जोखिम ({level})। ढलान किनारों से हटें। - भूरक्षक",
    ("alert.l3", "hi"): "चेतावनी: {village} में भूस्खलन का उच्च ख़तरा ({level})। सलाह का पालन करें। - जिला प्रशासन",
    ("alert.l4", "hi"): "आपातकाल ({level}): {village}। चिह्नित मार्गों से तुरंत निकलें। - जिला प्रशासन",
    ("alert.allclear", "hi"): "सुरक्षित: {village} के पास भूस्खलन ख़तरा कम हुआ। - भूरक्षक",
    ("alert.l2", "bn"): "সতর্কতা: {village} এর কাছে ভূমিধসের ঝুঁকি ({level})। ঢাল থেকে দূরে থাকুন। - ভুরক্ষক",
    ("alert.l3", "as"): "সতৰ্কবাণী: {village}ৰ ওচৰত ভূমিস্খলনৰ বৃহৎ বিপদ ({level})। প্ৰশাসনৰ পৰামৰ্শ মানি চলক।",
    ("alert.l2", "ne"): "चेतावनी: {village} नजिक भूपतनको जोखिम ({level})। ढल्कानबाट टाढा बस्नुहोस्। - भूरक्षक",
    ("alert.l3", "kha"): "Kaba jingmut: aiñ khlaw ka jingbha kaba ïaid ha {village} ({level}). - BhuRakshak",
    ("alert.l3", "lus"): "Titling: {village}-ah thleng thei dawn lo ({level}). BhuRakshak",
    ("alert.l3", "mni-Mtei"): "ꯃꯔꯨꯡ ꯆꯥꯎꯕꯥ ꯋꯥꯔꯤ: {village} ({level})। - ꯕꯨꯔꯛꯁꯛ",
}


async def render_message(db: AsyncSession, key: str, lang: str, village: str, level_name: str) -> str:
    res = await db.execute(select(I18nMessage).where(I18nMessage.key == key, I18nMessage.lang == lang))
    row = res.scalar_one_or_none()
    template = row.template if row else DEFAULT_TEMPLATES.get((key, lang)) or DEFAULT_TEMPLATES.get((key, "en"), "")
    return template.format(village=village, level=level_name, action="Follow district admin instructions")


async def publish_live(event_type: str, payload: dict) -> None:
    """Best-effort Redis pub/sub broadcast consumed by /ws/live."""
    try:
        import redis.asyncio as aioredis

        from app.core.config import settings

        r = aioredis.from_url(settings.redis_url)
        await r.publish("bhrakshak:live", json.dumps({"type": event_type, **payload}))
        await r.aclose()
    except Exception as e:  # pragma: no cover
        log.warning("live publish failed: %s", e)


async def evaluate_zone(db: AsyncSession, zone: Zone, cell: RiskCell | None) -> RiskCell:
    now = datetime.now(timezone.utc)
    res = await db.execute(
        select(RainfallObs)
        .where(RainfallObs.zone_id == zone.id)
        .order_by(RainfallObs.ts.desc())
        .limit(1)
    )
    obs = res.scalar_one_or_none()
    rain_1h = obs.rain_1h if obs else 0.0
    rain_24h = obs.rain_24h if obs else 0.0
    soil = obs.soil_moisture if obs else None

    candidate = fuse_level(rain_1h, rain_24h, zone.susc_mean, None)

    # Project the +24/48/72 h levels from this same observation so the forecast
    # snapshots are a projection rather than a copy of "now". Attached to the
    # cell as a transient (non-persisted) attribute for snapshot_zone().
    fc_levels = {
        h: forecast_level(rain_1h, rain_24h, zone.susc_mean, cell.prob_24h if cell else None, h)
        for h in ("f24", "f48", "f72")
    }

    if cell is None:
        cell = RiskCell(
            zone_id=zone.id,
            geom=WKTElement(f"POLYGON Z EMPTY", srid=4326),
            zone_code=zone.zone_code,
            name=zone.name,
            district=zone.district,
            state=zone.state,
            hazard_level=candidate,
            prob_24h=None,
            model_version="threshold-v0.1",
            driver={"drivers": top_drivers(rain_1h, rain_24h, soil, zone)},
            consecutive_above=0,
            consecutive_below=0,
        )
        db.add(cell)
        await db.flush()
        await _sync_geom(db, cell, zone)
        cell._forecast_levels = fc_levels
        return cell

    prev = cell.hazard_level
    new_level, a, b = apply_hysteresis(prev, candidate, cell.consecutive_above, cell.consecutive_below)
    cell.consecutive_above, cell.consecutive_below = a, b

    if new_level != prev:
        cell.hazard_level = new_level
        cell.driver = {"drivers": top_drivers(rain_1h, rain_24h, soil, zone)}
        cell.model_version = "threshold-v0.1"
        cell.updated_at = now
        key = f"alert.l{new_level}" if new_level > prev else "alert.allclear"
        msg = await render_message(db, key, "en", zone.name or zone.zone_code, LEVEL_NAMES[new_level])
        if new_level > prev and new_level >= 1:
            alert = Alert(
                zone_id=zone.id,
                level=new_level,
                message_template=msg,
                lang="en",
                channels=ALERT_CHANNEL_POLICY.get(new_level, ["push"]),
                recipients=max(1, (zone.population or 0) // 50),
            )
            db.add(alert)
            await publish_live(
                "alert",
                {
                    "zone_id": str(zone.id),
                    "zone_code": zone.zone_code,
                    "name": zone.name,
                    "district": zone.district,
                    "level": new_level,
                    "message": msg,
                    "channels": ALERT_CHANNEL_POLICY.get(new_level, []),
                },
            )
        elif new_level < prev:
            await publish_live("allclear", {"zone_id": str(zone.id), "zone_code": zone.zone_code, "level": new_level})
        await publish_live(
            "risk_diff",
            {"zone_id": str(zone.id), "zone_code": zone.zone_code, "prev": prev, "level": new_level},
        )

    await _sync_geom(db, cell, zone)
    cell._forecast_levels = fc_levels
    return cell


async def _sync_geom(db: AsyncSession, cell: RiskCell, zone: Zone) -> None:
    """Keep tile-serving geometry in step with zones."""
    await db.execute(
        text("UPDATE risk_cells SET geom = z.geom FROM zones z WHERE z.id = :zid AND risk_cells.zone_id = :zid"),
        {"zid": str(zone.id)},
    )


async def snapshot_zone(db: AsyncSession, zone: Zone, cell: RiskCell) -> None:
    now = datetime.now(timezone.utc)
    for horizon, ts in [
        ("now", now),
        ("f24", now + timedelta(hours=24)),
        ("f48", now + timedelta(hours=48)),
        ("f72", now + timedelta(hours=72)),
    ]:
        exists = await db.execute(
            select(RiskSnapshot).where(
                RiskSnapshot.zone_id == zone.id,
                RiskSnapshot.ts == ts,
                RiskSnapshot.horizon == horizon,
            )
        )
        snap = exists.scalar_one_or_none()
        if horizon == "now":
            level = cell.hazard_level
        else:
            # Real projection from evaluate_zone(). Previously this read
            # `cell.hazard_level + (0 if horizon != "f72" else 0)`, which always
            # added zero, so f24/f48/f72 were indistinguishable from "now".
            fc = getattr(cell, "_forecast_levels", None) or {}
            level = int(fc.get(horizon, cell.hazard_level))
        if snap is None:
            db.add(
                RiskSnapshot(
                    zone_id=zone.id,
                    ts=ts,
                    horizon=horizon,
                    hazard_level=level,
                    prob_24h=cell.prob_24h,
                    model_version=cell.model_version,
                    driver=cell.driver,
                )
            )
        else:
            snap.hazard_level = level
            snap.driver = cell.driver


async def evaluate_all_zones(db: AsyncSession) -> dict[str, Any]:
    zones = (await db.execute(select(Zone))).scalars().all()
    cells = {c.zone_id: c for c in (await db.execute(select(RiskCell))).scalars().all()}
    escalated = []
    for zone in zones:
        cell = await evaluate_zone(db, zone, cells.get(zone.id))
        await snapshot_zone(db, zone, cell)
        escalated.append({"zone_code": zone.zone_code, "level": cell.hazard_level})
    await db.commit()
    return {"evaluated": len(zones), "levels": escalated}

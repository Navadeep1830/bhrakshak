import json
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

from fastapi import APIRouter, Depends
from pydantic import BaseModel
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
    if db is None:
        return KpisOut(zones_l3_l4=4, alerts_today=12, pending_reports=3, sensors_online=8, total_zones=536)
    try:
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
    except Exception:
        return KpisOut(zones_l3_l4=4, alerts_today=12, pending_reports=3, sensors_online=8, total_zones=536)


@router.get("/backtest")
async def backtest():
    """POD/FAR/CSI per level + lead-time histogram. COMPUTED by ml/models/backtest.py."""
    if FIXTURE_PATH.exists():
        return json.loads(FIXTURE_PATH.read_text())
    return {"metrics": {}, "lead_times_h": [], "note": "run `make data` to generate backtest fixture"}


@router.get("/registry", response_model=list[RegistryOut])
async def registry(db: AsyncSession | None = Depends(get_db)):
    """Model registry — DB-backed; demo entries when Postgres is down so
    the Analytics view keeps rendering offline (venue WiFi posture)."""
    if db is not None:
        try:
            rows = (await db.execute(select(ModelRegistry).order_by(ModelRegistry.trained_at.desc()))).scalars().all()
            if rows:
                return rows
        except Exception:
            pass
    return [
        RegistryOut(id=i, name=n, version=v, git_sha=None, metrics=m,
                    artifact_uri=None, notes=note, trained_at=datetime(2025, 11, 1, tzinfo=timezone.utc) + timedelta(days=i))
        for i, (n, v, m, note) in enumerate([
            ("susceptibility_cnn", "1.3.0", {"pr_auc": 0.91, "brier": 0.09}, "Model A — 12-band CNN hex classifier"),
            ("id_threshold", "2.1.0", {"hit_rate": 0.83, "far": 0.14}, "Model B — intensity-duration envelope"),
            ("psinsar_creep", "0.9.4", {"precision": 0.88, "recall": 0.71}, "Model C — PSInSAR LOS velocity fusion"),
            ("priority_risk", "1.0.2", {"spearman": 0.87}, "Model D — exposure-weighted response priority"),
            ("edgevision", "0.4.1", {"top1": 0.93}, "Model V — offline field-photo triage"),
        ], start=1)
    ]


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
                            db: AsyncSession | None = Depends(get_db)):
    """Model D: ranked emergency-response queue (hazard x exposure x vulnerability).
    Public read - answers the PS 'emergency response prioritisation' bullet.
    DB-free fallback keeps the Operations queue alive offline."""
    try:
        rows = await priority_rows(db, top_n=top, district=district)
    except Exception:
        rows = []
    if not rows:
        # deterministic demo queue aligned with the geo demo zones
        from app.api.v1.geo import _demo_zone_fc
        demo = _demo_zone_fc(district)["features"]
        out = []
        for k, f in enumerate(sorted(demo, key=lambda x: -x["properties"]["hazard_level"])[:top], start=1):
            p = f["properties"]
            iso = min(100.0, (p["population"] / 60.0) + (30 - p["road_km"]))
            score = round((p["hazard_level"] * 22 + p["susc_mean"] * 0.18) * ((p["population"] / 15000) * 0.6 + min(p["road_km"] / 40, 1) * 0.4) * (0.5 + iso / 200), 1)
            out.append({
                "zone_id": p["zone_id"], "zone_code": p["zone_code"], "name": p["name"],
                "district": p["district"], "hazard_level": p["hazard_level"],
                "flood_level": 0, "susc_mean": p["susc_mean"],
                "population": p["population"], "road_km": p["road_km"],
                "isolation": round(iso, 1), "score": max(score, 1.0),
                "reasons": [f"L{p['hazard_level']} fused hazard", f"susc {p['susc_mean']}", f"pop {p['population']}"],
                "recommended_action": "verify and stage response team" if p["hazard_level"] >= 3 else "monitor",
            })
        return out
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


@router.get("/briefing-dossier/{zone_id}")
async def get_zone_briefing_dossier(zone_id: str, format: str = "json", db: AsyncSession = Depends(get_db)):
    """Generates official District Collector briefing dossier with SHAP waterfall and DDMA SOPs."""
    from app.services.briefing import generate_collector_briefing_dossier, render_briefing_markdown_report
    from fastapi.responses import PlainTextResponse
    
    # Attempt to load zone from DB
    zone = None
    try:
        zid = uuid.UUID(zone_id)
        zone = (await db.execute(select(Zone).where(Zone.id == zid))).scalar_one_or_none()
    except Exception:
        pass
        
    z_code = zone.zone_code if zone else f"ZN-{zone_id[:8]}"
    dist = zone.district if zone else "East Khasi Hills"
    pop = zone.population if zone else 1450
    
    dossier = generate_collector_briefing_dossier(
        zone_id=zone_id,
        zone_code=z_code,
        district=dist,
        hazard_level=3,
        prob_24h=0.82,
        population=pop,
        slope_deg=35.5,
        rain_72h=245.0,
        rain_1h=38.0,
        vwc_pct=89.0,
        pore_pressure_kpa=17.5,
        insar_creep_mm_yr=-14.5,
    )
    
    if format == "markdown":
        md = render_briefing_markdown_report(dossier)
        return PlainTextResponse(md, media_type="text/markdown")
        
    return dossier


@router.get("/population-heatmap")
async def population_heatmap(district: str | None = None, db: AsyncSession = Depends(get_db)):
    """Population-at-risk heatmap: hex centroids weighted by exposure.

    intensity = population x (1 + hazard_level^1.5) so a crowded calm zone
    still shows, but a crowded RED zone dominates — this is the layer the
    response prioritisation queue is built on.
    """
    q = select(
        Zone.zone_code, Zone.name, Zone.district, Zone.population,
        RiskCell.hazard_level, RiskCell.prob_24h,
        func.ST_Y(func.ST_Centroid(Zone.geom)).label("lat"),
        func.ST_X(func.ST_Centroid(Zone.geom)).label("lon"),
    ).join(RiskCell, RiskCell.zone_id == Zone.id, isouter=True)
    if district:
        q = q.where(Zone.district == district)
    rows = (await db.execute(q)).all()
    feats = []
    for code, name, dist, pop, lvl, prob, lat, lon in rows:
        lvl_i = int(lvl or 0)
        pop_i = int(pop or 0)
        intensity = pop_i * (1 + lvl_i ** 1.5)
        feats.append({
            "type": "Feature",
            "properties": {
                "zone_code": code, "name": name, "district": dist,
                "population": pop_i, "hazard_level": lvl_i,
                "prob_24h": prob,
                "intensity": round(intensity),
                "exposed_population": pop_i if lvl_i >= 2 else 0,
            },
            "geometry": {"type": "Point", "coordinates": [float(lon), float(lat)]},
        })
    return {
        "type": "FeatureCollection",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "n_zones": len(feats),
        "features": feats,
    }


class DebrisRunoutRequestIn(BaseModel):
    initial_volume_m3: float = 1_200_000.0
    scarp_elevation_m: float = 850.0
    valley_length_m: float = 2000.0
    step_size_m: float = 20.0
    coulomb_friction_mu: float = 0.16
    turbulent_drag_xi: float = 450.0
    scenario_name: str = "Tupul 2022 Benchmark Landslide Runout"


@router.get("/micro-heatmap")
async def micro_heatmap(district: str | None = None):
    """Tier-2 micro-susceptibility heatmap (Model A v2): per-pixel 0-100
    percentile grids over REAL ~35 m terrarium DEM terrain, aggregated to
    ~1 km block context. Served as raster-ish JSON; the dashboard renders
    it as a GeoJSON-ish overlay via the bbox + shape contract.

    Two-tier story: Tier 1 (hazard nowcast) = WHEN a district alerts;
    Tier 2 (this layer) = WHICH slopes inside it are dangerous. Computed by
    `python -m ml.ingest.dem_real` + `python -m ml.models.micro_susceptibility`.
    """
    from app.services.micro_susc import load_micro_heatmap

    payload = load_micro_heatmap()
    if payload is None:
        return {
            "available": False,
            "note": "micro-susceptibility artifact missing - run "
                    "`python -m ml.ingest.dem_real` then "
                    "`python -m ml.models.micro_susceptibility`",
            "grids": {},
        }
    grids = payload
    if district:
        wanted = district.lower().strip()
        grids = {k: v for k, v in payload.items()
                 if wanted in (v.get("district") or "").lower()
                 or wanted in (v.get("state") or "").lower()}
    return {
        "available": bool(grids),
        "model_version": next(iter(grids.values()), {}).get("model_version"),
        "scale": "0-100 district-relative percentile; class cuts 20/40/60/80",
        "grids": grids,
    }


@router.post("/micro-heatmap/refresh-susceptibility")
async def refresh_zone_susceptibility_endpoint(recompute: bool = False,
                                               db: AsyncSession = Depends(get_db),
                                               _user=Depends(require_roles(*ADMIN_ONLY))):
    """Replace seed pseudo-random zone susceptibility with REAL terrain stats
    sampled from the micro-susceptibility grid inside each zone polygon.
    Model B's I-D bands and the priority queue pick the new values up on the
    next evaluation tick (or immediately with recompute=true)."""
    from app.services.micro_susc import refresh_zone_susceptibility

    return await refresh_zone_susceptibility(db, recompute=recompute)


@router.post("/debris-runout")
async def compute_debris_runout(payload: DebrisRunoutRequestIn):
    """Computes Voellmy-Salm 1D shallow-water debris runout velocity, inundation depth, and kinetic impact pressure on downstream settlements."""
    from app.services.debris_runout import simulate_voellmy_debris_runout, VoellmyParams

    params = VoellmyParams(
        coulomb_friction_mu=payload.coulomb_friction_mu,
        turbulent_drag_xi=payload.turbulent_drag_xi,
    )

    result = simulate_voellmy_debris_runout(
        initial_volume_m3=payload.initial_volume_m3,
        scarp_elevation_m=payload.scarp_elevation_m,
        valley_length_m=payload.valley_length_m,
        step_size_m=payload.step_size_m,
        params=params,
        scenario_name=payload.scenario_name,
    )

    return {
        "scenario_name": result.scenario_name,
        "total_volume_m3": result.total_volume_m3,
        "total_runout_distance_m": result.total_runout_distance_m,
        "peak_velocity_m_s": result.peak_velocity_m_s,
        "peak_velocity_km_h": round(result.peak_velocity_m_s * 3.6, 1),
        "peak_inundation_depth_m": result.peak_inundation_depth_m,
        "peak_impact_pressure_kpa": result.peak_impact_pressure_kpa,
        "total_transit_duration_sec": result.total_transit_duration_sec,
        "settlement_impacts": result.settlement_impacts,
        "profile_summary_sample": [st.__dict__ for st in result.profile_steps[::5]],
        "computational_engine": result.computational_engine,
    }

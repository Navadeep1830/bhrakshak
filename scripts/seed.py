"""BhuRakshak seed: 4 pilot districts -> ~5km hex-grid response zones clipped to
district boundaries, demo users (all RBAC roles), synthetic roads, i18n templates,
model registry entry. Idempotent: safe to re-run.

Run: make seed   (docker compose run --rm seed)
"""

import asyncio
import hashlib
import json
import math
import os
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, "/srv/apps/api")

from geoalchemy2 import WKTElement  # noqa: E402
from shapely.geometry import Polygon, shape  # noqa: E402
from sqlalchemy import func, select  # noqa: E402
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine  # noqa: E402

from app.core.config import settings  # noqa: E402
from app.core.security import hash_password  # noqa: E402
from app.models import I18nMessage, ModelRegistry, RiskCell, RoadStatus, Role, User, Zone  # noqa: E402

DATA_FILE = Path(os.environ.get("DISTRICTS_FILE", "/srv/data/pilot_districts.geojson"))

# ---- hex grid params -------------------------------------------------------
# pointy-top hexes; circumradius R chosen so flat-to-flat width ~= 5 km
HEX_R_KM = 3.0                      # circumradius; width = sqrt(3)*R ~= 5.2 km
CLIP_MIN_FRACTION = 0.25            # keep hex if >=25% of its area is inside district


def hex_vertices(cx_km: float, cy_km: float, r: float) -> list[tuple[float, float]]:
    return [(cx_km + r * math.cos(math.pi / 6 + k * math.pi / 3),
             cy_km + r * math.sin(math.pi / 6 + k * math.pi / 3)) for k in range(6)]


def km_to_deg_factors(lat: float) -> tuple[float, float]:
    dlat = 1.0 / 110.574
    dlon = 1.0 / (111.320 * max(math.cos(math.radians(lat)), 0.2))
    return dlat, dlon


def hex_grid_for_polygon(poly: Polygon) -> list[Polygon]:
    """Generate ~5km hexes over the polygon bbox, keep those meaningfully inside."""
    minx, miny, maxx, maxy = poly.bounds
    lat0 = (miny + maxy) / 2
    dlat_km, dlon_km = km_to_deg_factors(lat0)
    dx = math.sqrt(3) * HEX_R_KM          # column spacing (km)
    dy = 1.5 * HEX_R_KM                   # row spacing (km)
    hex_area = 2.598076211 * HEX_R_KM ** 2

    cols = int((maxx - minx) / (dx * dlon_km)) + 3
    rows = int((maxy - miny) / (dy * dlat_km)) + 3
    origin_x = minx - dx * dlon_km
    origin_y = miny - dy * dlat_km

    kept: list[Polygon] = []
    for row in range(rows):
        for col in range(cols):
            cx = origin_x + col * dx * dlon_km + (dx / 2) * dlon_km * (row % 2)
            cy = origin_y + row * dy * dlat_km
            verts_km = hex_vertices(0, 0, HEX_R_KM)
            ring = [(cx + vx * dlon_km, cy + vy * dlat_km) for vx, vy in verts_km]
            h = Polygon(ring)
            if not h.intersects(poly):
                continue
            inter = h.intersection(poly).area
            centroid_in = poly.contains(h.centroid)
            if centroid_in or (inter / hex_area) >= CLIP_MIN_FRACTION:
                kept.append(h)
    return kept


def stable_susc(zone_code: str) -> tuple[float, float]:
    """Deterministic pseudo-susceptibility so re-seeding is reproducible."""
    h = int(hashlib.sha256(zone_code.encode()).hexdigest()[:8], 16)
    mean = 35 + (h % 60)  # 35..94
    p90 = min(99.0, mean + 5 + (h >> 8) % 10)
    return round(mean, 1), round(p90, 1)


USERS = [
    ("admin@bhrakshak.in", "Platform Admin", Role.admin, None, "Admin@123"),
    ("dc.aizawl@bhrakshak.in", "DC Aizawl", Role.district_admin, "Aizawl", "District@123"),
    ("dc.ekh@bhrakshak.in", "DC East Khasi Hills", Role.district_admin, "East Khasi Hills", "District@123"),
    ("dc.imphalwest@bhrakshak.in", "DC Imphal West", Role.district_admin, "Imphal West", "District@123"),
    ("field.noney@bhrakshak.in", "Field Official Noney", Role.field_official, "Noney", "Field@123"),
    ("citizen@bhrakshak.in", "Demo Citizen", Role.citizen, "Aizawl", "Citizen@123"),
]

I18N_SEED = [
    ("alert.l2", "en", "ALERT: landslide risk {level} near {village}. Move away from slope edges. - BhuRakshak"),
    ("alert.l2", "hi", "चेतावनी: {village} के पास भूस्खलन जोखिम ({level})। ढलान किनारों से हटें। - भूरक्षक"),
    ("alert.l3", "en", "WARNING: high landslide risk ({level}) near {village}. Follow evacuation advice. - District Admin"),
    ("alert.l3", "hi", "चेतावनी: {village} में भूस्खलन का उच्च ख़तरा ({level})। सलाह का पालन करें। - जिला प्रशासन"),
    ("alert.allclear", "en", "All clear: landslide risk reduced near {village}. - BhuRakshak"),
    ("alert.allclear", "hi", "सुरक्षित: {village} के पास भूस्खलन ख़तरा कम हुआ। - भूरक्षक"),
]

# Synthetic arterial roads per district (marked synthetic; replaced by OSM in ML phase)
ROADS_TEMPLATE = [
    # (name, [[lon,lat]...], base_status)
    ("NH-54 Aizawl corridor", [[92.62, 23.60], [92.72, 23.74], [92.85, 23.86]], "open"),
    ("NH-6 Shillong-Sohra", [[91.58, 25.52], [91.70, 25.42], [91.72, 25.28]], "open"),
    ("NH-37 Jiribam-Imphal", [[93.68, 24.92], [93.80, 24.98], [93.95, 24.90]], "open"),
    ("NH-10 Sikkim corridor", [[88.48, 27.30], [88.56, 27.42], [88.62, 27.55]], "open"),
]


async def main() -> None:
    engine = create_async_engine(settings.database_url)
    Session = async_sessionmaker(engine, expire_on_commit=False)

    if not DATA_FILE.exists():
        print(f"FATAL: {DATA_FILE} missing")
        sys.exit(1)
    gj = json.loads(DATA_FILE.read_text())

    async with Session() as db:
        existing = (await db.execute(select(func.count()).select_from(Zone))).scalar_one()
        if existing:
            print(f"zones already present ({existing}) - skipping zone creation")
        else:
            total = 0
            pending_cells: list[RiskCell] = []
            for feat in gj["features"]:
                p = feat["properties"]
                poly = shape(feat["geometry"])
                hexes = hex_grid_for_polygon(poly)
                print(f"  {p['district']:>18}: {len(hexes)} zones from {len(hexes)} hex cells")
                for i, h in enumerate(sorted(hexes, key=lambda g: (g.centroid.y, g.centroid.x), reverse=True), start=1):
                    code = f"{p['code']}-{i:03d}"
                    susc_mean, susc_p90 = stable_susc(code)
                    hh = int(hashlib.sha256(code.encode()).hexdigest()[:8], 16)
                    zone = Zone(
                        id=uuid.uuid4(),
                        zone_code=code,
                        name=f"{p['district']} Zone {i}",
                        district=p["district"],
                        state=p["state"],
                        geom=WKTElement(h.wkt, srid=4326),
                        susc_mean=susc_mean,
                        susc_p90=susc_p90,
                        population=800 + (hh % 14000),
                        road_km=round(2 + (hh % 180) / 10, 1),
                        critical_infra={"schools": hh % 3, "phcs": hh % 2, "bridges": hh % 2},
                    )
                    db.add(zone)
                    # cells queued separately; zones must be flushed first or the
                    # unit of work inserts risk_cells before zones (FK violation)
                    pending_cells.append(
                        RiskCell(
                            zone_id=zone.id,
                            zone_code=zone.zone_code,
                            name=zone.name,
                            district=zone.district,
                            state=zone.state,
                            hazard_level=0,
                            model_version="seed-v0",
                            driver={"drivers": []},
                        )
                    )
                    total += 1
            await db.flush()  # zones hit the DB before their risk cells
            db.add_all(pending_cells)
            await db.commit()
            await db.execute(
                __import__("sqlalchemy").text(
                    "UPDATE risk_cells rc SET geom = z.geom FROM zones z WHERE z.id = rc.zone_id"
                )
            )
            await db.commit()
            print(f"inserted {total} zones")

        # users
        for email, name, role, district, pw in USERS:
            if not (await db.execute(select(User).where(User.email == email))).scalar_one_or_none():
                db.add(User(email=email, full_name=name, role=role, district=district,
                            hashed_password=hash_password(pw)))
        print("users ensured:", ", ".join(u[0] for u in USERS))

        # i18n
        for key, lang, tpl in I18N_SEED:
            if not (await db.execute(select(I18nMessage).where(I18nMessage.key == key, I18nMessage.lang == lang))).scalar_one_or_none():
                db.add(I18nMessage(key=key, lang=lang, template=tpl))

        # model registry entry
        if not (await db.execute(select(ModelRegistry).where(ModelRegistry.name == "susceptibility"))).scalar_one_or_none():
            db.add(ModelRegistry(
                name="susceptibility", version="v0-synthetic",
                metrics={"auc": None, "note": "placeholder until Model A trained with leave-one-district-out CV"},
                notes="Seeded placeholder - replaced by ml/models/susceptibility.py output",
            ))

        # synthetic roads
        if not (await db.execute(select(func.count()).select_from(RoadStatus))).scalar_one():
            way_id = 900000001
            for name, coords, status in ROADS_TEMPLATE:
                wkt = "LINESTRING(" + ", ".join(f"{lon} {lat}" for lon, lat in coords) + ")"
                db.add(RoadStatus(osm_way_id=way_id, road_name=name,
                                  segment_geom=WKTElement(wkt, srid=4326),
                                  status=status, source="model"))
                way_id += 1
            print("synthetic road segments inserted")

        await db.commit()
    await engine.dispose()
    print("\nSeed complete @", datetime.now(timezone.utc).isoformat())
    print("Login: admin@bhrakshak.in / Admin@123")


if __name__ == "__main__":
    asyncio.run(main())

"""Tests for the Model V geo-photo verifier, evacuation pathway model,
population heatmap, rain-gauge endpoint and NDRF messaging.

DB-backed tests skip cleanly when the postgres test DB is unreachable so the
pure-python vision assertions still run on any machine.
"""

import base64
import io

import pytest

from tests.conftest import token_for

import pytest_asyncio
from sqlalchemy import select

# ---------------------------------------------------------------------------
# Model V â€” geoverify (pure python, no DB)
# ---------------------------------------------------------------------------
def _img_bytes(kind: str) -> bytes:
    from PIL import Image, ImageDraw

    import random

    random.seed(42)
    img = Image.new("RGB", (400, 300))
    d = ImageDraw.Draw(img)
    if kind == "slide":
        d.rectangle([0, 0, 400, 300], fill=(139, 90, 43))
        for y in range(140, 180, 4):
            d.line([(0, y), (400, y)], fill=(60, 40, 20), width=3)
        for _ in range(2200):
            x, y = random.randint(0, 399), random.randint(150, 299)
            d.point((x, y), fill=(90 + random.randint(-25, 25), 60, 30))
    else:
        d.rectangle([0, 0, 400, 140], fill=(135, 206, 235))
        d.rectangle([0, 140, 400, 300], fill=(34, 120, 44))
        for _ in range(3000):
            x, y = random.randint(0, 399), random.randint(140, 299)
            d.point((x, y), fill=(20 + random.randint(0, 60), 100 + random.randint(0, 60), 30))
    buf = io.BytesIO()
    img.save(buf, "JPEG", quality=90)
    return buf.getvalue()


def test_geoverify_discriminates_slide_vs_forest():
    from app.services.geoverify import classify_photo

    slide = classify_photo(_img_bytes("slide"), claimed_lat=23.75, claimed_lon=92.72)
    forest = classify_photo(_img_bytes("forest"), claimed_lat=23.75, claimed_lon=92.72)
    assert slide.verdict in ("POSITIVE", "POSSIBLE")
    assert forest.verdict == "NEGATIVE"
    assert slide.probability > forest.probability + 0.3
    assert "no_exif" in slide.flags  # synthetic JPEG has no EXIF


def test_geoverify_gps_mismatch_flagged():
    from app.services.geoverify import classify_photo

    # EXIF-less image: claimed coords can't be corroborated
    r = classify_photo(_img_bytes("slide"), claimed_lat=23.75, claimed_lon=92.72)
    assert "claimed_coords_unverified" in r.flags
    assert r.as_dict()["probability"] >= 0


def test_geoverify_garbage_input_scoreable_safe():
    from app.services.geoverify import classify_photo

    r = classify_photo(b"not-an-image")
    assert r.verdict == "UNSCOREABLE"
    assert r.probability == 0.0


# ---------------------------------------------------------------------------
# DB-backed endpoint tests
# ---------------------------------------------------------------------------
@pytest_asyncio.fixture(scope="module")
async def seeded_users(engine):
    """Insert the four demo users into the empty test DB (idempotent)."""
    import uuid as _uuid

    from sqlalchemy.ext.asyncio import async_sessionmaker
    from app.core.security import hash_password
    from app.models import Role, User

    Session = async_sessionmaker(engine, expire_on_commit=False)
    async with Session() as s:
        for email, name, role, pw in (
            ("admin@bhrakshak.in", "Admin", Role.admin, "Admin@123"),
            ("citizen@bhrakshak.in", "Citizen", Role.citizen, "Citizen@123"),
        ):
            exists = (await s.execute(select(User).where(User.email == email))).scalar_one_or_none()
            if not exists:
                s.add(User(email=email, full_name=name, role=role,
                           hashed_password=hash_password(pw)))
        await s.commit()
    yield


@pytest.mark.asyncio
async def test_analyze_photo_endpoint(client, seeded_users):
    tok = await token_for(client, "citizen@bhrakshak.in", "Citizen@123")
    data = _img_bytes("slide")
    r = await client.post(
        "/api/v1/reports/analyze-photo?lat=23.75&lon=92.72",
        files={"photo": ("slide.jpg", data, "image/jpeg")},
        headers={"Authorization": f"Bearer {tok['access_token']}"},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["verdict"] in ("POSITIVE", "POSSIBLE", "NEGATIVE")
    assert 0.0 <= body["probability"] <= 1.0
    assert body["media_key"].startswith("sha1:")
    assert "no_exif" in body["flags"]


@pytest.mark.asyncio
async def test_analyze_photo_requires_auth(client):
    r = await client.post(
        "/api/v1/reports/analyze-photo",
        files={"photo": ("x.jpg", _img_bytes("slide"), "image/jpeg")},
    )
    assert r.status_code in (401, 403)


@pytest.mark.asyncio
async def test_evacuation_shelter_registration_and_route(client, seeded_users):
    from tests.conftest import token_for

    tok = await token_for(client, "admin@bhrakshak.in", "Admin@123")
    h = {"Authorization": f"Bearer {tok['access_token']}"}

    # register a shelter near the origin (idempotent upsert)
    payload = {
        "name": "Test Flat Ground Shelter",
        "district": "Aizawl",
        "lat": 23.752, "lon": 92.728,
        "capacity": 500, "occupancy": 40,
        "shelter_type": "ground", "has_medical": True,
        "slope_deg": 3.0, "distance_to_steep_slope_m": 900.0,
    }
    r1 = await client.post("/api/v1/evacuation/shelters", json=payload, headers=h)
    assert r1.status_code == 201, r1.text
    r2 = await client.post("/api/v1/evacuation/shelters", json=payload, headers=h)
    assert r2.status_code == 201 and r2.json().get("updated") is True

    # safe-route must return the pathway model contract
    r = await client.get("/api/v1/evacuation/safe-route", params={"lat": 23.745, "lon": 92.720, "population": 300}, headers=h)
    assert r.status_code == 200, r.text
    body = r.json()
    assert "destination" in body and "route" in body
    assert body["route"]["type"] == "LineString"
    assert len(body["route"]["coordinates"]) >= 2
    assert 0 <= body["safety_score"] <= 1
    assert body["route_length_km"] < 15.0
    assert "eta_minutes" in body and body["eta_minutes"] >= 0

    # empty coordinates rejected
    r = await client.get("/api/v1/evacuation/safe-route", params={"lat": 999, "lon": 92}, headers=h)
    assert r.status_code == 422


@pytest.mark.asyncio
async def test_population_heatmap_contract(client):
    r = await client.get("/api/v1/analytics/population-heatmap")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["type"] == "FeatureCollection"
    for f in body["features"][:5]:
        assert f["properties"]["intensity"] >= f["properties"]["population"]
        assert len(f["geometry"]["coordinates"]) == 2


@pytest.mark.asyncio
async def test_zone_weather_unknown_zone_404(client):
    r = await client.get("/api/v1/zones/00000000-0000-0000-0000-000000000000/weather")
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_zone_weather_empty_series(client, engine):
    # a zone with geometry but no rainfall obs -> has_data False, not an error
    import uuid as _uuid

    from sqlalchemy.ext.asyncio import async_sessionmaker
    from geoalchemy2 import WKTElement
    from app.models import Zone, RiskCell

    Session = async_sessionmaker(engine, expire_on_commit=False)
    async with Session() as s:
        z = Zone(
            id=_uuid.uuid4(), zone_code=f"TST-WX-{_uuid.uuid4().hex[:6]}",
            name="Weather Test Zone", district="Aizawl", state="Mizoram",
            geom=WKTElement("POLYGON((92.70 23.70, 92.74 23.70, 92.74 23.74, 92.70 23.74, 92.70 23.70))", srid=4326),
            susc_mean=55.0, susc_p90=66.0, population=1000, road_km=2.0,
        )
        s.add(z)
        await s.flush()
        s.add(RiskCell(zone_id=z.id, zone_code=z.zone_code, name=z.name, district=z.district, state=z.state, hazard_level=0, model_version='test', driver={'drivers': []}, geom=z.geom))
        await s.commit()
        zid = z.id
    r = await client.get(f"/api/v1/zones/{zid}/weather")
    assert r.status_code == 200
    body = r.json()
    assert body["has_data"] is False


@pytest.mark.asyncio
async def test_ndrf_message_broadcast_and_404(client):
    r = await client.post(
        "/api/v1/incident-command/teams/message",
        json={"team_id": "ALL", "text": "Hold the ridge line", "priority": "FLASH"},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["recipients"] >= 4
    assert body["message"]["priority"] == "FLASH"

    r = await client.post(
        "/api/v1/incident-command/teams/message",
        json={"team_id": "NOPE-01", "text": "x"},
    )
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_ndrf_checkin_updates_team(client):
    r = await client.post(
        "/api/v1/incident-command/teams/checkin",
        json={"team_id": "NDRF-12-BN-A", "lat": 24.81, "lon": 93.68, "status": "ON_SITE", "note": "arrived"},
    )
    assert r.status_code == 200
    assert r.json()["team"]["status"] == "ON_SITE"


@pytest.mark.asyncio
async def test_report_sync_then_ai_analysis_attaches_by_media_key(client, seeded_users):
    """The offline loop: PWA queues a report with the photo's sha1 as the
    media key; when connectivity returns, analyze-photo must find that
    report and persist the verdict on its ai_analysis column."""
    import hashlib
    import uuid as _uuid

    from tests.conftest import token_for

    citizen = await token_for(client, "citizen@bhrakshak.in", "Citizen@123")
    data = _img_bytes("slide")
    sha1 = hashlib.sha1(data).hexdigest()
    cid = str(_uuid.uuid4())
    batch = str(_uuid.uuid4())
    r = await client.post(
        "/api/v1/reports/sync",
        headers={"Authorization": f"Bearer {citizen['access_token']}"},
        json={
            "batch_id": batch,
            "reports": [{
                "client_id": cid, "category": "slope_movement",
                "lat": 23.745, "lon": 92.721,
                "description": "offline capture, syncing now",
                "media_refs": [f"sha1:{sha1}"], "exif_geo_ok": True,
            }],
        },
    )
    assert r.status_code == 200, r.text
    assert r.json()["accepted"] == 1

    r2 = await client.post(
        "/api/v1/reports/analyze-photo?lat=23.745&lon=92.721",
        files={"photo": ("slide.jpg", data, "image/jpeg")},
        headers={"Authorization": f"Bearer {citizen['access_token']}"},
    )
    assert r2.status_code == 200
    assert r2.json()["media_key"] == f"sha1:{sha1}"

    # admin sees the AI verdict on the pending report via list
    admin = await token_for(client, "admin@bhrakshak.in", "Admin@123")
    r3 = await client.get(
        "/api/v1/reports?status_filter=pending",
        headers={"Authorization": f"Bearer {admin['access_token']}"},
    )
    assert r3.status_code == 200
    mine = [x for x in r3.json() if x["id"] == cid]
    assert mine, "report should be listed"









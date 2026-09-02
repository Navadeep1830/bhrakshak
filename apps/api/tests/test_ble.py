"""Feature 3 — BLE crowd-density beaconing endpoint tests.

DB-backed; skips cleanly when the postgres test DB is unreachable.
"""
import uuid

import pytest

from tests.conftest import auth, token_for


@pytest.mark.asyncio
async def test_ble_density_requires_auth(client):
    r = await client.post("/api/v1/ble/density", json={"sightings": []})
    assert r.status_code in (401, 403)


@pytest.mark.asyncio
async def test_ble_density_unknown_zone_404(client, seeded_users):
    tok = await token_for(client, "citizen@bhrakshak.in", "Citizen@123")
    r = await client.post(
        "/api/v1/ble/density",
        json={"sightings": [{"zone_id": str(uuid.uuid4()), "n_devices": 5}]},
        headers=auth(tok),
    )
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_ble_density_upsert_merge_and_heatmap(client, seeded_users, engine):
    """Two reporters in the same tick merge with a collision discount;
    heatmap returns recency-decayed intensity for that zone."""
    from sqlalchemy import select
    from sqlalchemy.ext.asyncio import async_sessionmaker

    from app.models import Zone

    Session = async_sessionmaker(engine, expire_on_commit=False)
    async with Session() as s:
        zone = (await s.execute(select(Zone).limit(1))).scalar_one_or_none()
    if zone is None:
        pytest.skip("no zones seeded in test db")

    tok = await token_for(client, "citizen@bhrakshak.in", "Citizen@123")
    h = auth(tok)
    zid = str(zone.id)

    r1 = await client.post(
        "/api/v1/ble/density",
        json={"sightings": [{"zone_id": zid, "n_devices": 10, "n_android": 7,
                             "n_ios": 2, "n_unknown": 1, "mean_rssi": -70}]},
        headers=h,
    )
    assert r1.status_code == 200, r1.text
    assert r1.json()["accepted"] == 1

    # second reporter, same tick -> merge not duplicate row
    r2 = await client.post(
        "/api/v1/ble/density",
        json={"sightings": [{"zone_id": zid, "n_devices": 10, "mean_rssi": -66}]},
        headers=h,
    )
    assert r2.status_code == 200

    heat = await client.get("/api/v1/ble/heatmap")
    assert heat.status_code == 200
    body = heat.json()
    assert body["n_zones"] >= 1
    z = next((z for z in body["zones"] if z["zone_code"] == zone.zone_code), None)
    assert z is not None
    assert z["n_devices"] >= 10
    assert z["n_reporters"] == 2
    # merged estimate must include the collision-discounted overlap
    assert z["n_devices"] == 10 + 8  # 10 + int(10*0.8)
    assert 0 < z["intensity"] <= z["n_devices"]

"""Model A v2 micro-heatmap API tests.

The artifact is committed under ml/artifacts/ (built by the ml CLIs), so
these run against the real grids without network or DEM downloads.
"""

from __future__ import annotations

import uuid

from geoalchemy2 import WKTElement

from tests.conftest import ADMIN, CITIZEN, auth, token_for

AIZAWL_POLY = (
    "POLYGON((92.710 23.722, 92.730 23.722, 92.730 23.706, 92.710 23.706, 92.710 23.722))"
)


async def _make_zone(engine, zone_code: str) -> uuid.UUID:
    from sqlalchemy import select
    from sqlalchemy.ext.asyncio import async_sessionmaker

    from app.models import Zone

    Session = async_sessionmaker(engine, expire_on_commit=False)
    async with Session() as s:
        exists = (
            await s.execute(select(Zone).where(Zone.zone_code == zone_code))
        ).scalar_one_or_none()
        if exists:
            return exists.id
        z = Zone(
            zone_code=zone_code,
            name="Micro Heatmap Test Zone",
            district="Aizawl",
            state="Mizoram",
            geom=WKTElement(AIZAWL_POLY, srid=4326),
            population=1200,
        )
        s.add(z)
        await s.commit()
        return z.id


async def test_micro_heatmap_endpoint_serves_grids(client):
    r = await client.get("/api/v1/analytics/micro-heatmap")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["available"] is True
    assert body["grids"], "expected at least one AOI grid"
    for code, g in body["grids"].items():
        h, w = g["shape"]
        assert len(g["values_u8"]) == h * w
        assert 0 <= min(g["values_u8"]) and max(g["values_u8"]) <= 100
        assert g["class_cuts"] == [20.0, 40.0, 60.0, 80.0]
        assert len(g["bbox"]) == 4
        assert g["cell_km"] > 0


async def test_micro_heatmap_district_filter(client):
    r = await client.get("/api/v1/analytics/micro-heatmap", params={"district": "Aizawl"})
    assert r.status_code == 200
    grids = r.json()["grids"]
    assert grids
    assert all("Aizawl" == g["district"] for g in grids.values())


async def test_refresh_susceptibility_requires_admin(client):
    citizen = await token_for(client, *CITIZEN)
    r = await client.post(
        "/api/v1/analytics/micro-heatmap/refresh-susceptibility", headers=auth(citizen)
    )
    assert r.status_code == 403


async def test_refresh_susceptibility_updates_zone(client, engine):
    admin = await token_for(client, *ADMIN)
    zone_id = await _make_zone(engine, f"MZ-MH-{uuid.uuid4().hex[:6].upper()}")

    r = await client.post(
        "/api/v1/analytics/micro-heatmap/refresh-susceptibility?recompute=false",
        headers=auth(admin),
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["updated"] >= 1
    assert body["susc_model"]

    from sqlalchemy import select
    from sqlalchemy.ext.asyncio import async_sessionmaker

    from app.models import Zone

    Session2 = async_sessionmaker(engine, expire_on_commit=False)
    async with Session2() as s:
        z = (await s.execute(select(Zone).where(Zone.id == zone_id))).scalar_one()
        assert z.susc_mean is not None
        assert 0.0 <= z.susc_mean <= 100.0
        assert z.susc_p90 is not None and z.susc_p90 >= z.susc_mean
        infra = z.critical_infra or {}
        assert infra.get("susc_model")
        assert infra.get("susc_refreshed_at")

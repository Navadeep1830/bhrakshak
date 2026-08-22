import uuid

import httpx

from tests.conftest import ADMIN, CITIZEN, auth, token_for  # noqa: F401


async def test_health(client: httpx.AsyncClient):
    r = await client.get("/health")
    assert r.status_code == 200 and r.json()["status"] == "ok"


async def test_login_bad_credentials(client: httpx.AsyncClient):
    r = await client.post("/api/v1/auth/login", json={"email": "x@y.z", "password": "nope"})
    assert r.status_code == 401


async def test_me_requires_auth(client: httpx.AsyncClient):
    assert (await client.get("/api/v1/auth/me")).status_code == 401


async def test_refresh_rotation_and_reuse_detection(client: httpx.AsyncClient):
    toks = await token_for(client, *ADMIN)
    old_refresh = toks["refresh_token"]

    # first rotation succeeds, returns a NEW refresh token
    r1 = await client.post("/api/v1/auth/refresh", json={"refresh_token": old_refresh})
    assert r1.status_code == 200
    new_refresh = r1.json()["refresh_token"]
    assert new_refresh != old_refresh

    # replaying the OLD token must be rejected AND kill the family
    r2 = await client.post("/api/v1/auth/refresh", json={"refresh_token": old_refresh})
    assert r2.status_code == 401

    # even the NEW child is now dead (family revoked)
    r3 = await client.post("/api/v1/auth/refresh", json={"refresh_token": new_refresh})
    assert r3.status_code in (401,)


async def test_rbac_citizen_cannot_verify_reports(client: httpx.AsyncClient):
    citizen = await token_for(client, *CITIZEN)
    r = await client.patch(
        f"/api/v1/reports/{uuid.uuid4()}/verify?decision=verified",
        headers=auth(citizen),
    )
    assert r.status_code == 403


async def test_reports_sync_is_idempotent(client: httpx.AsyncClient):
    import random

    from tests.conftest import auth as a

    tok = await token_for(client, *CITIZEN)
    cid = uuid.uuid4()
    lat, lon = 25.57 + random.random() * 0.01, 91.88 + random.random() * 0.01
    body = {
        "batch_id": str(uuid.uuid4()),
        "reports": [
            {"client_id": str(cid), "category": "crack", "lat": lat, "lon": lon,
             "description": "offline test report"}
        ],
    }
    r1 = await client.post("/api/v1/reports/sync", json=body, headers=a(tok))
    assert r1.status_code == 200 and r1.json()["accepted"] == 1

    # same batch replayed: must NOT duplicate (idempotent by client UUID)
    r2 = await client.post("/api/v1/reports/sync", json=body, headers=a(tok))
    assert r2.status_code == 200
    out = r2.json()
    assert out["accepted"] == 0 and cid.__str__() in [str(x) for x in out["synced_ids"]]


async def test_demo_storm_requires_admin(client: httpx.AsyncClient):
    citizen = await token_for(client, *CITIZEN)
    r = await client.post(
        "/api/v1/demo/inject-rainfall-storm",
        json={"district": "Aizawl"},
        headers=auth(citizen),
    )
    assert r.status_code == 403


async def test_zones_require_auth(client: httpx.AsyncClient):
    assert (await client.get("/api/v1/zones")).status_code == 401

"""test_incident_command.py - Automated Tests for NDRF/SDRF Incident Command & Resource Dispatch
SIH26001: Verifies rescue team deployments, camp capacity tracking, and emergency supply convoy dispatches.
"""

import sys
from pathlib import Path
import pytest
from httpx import ASGITransport, AsyncClient

PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_ROOT))

from app.main import app


@pytest.mark.asyncio
async def test_incident_command_teams_list_and_filter():
    """Lists NDRF & SDRF search-and-rescue teams and validates district filtering."""
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        res = await ac.get("/api/v1/incident-command/teams")
        assert res.status_code == 200
        teams = res.json()
        assert len(teams) >= 4
        assert any(t["agency"] == "NDRF" for t in teams)
        assert any(t["agency"] == "SDRF" for t in teams)

        # District filter
        res_noney = await ac.get("/api/v1/incident-command/teams?district=Noney")
        assert res_noney.status_code == 200
        noney_teams = res_noney.json()
        assert len(noney_teams) >= 2
        assert all(t["assigned_district"] == "Noney" for t in noney_teams)


@pytest.mark.asyncio
async def test_incident_command_deploy_rescue_team():
    """Deploys an NDRF unit to a landslide sector and verifies status transition."""
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        payload = {
            "team_id": "NDRF-12-BN-A",
            "target_sector": "Tupul Railway Bridge Sector 4",
            "target_district": "Noney",
            "lat": 24.8150,
            "lon": 93.6850,
            "status": "RECOVERY_OPS",
        }
        res = await ac.post("/api/v1/incident-command/teams/deploy", json=payload)
        assert res.status_code == 200
        data = res.json()
        assert data["status"] == "success"
        assert data["team"]["assigned_sector"] == "Tupul Railway Bridge Sector 4"
        assert data["team"]["status"] == "RECOVERY_OPS"


@pytest.mark.asyncio
async def test_incident_command_shelters_and_capacity_update():
    """Tracks relief camp capacities and verifies occupancy and water reserve updates."""
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        res = await ac.get("/api/v1/incident-command/shelters")
        assert res.status_code == 200
        shelters = res.json()
        assert len(shelters) >= 4

        update_payload = {
            "camp_id": "CAMP-NONEY-01",
            "current_occupancy": 410,
            "water_liters": 5200,
            "ration_packets": 1400,
        }
        res_update = await ac.post("/api/v1/incident-command/shelters/update", json=update_payload)
        assert res_update.status_code == 200
        data = res_update.json()
        assert data["status"] == "success"
        assert data["shelter"]["current_occupancy"] == 410
        assert data["shelter"]["available_beds"] == 90
        assert data["shelter"]["potable_water_liters"] == 5200


@pytest.mark.asyncio
async def test_incident_command_dispatches_and_summary():
    """Creates an emergency supply dispatch order and validates high-level DDMA operational summary."""
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        dispatch_payload = {
            "destination_camp_id": "CAMP-NONEY-01",
            "supply_type": "Emergency Satellite Comms Terminals",
            "quantity": 5,
            "unit": "Terminal Kits",
            "convoy_lead": "NDRF Quick Logistics Unit",
            "eta_minutes": 20,
        }
        res_disp = await ac.post("/api/v1/incident-command/dispatches/create", json=dispatch_payload)
        assert res_disp.status_code == 200
        disp_data = res_disp.json()
        assert disp_data["status"] == "success"
        assert disp_data["dispatch_id"].startswith("DISPATCH-2026-")

        # Summary Endpoint
        res_sum = await ac.get("/api/v1/incident-command/summary")
        assert res_sum.status_code == 200
        sum_data = res_sum.json()
        assert "shelter_overview" in sum_data
        assert "response_force" in sum_data
        assert sum_data["response_force"]["deployed_personnel_count"] > 0
        assert sum_data["shelter_overview"]["total_capacity"] > 0

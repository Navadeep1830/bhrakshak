"""test_debris_runout.py - Automated Tests for Voellmy-Salm Shallow-Water Debris Hydrodynamics
SIH26001: Verifies debris flow runout velocity, inundation depth, kinetic impact pressure,
and downstream settlement vulnerability modeling with zero cloud APIs.
"""

import sys
from pathlib import Path
import pytest
from httpx import ASGITransport, AsyncClient

PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_ROOT))

from app.main import app
from app.services.debris_runout import (
    simulate_voellmy_debris_runout,
    VoellmyParams,
    DownstreamSettlement,
)


def test_voellmy_salm_physics_tupul_benchmark():
    """Validates 1.2M m3 Tupul 2022 benchmark slide dynamics and structural impact pressure."""
    result = simulate_voellmy_debris_runout(
        initial_volume_m3=1_200_000.0,
        scarp_elevation_m=850.0,
        valley_length_m=2000.0,
    )

    assert result.total_volume_m3 == 1_200_000.0
    assert result.total_runout_distance_m >= 1200.0
    assert 12.0 <= result.peak_velocity_m_s <= 35.0
    assert 2.0 <= result.peak_inundation_depth_m <= 22.0
    assert result.peak_impact_pressure_kpa > 100.0  # Explains catastrophic damage to railway barracks
    assert len(result.settlement_impacts) >= 3

    # Tupul 107 TA Base Camp evaluation (at 820m)
    tupul_camp = result.settlement_impacts[0]
    assert tupul_camp["settlement_name"] == "Tupul 107 Territorial Army Base Camp"
    assert tupul_camp["arrival_time_seconds"] < 90.0  # High velocity debris arrives in < 90s
    assert tupul_camp["kinetic_impact_pressure_kpa"] > 50.0
    assert tupul_camp["structural_damage_assessment"] in ("SEVERE_STRUCTURAL_FAILURE", "CATASTROPHIC_OBLITERATION")


def test_voellmy_friction_and_drag_sensitivity():
    """Low friction (saturated slurry mu=0.10) must produce higher velocity and longer runout than dry colluvium (mu=0.28)."""
    res_wet = simulate_voellmy_debris_runout(
        initial_volume_m3=500_000.0,
        params=VoellmyParams(coulomb_friction_mu=0.10, turbulent_drag_xi=600.0),
    )
    res_dry = simulate_voellmy_debris_runout(
        initial_volume_m3=500_000.0,
        params=VoellmyParams(coulomb_friction_mu=0.28, turbulent_drag_xi=300.0),
    )

    assert res_wet.peak_velocity_m_s > res_dry.peak_velocity_m_s
    assert res_wet.total_runout_distance_m >= res_dry.total_runout_distance_m
    assert res_wet.peak_impact_pressure_kpa > res_dry.peak_impact_pressure_kpa


def test_voellmy_inundation_depth_conservation():
    """Flow depth across all steps must remain strictly positive and within physical bounds."""
    result = simulate_voellmy_debris_runout(initial_volume_m3=800_000.0)
    for step in result.profile_steps:
        assert step.flow_depth_m >= 0.5
        assert step.flow_depth_m <= 25.0
        assert step.velocity_m_s >= 0.0
        assert step.impact_pressure_kpa >= 0.0


@pytest.mark.asyncio
async def test_debris_runout_fastapi_endpoint():
    """Tests the /api/v1/analytics/debris-runout endpoint end-to-end."""
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        payload = {
            "initial_volume_m3": 1000000.0,
            "scarp_elevation_m": 820.0,
            "valley_length_m": 1800.0,
            "coulomb_friction_mu": 0.15,
            "turbulent_drag_xi": 500.0,
            "scenario_name": "Tupul Railway Yard Debris Simulation",
        }
        res = await ac.post("/api/v1/analytics/debris-runout", json=payload)
        assert res.status_code == 200
        data = res.json()
        assert data["scenario_name"] == "Tupul Railway Yard Debris Simulation"
        assert data["peak_velocity_m_s"] > 10.0
        assert len(data["settlement_impacts"]) >= 3
        assert len(data["profile_summary_sample"]) > 5
        assert "Voellmy-Salm" in data["computational_engine"]

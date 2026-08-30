"""test_briefing.py - Automated Tests for District Collector Briefing Dossier Generation
SIH26001: Verifies SHAP waterfall feature attributions, DDMA SOPs, and printable briefing report rendering.
"""

import sys
from pathlib import Path
import pytest

PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_ROOT))

from app.services.briefing import (
    compute_shap_waterfall_attributions,
    generate_collector_briefing_dossier,
    render_briefing_markdown_report,
)


def test_shap_waterfall_attributions_normalization():
    """SHAP waterfall attributions must sum to 100% and identify critical/warning drivers."""
    waterfall = compute_shap_waterfall_attributions(
        rain_72h=280.0,
        rain_1h=45.0,
        slope_deg=38.0,
        vwc_pct=92.0,
        insar_creep_mm_yr=-18.5,
    )
    assert len(waterfall) == 5
    total_pct = sum(item["contribution_pct"] for item in waterfall)
    assert 99.0 <= total_pct <= 101.0, f"Expected ~100% sum, got {total_pct}"
    
    top_driver = waterfall[0]
    assert top_driver["contribution_pct"] >= 20.0
    assert top_driver["severity"] in ("critical", "warning")


def test_collector_briefing_dossier_generation():
    """Generates structured briefing dossier with geotech mechanics, DDMA SOPs, and shelter allocations."""
    dossier = generate_collector_briefing_dossier(
        zone_id="test-zone-001",
        zone_code="ZN-TUPUL-01",
        district="Noney",
        hazard_level=4,
        prob_24h=0.92,
        population=1600,
        slope_deg=36.0,
        rain_72h=295.0,
        rain_1h=48.0,
        vwc_pct=94.0,
        pore_pressure_kpa=22.0,
        insar_creep_mm_yr=-16.4,
    )
    assert dossier["zone_code"] == "ZN-TUPUL-01"
    assert dossier["hazard_level"] == 4
    assert dossier["lead_time_hours"] == 36
    assert dossier["geotech_mechanics"]["factor_of_safety"] < 1.10
    assert len(dossier["shap_waterfall_attributions"]) == 5
    assert len(dossier["dc_directive"]["ddma_sop_checklist"]) >= 5
    assert dossier["evacuation_shelter_allocation"]["allocated_evacuees"] > 0


def test_briefing_markdown_rendering():
    """Renders formatted DDMA markdown briefing dossier containing all executive sections."""
    dossier = generate_collector_briefing_dossier(
        zone_id="test-zone-002",
        zone_code="ZN-AIZ-04",
        district="Aizawl",
        hazard_level=3,
        prob_24h=0.78,
    )
    md = render_briefing_markdown_report(dossier)
    assert "DISTRICT DISASTER MANAGEMENT AUTHORITY" in md
    assert "EXPLAINABLE AI (SHAP) PHYSICAL ATTRIBUTION WATERFALL" in md
    assert "MANDATORY DDMA STANDARD OPERATING PROCEDURES (SOP)" in md
    assert "RELIEF SHELTER & RESOURCE ALLOCATION" in md
    assert "ARTERIAL ROAD CLEARANCE & EMERGENCY DETOUR" in md


def test_briefing_dossier_all_hazard_tiers():
    """Generates valid briefing dossiers across all hazard tiers (L1 to L4)."""
    for lvl in [1, 2, 3, 4]:
        d = generate_collector_briefing_dossier(
            zone_id=f"zone-{lvl}",
            zone_code=f"ZN-0{lvl}",
            district="East Khasi Hills",
            hazard_level=lvl,
            prob_24h=lvl * 0.22,
        )
        assert d["hazard_level"] == lvl
        assert len(d["dc_directive"]["headline"]) > 5
        assert d["geotech_mechanics"]["factor_of_safety"] > 0


if __name__ == "__main__":
    test_shap_waterfall_attributions_normalization()
    test_collector_briefing_dossier_generation()
    test_briefing_markdown_rendering()
    test_briefing_dossier_all_hazard_tiers()
    print("✅ All District Collector briefing dossier tests passed successfully.")

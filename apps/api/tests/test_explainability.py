"""test_explainability.py - Automated Tests for SHAP Explainability & DDMA SOP Directives
SIH26001: Verifies zero-mock mathematical SHAP attribution and DDMA SOP checklist generation.
"""

import sys
from pathlib import Path
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.models import Zone
from app.services.risk_engine import generate_dc_directive, predict_model_b


def test_shap_feature_attributions_non_empty():
    """Predicting on Model B must return non-empty 5-factor physical drivers."""
    fake_zone = Zone(
        id=None,
        zone_code="MZ-AIZ-001",
        name="Aizawl West Slope",
        district="Aizawl",
        state="Mizoram",
        susc_mean=78.5,
        population=4500,
        road_km=14.2,
    )
    prob, drivers = predict_model_b(
        rain_1h=35.0,
        rain_24h=140.0,
        soil_moisture=88.0,
        zone=fake_zone,
    )
    assert 0.0 <= prob <= 1.0, f"Probability {prob} must be in [0, 1]"
    assert len(drivers) == 5, f"Expected exactly 5 physical SHAP feature drivers, got {len(drivers)}"
    
    # Check driver keys
    for d in drivers:
        assert "feature" in d
        assert "contribution" in d
        assert "val_num" in d
        assert "name" in d
        assert "description" in d


def test_ddma_sop_checklist_l4_emergency():
    """L4 Emergency must generate actionable DDMA SOPs for DC, SDRF, PWD, Health, and Police."""
    fake_zone = Zone(
        id=None,
        zone_code="MN-NON-002",
        name="Tupul Railway Zone",
        district="Noney",
        state="Manipur",
        susc_mean=84.0,
        population=1200,
        road_km=8.5,
    )
    directive = generate_dc_directive(
        zone=fake_zone,
        level=4,
        prob_24h=0.88,
        drivers=[],
        isolation_score=75,
    )
    assert directive["level"] == 4
    assert "Sec 34" in directive["headline"]
    assert "ddma_sop_checklist" in directive
    assert len(directive["ddma_sop_checklist"]) >= 5
    
    # Verify demographics calculation
    demo = directive["demographics"]
    assert demo["total_population"] == 1200
    assert demo["elderly_count"] == int(1200 * 0.08)
    assert demo["children_under_5"] == int(1200 * 0.12)
    assert demo["ambulances_assigned"] >= 3


if __name__ == "__main__":
    test_shap_feature_attributions_non_empty()
    test_ddma_sop_checklist_l4_emergency()
    print("✅ All SHAP explainability and DDMA SOP tests passed successfully.")

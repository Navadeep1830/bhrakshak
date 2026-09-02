"""test_ai_incident_commander.py - Automated Tests for Multi-Agent AI Incident Commander
SIH26001: Verifies multi-lingual triage (8 NER languages), NDRF battalion allocation,
road detour bypass routing, and bilingual DDMA Action Orders under DM Act 2005.
"""

import sys
from pathlib import Path
import pytest
from httpx import ASGITransport, AsyncClient

PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_ROOT))

from app.main import app
from app.services.incident_commander import (
    incident_commander,
    TriageAgent,
    ResourceAllocationAgent,
    OrderDraftingAgent,
)


def test_triage_agent_khasi_trapped_victims():
    """Khasi report of trapped villagers under collapsed homes must triage as CRITICAL (Priority 5)."""
    triage = TriageAgent()
    res = triage.triage_report(
        text_input="Jingtwad khyndew jur ha Sohra! Don ki briew shapoh ka ing kaba la kyllon, shah ngam ki mynsaw!",
        user_lat=25.280,
        user_lon=91.720,
    )
    assert res.severity_category == "CRITICAL_TRAPPED_CASUALTIES"
    assert res.priority_score == 5
    assert res.detected_language == "kha"
    assert res.estimated_casualties_flag is True
    assert "CRITICAL TRAPPED CASUALTIES" in res.summary_en


def test_triage_agent_hindi_highway_blockage():
    """Hindi report of stranded vehicles on NH-29 must triage as MAJOR_HIGHWAY_BLOCKAGE (Priority 4)."""
    triage = TriageAgent()
    res = triage.triage_report(
        text_input="एनएच-29 पर भूस्खलन के कारण सड़क अवरुद्ध हो गई है! राष्ट्रीय राजमार्ग पर 50 वाहन खड़े हैं और भारी मलबा सड़क पर आ गया है।",
        user_lat=25.665,
        user_lon=94.100,
    )
    assert res.severity_category == "MAJOR_HIGHWAY_BLOCKAGE"
    assert res.priority_score == 4
    assert res.detected_language == "hi"


def test_resource_allocation_agent_ndrf_and_detour():
    """Allocates nearest battalion (12th NDRF for Noney) and heavy JCBs with bypass corridor."""
    triage = TriageAgent()
    allocator = ResourceAllocationAgent()

    t_res = triage.triage_report("Severe landslide at Tupul railway yard! People trapped inside mud flow!", 24.810, 93.680)
    alloc = allocator.allocate_resources(t_res, 24.810, 93.680, "Noney")

    assert "assigned_battalion" in alloc
    battalion = alloc["assigned_battalion"]
    assert battalion.agency in ("NDRF", "SDRF")
    assert battalion.personnel >= 20
    assert len(battalion.specialty_equipment) >= 1
    assert "Bypass" in battalion.corridor_detour_used

    heavy = alloc["heavy_machinery"]
    assert heavy["jcb_excavators"] >= 2
    assert heavy["full_clearance_eta_hours"] > 0


def test_order_drafting_agent_bilingual_ddma_order():
    """Drafts official bilingual DDMA action order under DM Act 2005 with SHA-256 token."""
    triage = TriageAgent()
    allocator = ResourceAllocationAgent()
    drafter = OrderDraftingAgent()

    t_res = triage.triage_report("Lei min nasa avangin in a chim a, mi an tang! Tanpui vat rawh u!", 23.732, 92.715)
    alloc = allocator.allocate_resources(t_res, 23.732, 92.715, "Aizawl")
    order = drafter.draft_order(t_res, alloc, "Durtlang Ridge Sector", "Aizawl")

    assert order.order_id.startswith("DDMA/AIZAWL/EMERG/")
    assert "DM Act 2005" in order.act_section
    assert order.auth_token.startswith("SHA256:")
    assert len(order.auth_token) >= 20
    assert "OFFICE OF THE DEPUTY COMMISSIONER" in order.english_order_text
    assert len(order.regional_order_text) > 20
    assert len(order.inter_agency_tasks) >= 4


@pytest.mark.asyncio
async def test_ai_incident_commander_fastapi_endpoint():
    """Tests the end-to-end /api/v1/incident-command/ai-triage-dispatch API endpoint."""
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        payload = {
            "report_text": "Massive landslide at KM 12 Tupul yard. 3 houses collapsed and victims trapped in debris!",
            "lat": 24.8105,
            "lon": 93.6820,
            "district": "Noney",
            "incident_sector": "Tupul Railway Bridge Sector 2",
        }
        res = await ac.post("/api/v1/incident-command/ai-triage-dispatch", json=payload)
        assert res.status_code == 200
        data = res.json()
        assert data["status"] == "TRIAGED_AND_DISPATCHED"
        assert data["triage"]["severity_category"] == "CRITICAL_TRAPPED_CASUALTIES"
        assert data["triage"]["priority_score"] == 5
        assert data["dispatch_plan"]["battalion"]["agency"] in ("NDRF", "SDRF")
        assert data["ddma_action_order"]["auth_token"].startswith("SHA256:")





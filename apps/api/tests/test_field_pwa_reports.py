"""test_field_pwa_reports.py - Automated Tests for Field PWA Offline Reports & 8 NER Languages
SIH26001: Verifies multi-lingual templates, image attachment payloads, and spatial deduplication.
"""

import sys
import uuid
from pathlib import Path
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.api.v1.reports import _haversine_m
from app.schemas.schemas import ReportIn, SyncBatchIn
from app.services.risk_engine import DEFAULT_TEMPLATES, LEVEL_NAMES


def test_8_ner_languages_alert_templates_full_matrix():
    """Validates complete 8 languages x 4 warning levels matrix with real substitutions."""
    langs = ["en", "hi", "bn", "as", "ne", "kha", "lus", "mni-Mtei"]
    levels = [1, 2, 3, 4]
    
    for lang in langs:
        for lvl in levels:
            key = f"alert.l{lvl}"
            template = DEFAULT_TEMPLATES.get((key, lang))
            assert template is not None, f"Missing template for {key} in {lang}"
            rendered = template.format(village="Noney / Tupul", level=LEVEL_NAMES[lvl])
            assert "Noney / Tupul" in rendered or LEVEL_NAMES[lvl] in rendered
            assert len(rendered) > 10


def test_field_pwa_sync_payload_with_photos():
    """Verifies that offline PWA batch payload structure correctly parses photo attachments and EXIF flags."""
    client_id = uuid.uuid4()
    batch_id = uuid.uuid4()
    
    report_item = ReportIn(
        client_id=client_id,
        category="crack",
        lat=24.8105,
        lon=93.6820,
        description="Fresh 4-inch tension crack opening near slope toe",
        media_refs=["data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD..."],
        exif_geo_ok=True,
    )
    
    batch = SyncBatchIn(
        batch_id=batch_id,
        reports=[report_item],
    )
    
    assert batch.batch_id == batch_id
    assert len(batch.reports) == 1
    assert batch.reports[0].client_id == client_id
    assert batch.reports[0].media_refs[0].startswith("data:image/jpeg;base64,")
    assert batch.reports[0].exif_geo_ok is True


def test_field_pwa_sync_payload_with_voice_audio():
    """Verifies that offline PWA batch payload carries both camera photos and voice audio recordings."""
    client_id = uuid.uuid4()
    batch_id = uuid.uuid4()

    report_item = ReportIn(
        client_id=client_id,
        category="water_seepage",
        lat=24.8110,
        lon=93.6825,
        description="Turbid brown water gushing from slope base",
        media_refs=[
            "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD...",
            "data:audio/webm;base64,GkXfo59ChoEBQveBAULygQRC84EIQoK...",
        ],
        exif_geo_ok=True,
    )

    batch = SyncBatchIn(batch_id=batch_id, reports=[report_item])
    assert len(batch.reports[0].media_refs) == 2
    assert any("audio" in ref for ref in batch.reports[0].media_refs)


def test_spatial_proximity_deduplication():
    """Validates haversine proximity calculation for <50m duplicate detection."""
    lat1, lon1 = 23.7320, 92.7150
    # Point 20 meters away
    lat2, lon2 = 23.73215, 92.7151
    dist_m = _haversine_m(lat1, lon1, lat2, lon2)
    assert dist_m < 50.0, f"Expected distance < 50m, got {dist_m}m"
    
    # Point 500 meters away
    lat3, lon3 = 23.7360, 92.7180
    dist_far = _haversine_m(lat1, lon1, lat3, lon3)
    assert dist_far > 100.0, f"Expected distance > 100m, got {dist_far}m"


if __name__ == "__main__":
    test_8_ner_languages_alert_templates_full_matrix()
    test_field_pwa_sync_payload_with_photos()
    test_spatial_proximity_deduplication()
    print("✅ All Field PWA offline reports & 8 NER language tests passed successfully.")

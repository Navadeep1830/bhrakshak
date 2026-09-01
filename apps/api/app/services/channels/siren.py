"""Siren adapter — HTTP webhook to field siren controller / district PA system.

Env: SIREN_WEBHOOK_URL (if empty -> dryrun log). Supports generic POST {zone_code, level, message}.
"""
from __future__ import annotations

import logging
import os
import time

import httpx

from .base import ChannelAdapter, DeliveryResult

log = logging.getLogger("bhrakshak.channels.siren")


class SirenAdapter(ChannelAdapter):
    channel = "siren"
    provider = "webhook"

    async def send(self, *, zone_code: str, district: str, level: int, message: str, recipients: int) -> DeliveryResult:
        start = time.monotonic()
        try:
            url = os.environ.get("SIREN_WEBHOOK_URL")
            if not url:
                log.info("[SIREN dryrun] zone=%s level=%d — no webhook, logged only", zone_code, level)
                return DeliveryResult(channel="siren", success=True, provider="siren-dryrun", latency_ms=int((time.monotonic()-start)*1000), recipients=recipients)

            async with httpx.AsyncClient(timeout=8) as client:
                resp = await client.post(url, json={"zone_code": zone_code, "district": district, "level": level, "message": message})
                ok = resp.status_code in (200, 201, 202, 204)
                if not ok:
                    log.warning("Siren webhook HTTP %s body=%.400s", resp.status_code, resp.text)
                return DeliveryResult(channel="siren", success=ok, provider="webhook", latency_ms=int((time.monotonic()-start)*1000), recipients=recipients if ok else 0, error=None if ok else f"HTTP {resp.status_code}")
        except Exception as e:
            log.warning("Siren send failed: %s", e)
            return DeliveryResult(channel="siren", success=False, provider="webhook", error=str(e)[:300], recipients=0)

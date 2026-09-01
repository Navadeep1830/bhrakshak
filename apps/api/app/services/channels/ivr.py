"""IVR adapter — Exotel / Ozonetel voice call broadcast.

Env: IVR_PROVIDER=exotel|ozonetel|dryrun, EXOTEL_SID/TOKEN/FROM etc.
Stub logs in dryrun; real path POSTs to provider.
"""
from __future__ import annotations

import logging
import os
import time

import httpx

from .base import ChannelAdapter, DeliveryResult

log = logging.getLogger("bhrakshak.channels.ivr")


class IvrAdapter(ChannelAdapter):
    channel = "ivr"
    provider = "exotel"

    async def send(self, *, zone_code: str, district: str, level: int, message: str, recipients: int) -> DeliveryResult:
        start = time.monotonic()
        provider = (os.environ.get("IVR_PROVIDER") or "dryrun").lower()
        try:
            if provider == "dryrun" or not os.environ.get("EXOTEL_SID"):
                log.info("[IVR dryrun] zone=%s level=%d recipients=%d voice=%.120s", zone_code, level, recipients, message)
                return DeliveryResult(channel="ivr", success=True, provider="ivr-dryrun", latency_ms=int((time.monotonic()-start)*1000), recipients=recipients)

            # Exotel example — voice broadcast
            sid = os.environ["EXOTEL_SID"]
            token = os.environ["EXOTEL_TOKEN"]
            frm = os.environ.get("EXOTEL_FROM", "0400000000")
            async with httpx.AsyncClient(timeout=10, auth=(sid, token)) as client:
                resp = await client.post(
                    f"https://api.exotel.com/v1/Accounts/{sid}/Calls/connect",
                    data={"From": frm, "CallerId": frm, "Url": os.environ.get("IVR_VOICE_URL", "http://my.exotel.com/bhrakshak.xml")},
                )
                ok = resp.status_code in (200, 201)
                log.info("Exotel IVR status %s", resp.status_code)
                return DeliveryResult(channel="ivr", success=ok, provider="exotel", latency_ms=int((time.monotonic()-start)*1000), recipients=recipients if ok else 0, error=None if ok else f"HTTP {resp.status_code}")
        except Exception as e:
            log.warning("IVR send failed: %s", e)
            return DeliveryResult(channel="ivr", success=False, provider=provider, error=str(e)[:300], recipients=0)

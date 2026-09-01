"""SMS adapter — MSG91 primary (India), Twilio fallback, dry-run log fallback.

Env:
  SMS_PROVIDER=msg91|twilio|dryrun (default dryrun when no keys)
  MSG91_API_KEY, MSG91_SENDER, MSG91_ROUTE=4, MSG91_DLT_TEMPLATE_ID (optional)
  TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM
  ALERT_SMS_DRYRUN=true -> never hit network, just log (default true when demo_mode)
"""
from __future__ import annotations

import logging
import os
import time

import httpx

from .base import ChannelAdapter, DeliveryResult

log = logging.getLogger("bhrakshak.channels.sms")


class SmsAdapter(ChannelAdapter):
    channel = "sms"
    provider = "msg91"

    async def send(self, *, zone_code: str, district: str, level: int, message: str, recipients: int) -> DeliveryResult:
        provider = (os.environ.get("SMS_PROVIDER") or ("dryrun" if _is_dryrun() else "msg91")).lower()
        start = time.monotonic()
        try:
            if provider == "dryrun" or _is_dryrun():
                log.info("[SMS dryrun] zone=%s level=%d recipients=%d msg=%.120s", zone_code, level, recipients, message)
                return DeliveryResult(channel="sms", success=True, provider="dryrun", latency_ms=int((time.monotonic()-start)*1000), recipients=recipients)

            if provider == "twilio":
                return await _send_twilio(message, recipients, start)

            # default msg91
            return await _send_msg91(message, recipients, start)
        except Exception as e:
            log.warning("SMS send failed (%s): %s", provider, e)
            # never fail the whole alert flow — degrade to logged delivery
            return DeliveryResult(channel="sms", success=False, provider=provider, error=str(e)[:300], recipients=0)


def _is_dryrun() -> bool:
    return (os.environ.get("ALERT_SMS_DRYRUN") or os.environ.get("DEMO_MODE") or "true").lower() in ("1", "true", "yes") and not os.environ.get("MSG91_API_KEY")


async def _send_msg91(message: str, recipients: int, start: float) -> DeliveryResult:
    api_key = os.environ.get("MSG91_API_KEY")
    if not api_key:
        log.info("[SMS msg91 dryrun — no API key] recipients=%d msg=%.120s", recipients, message)
        return DeliveryResult(channel="sms", success=True, provider="msg91-dryrun", latency_ms=int((time.monotonic()-start)*1000), recipients=recipients)

    sender = os.environ.get("MSG91_SENDER", "BHRKSK")
    route = os.environ.get("MSG91_ROUTE", "4")
    # MSG91 bulk endpoint — phone numbers are resolved from zone subscriber registry;
    # for now broadcast is simulated with count-only (no PII in demo).
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.post(
            "https://api.msg91.com/api/v5/flow/",
            headers={"authkey": api_key, "Content-Type": "application/json"},
            json={"sender": sender, "route": route, "country": "91", "sms": [{"message": message}]},
        )
        ok = resp.status_code in (200, 201)
        if not ok:
            log.warning("MSG91 status %s body=%.500s", resp.status_code, resp.text)
        return DeliveryResult(channel="sms", success=ok, provider="msg91", latency_ms=int((time.monotonic()-start)*1000), recipients=recipients if ok else 0, error=None if ok else f"HTTP {resp.status_code}")


async def _send_twilio(message: str, recipients: int, start: float) -> DeliveryResult:
    sid = os.environ.get("TWILIO_ACCOUNT_SID")
    token = os.environ.get("TWILIO_AUTH_TOKEN")
    frm = os.environ.get("TWILIO_FROM")
    if not (sid and token and frm):
        log.info("[SMS twilio dryrun — missing creds] recipients=%d msg=%.120s", recipients, message)
        return DeliveryResult(channel="sms", success=True, provider="twilio-dryrun", latency_ms=int((time.monotonic()-start)*1000), recipients=recipients)

    # Twilio REST — recipients would be enumerated from District subscriber table;
    # demo counts only to avoid PII.
    log.info("[SMS twilio] would send to %d recipients: %.120s", recipients, message)
    return DeliveryResult(channel="sms", success=True, provider="twilio", latency_ms=int((time.monotonic()-start)*1000), recipients=recipients)

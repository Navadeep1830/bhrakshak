"""Push adapter — Firebase Cloud Messaging.

Env: FCM_CREDENTIALS_JSON (service account JSON string) or FCM_DRYRUN=true.
Falls back to logged delivery when no credentials.
"""
from __future__ import annotations

import logging
import os
import time

from .base import ChannelAdapter, DeliveryResult

log = logging.getLogger("bhrakshak.channels.push")


class PushAdapter(ChannelAdapter):
    channel = "push"
    provider = "fcm"

    async def send(self, *, zone_code: str, district: str, level: int, message: str, recipients: int) -> DeliveryResult:
        start = time.monotonic()
        try:
            dry = os.environ.get("FCM_DRYRUN", "true").lower() in ("1", "true", "yes") or not os.environ.get("FCM_CREDENTIALS_JSON")
            if dry:
                log.info("[PUSH dryrun] zone=%s level=%d recipients=%d msg=%.120s", zone_code, level, recipients, message)
                return DeliveryResult(channel="push", success=True, provider="fcm-dryrun", latency_ms=int((time.monotonic()-start)*1000), recipients=recipients)

            # Real FCM — lazy import so docker without firebase-admin still boots
            import firebase_admin
            from firebase_admin import credentials, messaging

            if not firebase_admin._apps:
                import json

                cred = credentials.Certificate(json.loads(os.environ["FCM_CREDENTIALS_JSON"]))
                firebase_admin.initialize_app(cred)

            # Topic per zone: bhrakshak-<zone_code>
            topic = f"bhrakshak-{zone_code.lower()}"
            msg = messaging.Message(
                notification=messaging.Notification(title=f"BhuRakshak L{level} — {district}", body=message),
                topic=topic,
                data={"zone_code": zone_code, "level": str(level), "district": district},
            )
            resp = messaging.send(msg)
            log.info("FCM sent topic=%s id=%s", topic, resp)
            return DeliveryResult(channel="push", success=True, provider="fcm", latency_ms=int((time.monotonic()-start)*1000), recipients=recipients)
        except Exception as e:
            log.warning("Push send failed: %s", e)
            return DeliveryResult(channel="push", success=False, provider="fcm", error=str(e)[:300], recipients=0)

import asyncio
import json

import redis.asyncio as aioredis
from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.core.config import settings

router = APIRouter(tags=["ws"])


@router.websocket("/ws/live")
async def ws_live(ws: WebSocket):
    await ws.accept()
    pubsub = None
    try:
        r = aioredis.from_url(settings.redis_url)
        pubsub = r.pubsub()
        await pubsub.subscribe("bhrakshak:live")
        while True:
            msg = await pubsub.get_message(ignore_subscribe_messages=True, timeout=15.0)
            if msg and msg.get("data"):
                await ws.send_text(msg["data"].decode() if isinstance(msg["data"], bytes) else str(msg["data"]))
            else:
                await ws.send_text(json.dumps({"type": "heartbeat"}))
    except WebSocketDisconnect:
        pass
    except Exception:
        pass
    finally:
        if pubsub:
            try:
                await pubsub.unsubscribe("bhrakshak:live")
                await pubsub.aclose()
            except Exception:
                pass

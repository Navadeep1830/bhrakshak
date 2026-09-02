import asyncio
import json

import redis.asyncio as aioredis
from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.core.config import settings

router = APIRouter(tags=["ws"])


active_sockets: set[WebSocket] = set()


async def broadcast_event(data: dict):
    msg_str = json.dumps(data)
    try:
        r = aioredis.from_url(settings.redis_url)
        await r.publish("bhrakshak:live", msg_str)
        await r.aclose()
    except Exception:
        pass
    for ws in list(active_sockets):
        try:
            await ws.send_text(msg_str)
        except Exception:
            active_sockets.discard(ws)


@router.websocket("/ws/live")
async def ws_live(ws: WebSocket):
    await ws.accept()
    active_sockets.add(ws)
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
        active_sockets.discard(ws)
        if pubsub:
            try:
                await pubsub.unsubscribe("bhrakshak:live")
                await pubsub.aclose()
            except Exception:
                pass

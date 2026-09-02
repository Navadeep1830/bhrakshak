import json
import uuid
from datetime import datetime, timezone
from fastapi import APIRouter, Body
from pydantic import BaseModel

from app.api.v1.ws import broadcast_event

router = APIRouter(prefix="/chat", tags=["chat"])


class ChatMessageIn(BaseModel):
    sender_name: str
    location: str | None = "Tupul Station Yard (Noney)"
    message: str
    role: str | None = "field_responder"


class ChatMessageOut(BaseModel):
    id: str
    sender_name: str
    location: str
    message: str
    role: str
    timestamp: str


CHAT_MESSAGES: list[dict] = [
    {
        "id": "00000000-0000-0000-0000-000000000301",
        "sender_name": "SDRF QRT Commander",
        "location": "Tupul Station Yard (Noney)",
        "message": "HQ, QRT Team 1 in position at NH-37 choke point. Satellite comms active.",
        "role": "field_responder",
        "timestamp": datetime.now(timezone.utc).isoformat(),
    },
    {
        "id": "00000000-0000-0000-0000-000000000302",
        "sender_name": "DC Control Room",
        "location": "Aizawl HQ",
        "message": "Copy QRT 1. Ramping rainfall expected. Keep evacuation channels open.",
        "role": "admin",
        "timestamp": datetime.now(timezone.utc).isoformat(),
    },
]


@router.get("/messages", response_model=list[ChatMessageOut])
async def get_messages():
    return CHAT_MESSAGES[:50]


@router.post("/send", response_model=ChatMessageOut)
async def send_message(body: ChatMessageIn):
    msg = {
        "id": str(uuid.uuid4()),
        "sender_name": body.sender_name,
        "location": body.location or "Field Location",
        "message": body.message,
        "role": body.role or "user",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "type": "chat_message",
    }
    CHAT_MESSAGES.insert(0, msg)
    await broadcast_event(msg)
    return msg

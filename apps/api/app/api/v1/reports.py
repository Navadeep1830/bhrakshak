import math
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from geoalchemy2 import WKTElement
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import OPS_ROLES, STAFF_ROLES, get_current_user, require_roles
from app.db.session import get_db
from app.models import CitizenReport, Role, User
from app.schemas.schemas import ReportIn, ReportOut, SyncBatchIn, SyncBatchOut

router = APIRouter(prefix="/reports", tags=["reports"])

DEDUP_RADIUS_M = 50
DEDUP_WINDOW_H = 1


async def _find_duplicate(db: AsyncSession, lat: float, lon: float, category: str) -> CitizenReport | None:
    """Proximity dedupe: <50m, <1h, same category -> merge into existing report."""
    since = datetime.now(timezone.utc) - timedelta(hours=DEDUP_WINDOW_H)
    # bounding box prefilter (~0.0005 deg ~ 55m at these latitudes)
    rows = (
        await db.execute(
            select(CitizenReport).where(
                CitizenReport.category == category,
                CitizenReport.created_at >= since,
            )
        )
    ).scalars().all()
    for r in rows:
        pt = db.execute(
            select(func.ST_X(CitizenReport.geom), func.ST_Y(CitizenReport.geom)).where(CitizenReport.id == r.id)
        )
        res = (await pt).first()
        if res is None:
            continue
        lon2, lat2 = float(res[0]), float(res[1])
        if _haversine_m(lat, lon, lat2, lon2) < DEDUP_RADIUS_M:
            return r
    return None


def _haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    R = 6371000
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * R * math.asin(math.sqrt(a))


@router.post("", response_model=ReportOut, status_code=201)
async def create_report(
    body: ReportIn,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    return await _upsert_report(db, body, user)


@router.post("/sync", response_model=SyncBatchOut)
async def sync_reports(
    batch: SyncBatchIn,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Idempotent offline sync: upsert by client UUID; duplicates merged."""
    accepted, merged, flagged, synced = 0, 0, 0, []
    for item in batch.reports:
        exists = await db.get(CitizenReport, item.client_id)
        if exists is not None:
            synced.append(item.client_id)
            continue
        dup = await _find_duplicate(db, item.lat, item.lon, item.category)
        if dup is not None:
            dup.dup_count += 1
            merged += 1
            synced.append(item.client_id)
            continue
        flagged_flag = item.exif_geo_ok is False
        flagged += int(flagged_flag)
        await _upsert_report(db, item, user, sync_batch=batch.batch_id)
        accepted += 1
        synced.append(item.client_id)
    await db.commit()
    return SyncBatchOut(
        batch_id=batch.batch_id,
        accepted=accepted,
        duplicates_merged=merged,
        flagged=flagged,
        synced_ids=synced,
    )


async def _upsert_report(db: AsyncSession, item: ReportIn, user: User, sync_batch: uuid.UUID | None = None) -> ReportOut:
    report = CitizenReport(
        id=item.client_id,
        author_id=user.id,
        role=user.role.value,
        category=item.category,
        geom=WKTElement(f"POINT({item.lon} {item.lat})", srid=4326),
        description=item.description,
        media_refs=item.media_refs or [],
        taken_at=item.taken_at,
        sync_batch=sync_batch,
        exif_geo_ok=item.exif_geo_ok,
        status="pending",
    )
    db.add(report)
    await db.commit()
    await db.refresh(report)
    out = ReportOut.model_validate(report)
    row = (await db.execute(select(func.ST_X(CitizenReport.geom), func.ST_Y(CitizenReport.geom)).where(CitizenReport.id == report.id))).first()
    if row:
        out.lon, out.lat = float(row[0]), float(row[1])
    return out


@router.get("", response_model=list[ReportOut])
async def list_reports(status_filter: str | None = "pending", limit: int = 100,
                       db: AsyncSession = Depends(get_db), user: User = Depends(require_roles(*STAFF_ROLES))):
    q = select(CitizenReport).order_by(CitizenReport.created_at.desc()).limit(limit)
    if status_filter:
        q = q.where(CitizenReport.status == status_filter)
    rows = (await db.execute(q)).scalars().all()
    outs = []
    for r in rows:
        o = ReportOut.model_validate(r)
        row = (await db.execute(select(func.ST_X(CitizenReport.geom), func.ST_Y(CitizenReport.geom)).where(CitizenReport.id == r.id))).first()
        if row:
            o.lon, o.lat = float(row[0]), float(row[1])
        outs.append(o)
    return outs


@router.patch("/{report_id}/verify", response_model=ReportOut)
async def verify_report(
    report_id: uuid.UUID,
    decision: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_roles(*OPS_ROLES)),
):
    if decision not in ("verified", "rejected"):
        raise HTTPException(422, "decision must be verified|rejected")
    report = await db.get(CitizenReport, report_id)
    if report is None:
        raise HTTPException(404, "Report not found")
    report.status = decision
    report.verified_by = user.id
    report.risk_contribution = 0.05 if decision == "verified" else 0.0
    await db.commit()
    await db.refresh(report)
    return ReportOut.model_validate(report)

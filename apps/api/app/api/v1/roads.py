import math

import networkx as nx
from fastapi import APIRouter, Depends, HTTPException
from geoalchemy2 import functions as gfunc
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.db.session import get_db
from app.models import RoadStatus
from app.schemas.schemas import DetourOut, RoadStatusOut

router = APIRouter(prefix="/roads", tags=["roads"])

BLOCKING_STATUSES = {"predicted_blocked", "confirmed_blocked"}


@router.get("/status", response_model=list[RoadStatusOut])
async def road_status(bbox: str | None = None, db: AsyncSession = Depends(get_db)):
    q = select(RoadStatus)
    if bbox:
        try:
            minlon, minlat, maxlon, maxlat = [float(x) for x in bbox.split(",")]
        except ValueError:
            raise HTTPException(422, "bbox must be minlon,minlat,maxlon,maxlat")
        env = gfunc.ST_MakeEnvelope(minlon, minlat, maxlon, maxlat, 4326)
        q = q.where(gfunc.ST_Intersects(RoadStatus.segment_geom, env))
    rows = (await db.execute(q)).scalars().all()
    return [
        RoadStatusOut(
            osm_way_id=r.osm_way_id,
            road_name=r.road_name,
            status=r.status,
            source=r.source,
            delay_min=r.delay_min,
        )
        for r in rows
    ]


def _haversine_km(lat1, lon1, lat2, lon2):
    R = 6371
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = math.radians(lat2 - lat1), math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * R * math.asin(math.sqrt(a))


@router.get("/detour", response_model=DetourOut)
async def detour(from_lat: float, from_lon: float, to_lat: float, to_lon: float,
                 db: AsyncSession = Depends(get_db), _user=Depends(get_current_user)):
    """Model E scaffold: build a graph from seeded road segments, drop blocked ones,
    route A* over the remainder. Swapped for full OSMnx graph in the ML phase."""
    roads = (await db.execute(select(RoadStatus))).scalars().all()
    G = nx.Graph()
    blocked_ids = []
    for r in roads:
        line = db.execute(
            select(gfunc.ST_AsText(RoadStatus.segment_geom)).where(RoadStatus.osm_way_id == r.osm_way_id)
        )
        row = (await line).first()
        if row is None:
            continue
        coords = _parse_linestring(row[0])
        if len(coords) < 2:
            continue
        if r.status in BLOCKING_STATUSES:
            blocked_ids.append(r.osm_way_id)
            continue
        for (a, b) in zip(coords, coords[1:]):
            d = _haversine_km(a[1], a[0], b[1], b[0])
            G.add_edge(a, b, weight=d)

    src, dst = (from_lon, from_lat), (to_lon, to_lat)
    G.add_node(src)
    G.add_node(dst)
    live_nodes = [n for n in G.nodes if n not in (src, dst)]
    if live_nodes:
        G.add_edge(src, min(live_nodes, key=lambda n: _haversine_km(from_lat, from_lon, n[1], n[0])), weight=0.5)
        G.add_edge(dst, min(live_nodes, key=lambda n: _haversine_km(to_lat, to_lon, n[1], n[0])), weight=0.5)

    try:
        path = nx.astar_path(G, src, dst, heuristic=lambda u, v: _haversine_km(u[1], u[0], v[1], v[0]), weight="weight")
    except nx.NetworkXNoPath:
        raise HTTPException(409, "No open route between points")

    dist = sum(_haversine_km(a[1], a[0], b[1], b[0]) for a, b in zip(path, path[1:]))
    return DetourOut(
        from_point=[from_lon, from_lat],
        to_point=[to_lon, to_lat],
        distance_km=round(dist, 1),
        delay_min=int(dist * 2.5),
        geometry=[[p[0], p[1]] for p in path],
        blocked_segments=blocked_ids,
    )


def _parse_linestring(wkt: str) -> list[tuple[float, float]]:
    body = wkt[wkt.index("(") + 1 : wkt.rindex(")")]
    out = []
    for pair in body.split(","):
        lon, lat = pair.strip().split()
        out.append((float(lon), float(lat)))
    return out

from __future__ import annotations
import httpx
from app.config import get_settings

async def fetch_station_observations(station_id: str, start_iso: str, end_iso: str) -> dict:
    settings = get_settings()
    url = f"{settings.met_api_base_url.rstrip('/')}/collections/observations-swob-nrt-60min/locations/{station_id}"
    params = {"datetime": f"{start_iso}/{end_iso}", "f": "json"}
    async with httpx.AsyncClient(timeout=settings.request_timeout_seconds) as client:
        r = await client.get(url, params=params); r.raise_for_status(); return r.json()

from __future__ import annotations
import httpx
from app.config import get_settings

async def epa_get(path: str, params: dict | None = None) -> dict:
    settings = get_settings()
    url = f"{settings.epa_base_url.rstrip('/')}/{path.lstrip('/')}"
    async with httpx.AsyncClient(timeout=settings.request_timeout_seconds) as client:
        r = await client.get(url, params=params); r.raise_for_status(); return r.json()

from typing import Any
import httpx
from app.config import get_settings

class GeocoderError(RuntimeError):
    pass

async def geocode(address: str) -> dict[str, Any]:
    settings = get_settings()
    if settings.geocoder_provider == "mock":
        raise GeocoderError("Mock geocoder selected; provide latitude/longitude in the request.")
    url = f"{settings.geocoder_base_url.rstrip('/')}/search"
    headers = {"User-Agent": settings.geocoder_user_agent}
    params = {"q": address, "format": "jsonv2", "limit": 1, "countrycodes": "ie"}
    async with httpx.AsyncClient(timeout=settings.request_timeout_seconds, headers=headers) as client:
        response = await client.get(url, params=params)
        response.raise_for_status()
        data = response.json()
    if not data:
        raise GeocoderError(f"No Irish geocoding result for: {address}")
    item = data[0]
    return {
        "latitude": float(item["lat"]),
        "longitude": float(item["lon"]),
        "display_name": item.get("display_name"),
        "provider": settings.geocoder_provider,
        "confidence": item.get("importance")
    }

"""Calls Person 4's FastAPI backend over HTTP."""
from __future__ import annotations

from typing import Any

import httpx

from rentcheck_agents.tools.base import ToolError


class HttpToolClient:
    name = "http"

    def __init__(self, base_url: str, timeout: float = 20.0):
        self._client = httpx.AsyncClient(base_url=base_url.rstrip("/"), timeout=timeout)

    async def _get(self, tool: str, path: str, **params: Any) -> dict[str, Any]:
        params = {k: v for k, v in params.items() if v is not None}
        try:
            r = await self._client.get(path, params=params)
        except httpx.HTTPError as exc:
            raise ToolError(tool, f"backend unreachable: {exc}") from exc
        if r.status_code >= 400:
            raise ToolError(tool, r.text[:300], r.status_code)
        return r.json()

    async def create_property(self, payload: dict[str, Any]) -> dict[str, Any]:
        try:
            r = await self._client.post("/property", json=payload)
        except httpx.HTTPError as exc:
            raise ToolError("createProperty", f"backend unreachable: {exc}") from exc
        if r.status_code >= 400:
            raise ToolError("createProperty", r.text[:300], r.status_code)
        return r.json()

    async def get_property(self, property_id):
        return await self._get("getProperty", f"/agent/getProperty/{property_id}")

    async def rental_comparables(self, property_id, bedrooms=None, property_type=None, period=None):
        return await self._get("getRentalComparables", f"/agent/getRentalComparables/{property_id}",
                               bedrooms=bedrooms, property_type=property_type, period=period)

    async def rental_history(self, property_id, years=5):
        return await self._get("getRentalHistory", f"/agent/getRentalHistory/{property_id}", years=years)

    async def nearby_transport(self, property_id, radius_m=500):
        return await self._get("getNearbyTransport", f"/agent/getNearbyTransport/{property_id}", radius_m=radius_m)

    async def neighbourhood(self, property_id):
        return await self._get("getNeighbourhoodData", f"/agent/getNeighbourhoodData/{property_id}")

    async def nearby_planning(self, property_id, radius_m=1000):
        return await self._get("getNearbyPlanning", f"/agent/getNearbyPlanning/{property_id}", radius_m=radius_m)

    async def property_sales(self, property_id, radius_m=1000, years=10):
        return await self._get("getPropertySales", f"/agent/getPropertySales/{property_id}", radius_m=radius_m, years=years)

    async def aclose(self):
        await self._client.aclose()

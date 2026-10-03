"""Calls Person 4's service layer directly. Use when this package is mounted inside their FastAPI app
(avoids the app making HTTP calls to itself). Requires Person 4's `app` package on the import path."""
from __future__ import annotations

import asyncio
from typing import Any

from rentcheck_agents.tools.base import ToolError, jsonable


class InProcessToolClient:
    name = "inprocess"

    def __init__(self):
        from app.services import (  # type: ignore[import-not-found]
            neighbourhood_service, planning_service, property_service, rental_service, sales_service, transport_service,
        )
        self._prop, self._rent, self._tr = property_service, rental_service, transport_service
        self._plan, self._nb, self._sales = planning_service, neighbourhood_service, sales_service

    async def _run(self, tool: str, fn, *args) -> dict[str, Any]:
        try:
            return jsonable(await asyncio.to_thread(fn, *args))
        except ToolError:
            raise
        except Exception as exc:  # backend raised; surface as a tool failure, not a crash
            raise ToolError(tool, str(exc)) from exc

    async def _doc(self, property_id: str) -> dict[str, Any]:
        doc = await asyncio.to_thread(self._prop.get_property, property_id)
        if not doc:
            raise ToolError("getProperty", "Property not found", 404)
        return doc

    async def create_property(self, payload):
        try:
            return jsonable(await self._prop.create_property(payload))
        except Exception as exc:
            raise ToolError("createProperty", str(exc), 502) from exc

    async def get_property(self, property_id):
        return jsonable(await self._doc(property_id))

    async def rental_comparables(self, property_id, bedrooms=None, property_type=None, period=None):
        return await self._run("getRentalComparables", self._rent.rental_comparables, await self._doc(property_id), bedrooms, property_type, period)

    async def rental_history(self, property_id, years=5):
        return await self._run("getRentalHistory", self._rent.rental_history, await self._doc(property_id), years)

    async def nearby_transport(self, property_id, radius_m=500):
        return await self._run("getNearbyTransport", self._tr.nearby_transport, await self._doc(property_id), radius_m)

    async def neighbourhood(self, property_id):
        return await self._run("getNeighbourhoodData", self._nb.neighbourhood_data, await self._doc(property_id))

    async def nearby_planning(self, property_id, radius_m=1000):
        return await self._run("getNearbyPlanning", self._plan.nearby_planning, await self._doc(property_id), radius_m)

    async def property_sales(self, property_id, radius_m=1000, years=10):
        return await self._run("getPropertySales", self._sales.property_sales, await self._doc(property_id), radius_m, years)

    async def aclose(self):
        return None

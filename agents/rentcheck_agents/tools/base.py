"""The ToolClient protocol mirrors Person 4's agent tool endpoints (/property, /agent/*).

Agents never talk to MongoDB directly; every data access goes through one of these methods so the
backend owns queries, indexes and provenance.
"""
from __future__ import annotations

import json
from typing import Any, Protocol


class ToolError(RuntimeError):
    def __init__(self, tool: str, message: str, status: int | None = None):
        super().__init__(f"{tool}: {message}")
        self.tool = tool
        self.status = status


class ToolClient(Protocol):
    name: str

    async def create_property(self, payload: dict[str, Any]) -> dict[str, Any]: ...
    async def get_property(self, property_id: str) -> dict[str, Any]: ...
    async def rental_comparables(self, property_id: str, bedrooms: int | None = None,
                                 property_type: str | None = None, period: str | None = None) -> dict[str, Any]: ...
    async def rental_history(self, property_id: str, years: int = 5) -> dict[str, Any]: ...
    async def nearby_transport(self, property_id: str, radius_m: int = 500) -> dict[str, Any]: ...
    async def neighbourhood(self, property_id: str) -> dict[str, Any]: ...
    async def nearby_planning(self, property_id: str, radius_m: int = 1000) -> dict[str, Any]: ...
    async def property_sales(self, property_id: str, radius_m: int = 1000, years: int = 10) -> dict[str, Any]: ...
    async def aclose(self) -> None: ...


def jsonable(value: Any) -> Any:
    """Make Mongo/py objects (datetime, ObjectId) JSON-safe, matching what the HTTP API returns."""
    return json.loads(json.dumps(value, default=str))


def get_tool_client(kind: str | None = None) -> ToolClient:
    from rentcheck_agents.config import get_settings

    kind = (kind or get_settings().tool_client).lower()
    if kind == "http":
        from rentcheck_agents.tools.http_client import HttpToolClient
        return HttpToolClient(get_settings().rentcheck_api_url)
    if kind == "inprocess":
        from rentcheck_agents.tools.inprocess_client import InProcessToolClient
        return InProcessToolClient()
    if kind == "mock":
        from rentcheck_agents.tools.mock_client import MockToolClient
        return MockToolClient()
    raise ValueError(f"Unknown TOOL_CLIENT {kind!r} (expected http | inprocess | mock)")

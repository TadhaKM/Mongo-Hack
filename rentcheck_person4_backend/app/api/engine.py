"""Gateway to Person 1's MongoDB engine (the Node service in ../db, `npm run engine`).

The engine computes comparables, rent trends, geography, transport and planning inside MongoDB and returns the same
envelope everywhere: {ok, data, evidence[], coverage, warnings[]}. These routes forward to it unchanged so the frontend and
the agents can use the evidence-backed results through this single API. Disabled (503) until ENGINE_URL is set.
"""
from __future__ import annotations
import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from app.config import get_settings

router = APIRouter(prefix="/engine", tags=["engine"])


class ToolRequest(BaseModel):
    params: dict = Field(default_factory=dict)
    analysis_id: str | None = Field(default=None, description="engine analysis id; if given the result and evidence are stored on it")


def _base() -> str:
    url = get_settings().engine_url
    if not url:
        raise HTTPException(status_code=503, detail="Engine not configured. Set ENGINE_URL (e.g. http://localhost:8787) and run `npm run engine`.")
    return url.rstrip("/")


def _request(method: str, path: str, json: dict | None = None) -> dict:
    try:
        r = httpx.request(method, _base() + path, json=json, timeout=get_settings().request_timeout_seconds)
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"Engine unreachable: {exc}") from exc
    if r.status_code >= 400:
        raise HTTPException(status_code=r.status_code if r.status_code in (404, 422) else 502, detail=r.json().get("error", r.text) if r.headers.get("content-type", "").startswith("application/json") else r.text)
    return r.json()


@router.get("/health")
def engine_health():
    return _request("GET", "/health")


@router.post("/analyses", status_code=201)
def engine_start_analysis(body: dict):
    """Body: {"input": {address, latitude, longitude, monthlyRent, bedrooms, propertyType, floorArea, analysisDate}}."""
    return _request("POST", "/analyses", body)


@router.get("/analyses/{analysis_id}")
def engine_get_analysis(analysis_id: str):
    return _request("GET", f"/analyses/{analysis_id}")


@router.post("/tools/{tool}")
def engine_tool(tool: str, body: ToolRequest):
    """e.g. rentalComparables, rentalTrend, rentContext, nearbyTransport, nearbyPlanning, verifyClaims (see GET /engine/health)."""
    return _request("POST", f"/tools/{tool}", {"params": body.params, **({"analysisId": body.analysis_id} if body.analysis_id else {})})

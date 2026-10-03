"""FastAPI surface for the agent layer.

Mount inside Person 4's app:
    from rentcheck_agents.api import router as ai_router
    app.include_router(ai_router)            # set TOOL_CLIENT=inprocess
or run standalone (calls Person 4's API over HTTP, or the mock):
    uvicorn rentcheck_agents.api:app --port 8001
"""
from __future__ import annotations

import json

from fastapi import APIRouter, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

from rentcheck_agents.models import PropertyInput
from rentcheck_agents.pipeline import analyse, run_analysis
from rentcheck_agents.store import get_store

router = APIRouter(prefix="/ai", tags=["ai-agents"])


@router.post("/analyse")
async def analyse_stream(payload: PropertyInput):
    """Server-Sent Events: one `data: {event json}` line per progress event, ending with type=report (or error)."""
    async def gen():
        async for ev in run_analysis(payload):
            yield f"event: {ev.type}\ndata: {ev.model_dump_json()}\n\n"
    return StreamingResponse(gen(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@router.post("/analyse/sync")
async def analyse_sync(payload: PropertyInput):
    report, events = await analyse(payload)
    if report is None:
        err = next((e for e in events if e.type == "error"), None)
        raise HTTPException(status_code=422, detail=err.detail if err else "analysis failed")
    return {"analysis_id": report.analysis_id, "report": json.loads(report.model_dump_json()),
            "events": [json.loads(e.model_dump_json()) for e in events]}


@router.get("/analysis/{analysis_id}")
async def get_analysis(analysis_id: str):
    doc = await get_store().get(analysis_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Analysis not found")
    return json.loads(json.dumps(doc, default=str))


@router.get("/health")
async def health():
    from rentcheck_agents.config import get_settings
    from rentcheck_agents.llm import llm_available
    s = get_settings()
    return {"status": "ok", "tool_client": s.tool_client, "llm": llm_available(), "model": s.gemini_model}


app = FastAPI(title="mend.ai agents", version="0.1.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])
app.include_router(router)

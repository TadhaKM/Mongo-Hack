from fastapi import APIRouter
from app.db.mongodb import collection

router=APIRouter(tags=["system"])

@router.get("/sources")
def sources():
    return {"sources": list(collection("data_sources").find({}, {"_id": 0}).sort("id", 1))}

@router.get("/ingestion/runs")
def ingestion_runs(limit: int = 20):
    docs=list(collection("ingestion_runs").find({}, {"_id": 1, "dataset": 1, "status": 1, "started_at": 1, "result": 1, "error": 1}).sort("started_at", -1).limit(limit))
    return {"runs": docs}

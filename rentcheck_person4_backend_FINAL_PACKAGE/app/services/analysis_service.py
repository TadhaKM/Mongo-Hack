from datetime import datetime, timezone
from uuid import uuid4
from app.db.mongodb import collection
from app.services.transport_service import nearby_transport
from app.services.planning_service import nearby_planning
from app.services.rental_service import rental_comparables, rental_history
from app.services.neighbourhood_service import neighbourhood_data
from app.services.sales_service import property_sales
from app.services.property_service import get_property

def create_analysis(property_id: str, requested: list[str]) -> dict:
    property_doc = get_property(property_id)
    if not property_doc:
        raise ValueError("Property not found")
    analysis_id = f"analysis_{uuid4().hex[:12]}"
    result = {"_id": analysis_id, "property_id": property_id, "status": "complete", "created_at": datetime.now(timezone.utc), "requested": requested, "evidence": {}}
    if "rental" in requested:
        result["evidence"]["rental"] = rental_comparables(property_doc)
    if "transport" in requested:
        result["evidence"]["transport"] = nearby_transport(property_doc)
    if "planning" in requested:
        result["evidence"]["planning"] = nearby_planning(property_doc)
    if "neighbourhood" in requested:
        result["evidence"]["neighbourhood"] = neighbourhood_data(property_doc)
    if "sales" in requested:
        result["evidence"]["sales"] = property_sales(property_doc)
    result["sources"] = _collect_sources(result["evidence"])
    collection("analyses").replace_one({"_id": analysis_id}, result, upsert=True)
    return {**result, "analysis_id": result.pop("_id")}

def get_analysis(analysis_id: str):
    doc = collection("analyses").find_one({"_id": analysis_id})
    if doc: doc["analysis_id"] = doc.pop("_id")
    return doc

def _collect_sources(evidence: dict) -> list[dict]:
    sources = []
    seen = set()
    def walk(value):
        if isinstance(value, dict):
            src = value.get("source")
            if isinstance(src, dict) and src.get("dataset"):
                key = (src.get("dataset"), src.get("source_url"))
                if key not in seen:
                    seen.add(key); sources.append(src)
            for v in value.values(): walk(v)
        elif isinstance(value, list):
            for v in value: walk(v)
    walk(evidence)
    return sources

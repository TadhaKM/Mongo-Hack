from datetime import datetime, timezone
from uuid import uuid4
from app.db.mongodb import collection
from app.geo.boundaries import resolve_geographies
from app.geo.geocoder import geocode
from app.geo.normalise import normalise_address

async def create_property(payload: dict) -> dict:
    address = payload["address"]
    lon, lat = payload.get("longitude"), payload.get("latitude")
    geo = None
    if lat is None or lon is None:
        geo = await geocode(address)
        lat, lon = geo["latitude"], geo["longitude"]
    else:
        geo = {"provider": "user_supplied", "confidence": 1.0, "display_name": address}
    geography = resolve_geographies(lon, lat)
    pid = f"property_{uuid4().hex[:12]}"
    doc = {
        "_id": pid,
        "address": {"raw": address, "normalised": normalise_address(address), "eircode": payload.get("eircode"), "postal_area": payload.get("postal_area")},
        "location": {"type": "Point", "coordinates": [lon, lat]},
        "geography": geography,
        "property_attributes": {"property_type": payload.get("property_type"), "bedrooms": payload.get("bedrooms")},
        "geocode": {**geo, "retrieved_at": datetime.now(timezone.utc)},
        "source": {"organisation": "RentCheck user input", "dataset": "user_property", "retrieved_at": datetime.now(timezone.utc)},
    }
    collection("properties").insert_one(doc)
    doc["property_id"] = pid
    return doc

def get_property(property_id: str) -> dict | None:
    doc = collection("properties").find_one({"_id": property_id})
    if doc:
        doc["property_id"] = doc.pop("_id")
    return doc

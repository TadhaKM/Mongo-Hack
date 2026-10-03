from app.db.mongodb import collection
from app.geo.distance import haversine_m

def nearby_planning(property_doc: dict, radius_m: int = 1000, limit: int = 100) -> dict:
    point = property_doc["location"]
    docs = collection("planning_applications").find({"location": {"$near": {"$geometry": point, "$maxDistance": radius_m}}}).limit(limit)
    property_lon, property_lat = point["coordinates"]
    apps = []
    for doc in docs:
        coords = doc.get("location", {}).get("coordinates", [None, None])
        dist = None if coords[0] is None else round(haversine_m(property_lon, property_lat, coords[0], coords[1]), 1)
        apps.append({
            "application_ref": doc.get("application_ref"),
            "location": doc.get("location"),
            "application_date": doc.get("application_date"),
            "decision": doc.get("decision"),
            "status": doc.get("status"),
            "proposal": doc.get("proposal"),
            "num_residential_units": doc.get("num_residential_units"),
            "distance_m": dist,
            "source": doc.get("source", {})
        })
    return {"radius_m": radius_m, "applications": apps, "count": len(apps)}

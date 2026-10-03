from typing import Any
from app.db.mongodb import collection

def resolve_geographies(lon: float, lat: float) -> dict[str, Any]:
    point = {"type": "Point", "coordinates": [lon, lat]}
    result = {}
    for collection_name, output_name in [
        ("small_areas", "small_area"),
        ("electoral_divisions", "electoral_division"),
        ("local_electoral_areas", "local_electoral_area"),
        ("local_authorities", "local_authority"),
        ("counties", "county"),
    ]:
        doc = collection(collection_name).find_one({"geometry": {"$geoIntersects": {"$geometry": point}}}, {"code": 1, "name": 1})
        result[output_name] = {"code": doc.get("code"), "name": doc.get("name")} if doc else {"code": None, "name": None}
    return result

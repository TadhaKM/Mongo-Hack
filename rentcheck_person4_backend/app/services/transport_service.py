from app.db.mongodb import collection
from app.geo.distance import haversine_m

def nearby_transport(property_doc: dict, radius_m: int = 500, limit: int = 50) -> dict:
    point = property_doc["location"]
    cursor = collection("transport_stops").find({"location": {"$near": {"$geometry": point, "$maxDistance": radius_m}}}).limit(limit)
    stops = []
    route_ids = set()
    property_lon, property_lat = point["coordinates"]
    for doc in cursor:
        coords = doc["location"]["coordinates"]
        distance_m = round(haversine_m(property_lon, property_lat, coords[0], coords[1]), 1)
        stop_routes = doc.get("route_ids", [])
        route_ids.update(stop_routes)
        stops.append({
            "stop_id": doc.get("stop_id"),
            "name": doc.get("name"),
            "distance_m": distance_m,
            "modes": doc.get("transport_modes", []),
            "routes": stop_routes,
            "location": {"type": "Point", "coordinates": coords}
        })
    nearest = stops[0]["distance_m"] if stops and stops[0]["distance_m"] is not None else None
    return {"radius_m": radius_m, "stops": stops, "stops_within_radius": len(stops), "routes_within_radius": sorted(route_ids), "nearest_stop_distance_m": nearest}

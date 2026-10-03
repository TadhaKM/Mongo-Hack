from app.db.mongodb import collection
from app.geo.normalise import normalise_address

def property_sales(property_doc: dict, radius_m: int = 1000, years: int = 10, limit: int = 50) -> dict:
    point = property_doc["location"]
    address = property_doc.get("address", {}).get("normalised")
    docs = []
    if address:
        docs.extend(collection("property_sales").find({"address.normalised": address}).sort("sale_date", -1).limit(limit))
    geo_cursor = collection("property_sales").find({"location": {"$near": {"$geometry": point, "$maxDistance": radius_m}}}).sort("sale_date", -1).limit(limit)
    seen = {d.get("_record_key") or str(d.get("_id")) for d in docs}
    for d in geo_cursor:
        k=d.get("_record_key") or str(d.get("_id"))
        if k not in seen:
            docs.append(d); seen.add(k)
        if len(docs) >= limit: break
    results = []
    for doc in docs:
        doc.pop("_id", None)
        doc["interpretation_note"] = "Historical sales evidence only; do not treat sale price as rental value."
        results.append(doc)
    return {"radius_m": radius_m, "years_requested": years, "results": results, "count": len(results)}

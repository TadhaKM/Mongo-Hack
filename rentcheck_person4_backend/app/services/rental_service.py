from app.db.mongodb import collection

def _period_parts(period: str | None):
    if not period or "-Q" not in period:
        return None, None
    year, q = period.split("-Q", 1)
    try:
        return int(year), int(q)
    except ValueError:
        return None, None

def rental_comparables(property_doc: dict, bedrooms=None, property_type=None, period=None, limit=10) -> dict:
    bedrooms = bedrooms if bedrooms is not None else property_doc.get("property_attributes", {}).get("bedrooms")
    property_type = property_type if property_type is not None else property_doc.get("property_attributes", {}).get("property_type")
    geography = property_doc.get("geography", {}).get("rtb_area", {})
    query = {}
    if geography.get("code"): query["geography.code"] = geography["code"]
    if bedrooms is not None: query["property.bedrooms"] = bedrooms
    if property_type: query["property.type"] = property_type
    year, quarter = _period_parts(period)
    if year: query["period.year"] = year
    if quarter: query["period.quarter"] = quarter

    docs = list(collection("rent_index").find(query).sort([("period.year", -1), ("period.quarter", -1)]).limit(limit))
    match_type = "exact"
    if not docs and property_type:
        query.pop("property.type", None)
        docs = list(collection("rent_index").find(query).sort([("period.year", -1), ("period.quarter", -1)]).limit(limit))
        match_type = "property_type_relaxed"
    if not docs and bedrooms is not None:
        query.pop("property.bedrooms", None)
        docs = list(collection("rent_index").find(query).sort([("period.year", -1), ("period.quarter", -1)]).limit(limit))
        match_type = "bedroom_relaxed"
    results = []
    for doc in docs:
        doc.pop("_id", None)
        doc["match"] = {"method": match_type, "geography": "exact" if geography.get("code") else "unresolved"}
        results.append(doc)
    return {"query": {"bedrooms": bedrooms, "property_type": property_type, "period": period}, "results": results, "count": len(results)}

def rental_history(property_doc: dict, years: int = 5) -> dict:
    geography = property_doc.get("geography", {}).get("rtb_area", {})
    query = {"geography.code": geography.get("code")} if geography.get("code") else {}
    docs = list(collection("rent_index").find(query).sort([("period.year", -1), ("period.quarter", -1)]).limit(years * 4))
    for doc in docs: doc.pop("_id", None)
    return {"years_requested": years, "results": docs, "count": len(docs)}

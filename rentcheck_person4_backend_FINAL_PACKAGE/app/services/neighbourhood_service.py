from app.db.mongodb import collection

def neighbourhood_data(property_doc: dict) -> dict:
    geography = property_doc.get("geography", {})
    small_area = geography.get("small_area", {}).get("code")
    vacancy = None
    if small_area:
        vacancy = collection("vacancy").find_one({"geography.code": small_area}, {"_id": 0})
    census = None
    if small_area:
        census = collection("census_saps").find_one({"small_area_code": small_area}, {"_id": 0})
    return {"small_area": geography.get("small_area"), "census": census, "vacancy": vacancy}

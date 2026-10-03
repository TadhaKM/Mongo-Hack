from app.db.mongodb import get_db

def ensure_indexes() -> None:
    db = get_db()
    for name in ["properties", "transport_stops", "planning_applications", "property_sales"]:
        db[name].create_index([("location", "2dsphere")], name="location_2dsphere")
    for name in ["small_areas", "electoral_divisions", "local_electoral_areas", "local_authorities", "counties", "rtb_areas"]:
        db[name].create_index([("geometry", "2dsphere")], name="geometry_2dsphere")
    db.rent_index.create_index(
        [("geography.code", 1), ("period.year", 1), ("period.quarter", 1), ("property.bedrooms", 1), ("property.type", 1)],
        name="rent_lookup"
    )
    for name in ["analyses", "data_sources", "ingestion_runs"]:
        db[name].create_index([("_id", 1)], name="id")
    # Importers upsert on `_record_key`. Without an index every upsert scans the whole collection (a 90k-row load never finished).
    # Partial, so API-created documents without the key (properties, analyses) are unaffected.
    for name in ["transport_stops", "planning_applications", "property_sales", "rent_index", "census_saps", "vacancy",
                 "small_areas", "electoral_divisions", "local_electoral_areas", "local_authorities", "counties", "rtb_areas"]:
        db[name].create_index([("_record_key", 1)], name="record_key", unique=True, partialFilterExpression={"_record_key": {"$exists": True}})
    db.properties.create_index([("address.normalised", 1)], name="address_normalised")
    db.property_sales.create_index([("sale_date", -1)], name="sale_date_desc")
    db.planning_applications.create_index([("application_date", -1)], name="planning_date_desc")

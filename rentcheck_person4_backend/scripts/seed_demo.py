#!/usr/bin/env python3
from pathlib import Path
import sys
from datetime import datetime, timezone
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.db.mongodb import get_db
from app.db.indexes import ensure_indexes

now=datetime.now(timezone.utc)

def put(name, docs):
    c=get_db()[name]
    for d in docs: c.replace_one({"_record_key":d["_record_key"]}, d, upsert=True)

ensure_indexes()
put("properties", [{"_record_key":"property:demo","_id":"property_demo","address":{"raw":"25 Example Street, Dublin 8","normalised":"25 EXAMPLE STREET DUBLIN 8","eircode":None},"location":{"type":"Point","coordinates":[-6.3000,53.3400]},"geography":{"small_area":{"code":"SA-DEMO","name":"Demo Small Area"},"rtb_area":{"code":"RTB-DEMO","name":"Demo Rental Area"},"county":{"code":"D","name":"Dublin"},"local_authority":{"code":"DCC","name":"Dublin City Council"}},"property_attributes":{"property_type":"apartment","bedrooms":2},"source":{"dataset":"demo"},"geocode":{"provider":"demo","retrieved_at":now}}])
put("transport_stops", [
 {"_record_key":"nta_gtfs:demo1","stop_id":"DEMO1","name":"Example Stop","location":{"type":"Point","coordinates":[-6.2990,53.3410]},"transport_modes":["bus"],"route_ids":["40","140"],"source":{"dataset":"NTA GTFS","organisation":"National Transport Authority","source_url":"https://www.transportforireland.ie/transitData/PT_Data.html","retrieved_at":now}},
 {"_record_key":"nta_gtfs:demo2","stop_id":"DEMO2","name":"Example Station","location":{"type":"Point","coordinates":[-6.2950,53.3430]},"transport_modes":["rail"],"route_ids":["DART"],"source":{"dataset":"NTA GTFS","organisation":"National Transport Authority","source_url":"https://www.transportforireland.ie/transitData/PT_Data.html","retrieved_at":now}}
])
put("planning_applications", [{"_record_key":"planning:DEMO123","application_ref":"DEMO123","location":{"type":"Point","coordinates":[-6.3040,53.3430]},"application_date":"2026-05-12","decision":"Grant","status":"Decision made","proposal":"Construction of 48 apartments and associated works.","source":{"dataset":"National Planning Applications","organisation":"Department of Housing, Local Government and Heritage","source_url":"https://services.arcgis.com/NzlPQPKn5QF9v2US/arcgis/rest/services/IrishPlanningApplications/FeatureServer","retrieved_at":now}}])
put("rent_index", [{"_record_key":"rent:demo:2026Q1","geography":{"code":"RTB-DEMO","name":"Demo Rental Area","type":"rtb_rental_area"},"period":{"year":2026,"quarter":1},"property":{"type":"apartment","bedrooms":2},"rent":{"monthly_eur":2100,"measure":"average"},"validation":{"status":"ok","issues":[]},"source":{"dataset":"RTB/ESRI Rent Index","organisation":"Residential Tenancies Board / ESRI","source_url":"https://rtb.ie/data-insights/rtb-data-hub/rtb-esri-rent-index-data-set/","retrieved_at":now,"dataset_date":"2026-Q1"}}])
put("census_saps", [{"_record_key":"census_2022_saps:SA-DEMO","small_area_code":"SA-DEMO","values":{"population_total":520,"private_rented_pct":42.0,"car_available_pct":49.0},"source":{"dataset":"Census 2022 SAPS","organisation":"Central Statistics Office","source_url":"https://www.cso.ie/en/census/census2022/census2022smallareapopulationstatistics/","retrieved_at":now,"dataset_date":2022}}])
put("vacancy", [{"_record_key":"cso_fp010:SA-DEMO","geography":{"code":"SA-DEMO"},"values":{"vacancy_rate_pct":6.8},"data_year":2022,"source":{"dataset":"CSO FP010","organisation":"Central Statistics Office","source_url":"https://data.gov.ie/dataset/fp010-housing-stock-and-vacant-dwellings-2022","retrieved_at":now,"dataset_date":2022}}])
put("property_sales", [{"_record_key":"ppr:demo1","sale_date":"2025-09-10","price":{"amount_eur":385000},"address":{"raw":"25 Example Street, Dublin 8","normalised":"25 EXAMPLE STREET DUBLIN 8"},"source":{"dataset":"Residential Property Price Register","organisation":"Property Services Regulatory Authority","source_url":"https://propertypriceregister.ie/website/npsra/pprweb.nsf/page/ppr-home-en","retrieved_at":now}}])

# ---- DEMO boundaries: square polygons around the demo point so map clicks nearby resolve to the demo areas.
def square(lon, lat, d_lon, d_lat):
    return {"type": "Polygon", "coordinates": [[[lon-d_lon, lat-d_lat], [lon+d_lon, lat-d_lat], [lon+d_lon, lat+d_lat], [lon-d_lon, lat+d_lat], [lon-d_lon, lat-d_lat]]]}
demo_src = {"dataset": "demo_boundaries", "organisation": "RentCheck demo (not official boundaries)", "retrieved_at": now}
put("small_areas", [{"_record_key": "boundary:SA-DEMO", "code": "SA-DEMO", "name": "Demo Small Area", "geometry": square(-6.3000, 53.3400, 0.012, 0.008), "source": demo_src}])
put("rtb_areas", [{"_record_key": "boundary:RTB-DEMO", "code": "RTB-DEMO", "name": "Demo Rental Area", "geometry": square(-6.3000, 53.3400, 0.03, 0.02), "source": demo_src}])
put("local_authorities", [{"_record_key": "boundary:DCC", "code": "DCC", "name": "Dublin City Council", "geometry": square(-6.27, 53.35, 0.12, 0.07), "source": demo_src}])
put("counties", [{"_record_key": "boundary:D", "code": "D", "name": "Dublin", "geometry": square(-6.27, 53.35, 0.35, 0.25), "source": demo_src}])

# ---- DEMO rent series (illustrative values) so the agents can show a trend: 12 quarters x 1/2/3-bed apartments.
quarters = [(2023, 2), (2023, 3), (2023, 4), (2024, 1), (2024, 2), (2024, 3), (2024, 4), (2025, 1), (2025, 2), (2025, 3), (2025, 4), (2026, 1)]
rent_docs = []
for beds, base in [(1, 1700), (2, 1890), (3, 2350)]:
    for i, (y, q) in enumerate(quarters):
        if (beds, y, q) == (2, 2026, 1):
            continue  # already seeded above (rent:demo:2026Q1)
        rent_docs.append({"_record_key": f"rent:demo:{beds}bed:{y}Q{q}", "geography": {"code": "RTB-DEMO", "name": "Demo Rental Area", "type": "rtb_rental_area"},
                          "period": {"year": y, "quarter": q}, "property": {"type": "apartment", "bedrooms": beds},
                          "rent": {"monthly_eur": round(base * (1 + 0.0095 * i)), "measure": "average"},
                          "validation": {"status": "ok", "issues": []},
                          "source": {"dataset": "RTB/ESRI Rent Index", "organisation": "Residential Tenancies Board / ESRI", "source_url": "https://rtb.ie/data-insights/rtb-data-hub/rtb-esri-rent-index-data-set/", "retrieved_at": now, "dataset_date": f"{y}-Q{q}"}})
put("rent_index", rent_docs)
put("transport_stops", [
 {"_record_key":"nta_gtfs:demo3","stop_id":"DEMO3","name":"Example Luas Stop","location":{"type":"Point","coordinates":[-6.3025,53.3388]},"transport_modes":["tram"],"route_ids":["Red"],"source":{"dataset":"NTA GTFS","organisation":"National Transport Authority","source_url":"https://www.transportforireland.ie/transitData/PT_Data.html","retrieved_at":now}},
])
print("Demo data seeded. Try property_id=property_demo, or POST /ai/analyse with latitude 53.3400, longitude -6.3000")

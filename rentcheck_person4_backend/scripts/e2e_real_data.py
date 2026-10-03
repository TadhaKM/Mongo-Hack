#!/usr/bin/env python3
"""End-to-end check of the integrated API against REAL data (CSO RIQ02 loaded via `ingest.py riq02` + `ingest.py boundary`).

  MONGODB_URI=... MONGODB_DATABASE=rentcheck python scripts/e2e_real_data.py [lat lon bedrooms property_type monthly_rent]

Creates a property at a real coordinate, runs the data API analysis and the agent tools, and prints what real figures came back.
"""
import json, os, sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ.setdefault("TOOL_CLIENT", "inprocess")
from fastapi.testclient import TestClient
from app.main import app
from app.db.indexes import ensure_indexes

lat, lon = (float(sys.argv[1]), float(sys.argv[2])) if len(sys.argv) > 2 else (53.3438, -6.2546)   # Trinity College Dublin
beds = int(sys.argv[3]) if len(sys.argv) > 3 else 2
ptype = sys.argv[4] if len(sys.argv) > 4 else "apartment"
rent = float(sys.argv[5]) if len(sys.argv) > 5 else 2600

ensure_indexes()
c = TestClient(app)
p = c.post("/property", json={"address": "Trinity College Dublin (e2e)", "latitude": lat, "longitude": lon, "bedrooms": beds, "property_type": ptype}).json()
print("property:", p["property_id"], "| rtb_area:", p["geography"]["rtb_area"])
a = c.post("/analyse", json={"property_id": p["property_id"], "requested_analysis": ["rental"]}).json()
rental = a["evidence"]["rental"]
print("rental match:", rental["results"][0]["match"] if rental["results"] else "NO RESULTS", "| rows:", rental["count"])
for r in rental["results"][:3]:
    print("  ", r["period"], r["property"], r["rent"]["monthly_eur"], "EUR |", r["source"]["dataset"], "|", r["source"]["source_url"])
h = c.get(f"/agent/getRentalHistory/{p['property_id']}?years=3").json()
print("history rows:", h["count"])
print("asking", rent, "vs latest RTB average", rental["results"][0]["rent"]["monthly_eur"] if rental["results"] else None)

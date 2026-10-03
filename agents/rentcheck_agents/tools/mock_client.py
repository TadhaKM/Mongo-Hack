"""Offline ToolClient. Re-implements Person 4's service logic over a JSON fixture so the agents can be
built and demoed without MongoDB. Response shapes match app/services/*.py exactly, including the
current behaviour where an unresolved rtb_area means rental queries carry no area filter."""
from __future__ import annotations

import copy
import json
from math import atan2, cos, radians, sin, sqrt
from pathlib import Path
from typing import Any
from uuid import uuid4

from rentcheck_agents.tools.base import ToolError

FIXTURE = Path(__file__).parent / "fixtures" / "demo.json"


def haversine_m(lon1, lat1, lon2, lat2) -> float:
    r = 6371008.8
    p1, p2 = radians(lat1), radians(lat2)
    a = sin(radians(lat2 - lat1) / 2) ** 2 + cos(p1) * cos(p2) * sin(radians(lon2 - lon1) / 2) ** 2
    return 2 * r * atan2(sqrt(a), sqrt(1 - a))


class MockToolClient:
    name = "mock"

    def __init__(self, fixture_path: Path = FIXTURE):
        self.data = json.loads(fixture_path.read_text())
        self.properties: dict[str, dict] = {}
        self.calls: list[tuple[str, dict]] = []

    # -- property ----------------------------------------------------------------
    async def create_property(self, payload):
        self.calls.append(("createProperty", payload))
        lat, lon = payload.get("latitude"), payload.get("longitude")
        if lat is None or lon is None:
            raise ToolError("createProperty", "Mock geocoder selected; provide latitude/longitude in the request.", 502)
        geography = copy.deepcopy(self.data["fallback_geography"])
        for area in self.data["areas"]:
            if haversine_m(lon, lat, *area["center"]) <= area["radius_m"]:
                geography = copy.deepcopy(area["geography"])
                break
        pid = f"property_{uuid4().hex[:12]}"
        doc = {"property_id": pid,
               "address": {"raw": payload.get("address"), "normalised": (payload.get("address") or "").upper(), "eircode": payload.get("eircode"), "postal_area": None},
               "location": {"type": "Point", "coordinates": [lon, lat]},
               "geography": geography,
               "property_attributes": {"property_type": payload.get("property_type"), "bedrooms": payload.get("bedrooms")},
               "geocode": {"provider": "user_supplied", "confidence": 1.0}}
        self.properties[pid] = doc
        return copy.deepcopy(doc)

    async def get_property(self, property_id):
        self.calls.append(("getProperty", {"property_id": property_id}))
        if property_id not in self.properties:
            raise ToolError("getProperty", "Property not found", 404)
        return copy.deepcopy(self.properties[property_id])

    def _p(self, pid):
        if pid not in self.properties:
            raise ToolError("tool", "Property not found", 404)
        return self.properties[pid]

    # -- rental (mirrors app/services/rental_service.py) ---------------------------
    def _rent_find(self, query: dict, limit: int):
        def ok(row):
            for k, v in query.items():
                cur = row
                for part in k.split("."):
                    cur = cur.get(part) if isinstance(cur, dict) else None
                if cur != v:
                    return False
            return True
        rows = [r for r in self.data["rent_index"] if ok(r)]
        rows.sort(key=lambda r: (r["period"]["year"], r["period"]["quarter"]), reverse=True)
        return copy.deepcopy(rows[:limit])

    async def rental_comparables(self, property_id, bedrooms=None, property_type=None, period=None, limit=10):
        self.calls.append(("getRentalComparables", {"bedrooms": bedrooms, "property_type": property_type, "period": period}))
        p = self._p(property_id)
        bedrooms = bedrooms if bedrooms is not None else p["property_attributes"].get("bedrooms")
        property_type = property_type if property_type is not None else p["property_attributes"].get("property_type")
        geo = p["geography"].get("rtb_area", {})
        query = {}
        if geo.get("code"): query["geography.code"] = geo["code"]
        if bedrooms is not None: query["property.bedrooms"] = bedrooms
        if property_type: query["property.type"] = property_type
        if period and "-Q" in period:
            y, q = period.split("-Q", 1)
            query["period.year"], query["period.quarter"] = int(y), int(q)
        docs, match = self._rent_find(query, limit), "exact"
        if not docs and property_type:
            query.pop("property.type", None); docs, match = self._rent_find(query, limit), "property_type_relaxed"
        if not docs and bedrooms is not None:
            query.pop("property.bedrooms", None); docs, match = self._rent_find(query, limit), "bedroom_relaxed"
        for d in docs:
            d["match"] = {"method": match, "geography": "exact" if geo.get("code") else "unresolved"}
        return {"query": {"bedrooms": bedrooms, "property_type": property_type, "period": period}, "results": docs, "count": len(docs)}

    async def rental_history(self, property_id, years=5):
        self.calls.append(("getRentalHistory", {"years": years}))
        geo = self._p(property_id)["geography"].get("rtb_area", {})
        query = {"geography.code": geo["code"]} if geo.get("code") else {}
        docs = self._rent_find(query, years * 4)
        return {"years_requested": years, "results": docs, "count": len(docs)}

    # -- spatial (mirrors transport/planning services) -----------------------------
    def _near(self, rows, pid, radius_m, limit):
        lon, lat = self._p(pid)["location"]["coordinates"]
        out = []
        for r in rows:
            c = r["location"]["coordinates"]
            d = haversine_m(lon, lat, c[0], c[1])
            if d <= radius_m:
                out.append((d, r))
        out.sort(key=lambda x: x[0])
        return [(round(d, 1), copy.deepcopy(r)) for d, r in out[:limit]]

    async def nearby_transport(self, property_id, radius_m=500, limit=50):
        self.calls.append(("getNearbyTransport", {"radius_m": radius_m}))
        stops, routes = [], set()
        for d, s in self._near(self.data["transport_stops"], property_id, radius_m, limit):
            routes.update(s["route_ids"])
            stops.append({"stop_id": s["stop_id"], "name": s["name"], "distance_m": d, "modes": s["transport_modes"],
                          "routes": s["route_ids"], "location": s["location"]})
        return {"radius_m": radius_m, "stops": stops, "stops_within_radius": len(stops),
                "routes_within_radius": sorted(routes), "nearest_stop_distance_m": stops[0]["distance_m"] if stops else None}

    async def nearby_planning(self, property_id, radius_m=1000, limit=100):
        self.calls.append(("getNearbyPlanning", {"radius_m": radius_m}))
        apps = [{"application_ref": a["application_ref"], "location": a["location"], "application_date": a["application_date"],
                 "decision": a["decision"], "status": a["status"], "proposal": a["proposal"], "distance_m": d, "source": a["source"]}
                for d, a in self._near(self.data["planning_applications"], property_id, radius_m, limit)]
        return {"radius_m": radius_m, "applications": apps, "count": len(apps)}

    async def neighbourhood(self, property_id):
        self.calls.append(("getNeighbourhoodData", {}))
        sa = self._p(property_id)["geography"].get("small_area", {})
        code = sa.get("code")
        census = next((copy.deepcopy(c) for c in self.data["census_saps"] if code and c["small_area_code"] == code), None)
        vacancy = next((copy.deepcopy(v) for v in self.data["vacancy"] if code and v["geography"]["code"] == code), None)
        return {"small_area": sa, "census": census, "vacancy": vacancy}

    async def property_sales(self, property_id, radius_m=1000, years=10):
        self.calls.append(("getPropertySales", {"radius_m": radius_m, "years": years}))
        return {"radius_m": radius_m, "years_requested": years, "results": copy.deepcopy(self.data["property_sales"]), "count": len(self.data["property_sales"])}

    async def aclose(self):
        return None

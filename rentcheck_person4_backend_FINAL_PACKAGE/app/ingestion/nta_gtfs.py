from __future__ import annotations
from pathlib import Path
from zipfile import ZipFile
from app.ingestion.base import DatasetImporter
from app.ingestion.utils import read_csv_rows, first, float_or_none, record_hash
import csv, io

GTFS_REQUIRED = ["agency.txt", "routes.txt", "trips.txt", "stops.txt", "stop_times.txt", "calendar.txt", "calendar_dates.txt"]

def rows_from_zip(z: ZipFile, filename: str):
    name = next((n for n in z.namelist() if n.lower().endswith(filename.lower())), None)
    if not name: return []
    with z.open(name) as f:
        return list(csv.DictReader(io.TextIOWrapper(f, encoding="utf-8-sig", newline="")))

class NtaGtfsImporter(DatasetImporter):
    dataset_id = "nta_gtfs"
    organisation = "National Transport Authority"
    collection_name = "transport_stops"

    def import_path(self, path, source_url=None):
        path = Path(path)
        files = list(path.glob("*.zip")) if path.is_dir() else [path]
        stops_total = 0
        routes_by_stop: dict[str, set[str]] = {}
        route_mode_by_id = {}
        agency_by_id = {}
        all_stop_docs = {}
        for zip_path in files:
            with ZipFile(zip_path) as z:
                agencies = rows_from_zip(z, "agency.txt")
                routes = rows_from_zip(z, "routes.txt")
                stops = rows_from_zip(z, "stops.txt")
                trips = rows_from_zip(z, "trips.txt")
                for a in agencies: agency_by_id[a.get("agency_id")] = a.get("agency_name")
                for r in routes:
                    rid = r.get("route_id")
                    route_mode_by_id[rid] = {"short_name": r.get("route_short_name"), "long_name": r.get("route_long_name"), "route_type": r.get("route_type"), "agency_id": r.get("agency_id"), "mode": route_type_to_mode(r.get("route_type"))}
                trip_to_route = {t.get("trip_id"): t.get("route_id") for t in trips}
                stop_times = rows_from_zip(z, "stop_times.txt")
                for st in stop_times:
                    sid, tid = st.get("stop_id"), st.get("trip_id")
                    rid = trip_to_route.get(tid)
                    if sid and rid: routes_by_stop.setdefault(sid, set()).add(rid)
                for s in stops:
                    lon, lat = float_or_none(s.get("stop_lon")), float_or_none(s.get("stop_lat"))
                    if lon is None or lat is None: continue
                    sid = s.get("stop_id")
                    all_stop_docs[sid] = {
                        "_record_key": f"{self.dataset_id}:{sid}",
                        "stop_id": sid,
                        "name": s.get("stop_name"),
                        "location": {"type": "Point", "coordinates": [lon, lat]},
                        "transport_modes": sorted({route_mode_by_id.get(r, {}).get("mode") for r in routes_by_stop.get(sid, set()) if route_mode_by_id.get(r, {}).get("mode")}),
                        "route_ids": sorted(routes_by_stop.get(sid, set())),
                        "route_details": [route_mode_by_id[r] for r in sorted(routes_by_stop.get(sid, set())) if r in route_mode_by_id],
                        "source": self.source_metadata(source_url or "https://www.transportforireland.ie/transitData/PT_Data.html")
                    }
        written = self.write(list(all_stop_docs.values()))
        return ImportResult(records_read=len(all_stop_docs), records_written=written)

def route_type_to_mode(route_type):
    mapping = {0: "tram", 1: "metro", 2: "rail", 3: "bus", 4: "ferry", 5: "cable_tram", 6: "aerial_lift", 7: "funicular", 11: "trolleybus", 12: "monorail"}
    try: return mapping.get(int(route_type), "other")
    except (ValueError, TypeError): return "other"

from __future__ import annotations
import json
from datetime import datetime, timezone
from pathlib import Path
import httpx
from app.ingestion.base import DatasetImporter
from app.ingestion.utils import first

OFFICIAL_POINTS = "https://services.arcgis.com/NzlPQPKn5QF9v2US/arcgis/rest/services/IrishPlanningApplications/FeatureServer/0/query"

class PlanningImporter(DatasetImporter):
    dataset_id = "national_planning_applications"
    organisation = "Department of Housing, Local Government and Heritage"
    collection_name = "planning_applications"

    def import_path(self, path=None, source_url=OFFICIAL_POINTS):
        if path:
            data = json.loads(Path(path).read_text(encoding="utf-8"))
        else:
            data = self._download_all(source_url)
        docs = []
        for feature in data.get("features", []):
            props = feature.get("properties") or feature.get("attributes") or {}
            geom = feature.get("geometry")
            point = self._to_point(geom)
            if not point: continue
            ref = first(props, "application_ref", "planning_ref", "applicationnumber", "app_no", "appnumber", default=None)
            if ref is None:
                ref = props.get("OBJECTID") or props.get("objectid")
            docs.append({
                "_record_key": f"{self.dataset_id}:{ref}",
                "application_ref": ref,
                "location": point,
                "application_date": first(props, "application_date", "date_received", "received_date", "date", default=None),
                "decision": first(props, "decision", "decision_description", default=None),
                "status": first(props, "status", "current_status", default=None),
                "proposal": first(props, "proposal", "description", "developmentdescription", default=None),
                "local_authority": first(props, "local_authority", "planning_authority", "la_name", default=None),
                "raw": props,
                "source": self.source_metadata(source_url)
            })
        return ImportResult(records_read=len(data.get("features", [])), records_written=self.write(docs))

    def _download_all(self, url):
        out = {"type": "FeatureCollection", "features": []}
        offset = 0
        page_size = 2000
        with httpx.Client(timeout=60) as client:
            while True:
                params = {"where": "1=1", "outFields": "*", "outSR": "4326", "f": "geojson", "resultOffset": offset, "resultRecordCount": page_size}
                r = client.get(url, params=params); r.raise_for_status(); batch = r.json()
                fs = batch.get("features", [])
                out["features"].extend(fs)
                if len(fs) < page_size: break
                offset += page_size
        return out

    @staticmethod
    def _to_point(geometry):
        if not geometry: return None
        if geometry.get("type") == "Point":
            return geometry
        if "x" in geometry and "y" in geometry:
            return {"type": "Point", "coordinates": [geometry["x"], geometry["y"]]}
        # For polygon geometries, use centroid only for an optional fallback; points layer is preferred.
        return None

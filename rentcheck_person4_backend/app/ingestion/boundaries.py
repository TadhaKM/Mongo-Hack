from __future__ import annotations
import json
from pathlib import Path
from app.ingestion.base import DatasetImporter, ImportResult

class GeoJsonBoundaryImporter(DatasetImporter):
    """Loads an official boundary GeoJSON into a named collection.

    Keep each geography level in its own collection so point-in-polygon joins
    cannot accidentally mix incompatible geography systems.
    """
    dataset_id = "official_boundaries"

    def __init__(self, collection_name: str, dataset_id: str | None = None):
        self.collection_name = collection_name
        if dataset_id:
            self.dataset_id = dataset_id

    def import_path(self, path, source_url=None):
        data = json.loads(Path(path).read_text(encoding="utf-8"))
        docs=[]
        for i, feature in enumerate(data.get("features", [])):
            props=feature.get("properties") or {}
            code=props.get("code") or props.get("GEOGID") or props.get("geogid") or props.get("GUID") or props.get("id") or str(i)
            name=props.get("name") or props.get("NAME") or props.get("English") or props.get("GEOGDESC")
            geometry=feature.get("geometry")
            if not geometry: continue
            docs.append({"_record_key": f"{self.dataset_id}:{code}", "code": str(code), "name": name, "geometry": geometry, "properties": props, "source": self.source_metadata(source_url)})
        return ImportResult(records_read=len(data.get("features", [])), records_written=self.write(docs))

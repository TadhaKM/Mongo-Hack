from __future__ import annotations
import json
from pathlib import Path
from app.db.mongodb import collection

def seed_source_catalog(path: str = "source_catalog.json") -> int:
    data=json.loads(Path(path).read_text(encoding="utf-8"))
    written=0
    for item in data.get("sources", []):
        doc={"_id": item["id"], **item}
        collection("data_sources").replace_one({"_id": item["id"]}, doc, upsert=True)
        written += 1
    return written

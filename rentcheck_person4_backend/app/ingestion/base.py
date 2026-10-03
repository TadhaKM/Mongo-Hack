from __future__ import annotations
from abc import ABC, abstractmethod
from datetime import datetime, timezone
from app.db.mongodb import collection

class ImportResult(dict): pass

class DatasetImporter(ABC):
    dataset_id: str
    collection_name: str
    pipeline_version = "0.1.0"
    organisation = None

    def source_metadata(self, source_url: str | None = None, dataset_date=None) -> dict:
        return {
            "dataset": self.dataset_id,
            "organisation": self.organisation,
            "source_url": source_url,
            "retrieved_at": datetime.now(timezone.utc),
            "dataset_date": dataset_date,
            "pipeline_version": self.pipeline_version
        }

    @abstractmethod
    def import_path(self, path, source_url: str | None = None) -> ImportResult: ...

    def write(self, docs: list[dict]) -> int:
        if not docs: return 0
        col = collection(self.collection_name)
        for doc in docs:
            key = doc.pop("_record_key")
            doc["_record_key"] = key
            col.replace_one({"_record_key": key}, doc, upsert=True)
        return len(docs)

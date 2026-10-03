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
        from pymongo import ReplaceOne
        col = collection(self.collection_name)
        # one round trip per batch instead of per document (a 90k-row file went from ~30 min to seconds); still an idempotent upsert
        for i in range(0, len(docs), 1000):
            col.bulk_write([ReplaceOne({"_record_key": d["_record_key"]}, d, upsert=True) for d in docs[i:i + 1000]], ordered=False)
        return len(docs)

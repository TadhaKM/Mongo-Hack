"""Where finished analyses (agent memory) are persisted.

MongoAnalysisStore writes into Person 4's `analyses` collection using their access helper, keeping their
document shape (_id, property_id, status, evidence, sources) and adding `report` and `agent`, so their
GET /analysis/{id}/... endpoints keep working."""
from __future__ import annotations

import asyncio
from typing import Any, Protocol


class AnalysisStore(Protocol):
    async def save(self, doc: dict[str, Any]) -> None: ...
    async def get(self, analysis_id: str) -> dict[str, Any] | None: ...


class MemoryAnalysisStore:
    def __init__(self):
        self._docs: dict[str, dict[str, Any]] = {}

    async def save(self, doc):
        self._docs[doc["_id"]] = doc

    async def get(self, analysis_id):
        doc = self._docs.get(analysis_id)
        return None if doc is None else {**{k: v for k, v in doc.items() if k != "_id"}, "analysis_id": analysis_id}


class MongoAnalysisStore:
    def __init__(self):
        from app.db.mongodb import collection  # type: ignore[import-not-found]  (Person 4's backend)
        self._col = collection("analyses")

    async def save(self, doc):
        await asyncio.to_thread(self._col.replace_one, {"_id": doc["_id"]}, doc, True)

    async def get(self, analysis_id):
        doc = await asyncio.to_thread(self._col.find_one, {"_id": analysis_id})
        if doc:
            doc["analysis_id"] = doc.pop("_id")
        return doc


_default: AnalysisStore | None = None


def get_store(kind: str | None = None) -> AnalysisStore:
    global _default
    if _default is None:
        from rentcheck_agents.config import get_settings
        kind = kind or ("mongo" if get_settings().tool_client == "inprocess" else "memory")
        _default = MongoAnalysisStore() if kind == "mongo" else MemoryAnalysisStore()
    return _default

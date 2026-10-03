from __future__ import annotations
import csv, hashlib, json, re
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable

ALIAS = re.compile(r"[^a-z0-9]+")

def canonical_key(value: str) -> str:
    return ALIAS.sub("_", value.strip().lower()).strip("_")

def now_utc() -> datetime:
    return datetime.now(timezone.utc)

def record_hash(record: dict) -> str:
    body = json.dumps(record, sort_keys=True, default=str, ensure_ascii=False).encode()
    return hashlib.sha256(body).hexdigest()

def read_csv_rows(path: Path) -> Iterable[dict]:
    with path.open("r", encoding="utf-8-sig", newline="") as f:
        for row in csv.DictReader(f):
            yield {canonical_key(k): v.strip() if isinstance(v, str) else v for k, v in row.items()}

def first(row: dict, *names: str, default=None):
    for name in names:
        key = canonical_key(name)
        if key in row and row[key] not in (None, ""):
            return row[key]
    return default

def float_or_none(value):
    try:
        return float(value)
    except (TypeError, ValueError):
        return None

def int_or_none(value):
    try:
        return int(float(value))
    except (TypeError, ValueError):
        return None

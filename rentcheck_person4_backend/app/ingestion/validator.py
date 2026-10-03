from __future__ import annotations
from datetime import datetime, timezone
from app.ingestion.utils import float_or_none

def validate_point(lon, lat) -> list[str]:
    errors = []
    if lon is None or lat is None:
        errors.append("missing_coordinates")
        return errors
    if not (-180 <= lon <= 180 and -90 <= lat <= 90):
        errors.append("invalid_coordinates")
    return errors

def plausibility_flags_for_rent(rent: float | None) -> list[str]:
    if rent is None: return ["missing_rent"]
    if rent <= 0: return ["non_positive_rent"]
    if rent > 20000: return ["rent_outlier"]
    return []

def is_future_date(value: datetime | None) -> bool:
    return value is not None and value > datetime.now(timezone.utc)

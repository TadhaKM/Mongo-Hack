"""Small, exact statistics. All numbers shown to users are computed here, never by the LLM."""
from __future__ import annotations

from statistics import median as _median


def median(values: list[float]) -> float | None:
    vals = [v for v in values if v is not None]
    return float(_median(vals)) if vals else None


def quantile(values: list[float], q: float) -> float | None:
    """Linear-interpolated quantile (same as numpy's default)."""
    vals = sorted(v for v in values if v is not None)
    if not vals:
        return None
    pos = (len(vals) - 1) * q
    lo, hi = int(pos), min(int(pos) + 1, len(vals) - 1)
    return vals[lo] + (vals[hi] - vals[lo]) * (pos - lo)


def weighted_median(pairs: list[tuple[float, float]]) -> float | None:
    """pairs = [(value, weight)], e.g. (area average rent, number of tenancies)."""
    pairs = sorted((v, w) for v, w in pairs if v is not None and w and w > 0)
    if not pairs:
        return None
    total = sum(w for _, w in pairs)
    cum = 0.0
    for v, w in pairs:
        cum += w
        if cum >= total / 2:
            return float(v)
    return float(pairs[-1][0])


def iqr_filter(values: list[float], k: float = 1.5) -> tuple[list[float], list[float]]:
    """Split into (kept, outliers) using Tukey fences. Needs >= 4 values to drop anything."""
    vals = [v for v in values if v is not None]
    if len(vals) < 4:
        return vals, []
    q1, q3 = quantile(vals, 0.25), quantile(vals, 0.75)
    lo, hi = q1 - k * (q3 - q1), q3 + k * (q3 - q1)
    return [v for v in vals if lo <= v <= hi], [v for v in vals if v < lo or v > hi]


def pct_change(new: float | None, old: float | None) -> float | None:
    if new is None or old in (None, 0):
        return None
    return (new - old) / old * 100.0


def percentile_rank(value: float, values: list[float]) -> float | None:
    vals = [v for v in values if v is not None]
    if not vals:
        return None
    below = sum(1 for v in vals if v < value)
    equal = sum(1 for v in vals if v == value)
    return (below + 0.5 * equal) / len(vals) * 100.0


def delta_band(delta_pct: float | None) -> str | None:
    """Descriptive wording for asking rent vs benchmark. Deliberately not a verdict."""
    if delta_pct is None:
        return None
    a = abs(delta_pct)
    if a <= 5:
        return "in line with"
    direction = "above" if delta_pct > 0 else "below"
    return f"well {direction}" if a > 15 else f"{direction}"


def quarter_index(year: int, quarter: int) -> int:
    return year * 4 + (quarter - 1)


def quarter_label(year: int | None, quarter: int | None) -> str:
    if year is None:
        return "unknown period"
    return f"{year} Q{quarter}" if quarter else str(year)


def round_eur(v: float | None) -> float | None:
    return None if v is None else float(round(v))


def plural(n: int | float, word: str, plural_word: str | None = None) -> str:
    return f"{n:g} {word if n == 1 else (plural_word or word + 's')}"


def round1(v: float | None) -> float | None:
    return None if v is None else round(v, 1)

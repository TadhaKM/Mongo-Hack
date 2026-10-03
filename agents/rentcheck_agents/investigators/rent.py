"""Rent investigator: turns RTB rows from the backend into benchmark / position / trend evidence.

RTB data is aggregate (area x bedrooms x type x quarter averages). We never call these "comparable
properties"; they are "average registered rents for new tenancies" in a named area and quarter.
"""
from __future__ import annotations

from datetime import date
from typing import Any

from rentcheck_agents import stats
from rentcheck_agents.models import Evidence, EvidenceLedger, EvidenceValue, Finding, PropertyInput, SourceRef, ToolCallRef
from rentcheck_agents.tools.base import ToolClient, ToolError

RELAX_LABEL = {
    "exact": "same area, bedrooms and property type",
    "property_type_relaxed": "same area and bedrooms, all property types",
    "bedroom_relaxed": "same area, all bedroom counts",
}


def source_ref(src: dict | None) -> SourceRef | None:
    if not src:
        return None
    return SourceRef(organisation=src.get("organisation"), dataset=src.get("dataset"), source_url=src.get("source_url"),
                     retrieved_at=str(src.get("retrieved_at")) if src.get("retrieved_at") else None,
                     dataset_date=str(src.get("dataset_date")) if src.get("dataset_date") is not None else None)


def _rent(row: dict) -> float | None:
    v = (row.get("rent") or {}).get("monthly_eur")
    return float(v) if isinstance(v, (int, float)) and v > 0 else None


def _yq(row: dict) -> tuple[int | None, int | None]:
    p = row.get("period") or {}
    return p.get("year"), p.get("quarter")


def _usable(row: dict) -> bool:
    y, q = _yq(row)
    return _rent(row) is not None and y is not None and (row.get("validation") or {}).get("status", "ok") == "ok"


ALL_TYPES = {None, "", "all", "all property types", "all types"}


def collapse_quarters(rows: list[dict], bedrooms: int | None, property_type: str | None) -> list[dict]:
    """Keep one row per quarter. Relaxed matches return several rows per quarter (one per type/bedroom count);
    prefer the exact profile, then an 'all types' row, else combine with the median and mark it as combined."""
    by_q: dict[tuple, list[dict]] = {}
    for r in rows:
        by_q.setdefault(_yq(r), []).append(r)
    out = []
    for key, rs in by_q.items():
        prop = lambda r: r.get("property") or {}
        pick = ([r for r in rs if prop(r).get("type") == property_type and prop(r).get("bedrooms") == bedrooms]
                or [r for r in rs if prop(r).get("type") in ALL_TYPES and prop(r).get("bedrooms") == bedrooms]
                or [r for r in rs if prop(r).get("type") == property_type]
                or [r for r in rs if prop(r).get("type") in ALL_TYPES]
                or rs)
        if len(pick) == 1:
            out.append(pick[0])
        else:
            combined = dict(pick[0])
            combined["rent"] = {"monthly_eur": stats.median([_rent(r) for r in pick]), "measure": "median of averages"}
            p0 = dict(prop(pick[0]))
            if len({prop(r).get("type") for r in pick}) > 1:
                p0["type"] = None
            if len({prop(r).get("bedrooms") for r in pick}) > 1:
                p0["bedrooms"] = None
            combined["property"] = p0
            combined["_n_combined"] = len(pick)
            out.append(combined)
    out.sort(key=lambda r: _yq(r), reverse=True)
    return out


def current_quarter_index(today: date | None = None) -> int:
    today = today or date.today()
    return stats.quarter_index(today.year, (today.month - 1) // 3 + 1)


def _confidence(match_method: str, quarters_old: int | None) -> tuple[str, list[str]]:
    reasons = [f"Matched on {RELAX_LABEL.get(match_method, match_method)}."]
    score = 2
    if match_method == "property_type_relaxed":
        score -= 1
    elif match_method == "bedroom_relaxed":
        score -= 2
    if quarters_old is not None:
        reasons.append(f"Latest data is {quarters_old} quarter(s) behind the current quarter.")
        if quarters_old > 6:
            score -= 2
        elif quarters_old > 2:
            score -= 1
    level = "high" if score >= 2 else "medium" if score == 1 else "low"
    return level, reasons


async def investigate_rent(tools: ToolClient, property_id: str, inp: PropertyInput, ledger: EvidenceLedger,
                           today: date | None = None) -> Finding:
    asking = float(inp.monthly_rent)
    limitations = [
        "RTB figures are area averages for newly registered tenancies; they do not reflect this property's condition, size, BER or furnishing.",
        "Asking rent is an advertised price; RTB rents are registered rents and are published with a lag of one or more quarters.",
    ]
    if inp.floor_area_m2:
        limitations.append("Floor area was provided but RTB averages are not broken down by floor area, so no size adjustment is made.")

    try:
        comp = await tools.rental_comparables(property_id, bedrooms=inp.bedrooms, property_type=inp.property_type)
    except ToolError as exc:
        return Finding(id="f_rent", topic="rent", status="unavailable", confidence="low",
                       headline="Rental market data could not be retrieved.", limitations=[str(exc)] + limitations)

    rows = [r for r in comp.get("results", []) if _usable(r)]
    match = (rows[0].get("match") or {}) if rows else {}
    geo_match = match.get("geography")
    method = match.get("method", "exact")

    # Guard: without a resolved RTB area the backend query has no location filter, so rows may be from anywhere.
    if not rows or geo_match != "exact":
        reason = ("The property's RTB rental area could not be resolved, so no local benchmark is used "
                  "(national or other-area figures would be misleading)." if rows and geo_match != "exact"
                  else "No RTB rent figures matched this area, bedroom count and property type.")
        ev = ledger.add(Evidence(
            id="ev_rent_unavailable", kind="rent_benchmark_missing", statement=reason,
            values=[EvidenceValue(name="asking_rent", value=asking, unit="EUR/month")],
            tool=ToolCallRef(name="getRentalComparables", params=[EvidenceValue(name="bedrooms", value=inp.bedrooms), EvidenceValue(name="property_type", value=inp.property_type)]),
            confidence="low", confidence_reasons=[reason]))
        return Finding(id="f_rent", topic="rent", status="limited", confidence="low", evidence_ids=[ev],
                       headline="Not enough local RTB data to benchmark this rent.", flags=["insufficient_rent_data"],
                       metrics=[EvidenceValue(name="asking_rent", value=asking, unit="EUR/month")], limitations=[reason] + limitations)

    rows = collapse_quarters(rows, inp.bedrooms, inp.property_type)
    latest = rows[0]
    bench = _rent(latest)
    y, q = _yq(latest)
    area = (latest.get("geography") or {}).get("name") or (latest.get("geography") or {}).get("code")
    ptype = (latest.get("property") or {}).get("type") or "all property types"
    beds = (latest.get("property") or {}).get("bedrooms")
    beds_label = f"{beds}-bed" if beds is not None else "all-bedroom"
    qold = current_quarter_index(today) - stats.quarter_index(y, q or 1)
    conf, reasons = _confidence(method, qold)

    delta = stats.pct_change(asking, bench)
    band = stats.delta_band(delta)
    period_label = stats.quarter_label(y, q)
    n_comb = latest.get("_n_combined")
    if n_comb:
        reasons.append(f"Benchmark is the median of {n_comb} RTB averages for different property types/bedroom counts.")

    ev_bench = ledger.add(Evidence(
        id="ev_rent_benchmark", kind="rent_benchmark", derived=bool(n_comb),
        statement=(f"The RTB average registered rent for new {beds_label} {ptype} tenancies in {area} was €{bench:,.0f} per month in {period_label}."
                   if not n_comb else
                   f"The median of {n_comb} RTB average registered rents (different property types/bedroom counts) for new tenancies in {area} "
                   f"was €{bench:,.0f} per month in {period_label}."),
        values=[EvidenceValue(name="benchmark_rent", value=stats.round_eur(bench), unit="EUR/month"),
                EvidenceValue(name="bedrooms", value=beds), EvidenceValue(name="year", value=y), EvidenceValue(name="quarter", value=q)],
        source=source_ref(latest.get("source")), period=period_label, geography=area,
        tool=ToolCallRef(name="getRentalComparables", params=[EvidenceValue(name="bedrooms", value=inp.bedrooms), EvidenceValue(name="property_type", value=inp.property_type)]),
        match_method=method, confidence=conf, confidence_reasons=reasons,
        caveats=["Area average; not a valuation of this property."]))

    ev_pos = ledger.add(Evidence(
        id="ev_rent_position", kind="rent_position", derived=True,
        statement=(f"The asking rent of €{asking:,.0f} is {abs(delta):.1f}% {'above' if delta >= 0 else 'below'} "
                   f"the RTB average of €{bench:,.0f} ({band} the area average)."),
        values=[EvidenceValue(name="asking_rent", value=stats.round_eur(asking), unit="EUR/month"),
                EvidenceValue(name="benchmark_rent", value=stats.round_eur(bench), unit="EUR/month"),
                EvidenceValue(name="difference_eur", value=stats.round_eur(asking - bench), unit="EUR/month"),
                EvidenceValue(name="difference_pct", value=stats.round1(delta), unit="%")],
        period=period_label, geography=area, confidence=conf, confidence_reasons=reasons + ["Computed from the benchmark evidence."]))

    evidence_ids = [ev_bench, ev_pos]
    flags: list[str] = []
    if delta is not None and delta > 15:
        flags.append("well_above_benchmark")
    elif delta is not None and delta > 5:
        flags.append("above_benchmark")
    elif delta is not None and delta < -15:
        flags.append("well_below_benchmark")
    if method != "exact":
        flags.append("benchmark_relaxed")
    if qold > 2:
        flags.append("benchmark_stale")

    # Spread across recent quarters of the same cell (not across properties).
    recent = [r for r in rows if current_quarter_index(today) - stats.quarter_index(*_yq(r)) <= qold + 3]
    metrics = [EvidenceValue(name="asking_rent", value=stats.round_eur(asking), unit="EUR/month"),
               EvidenceValue(name="benchmark_rent", value=stats.round_eur(bench), unit="EUR/month"),
               EvidenceValue(name="difference_pct", value=stats.round1(delta), unit="%")]
    items = [{"area": (r.get("geography") or {}).get("name"), "period": stats.quarter_label(*_yq(r)),
              "year": _yq(r)[0], "quarter": _yq(r)[1], "source": r.get("source"),
              "bedrooms": (r.get("property") or {}).get("bedrooms"), "property_type": (r.get("property") or {}).get("type"),
              "average_rent_eur": _rent(r), "match": (r.get("match") or {}).get("method")} for r in rows]
    if len(recent) >= 4:
        vals = [_rent(r) for r in recent]
        ev_spread = ledger.add(Evidence(
            id="ev_rent_spread", kind="rent_spread", derived=True,
            statement=(f"Across the last {len({_yq(r) for r in recent})} quarters of RTB data for this area and property profile, the quarterly average "
                       f"ranged from €{min(vals):,.0f} to €{max(vals):,.0f} (median €{stats.median(vals):,.0f})."),
            values=[EvidenceValue(name="quarters", value=len({_yq(r) for r in recent}), unit="count"),
                    EvidenceValue(name="min_rent", value=stats.round_eur(min(vals)), unit="EUR/month"),
                    EvidenceValue(name="max_rent", value=stats.round_eur(max(vals)), unit="EUR/month"),
                    EvidenceValue(name="median_rent", value=stats.round_eur(stats.median(vals)), unit="EUR/month")],
            source=source_ref(latest.get("source")), geography=area,
            period=f"{stats.quarter_label(*_yq(recent[-1]))} to {period_label}", confidence=conf, confidence_reasons=reasons))
        evidence_ids.append(ev_spread)

    # Optional upgrade path: if the backend ever returns tenancy counts per row, use a weighted median.
    weighted = [(_rent(r), (r.get("rent") or {}).get("n_tenancies")) for r in rows if (r.get("rent") or {}).get("n_tenancies")]
    if weighted:
        wm = stats.weighted_median(weighted)
        n = int(sum(w for _, w in weighted))
        ledger.add(Evidence(
            id="ev_rent_weighted", kind="rent_weighted_median", derived=True,
            statement=f"Weighted by {n} registered tenancies, the median of these RTB averages is €{wm:,.0f}.",
            values=[EvidenceValue(name="weighted_median_rent", value=stats.round_eur(wm), unit="EUR/month"),
                    EvidenceValue(name="tenancies", value=n, unit="count")],
            source=source_ref(latest.get("source")), geography=area, confidence=conf, confidence_reasons=reasons))
        evidence_ids.append("ev_rent_weighted")

    headline = f"Asking rent €{asking:,.0f} is {abs(delta):.1f}% {'above' if delta >= 0 else 'below'} the RTB average of €{bench:,.0f} for {area} ({period_label})."
    return Finding(id="f_rent", topic="rent", headline=headline, confidence=conf, evidence_ids=evidence_ids, flags=flags,
                   metrics=metrics, items=items, limitations=limitations,
                   status="ok" if conf != "low" else "limited")


async def investigate_trend(tools: ToolClient, property_id: str, inp: PropertyInput, ledger: EvidenceLedger,
                            benchmark: Finding | None, today: date | None = None) -> Finding:
    """History of the same RTB cell. The backend returns all bedrooms/types for the area, so filter here."""
    if benchmark is None or benchmark.status == "unavailable" or "insufficient_rent_data" in benchmark.flags:
        return Finding(id="f_trend", topic="trend", status="unavailable", confidence="low",
                       headline="Rent trend not assessed because no local RTB benchmark was available.")
    try:
        hist = await tools.rental_history(property_id, years=5)
    except ToolError as exc:
        return Finding(id="f_trend", topic="trend", status="unavailable", confidence="low",
                       headline="Rent history could not be retrieved.", limitations=[str(exc)])

    bench_ev = ledger.get("ev_rent_benchmark")
    beds = next((v.value for v in bench_ev.values if v.name == "bedrooms"), inp.bedrooms) if bench_ev else inp.bedrooms
    ptype = None
    if bench_ev and benchmark.items:
        ptype = benchmark.items[0].get("property_type")
    series: dict[tuple[int, int], dict[str, Any]] = {}
    matching = [r for r in hist.get("results", []) if _usable(r) and (r.get("property") or {}).get("bedrooms") == beds
                and (not ptype or (r.get("property") or {}).get("type") == ptype)]
    for r in collapse_quarters(matching, beds, ptype):
        y, q = _yq(r)
        series[(y, q or 1)] = r
    # getRentalHistory caps rows across all bedroom/type mixes, so also use the exact-cell rows from the benchmark call.
    for it in benchmark.items:
        if it.get("year") and it.get("average_rent_eur") and it.get("bedrooms") == beds and (not ptype or it.get("property_type") == ptype):
            key = (it["year"], it.get("quarter") or 1)
            series.setdefault(key, {"period": {"year": it["year"], "quarter": it.get("quarter")}, "rent": {"monthly_eur": it["average_rent_eur"]},
                                    "property": {"bedrooms": it["bedrooms"], "type": it["property_type"]}, "geography": {"name": it.get("area")},
                                    "source": it.get("source"), "validation": {"status": "ok"}})
    if len(series) < 2:
        return Finding(id="f_trend", topic="trend", status="limited", confidence="low",
                       headline="Not enough quarters of matching RTB data to describe a trend.",
                       limitations=["Fewer than two quarters of data for this area and property profile."])

    keys = sorted(series)
    pts = [(k, _rent(series[k])) for k in keys]
    (ly, lq), latest = pts[-1]
    yoy_base = series.get((ly - 1, lq))
    yoy = stats.pct_change(latest, _rent(yoy_base)) if yoy_base else None
    first_k, first_v = pts[0]
    total = stats.pct_change(latest, first_v)
    area = ((series[keys[-1]].get("geography") or {}).get("name"))
    src = source_ref(series[keys[-1]].get("source"))
    values = [EvidenceValue(name="first_rent", value=stats.round_eur(first_v), unit="EUR/month"),
              EvidenceValue(name="latest_rent", value=stats.round_eur(latest), unit="EUR/month"),
              EvidenceValue(name="change_pct", value=stats.round1(total), unit="%"),
              EvidenceValue(name="quarters", value=len(pts), unit="count")]
    statement = (f"The RTB average for this area and property profile moved from €{first_v:,.0f} in {stats.quarter_label(*first_k)} "
                 f"to €{latest:,.0f} in {stats.quarter_label(ly, lq)} ({total:+.1f}%).")
    if yoy is not None:
        values.append(EvidenceValue(name="yoy_change_pct", value=stats.round1(yoy), unit="%"))
        statement += f" Year-on-year change to {stats.quarter_label(ly, lq)}: {yoy:+.1f}%."
    ev = ledger.add(Evidence(id="ev_rent_trend", kind="rent_trend", derived=True, statement=statement, values=values,
                             source=src, geography=area, period=f"{stats.quarter_label(*first_k)} to {stats.quarter_label(ly, lq)}",
                             tool=ToolCallRef(name="getRentalHistory", params=[EvidenceValue(name="years", value=5)]),
                             confidence=benchmark.confidence, confidence_reasons=["Same RTB cell as the benchmark, filtered client-side to matching bedrooms/type."]))
    evidence_ids = [ev]
    flags = []
    if yoy is not None and yoy > 8:
        flags.append("fast_rising_area")

    # Derived estimate: roll the benchmark forward to the current quarter using the trailing annual growth rate.
    qgap = current_quarter_index(today) - stats.quarter_index(ly, lq)
    if yoy is not None and qgap > 0 and benchmark.metrics:
        adj = latest * (1 + yoy / 100) ** (qgap / 4)
        asking = float(inp.monthly_rent)
        adj_delta = stats.pct_change(asking, adj)
        ledger.add(Evidence(
            id="ev_rent_trend_adjusted", kind="rent_trend_adjusted", derived=True,
            statement=(f"Estimate only: if the recent annual change of {yoy:+.1f}% continued for the {qgap} quarter(s) since the latest RTB data, "
                       f"the area average would be about €{adj:,.0f}; the asking rent would be {abs(adj_delta):.1f}% {'above' if adj_delta >= 0 else 'below'} that."),
            values=[EvidenceValue(name="trend_adjusted_rent", value=stats.round_eur(adj), unit="EUR/month"),
                    EvidenceValue(name="quarters_projected", value=qgap, unit="count"),
                    EvidenceValue(name="yoy_change_pct", value=stats.round1(yoy), unit="%"),
                    EvidenceValue(name="difference_pct", value=stats.round1(adj_delta), unit="%")],
            geography=area, confidence="low", confidence_reasons=["Projection, not observed data."],
            caveats=["Assumes the recent trend continued; real rents may differ."]))
        evidence_ids.append("ev_rent_trend_adjusted")

    items = [{"period": stats.quarter_label(*k), "average_rent_eur": v} for k, v in pts]
    headline = f"RTB average for this profile changed {total:+.1f}% from {stats.quarter_label(*first_k)} to {stats.quarter_label(ly, lq)}."
    return Finding(id="f_trend", topic="trend", headline=headline, evidence_ids=evidence_ids, confidence=benchmark.confidence,
                   flags=flags, items=items, metrics=values)

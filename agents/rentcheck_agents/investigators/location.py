"""Location investigator: transport accessibility (GTFS stops) and small-area census context."""
from __future__ import annotations

from typing import Any

from rentcheck_agents import stats
from rentcheck_agents.investigators.rent import source_ref
from rentcheck_agents.models import Evidence, EvidenceLedger, EvidenceValue, Finding, ToolCallRef
from rentcheck_agents.tools.base import ToolClient, ToolError

BACKEND_STOP_LIMIT = 50  # app/services/transport_service.py nearby_transport(limit=50)
# The backend's transport_stops collection is built by its NTA GTFS importer, but stop rows carry no `source`.
GTFS_SOURCE = {"organisation": "National Transport Authority", "dataset": "NTA GTFS",
               "source_url": "https://www.transportforireland.ie/transitData/PT_Data.html"}
WALK_M_PER_MIN = 80.0  # ~4.8 km/h; straight-line distance, so real walks are usually longer
MODE_LABEL = {"tram": "Luas", "rail": "rail/DART", "bus": "bus", "metro": "metro", "ferry": "ferry"}

# Census columns arrive as raw CSV keys, so accept a few aliases per canonical metric.
CENSUS_KEYS = {
    "population_total": ("population_total", "total_population", "t1_1agett"),
    "households_total": ("households_total", "total_households", "private_households"),
    "private_rented_pct": ("private_rented_pct", "rented_private_pct", "pct_private_rented"),
    "car_available_pct": ("car_available_pct", "pct_car_available"),
}
CENSUS_LABEL = {
    "population_total": ("population", "people", None),
    "households_total": ("households", "households", None),
    "private_rented_pct": ("share of households renting privately", "%", "%"),
    "car_available_pct": ("share of households with a car", "%", "%"),
}


def _num(v: Any) -> float | None:
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


async def investigate_transport(tools: ToolClient, property_id: str, ledger: EvidenceLedger, precise: bool = True) -> Finding:
    try:
        near = await tools.nearby_transport(property_id, radius_m=800)
    except ToolError as exc:
        return Finding(id="f_transport", topic="transport", status="unavailable", confidence="low",
                       headline="Transport data could not be retrieved.", limitations=[str(exc)])
    stops = sorted(near.get("stops", []), key=lambda s: s.get("distance_m") or 1e9)
    limitations = ["Distances are straight-line from the property point; walking routes are longer.",
                   "Stops come from the NTA GTFS timetable feed; service frequency is not assessed."]
    if not precise:
        limitations.insert(0, "Location was approximated from the Eircode routing area, so distances are indicative only.")
    if not stops:
        ev = ledger.add(Evidence(id="ev_transport_none", kind="transport_none",
                                 statement="No public transport stops were found within 800 m of the property point.",
                                 values=[EvidenceValue(name="radius_m", value=800, unit="m"), EvidenceValue(name="stops", value=0, unit="count")],
                                 tool=ToolCallRef(name="getNearbyTransport", params=[EvidenceValue(name="radius_m", value=800)]),
                                 confidence="medium" if precise else "low"))
        return Finding(id="f_transport", topic="transport", status="ok", confidence="medium" if precise else "low",
                       headline="No public transport stops within 800 m.", evidence_ids=[ev], flags=["no_transport_800m"],
                       limitations=limitations)

    src = source_ref(stops[0].get("source") or GTFS_SOURCE)
    capped = len(stops) >= BACKEND_STOP_LIMIT
    if capped:
        limitations.insert(0, f"The backend returns at most {BACKEND_STOP_LIMIT} stops, so the 800 m counts are a minimum.")
    conf = "high" if precise else "low"
    evidence_ids, metrics = [], []
    by_mode: dict[str, dict] = {}
    for s in stops:
        for m in s.get("modes") or ["unknown"]:
            by_mode.setdefault(m, s)  # stops sorted, so first seen = nearest
    for mode, s in sorted(by_mode.items(), key=lambda kv: kv[1]["distance_m"]):
        d = float(s["distance_m"])
        label = MODE_LABEL.get(mode, mode)
        walk = round(d / WALK_M_PER_MIN)
        ev_id = f"ev_transport_nearest_{mode}"
        ledger.add(Evidence(
            id=ev_id, kind="transport_nearest",
            statement=f"The nearest {label} stop is {s.get('name')}, {d:.0f} m away in a straight line (about {walk} min walk, estimated).",
            values=[EvidenceValue(name="distance_m", value=round(d), unit="m"), EvidenceValue(name="walk_minutes_estimate", value=walk, unit="min")],
            source=src, tool=ToolCallRef(name="getNearbyTransport", params=[EvidenceValue(name="radius_m", value=800)]),
            confidence=conf, caveats=["Walking time assumes 80 m/min over straight-line distance."]))
        evidence_ids.append(ev_id)
        metrics.append(EvidenceValue(name=f"nearest_{mode}_m", value=round(d), unit="m"))

    within400 = [s for s in stops if (s.get("distance_m") or 1e9) <= 400]
    routes800 = sorted({r for s in stops for r in (s.get("routes") or [])})
    routes400 = sorted({r for s in within400 for r in (s.get("routes") or [])})
    ledger.add(Evidence(
        id="ev_transport_counts", kind="transport_counts",
        statement=(("At least " if capped else "") + f"{stats.plural(len(within400), 'stop')} within 400 m and {len(stops)} within 800 m, "
                   f"served by {stats.plural(len(routes400), 'distinct route')} and {len(routes800)} respectively."),
        values=[EvidenceValue(name="stops_400m", value=len(within400), unit="count"), EvidenceValue(name="stops_800m", value=len(stops), unit="count"),
                EvidenceValue(name="routes_400m", value=len(routes400), unit="count"), EvidenceValue(name="routes_800m", value=len(routes800), unit="count")],
        source=src, tool=ToolCallRef(name="getNearbyTransport", params=[EvidenceValue(name="radius_m", value=800)]), confidence=conf))
    evidence_ids.append("ev_transport_counts")
    metrics += [EvidenceValue(name="stops_800m", value=len(stops), unit="count"), EvidenceValue(name="routes_800m", value=len(routes800), unit="count")]

    flags = []
    if "tram" in by_mode or "rail" in by_mode:
        if min(by_mode[m]["distance_m"] for m in ("tram", "rail") if m in by_mode) <= 800:
            flags.append("rail_or_luas_within_800m")
    nearest = stops[0]
    headline = (f"{stats.plural(len(stops), 'stop')} within 800 m; nearest is {nearest.get('name')} at {nearest['distance_m']:.0f} m"
                + (f"; Luas at {by_mode['tram']['distance_m']:.0f} m" if "tram" in by_mode else "") + ".")
    items = [{"name": s.get("name"), "distance_m": s.get("distance_m"), "modes": s.get("modes"), "routes": s.get("routes"),
              "location": s.get("location"), "walk_minutes_estimate": round(float(s["distance_m"]) / WALK_M_PER_MIN)} for s in stops[:25]]
    return Finding(id="f_transport", topic="transport", headline=headline, evidence_ids=evidence_ids, confidence=conf,
                   flags=flags, metrics=metrics, items=items, limitations=limitations)


async def investigate_neighbourhood(tools: ToolClient, property_id: str, ledger: EvidenceLedger) -> Finding:
    try:
        nb = await tools.neighbourhood(property_id)
    except ToolError as exc:
        return Finding(id="f_neighbourhood", topic="neighbourhood", status="unavailable", confidence="low",
                       headline="Neighbourhood data could not be retrieved.", limitations=[str(exc)])
    sa = nb.get("small_area") or {}
    census, vacancy = nb.get("census") or {}, nb.get("vacancy") or {}
    if not sa.get("code") or (not census and not vacancy):
        return Finding(id="f_neighbourhood", topic="neighbourhood", status="unavailable", confidence="low",
                       headline="No Census small-area statistics are available for this location.",
                       limitations=["The property could not be matched to a Census 2022 small area with loaded statistics."])
    sa_label = sa.get("name") or sa.get("code")
    evidence_ids, metrics = [], []
    import re as _re
    cvals = {_re.sub(r"[^a-z0-9]+", "_", str(k).lower()).strip("_"): v for k, v in (census.get("values") or {}).items()}
    for key, aliases in CENSUS_KEYS.items():
        val = next((_num(cvals[a]) for a in aliases if a in cvals and _num(cvals[a]) is not None), None)
        if val is None:
            continue
        label, unit_word, unit = CENSUS_LABEL[key]
        shown = f"{val:.1f}%" if unit == "%" else f"{val:,.0f} {unit_word}"
        ev_id = f"ev_census_{key}"
        ledger.add(Evidence(id=ev_id, kind="census", statement=f"Census 2022 records a {label} of {shown} in small area {sa_label}." if unit == "%"
                            else f"Census 2022 records {shown} in small area {sa_label}.",
                            values=[EvidenceValue(name=key, value=round(val, 1), unit=unit or "count")],
                            source=source_ref(census.get("source")), period="2022", geography=sa_label,
                            tool=ToolCallRef(name="getNeighbourhoodData"), confidence="high",
                            caveats=["Census 2022 snapshot; the area may have changed since."]))
        evidence_ids.append(ev_id)
        metrics.append(EvidenceValue(name=key, value=round(val, 1), unit=unit or "count"))
    vac = _num((vacancy.get("values") or {}).get("vacancy_rate_pct"))
    if vac is not None:
        ledger.add(Evidence(id="ev_vacancy", kind="vacancy", statement=f"CSO records a dwelling vacancy rate of {vac:.1f}% for small area {sa_label} ({vacancy.get('data_year', 2022)}).",
                            values=[EvidenceValue(name="vacancy_rate_pct", value=round(vac, 1), unit="%")],
                            source=source_ref(vacancy.get("source")), period=str(vacancy.get("data_year", 2022)), geography=sa_label,
                            tool=ToolCallRef(name="getNeighbourhoodData"), confidence="high"))
        evidence_ids.append("ev_vacancy")
        metrics.append(EvidenceValue(name="vacancy_rate_pct", value=round(vac, 1), unit="%"))
    if not evidence_ids:
        return Finding(id="f_neighbourhood", topic="neighbourhood", status="unavailable", confidence="low",
                       headline="Census data was found but none of the expected fields were present.")
    rented = next((m.value for m in metrics if m.name == "private_rented_pct"), None)
    parts = [f"{m.value:.1f}% {m.name.replace('_pct', '').replace('_', ' ')}" if m.unit == "%" else f"{m.value:,.0f} {m.name.replace('_total', '').replace('_', ' ')}"
             for m in metrics[:4]]
    headline = f"Small area {sa_label}: " + ", ".join(parts) + "."
    flags = ["high_rental_share"] if rented is not None and rented >= 40 else []
    return Finding(id="f_neighbourhood", topic="neighbourhood", headline=headline, evidence_ids=evidence_ids, confidence="high",
                   metrics=metrics, flags=flags, items=[{"small_area": sa}],
                   limitations=["Census figures describe the small area in April 2022, not this specific building."])

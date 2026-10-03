"""Development investigator: nearby planning applications and (context-only) property sales."""
from __future__ import annotations

import re
from datetime import date, datetime, timezone
from typing import Any

from rentcheck_agents import stats
from rentcheck_agents.investigators.rent import source_ref
from rentcheck_agents.models import Evidence, EvidenceLedger, EvidenceValue, Finding, ToolCallRef
from rentcheck_agents.tools.base import ToolClient, ToolError

RECENT_YEARS = 3
BACKEND_PLANNING_LIMIT = 100  # app/services/planning_service.py nearby_planning(limit=100)
LARGE_SCHEME_UNITS = 30
UNITS_RE = re.compile(r"(\d{1,4})\s*(?:no\.?\s*)?(?:residential\s+|build[- ]to[- ]rent\s+|social\s+|affordable\s+)?"
                      r"(units|apartments|dwellings|houses|homes|bed\s*spaces|student\s+bed(?:space)?s?)", re.I)
CATEGORY_RULES = [
    ("student_accommodation", re.compile(r"student", re.I)),
    ("large_residential_lrd_shd", re.compile(r"\b(LRD|SHD|large[- ]scale residential|strategic housing)\b", re.I)),
    ("build_to_rent", re.compile(r"build[- ]to[- ]rent|\bBTR\b", re.I)),
    ("hotel", re.compile(r"\bhotel|aparthotel", re.I)),
    ("demolition", re.compile(r"\bdemoli", re.I)),
    ("extension_minor", re.compile(r"\b(extension|dormer|porch|attic conversion)\b", re.I)),
]


def parse_date(v: Any) -> date | None:
    """Planning dates arrive as ISO strings, dd/mm/yyyy, or ArcGIS epoch milliseconds."""
    if v in (None, ""):
        return None
    if isinstance(v, (int, float)):
        try:
            return datetime.fromtimestamp(v / 1000 if v > 1e11 else v, tz=timezone.utc).date()
        except (OverflowError, OSError, ValueError):
            return None
    s = str(v).strip()
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00")).date()
    except ValueError:
        pass
    for fmt in ("%d/%m/%Y", "%d-%m-%Y", "%Y/%m/%d"):
        try:
            return datetime.strptime(s[:10], fmt).date()
        except ValueError:
            continue
    return None


def normalise_decision(decision: str | None, status: str | None) -> str:
    d = (decision or "").strip().lower()
    if any(k in d for k in ("refus", "reject")):
        return "refused"
    if any(k in d for k in ("grant", "conditional", "approv", "permit")):
        return "granted"
    if "further information" in d:
        return "further_information_requested"
    if "withdraw" in d or "withdraw" in (status or "").lower():
        return "withdrawn"
    if "invalid" in d:
        return "invalid"
    return "pending_or_unknown"


def unit_count(app: dict) -> int | None:
    for k in ("num_residential_units", "NumResidentialUnits", "residential_units"):
        v = app.get(k)
        if isinstance(v, (int, float)) and v > 0:
            return int(v)
    m = [int(x.group(1)) for x in UNITS_RE.finditer(app.get("proposal") or "")]
    return max(m) if m else None


def categorise(app: dict, units: int | None) -> list[str]:
    text = app.get("proposal") or ""
    cats = [name for name, rx in CATEGORY_RULES if rx.search(text)]
    if units and units >= LARGE_SCHEME_UNITS and "large_residential_lrd_shd" not in cats and "student_accommodation" not in cats:
        cats.append("large_residential")
    return cats


async def investigate_planning(tools: ToolClient, property_id: str, ledger: EvidenceLedger, today: date | None = None,
                               radius_m: int = 1000) -> Finding:
    today = today or date.today()
    try:
        res = await tools.nearby_planning(property_id, radius_m=radius_m)
    except ToolError as exc:
        return Finding(id="f_planning", topic="planning", status="unavailable", confidence="low",
                       headline="Planning data could not be retrieved.", limitations=[str(exc)])
    cutoff = date(today.year - RECENT_YEARS, today.month, min(today.day, 28))
    returned = res.get("applications", [])
    capped = len(returned) >= BACKEND_PLANNING_LIMIT  # backend returns only the N nearest, of any year
    apps, undated = [], 0
    for a in res.get("applications", []):
        d = parse_date(a.get("application_date"))
        if d is None:
            undated += 1
            continue
        if d < cutoff:
            continue
        units = unit_count(a)
        apps.append({**a, "_date": d, "_units": units, "_decision": normalise_decision(a.get("decision"), a.get("status")),
                     "_cats": categorise(a, units)})
    apps.sort(key=lambda a: a.get("distance_m") or 1e9)
    limitations = [f"Covers applications received since {cutoff.isoformat()} within {radius_m} m, as recorded in the national planning dataset.",
                   "Planning status is reported as recorded; RentCheck does not predict decisions or their effect on rents."]
    if capped:
        limitations.insert(0, f"The backend returns only the {len(returned)} nearest recorded applications (any year), so counts below are a minimum and farther schemes may be missing.")
    if undated:
        limitations.append(f"{undated} application(s) had no usable date and were excluded.")
    src = source_ref(apps[0].get("source")) if apps and apps[0].get("source") else None
    tool = ToolCallRef(name="getNearbyPlanning", params=[EvidenceValue(name="radius_m", value=radius_m)])

    if not apps and capped:
        ev = ledger.add(Evidence(id="ev_planning_capped", kind="planning_capped",
                                 statement=f"None of the {len(returned)} nearest recorded planning applications were received since {cutoff.isoformat()}; more recent applications farther away may exist.",
                                 values=[EvidenceValue(name="applications_checked", value=len(returned), unit="count")], tool=tool, confidence="low"))
        return Finding(id="f_planning", topic="planning", status="limited", confidence="low", evidence_ids=[ev],
                       headline="Recent planning activity could not be fully assessed (backend result limit).", limitations=limitations)
    if not apps:
        ev = ledger.add(Evidence(id="ev_planning_none", kind="planning_none",
                                 statement=f"No planning applications received since {cutoff.isoformat()} were found within {radius_m} m.",
                                 values=[EvidenceValue(name="radius_m", value=radius_m, unit="m"), EvidenceValue(name="applications", value=0, unit="count")],
                                 tool=tool, confidence="medium"))
        return Finding(id="f_planning", topic="planning", headline=f"No recent planning applications within {radius_m} m.",
                       evidence_ids=[ev], confidence="medium", limitations=limitations)

    granted = sum(1 for a in apps if a["_decision"] == "granted")
    pending = sum(1 for a in apps if a["_decision"] in ("pending_or_unknown", "further_information_requested"))
    ledger.add(Evidence(
        id="ev_planning_summary", kind="planning_summary",
        statement=(("Among the nearest recorded applications, at least " if capped else "")
                   + f"{stats.plural(len(apps), 'planning application')} received since {cutoff.isoformat()} "
                   f"{'lies' if len(apps) == 1 else 'lie'} within {radius_m} m: "
                   f"{granted} recorded as granted and {pending} pending or awaiting further information."),
        values=[EvidenceValue(name="applications", value=len(apps), unit="count"), EvidenceValue(name="granted", value=granted, unit="count"),
                EvidenceValue(name="pending", value=pending, unit="count"), EvidenceValue(name="radius_m", value=radius_m, unit="m"),
                EvidenceValue(name="years", value=RECENT_YEARS, unit="years")],
        source=src, tool=tool, confidence="medium" if capped else "high"))
    evidence_ids = ["ev_planning_summary"]
    flags: list[str] = []
    notable = [a for a in apps if {"student_accommodation", "large_residential_lrd_shd", "large_residential", "build_to_rent", "hotel"} & set(a["_cats"])]
    for i, a in enumerate(notable[:5]):
        ev_id = f"ev_planning_app_{i + 1}"
        units_txt = f" ({a['_units']} units/bed spaces stated)" if a["_units"] else ""
        decision_txt = (a.get("decision") or a.get("status") or "no decision recorded").strip()
        ledger.add(Evidence(
            id=ev_id, kind="planning_application",
            statement=(f"Application {a.get('application_ref')}, received {a['_date'].isoformat()}, {a.get('distance_m', 0):.0f} m away{units_txt}; "
                       f"recorded decision/status: {decision_txt}. Proposal: {(a.get('proposal') or '')[:300]}"),
            values=[EvidenceValue(name="distance_m", value=round(a.get("distance_m") or 0), unit="m"),
                    EvidenceValue(name="units", value=a["_units"], unit="count"),
                    EvidenceValue(name="application_ref", value=str(a.get("application_ref"))),
                    EvidenceValue(name="year", value=a["_date"].year)],
            source=source_ref(a.get("source")), period=a["_date"].isoformat(), tool=tool, confidence="high",
            caveats=["Category inferred from the proposal text by keyword rules."]))
        evidence_ids.append(ev_id)
    if any("student_accommodation" in a["_cats"] for a in notable):
        flags.append("student_accommodation_nearby")
    if any({"large_residential", "large_residential_lrd_shd", "build_to_rent"} & set(a["_cats"]) for a in notable):
        flags.append("large_residential_nearby")
    if any(a["_decision"] in ("pending_or_unknown", "further_information_requested") and a in notable for a in apps):
        flags.append("pending_major_application")
    items = [{"application_ref": a.get("application_ref"), "application_date": a["_date"].isoformat(), "distance_m": a.get("distance_m"),
              "decision": a.get("decision"), "status": a.get("status"), "decision_normalised": a["_decision"], "categories": a["_cats"],
              "units": a["_units"], "proposal": a.get("proposal"), "location": a.get("location")} for a in apps[:50]]
    headline = (f"{stats.plural(len(apps), 'planning application')} within {radius_m} m since {cutoff.year}; "
                f"{len(notable)} notable (large residential, student accommodation or hotel schemes).")
    return Finding(id="f_planning", topic="planning", headline=headline, evidence_ids=evidence_ids, confidence="high", flags=flags,
                   metrics=[EvidenceValue(name="applications", value=len(apps), unit="count"), EvidenceValue(name="notable", value=len(notable), unit="count")],
                   items=items, limitations=limitations)


async def investigate_sales(tools: ToolClient, property_id: str, ledger: EvidenceLedger, today: date | None = None) -> Finding:
    today = today or date.today()
    try:
        res = await tools.property_sales(property_id, radius_m=1000, years=3)
    except ToolError as exc:
        return Finding(id="f_sales", topic="sales", status="unavailable", confidence="low",
                       headline="Property sales data could not be retrieved.", limitations=[str(exc)])
    rows = []
    for r in res.get("results", []):
        d = parse_date(r.get("sale_date"))
        price = (r.get("price") or {}).get("amount_eur") if isinstance(r.get("price"), dict) else r.get("price")
        if d and isinstance(price, (int, float)) and price > 0 and d.year >= today.year - 3:
            rows.append((d, float(price), r))
    note = "Sale prices are historical sales evidence only and are not rental values."
    if not rows:
        return Finding(id="f_sales", topic="sales", status="unavailable", confidence="low",
                       headline="No recent Property Price Register sales matched near this property.", limitations=[note])
    prices = [p for _, p, _ in rows]
    med = stats.median(prices)
    ledger.add(Evidence(id="ev_sales_summary", kind="sales_summary",
                        statement=f"Among the sales the backend returned (up to 50), the Property Price Register lists {stats.plural(len(rows), 'sale')} nearby since {today.year - 3}, with a median price of €{med:,.0f}.",
                        values=[EvidenceValue(name="sales", value=len(rows), unit="count"), EvidenceValue(name="median_price", value=stats.round_eur(med), unit="EUR")],
                        source=source_ref(rows[0][2].get("source")), tool=ToolCallRef(name="getPropertySales"), confidence="medium", caveats=[note]))
    return Finding(id="f_sales", topic="sales", headline=f"{stats.plural(len(rows), 'nearby sale')} since {today.year - 3}, median €{med:,.0f} (context only).",
                   evidence_ids=["ev_sales_summary"], confidence="medium",
                   items=[{"sale_date": d.isoformat(), "price_eur": p, "address": (r.get("address") or {}).get("raw")} for d, p, r in rows[:20]],
                   limitations=[note])

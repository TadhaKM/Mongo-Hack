"""Orchestrator: resolves the property through the backend and decides which investigations to run.

Deterministic rules on purpose: the plan (and each reason) is shown to the user, so it must be
reproducible and explainable. No LLM is needed to decide that a property needs a rent benchmark.
"""
from __future__ import annotations

from typing import Any

from rentcheck_agents.location import routing_centroid
from rentcheck_agents.models import PlanStep, PropertyInput
from rentcheck_agents.tools.base import ToolClient, ToolError


class LocationError(RuntimeError):
    pass


async def resolve_property(tools: ToolClient, inp: PropertyInput) -> tuple[dict[str, Any], str, str]:
    """Return (property doc, precision, how) where precision is point | geocoded | routing_area."""
    if inp.property_id:
        return await tools.get_property(inp.property_id), "point", "existing property record"

    base = {"address": inp.address or inp.eircode or "Map location", "eircode": inp.eircode,
            "property_type": inp.property_type, "bedrooms": inp.bedrooms}
    if inp.latitude is not None and inp.longitude is not None:
        if not inp.address and not inp.eircode:
            base["address"] = f"Map location {inp.latitude:.5f}, {inp.longitude:.5f}"
        doc = await tools.create_property({**base, "latitude": inp.latitude, "longitude": inp.longitude})
        return doc, "point", "map location supplied by the user"

    if not inp.address and not inp.eircode:
        raise LocationError("Provide a map location, an Eircode or an address.")
    try:
        doc = await tools.create_property({**base, "latitude": None, "longitude": None})
        return doc, "geocoded", f"address geocoded by the backend ({(doc.get('geocode') or {}).get('provider', 'geocoder')})"
    except ToolError as exc:
        fallback = routing_centroid(inp.eircode) or routing_centroid(inp.address)
        if not fallback:
            raise LocationError(f"Could not locate '{inp.label()}': {exc}") from exc
        lon, lat, name = fallback
        doc = await tools.create_property({**base, "latitude": lat, "longitude": lon})
        return doc, "routing_area", f"approximate centre of Eircode routing area {name} (geocoding failed)"


def build_plan(prop: dict[str, Any], inp: PropertyInput, precision: str) -> list[PlanStep]:
    geo = prop.get("geography") or {}
    rtb = (geo.get("rtb_area") or {})
    sa = (geo.get("small_area") or {})
    approx = precision == "routing_area"
    beds = f"{inp.bedrooms}-bed {inp.property_type}"
    steps = [
        PlanStep(step="rent", label="Benchmark the asking rent",
                 reason=(f"Compare €{inp.monthly_rent:,.0f} with RTB registered rents for {beds} homes in {rtb.get('name') or rtb.get('code')}."
                         if rtb.get("code") else
                         "RTB rental area not resolved for this location; will check and report limited local data rather than use other areas.")),
        PlanStep(step="trend", label="Check the rent trend", reason="See how the same RTB area/profile has moved over recent quarters."),
        PlanStep(step="transport", label="Analyse transport access",
                 reason="Find Luas, rail and bus stops within 800 m" + (" (approximate location, distances indicative)." if approx else ".")),
        PlanStep(step="neighbourhood", label="Profile the neighbourhood",
                 reason=(f"Census 2022 and vacancy figures for small area {sa.get('name') or sa.get('code')}." if sa.get("code")
                         else "Small area not resolved; will report that census context is unavailable."),
                 will_run=True),
        PlanStep(step="planning", label="Look for nearby developments", reason="Planning applications within 1 km in the last 3 years."),
        PlanStep(step="sales", label="Check sales context", reason="Property Price Register sales nearby, as context only (not rental value)."),
    ]
    if inp.listing_text:
        steps.insert(0, PlanStep(step="listing", label="Read the listing", reason="Extract stated facts and check them against what you entered."))
    steps.append(PlanStep(step="report", label="Write the evidence-backed report",
                          reason="Every claim must cite evidence; a verifier removes anything ungrounded."))
    return steps

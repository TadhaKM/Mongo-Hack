"""End-to-end analysis pipeline, exposed as an async stream of progress events.

    async for event in run_analysis(PropertyInput(...)):
        ...  # event.type in plan | step | report | error
"""
from __future__ import annotations

import asyncio
import logging
import time
from datetime import date
from typing import Any, AsyncIterator
from uuid import uuid4

from rentcheck_agents import stats
from rentcheck_agents.investigators.development import investigate_planning, investigate_sales
from rentcheck_agents.investigators.location import investigate_neighbourhood, investigate_transport
from rentcheck_agents.investigators.rent import investigate_rent, investigate_trend
from rentcheck_agents.models import (
    Event, Evidence, EvidenceLedger, EvidenceValue, Finding, PropertyInput, Report, utcnow,
)
from rentcheck_agents.planner import LocationError, build_plan, resolve_property
from rentcheck_agents.prompts import PROMPT_VERSION
from rentcheck_agents.store import AnalysisStore, get_store
from rentcheck_agents.tools.base import ToolClient, ToolError, get_tool_client, jsonable
from rentcheck_agents.writer import extract_listing, llm_report, template_report

log = logging.getLogger(__name__)

# Raw tool output is also stored under Person 4's evidence keys so their /analysis/{id}/<section> routes work.
RAW_KEYS = {"rental_comparables": "rental", "nearby_transport": "transport", "nearby_planning": "planning",
            "neighbourhood": "neighbourhood", "property_sales": "sales", "rental_history": "rental_history"}


class RecordingTools:
    """Wraps a ToolClient and records every call (name, params, duration, ok) for the agent trace."""

    def __init__(self, inner: ToolClient):
        self.inner, self.name = inner, inner.name
        self.calls: list[dict[str, Any]] = []
        self.raw: dict[str, Any] = {}

    def __getattr__(self, attr):
        fn = getattr(self.inner, attr)
        if not callable(fn) or attr.startswith("_") or attr == "aclose":
            return fn

        async def wrapped(*args, **kwargs):
            t0 = time.perf_counter()
            entry = {"tool": attr, "params": jsonable({k: v for k, v in kwargs.items()}), "ok": True}
            try:
                result = await fn(*args, **kwargs)
                if attr in RAW_KEYS and RAW_KEYS[attr] not in self.raw:
                    self.raw[RAW_KEYS[attr]] = result
                return result
            except ToolError as exc:
                entry.update(ok=False, error=str(exc))
                raise
            finally:
                entry["ms"] = round((time.perf_counter() - t0) * 1000)
                self.calls.append(entry)
        return wrapped


def _listing_finding(facts, inp: PropertyInput, ledger: EvidenceLedger) -> Finding:
    if facts is None:
        return Finding(id="f_listing", topic="listing", status="unavailable", confidence="low",
                       headline="Listing text could not be analysed (language model unavailable).")
    values, flags, notes = [], [], []
    for name, val, unit in (("listing_rent", facts.monthly_rent_eur, "EUR/month"), ("listing_bedrooms", facts.bedrooms, None),
                            ("listing_floor_area_m2", facts.floor_area_m2, "m2"), ("listing_deposit", facts.deposit_eur, "EUR")):
        if val is not None:
            values.append(EvidenceValue(name=name, value=val, unit=unit))
    if facts.monthly_rent_eur and abs(facts.monthly_rent_eur - inp.monthly_rent) > 1:
        flags.append("listing_rent_mismatch")
        notes.append(f"the listing states €{facts.monthly_rent_eur:,.0f} per month but €{inp.monthly_rent:,.0f} was entered")
    if facts.bedrooms is not None and facts.bedrooms != inp.bedrooms:
        flags.append("listing_bedrooms_mismatch")
        notes.append(f"the listing states {facts.bedrooms} bedrooms but {inp.bedrooms} was entered")
    if facts.red_flags:
        flags.append("listing_red_flag")
        notes.append("the listing contains phrases worth querying: " + "; ".join(f'"{r}"' for r in facts.red_flags[:3]))
    stated = [f"{k.replace('_', ' ')}: {v}" for k, v in (("BER", facts.ber_rating), ("furnished", facts.furnished),
                                                          ("bills included", facts.bills_included), ("available from", facts.available_from)) if v is not None]
    statement = "From the pasted listing text: " + ("; ".join(stated) if stated else "no structured facts were stated") + "."
    if notes:
        statement += " Note: " + "; ".join(notes) + "."
    ev = ledger.add(Evidence(id="ev_listing", kind="listing", statement=statement, values=values, derived=True,
                             confidence="medium", confidence_reasons=["Extracted by a language model from user-supplied text; red flags verified to appear verbatim."],
                             caveats=["Listing text is supplied by the user and not independently verified."]))
    return Finding(id="f_listing", topic="listing", headline=statement, evidence_ids=[ev], confidence="medium", flags=flags,
                   items=[facts.model_dump()])


def _step_detail(f: Finding) -> str:
    return f.headline


async def run_analysis(inp: PropertyInput, tools: ToolClient | None = None, store: AnalysisStore | None = None,
                       use_llm: bool = True, today: date | None = None) -> AsyncIterator[Event]:
    analysis_id = f"analysis_{uuid4().hex[:12]}"
    own_tools = tools is None
    rec = RecordingTools(tools or get_tool_client())
    store = store or get_store()
    ledger = EvidenceLedger()
    events: list[Event] = []
    t_start = time.perf_counter()

    def emit(**kw) -> Event:
        ev = Event(analysis_id=analysis_id, **kw)
        events.append(ev)
        return ev

    try:
        yield emit(type="step", step="locate", status="running", label="Locating the property")
        try:
            prop, precision, how = await resolve_property(rec, inp)
        except (LocationError, ToolError) as exc:
            yield emit(type="error", step="locate", status="failed", label="Could not locate the property", detail=str(exc))
            return
        pid = prop.get("property_id") or prop.get("_id")
        geo = prop.get("geography") or {}
        area_bits = [x.get("name") for x in (geo.get("local_authority") or {}, geo.get("small_area") or {}) if x and x.get("name")]
        yield emit(type="step", step="locate", status="done", label="Property identified",
                   detail=f"{prop.get('address', {}).get('raw') or inp.label()} — {how}" + (f"; {', '.join(area_bits)}" if area_bits else ""),
                   data={"property_id": pid, "location": prop.get("location"), "precision": precision})
        ledger.findings.append(Finding(id="f_overview", topic="overview", headline=f"{inp.bedrooms}-bed {inp.property_type}, asking €{inp.monthly_rent:,.0f}/month.",
                                       metrics=[EvidenceValue(name="asking_rent", value=inp.monthly_rent, unit="EUR/month"),
                                                EvidenceValue(name="bedrooms", value=inp.bedrooms)],
                                       items=[{"location": prop.get("location"), "geography": geo, "precision": precision}]))

        plan = build_plan(prop, inp, precision)
        yield emit(type="plan", label="Investigation plan", detail=f"{len(plan)} steps", data={"steps": [s.model_dump() for s in plan]})

        # ---- investigations (concurrent; events emitted as each finishes)
        queue: asyncio.Queue = asyncio.Queue()

        async def run(step: str, coro):
            try:
                result = await coro
            except Exception as exc:  # an investigator bug must not kill the report
                log.exception("investigator %s failed", step)
                result = Finding(id=f"f_{step}", topic=step if step in ("transport", "neighbourhood", "planning", "sales") else "overview",
                                 status="unavailable", confidence="low", headline=f"{step} analysis failed: {exc}")
            await queue.put((step, result))

        async def rent_then_trend():
            try:
                f_rent = await investigate_rent(rec, pid, inp, ledger, today)
            except Exception as exc:  # always enqueue a rent finding so the event loop below cannot hang
                log.exception("rent investigator failed")
                f_rent = Finding(id="f_rent", topic="rent", status="unavailable", confidence="low", headline=f"Rent analysis failed: {exc}")
            await queue.put(("rent", f_rent))
            return await investigate_trend(rec, pid, inp, ledger, f_rent, today)

        jobs = {
            "trend": rent_then_trend(),
            "transport": investigate_transport(rec, pid, ledger, precise=precision != "routing_area"),
            "neighbourhood": investigate_neighbourhood(rec, pid, ledger),
            "planning": investigate_planning(rec, pid, ledger, today),
            "sales": investigate_sales(rec, pid, ledger, today),
        }
        if inp.listing_text and use_llm:
            async def listing():
                return _listing_finding(await extract_listing(inp.listing_text), inp, ledger)
            jobs["listing"] = listing()
        labels = {"rent": ("Retrieving rental market data", "Rental market data analysed"), "trend": ("Checking rent trend", "Rent trend analysed"),
                  "transport": ("Analysing transport", "Transport analysed"), "neighbourhood": ("Profiling neighbourhood", "Neighbourhood profiled"),
                  "planning": ("Searching planning applications", "Local planning data analysed"), "sales": ("Checking sales context", "Sales context checked"),
                  "listing": ("Reading the listing", "Listing analysed")}
        for step in ["rent", *jobs.keys()]:
            yield emit(type="step", step=step, status="running", label=labels[step][0])
        tasks = [asyncio.create_task(run(step, coro)) for step, coro in jobs.items()]
        expected = len(jobs) + 1  # + rent
        for _ in range(expected):
            step, finding = await queue.get()
            ledger.findings.append(finding)
            status = "done" if finding.status == "ok" else ("skipped" if finding.status == "unavailable" else "done")
            yield emit(type="step", step=step, status=status, label=labels[step][1] if finding.status != "unavailable" else finding.headline,
                       detail=_step_detail(finding), data={"status": finding.status, "confidence": finding.confidence, "flags": finding.flags})
        await asyncio.gather(*tasks)

        # ---- report
        yield emit(type="step", step="report", status="running", label="Generating report",
                   detail=f"{len(ledger.evidence)} evidence items from {len({c['tool'] for c in rec.calls})} backend tools")
        prop_summary = {"property_id": pid, "address": (prop.get("address") or {}).get("raw"), "eircode": inp.eircode,
                        "location": prop.get("location"), "precision": precision, "geography": geo,
                        "monthly_rent": inp.monthly_rent, "bedrooms": inp.bedrooms, "property_type": inp.property_type,
                        "floor_area_m2": inp.floor_area_m2, "furnished": inp.furnished}
        dropped: list[dict] = []
        if use_llm:
            report, dropped = await llm_report(analysis_id, prop_summary, ledger, inp)
        else:
            report = template_report(analysis_id, prop_summary, ledger, inp)
        yield emit(type="step", step="report", status="done", label="Report ready",
                   detail=f"written by {'Gemini (' + (report.model or '') + ')' if report.generated_by == 'llm' else 'template'}; "
                          f"{len(dropped)} unsupported claim(s) removed by the verifier")

        doc = {
            "_id": analysis_id, "property_id": pid, "status": "complete", "created_at": utcnow(),
            "requested": list(jobs.keys()) + ["rent"], "evidence": jsonable(rec.raw),
            "sources": [s.model_dump() for s in report.sources],
            "report": report.model_dump(mode="json"),
            "agent": {"plan": [s.model_dump() for s in plan], "events": [e.model_dump(mode="json") for e in events],
                      "tool_calls": rec.calls, "findings": [f.model_dump(mode="json") for f in ledger.findings],
                      "evidence": [e.model_dump(mode="json") for e in ledger.evidence], "dropped_claims": dropped,
                      "model": report.model, "prompt_version": PROMPT_VERSION, "tool_client": rec.name,
                      "duration_ms": round((time.perf_counter() - t_start) * 1000)},
        }
        try:
            await store.save(doc)
        except Exception as exc:
            log.warning("could not persist analysis %s: %s", analysis_id, exc)
        yield emit(type="report", label="Know Before You Rent report", data=report.model_dump(mode="json"))
    finally:
        if own_tools:
            await rec.inner.aclose()


async def analyse(inp: PropertyInput, **kwargs) -> tuple[Report | None, list[Event]]:
    """Non-streaming convenience wrapper: returns (report, events)."""
    events, report = [], None
    async for ev in run_analysis(inp, **kwargs):
        events.append(ev)
        if ev.type == "report":
            report = Report.model_validate(ev.data)
    return report, events

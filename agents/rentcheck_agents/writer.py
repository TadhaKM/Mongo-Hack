"""Report writer: Gemini phrases the evidence; a template builds the same report without any LLM."""
from __future__ import annotations

import json
import logging

from rentcheck_agents.llm import LLMUnavailable, generate_structured, llm_available
from rentcheck_agents.models import (
    Claim, EvidenceLedger, ListingFacts, PropertyInput, Report, ReportSection, SourceRef, WriterOutput,
)
from rentcheck_agents.prompts import EXTRACTOR_SYSTEM, SECTION_IDS, WRITER_SYSTEM
from rentcheck_agents.verifier import verify_claims

log = logging.getLogger(__name__)

SECTION_META = {
    # section id: (title, finding topics)
    "overview": ("Property overview", ["overview", "listing"]),
    "rent_analysis": ("Rental price analysis", ["rent"]),
    "rent_trend": ("Historical rent trend", ["trend"]),
    "transport": ("Transport accessibility", ["transport"]),
    "neighbourhood": ("Neighbourhood", ["neighbourhood"]),
    "developments": ("Nearby developments", ["planning", "sales"]),
    "considerations": ("Things to consider", []),
}

QUESTION_BANK = {
    "above_benchmark": "Can you confirm the rent previously registered with the RTB for this property, and how the asking rent was set?",
    "well_above_benchmark": "The asking rent is well above the RTB area average; what features or recent works justify the difference?",
    "benchmark_stale": "Has the rent for this property changed in the last year, and when was it last registered with the RTB?",
    "fast_rising_area": "Rents in this area have risen quickly; how are future rent reviews handled in the lease?",
    "large_residential_nearby": "Is any construction planned next to the building, and how might it affect noise or access?",
    "student_accommodation_nearby": "Is the building or street popular with students, and how does that affect noise in term time?",
    "pending_major_application": "Do you know the status of the nearby planning applications?",
    "no_transport_800m": "What are the realistic commute options from this address?",
    "insufficient_rent_data": "What rent did previous tenants pay, and is it registered with the RTB?",
    "listing_rent_mismatch": "The listing and the rent you entered differ; which figure is correct?",
    "listing_red_flag": "Can you view the property in person before paying any deposit?",
}
ALWAYS_QUESTIONS = [
    "Is the tenancy registered with the RTB, and what deposit and advance rent are required?",
    "What is the BER rating, and which bills (heating, electricity, bins, broadband) are included?",
]


def _sources(ledger: EvidenceLedger) -> list[SourceRef]:
    seen, out = set(), []
    for ev in ledger.evidence:
        if ev.source and (ev.source.dataset, ev.source.source_url) not in seen:
            seen.add((ev.source.dataset, ev.source.source_url))
            out.append(ev.source)
    return out


def _flag_questions(ledger: EvidenceLedger) -> list[Claim]:
    out: list[Claim] = []
    for f in ledger.findings:
        for flag in f.flags:
            if flag in QUESTION_BANK and all(q.text != QUESTION_BANK[flag] for q in out):
                out.append(Claim(text=QUESTION_BANK[flag], claim_type="question", evidence_ids=f.evidence_ids[:1]))
    out += [Claim(text=q, claim_type="question") for q in ALWAYS_QUESTIONS]
    return out[:7]


def _template_claims(ledger: EvidenceLedger, topics: list[str]) -> list[Claim]:
    claims = []
    for f in ledger.findings:
        if f.topic not in topics:
            continue
        for ev_id in f.evidence_ids:
            ev = ledger.get(ev_id)
            if ev:
                claims.append(Claim(text=ev.statement, claim_type="interpretation" if ev.derived else "fact", evidence_ids=[ev_id]))
        if not f.evidence_ids:
            claims.append(Claim(text=f.headline, claim_type="fact"))
    return claims


def _considerations(ledger: EvidenceLedger) -> list[Claim]:
    out = []
    rent = ledger.finding("rent")
    if rent and rent.evidence_ids:
        out.append(Claim(text="RTB figures are area averages for new tenancies. A specific home can reasonably differ from them "
                              "because of its size, condition, BER rating or furnishing.", claim_type="interpretation", evidence_ids=rent.evidence_ids[:1]))
        out.append(Claim(text="The asking rent is an advertised price, while RTB figures are rents registered for new tenancies "
                              "and are published with a delay.", claim_type="interpretation", evidence_ids=rent.evidence_ids[:1]))
    return out


def build_sections(ledger: EvidenceLedger, claims_by_section: dict[str, list[Claim]]) -> list[ReportSection]:
    sections = []
    for sid, (title, topics) in SECTION_META.items():
        fs = [f for f in ledger.findings if f.topic in topics]
        if sid == "considerations":
            status, conf = "ok", None
        elif not fs:
            status, conf = "unavailable", None
        else:
            order = {"ok": 0, "limited": 1, "unavailable": 2}
            status = min((f.status for f in fs), key=lambda s: order[s])
            conf = fs[0].confidence
        sections.append(ReportSection(
            id=sid, title=title, status=status, confidence=conf, claims=claims_by_section.get(sid, []),
            metrics=[m for f in fs for m in f.metrics], items=[i for f in fs for i in f.items],
            evidence_ids=[e for f in fs for e in f.evidence_ids], limitations=[l for f in fs for l in f.limitations]))
    return sections


def template_report(analysis_id: str, prop: dict, ledger: EvidenceLedger, inp: PropertyInput) -> Report:
    claims = {sid: _template_claims(ledger, topics) for sid, (_, topics) in SECTION_META.items()}
    claims["considerations"] = _considerations(ledger)
    summary = [Claim(text=f.headline, claim_type="fact", evidence_ids=f.evidence_ids[:2])
               for f in ledger.findings if f.topic in ("rent", "transport", "planning") and f.status != "unavailable"]
    return Report(analysis_id=analysis_id, property=prop, summary=summary, sections=build_sections(ledger, claims),
                  questions_to_ask=_flag_questions(ledger), sources=_sources(ledger), limitations=_limitations(ledger),
                  evidence=ledger.evidence, generated_by="template")


def _limitations(ledger: EvidenceLedger) -> list[str]:
    out = []
    for f in ledger.findings:
        for l in f.limitations:
            if l not in out:
                out.append(l)
    out.append("Amenities (shops, schools, parks) are not assessed because no amenities dataset is loaded.")
    return out


def _ledger_prompt(ledger: EvidenceLedger, inp: PropertyInput, prop: dict) -> str:
    evidence = [{"id": e.id, "statement": e.statement, "values": [v.model_dump() for v in e.values], "period": e.period,
                 "geography": e.geography, "confidence": e.confidence, "derived": e.derived, "caveats": e.caveats,
                 "dataset": e.source.dataset if e.source else None} for e in ledger.evidence]
    findings = [{"topic": f.topic, "headline": f.headline, "status": f.status, "confidence": f.confidence, "flags": f.flags,
                 "evidence_ids": f.evidence_ids, "limitations": f.limitations} for f in ledger.findings]
    renter = {"asking_rent_eur_per_month": inp.monthly_rent, "bedrooms": inp.bedrooms, "property_type": inp.property_type,
              "floor_area_m2": inp.floor_area_m2, "furnished": inp.furnished, "location_label": inp.label()}
    return ("RENTER INPUTS:\n" + json.dumps(renter, ensure_ascii=False) + "\n\nFINDINGS:\n" + json.dumps(findings, ensure_ascii=False, default=str)
            + "\n\nEVIDENCE LEDGER:\n" + json.dumps(evidence, ensure_ascii=False, default=str)
            + f"\n\nWrite the report. Section ids: {', '.join(SECTION_IDS)}.")


async def llm_report(analysis_id: str, prop: dict, ledger: EvidenceLedger, inp: PropertyInput) -> tuple[Report, list[dict]]:
    """Gemini report, verified claim-by-claim. Falls back to the template for any section left empty."""
    dropped: list[dict] = []
    base = template_report(analysis_id, prop, ledger, inp)
    if not llm_available():
        return base, dropped
    try:
        out, model = await generate_structured(WriterOutput, WRITER_SYSTEM, _ledger_prompt(ledger, inp, prop))
    except LLMUnavailable as exc:
        log.warning("writer falling back to template: %s", exc)
        dropped.append({"where": "writer", "reason": f"LLM unavailable: {str(exc)[:300]}"})
        return base, dropped

    by_id = {s.id: verify_claims(s.claims, ledger, inp, s.id, dropped) for s in out.sections if s.id in SECTION_META}
    template_by_id = {s.id: s.claims for s in base.sections}
    claims = {sid: (by_id.get(sid) or template_by_id.get(sid, [])) for sid in SECTION_META}
    summary = verify_claims(out.summary, ledger, inp, "summary", dropped) or base.summary
    questions = verify_claims(out.questions_to_ask, ledger, inp, "questions", dropped)
    questions = [q.model_copy(update={"claim_type": "question"}) for q in questions] or base.questions_to_ask
    report = base.model_copy(update={"summary": summary, "sections": build_sections(ledger, claims), "questions_to_ask": questions[:7],
                                     "generated_by": "llm", "model": model})
    return report, dropped


async def extract_listing(text: str) -> ListingFacts | None:
    """Gemini extraction of listing facts; red flags kept only if they literally occur in the text."""
    if not text or not llm_available():
        return None
    try:
        facts, _ = await generate_structured(ListingFacts, EXTRACTOR_SYSTEM, "LISTING TEXT:\n" + text[:6000], temperature=0.0)
    except LLMUnavailable:
        return None
    low = text.lower()
    from rentcheck_agents.verifier import numbers_in
    present = set(numbers_in(text))
    # numeric facts must literally appear in the listing text (no inferred or converted values)
    for field in ("monthly_rent_eur", "bedrooms", "bathrooms", "floor_area_m2", "deposit_eur"):
        val = getattr(facts, field)
        if val is not None and float(val) not in present:
            setattr(facts, field, None)
    facts.red_flags = [f for f in facts.red_flags
                       if f and len(f.strip()) >= 8 and len(f.split()) >= 2 and f.lower().strip(" .") in low]
    facts.notable_features = [f for f in facts.notable_features if f][:8]
    return facts

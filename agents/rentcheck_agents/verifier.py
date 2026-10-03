"""Deterministic grounding checks for LLM-written claims.

A claim survives only if (a) every cited evidence id exists, (b) facts/interpretations cite at least one id,
(c) every number in the text appears in the cited evidence or the renter's own inputs, and (d) it contains no
verdict language.
"""
from __future__ import annotations

import re

from rentcheck_agents.models import Claim, EvidenceLedger, PropertyInput

NUM_RE = re.compile(r"(?<![A-Za-z])[-+]?\d[\d,]*(?:\.\d+)?")
VERDICT_RE = re.compile(r"\b(over-?priced|under-?priced|bargain|good deal|bad deal|great deal|rip-?off|scam|"
                        r"you should(?:n't| not)?|must not rent|avoid this|steal|fair(?:ly)? price[d]?|reasonably priced|"
                        r"good value|poor value|worth it|too expensive|expensive|cheap)\b", re.I)
# RTB data is aggregate: never let the writer imply individual comparable properties.
AGGREGATE_RE = re.compile(r"\bcomparable (?:propert|home|flat|apartment|house|listing|unit)|\bcomparables\b|\bsimilar properties\b", re.I)
NUMBER_WORDS = {"two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen",
                "fifteen", "sixteen", "seventeen", "eighteen", "nineteen", "twenty", "thirty", "forty", "fifty", "sixty", "seventy",
                "eighty", "ninety", "hundred", "hundreds", "thousand", "thousands", "dozen", "dozens", "million", "double", "triple", "half"}
WORD_RE = re.compile(r"[a-z]+")
ESTIMATE_KINDS = {"rent_trend_adjusted"}
ESTIMATE_WORDS = re.compile(r"\b(estimat|project|if the|would be|assum)", re.I)


def numbers_in(text: str) -> list[float]:
    out = []
    for m in NUM_RE.finditer(text or ""):
        s = m.group(0).replace(",", "").lstrip("+")
        try:
            out.append(abs(float(s)))
        except ValueError:
            continue
    return out


def _allowed_numbers(claim: Claim, ledger: EvidenceLedger, inp: PropertyInput | None) -> set[float]:
    allowed: set[float] = set()
    for ev_id in claim.evidence_ids:
        ev = ledger.get(ev_id)
        if not ev:
            continue
        allowed.update(abs(n) for n in ev.numbers())
        allowed.update(numbers_in(ev.statement))
        allowed.update(numbers_in(ev.period or ""))
        allowed.update(numbers_in(ev.geography or ""))
    if inp:
        allowed.update(abs(float(x)) for x in (inp.monthly_rent, inp.bedrooms, inp.floor_area_m2) if x is not None)
        allowed.update(numbers_in(inp.address or "") + numbers_in(inp.eircode or ""))
    return allowed


def _matches(x: float, allowed: set[float]) -> bool:
    """Exact match, or the same value rounded (2235.4 -> 2235, 9.46 -> 9.5). Years must match exactly."""
    for a in allowed:
        if x == a or round(a) == x or round(a, 1) == x:
            return True
        if not (x.is_integer() and 1990 <= x <= 2100) and abs(x - a) <= 0.051:
            return True
    return False


def check_claim(claim: Claim, ledger: EvidenceLedger, inp: PropertyInput | None = None, allow_questions: bool = True) -> str | None:
    """Return None if the claim is grounded, else a reason string."""
    unknown = [i for i in claim.evidence_ids if ledger.get(i) is None]
    if unknown:
        return f"cites unknown evidence ids {unknown}"
    is_question = claim.claim_type == "question" and allow_questions
    if not is_question and not claim.evidence_ids:
        return "fact/interpretation without evidence ids"
    if VERDICT_RE.search(claim.text):
        return "verdict language"
    if AGGREGATE_RE.search(claim.text):
        return "describes aggregate RTB data as comparable properties"
    cited = [ledger.get(i) for i in claim.evidence_ids]
    cited_words = set(WORD_RE.findall(" ".join(e.statement.lower() for e in cited)))
    words = [w for w in WORD_RE.findall(claim.text.lower()) if w in NUMBER_WORDS and w not in cited_words]
    if words:
        return f"spelled-out quantities not in cited evidence: {words}"
    if any(e.kind in ESTIMATE_KINDS for e in cited) and not ESTIMATE_WORDS.search(claim.text):
        return "states a projection without saying it is an estimate"
    allowed = _allowed_numbers(claim, ledger, inp)
    bad = [n for n in numbers_in(claim.text) if not _matches(n, allowed)]
    if bad:
        return f"numbers not in cited evidence: {bad}"
    return None


def verify_claims(claims: list[Claim], ledger: EvidenceLedger, inp: PropertyInput | None, where: str,
                  dropped: list[dict]) -> list[Claim]:
    kept = []
    for c in claims:
        # outside the questions list, a "question" label must not let a claim skip the evidence requirement
        reason = check_claim(c, ledger, inp, allow_questions=(where == "questions"))
        if reason is None:
            kept.append(c)
        else:
            dropped.append({"where": where, "text": c.text, "evidence_ids": c.evidence_ids, "reason": reason})
    return kept

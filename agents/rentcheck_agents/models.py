"""Data contracts for the agent layer.

Schemas are kept flat (lists of sub-models, no dict-valued fields in LLM-facing models) because
Gemini structured output handles flat JSON Schema most reliably.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Literal

from pydantic import BaseModel, Field

Confidence = Literal["high", "medium", "low"]
SectionStatus = Literal["ok", "limited", "unavailable"]


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


# ---------------------------------------------------------------- input

class PropertyInput(BaseModel):
    """What the user typed or clicked. Either a map point, an Eircode or an address is required."""
    address: str | None = None
    eircode: str | None = None
    latitude: float | None = Field(default=None, ge=-90, le=90)
    longitude: float | None = Field(default=None, ge=-180, le=180)
    monthly_rent: float = Field(gt=0, le=50000)
    bedrooms: int = Field(ge=0, le=20)
    property_type: str = "apartment"
    floor_area_m2: float | None = Field(default=None, gt=0, le=2000)
    furnished: bool | None = None
    listing_text: str | None = None
    property_id: str | None = None  # reuse a property already created through POST /property

    def label(self) -> str:
        return self.address or self.eircode or (
            f"{self.latitude:.5f}, {self.longitude:.5f}" if self.latitude is not None and self.longitude is not None else "unknown location"
        )


# ---------------------------------------------------------------- evidence

class EvidenceValue(BaseModel):
    name: str
    value: float | str | None
    unit: str | None = None  # "EUR/month", "%", "m", "count", "min" ...


class SourceRef(BaseModel):
    organisation: str | None = None
    dataset: str | None = None
    source_url: str | None = None
    retrieved_at: str | None = None
    dataset_date: str | None = None


class ToolCallRef(BaseModel):
    """Which backend tool produced the data, so any claim can be replayed."""
    name: str
    params: list[EvidenceValue] = []


class Evidence(BaseModel):
    id: str
    kind: str
    statement: str  # machine-written factual sentence; the writer may only paraphrase this
    values: list[EvidenceValue] = []
    source: SourceRef | None = None
    period: str | None = None
    geography: str | None = None
    tool: ToolCallRef | None = None
    match_method: str | None = None
    derived: bool = False  # True when computed by us (e.g. trend-adjusted estimate), not read from a dataset
    confidence: Confidence = "medium"
    confidence_reasons: list[str] = []
    caveats: list[str] = []

    def numbers(self) -> list[float]:
        out = []
        for v in self.values:
            if isinstance(v.value, (int, float)) and not isinstance(v.value, bool):
                out.append(float(v.value))
        return out


class Finding(BaseModel):
    id: str
    topic: Literal["overview", "rent", "trend", "transport", "neighbourhood", "planning", "sales", "listing"]
    headline: str
    status: SectionStatus = "ok"
    evidence_ids: list[str] = []
    confidence: Confidence = "medium"
    flags: list[str] = []
    metrics: list[EvidenceValue] = []
    items: list[dict[str, Any]] = []  # rows for UI tables/maps (stops, applications, quarters); never sent to the LLM as free text
    limitations: list[str] = []


class EvidenceLedger(BaseModel):
    evidence: list[Evidence] = []
    findings: list[Finding] = []

    def add(self, ev: Evidence) -> str:
        self.evidence = [e for e in self.evidence if e.id != ev.id] + [ev]
        return ev.id

    def get(self, ev_id: str) -> Evidence | None:
        return next((e for e in self.evidence if e.id == ev_id), None)

    def finding(self, topic: str) -> Finding | None:
        return next((f for f in self.findings if f.topic == topic), None)


# ---------------------------------------------------------------- LLM output (writer)

class Claim(BaseModel):
    text: str
    claim_type: Literal["fact", "interpretation", "question"] = "fact"
    evidence_ids: list[str] = []


class WriterSection(BaseModel):
    id: str
    claims: list[Claim]


class WriterOutput(BaseModel):
    summary: list[Claim]
    sections: list[WriterSection]
    questions_to_ask: list[Claim]


class ListingFacts(BaseModel):
    """Facts the extractor may pull from pasted listing text. Every field is optional."""
    monthly_rent_eur: float | None = None
    bedrooms: int | None = None
    bathrooms: int | None = None
    property_type: str | None = None
    floor_area_m2: float | None = None
    furnished: bool | None = None
    ber_rating: str | None = None
    bills_included: bool | None = None
    deposit_eur: float | None = None
    available_from: str | None = None
    notable_features: list[str] = []
    red_flags: list[str] = Field(default=[], description="Only phrases literally present in the listing that a renter should query, e.g. 'pay deposit before viewing'.")


# ---------------------------------------------------------------- report (for the frontend)

class ReportSection(BaseModel):
    id: str
    title: str
    status: SectionStatus
    confidence: Confidence | None = None
    claims: list[Claim] = []
    metrics: list[EvidenceValue] = []
    items: list[dict[str, Any]] = []
    evidence_ids: list[str] = []
    limitations: list[str] = []


class Report(BaseModel):
    analysis_id: str
    property: dict[str, Any]
    summary: list[Claim] = []
    sections: list[ReportSection]
    questions_to_ask: list[Claim] = []
    sources: list[SourceRef] = []
    limitations: list[str] = []
    evidence: list[Evidence] = []
    generated_at: datetime = Field(default_factory=utcnow)
    generated_by: Literal["llm", "template"] = "template"
    model: str | None = None
    disclaimer: str = (
        "RentCheck is a decision-support tool. It summarises official open data about the area; "
        "it is not a valuation of this specific property and not legal or financial advice."
    )


# ---------------------------------------------------------------- progress events

class Event(BaseModel):
    type: Literal["plan", "step", "report", "error"]
    analysis_id: str
    step: str | None = None
    status: Literal["running", "done", "skipped", "failed"] | None = None
    label: str | None = None
    detail: str | None = None
    data: dict[str, Any] | None = None
    ts: datetime = Field(default_factory=utcnow)


class PlanStep(BaseModel):
    step: str
    label: str
    reason: str
    will_run: bool = True

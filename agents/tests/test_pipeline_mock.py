from rentcheck_agents import llm, writer
from rentcheck_agents.models import Claim, WriterOutput, WriterSection
from rentcheck_agents.pipeline import analyse
from tests.conftest import TODAY


async def test_template_pipeline_end_to_end(tools, store, dublin8):
    report, events = await analyse(dublin8, tools=tools, store=store, use_llm=False, today=TODAY)
    assert report is not None and report.generated_by == "template"
    ids = {e.id for e in report.evidence}
    for s in report.sections:
        for c in s.claims:
            assert set(c.evidence_ids) <= ids
    assert {s.id for s in report.sections} >= {"rent_analysis", "rent_trend", "transport", "neighbourhood", "developments"}
    assert [e.type for e in events][0] == "step" and events[-1].type == "report"
    assert any(e.type == "plan" for e in events)
    doc = await store.get(report.analysis_id)
    assert doc["report"]["analysis_id"] == report.analysis_id
    assert {"rental", "transport", "planning", "neighbourhood"} <= set(doc["evidence"])  # Person 4's evidence keys
    assert doc["agent"]["tool_calls"] and doc["agent"]["evidence"]


async def test_hard_case_reports_limits(tools, store, rural):
    report, _ = await analyse(rural, tools=tools, store=store, use_llm=False, today=TODAY)
    rent = next(s for s in report.sections if s.id == "rent_analysis")
    assert rent.status == "limited" and rent.confidence == "low"
    assert not any("€" in c.text and "average" in c.text and "was €" in c.text for c in rent.claims)


async def test_location_required(tools, store):
    from rentcheck_agents.models import PropertyInput
    report, events = await analyse(PropertyInput(monthly_rent=2000, bedrooms=2), tools=tools, store=store, use_llm=False)
    assert report is None and events[-1].type == "error"


async def test_llm_hallucinations_are_dropped(tools, store, dublin8, monkeypatch):
    async def fake_generate(model_cls, system, prompt, temperature=0.2):
        assert "EVIDENCE LEDGER" in prompt
        return WriterOutput(
            summary=[Claim(text="The asking rent of €2,200 is 1.6% below the RTB average of €2,235.", evidence_ids=["ev_rent_position"])],
            sections=[
                WriterSection(id="rent_analysis", claims=[
                    Claim(text="We found 37 comparable properties with a median of €1,980.", evidence_ids=["ev_rent_benchmark"]),  # invented
                    Claim(text="This is a bargain.", evidence_ids=["ev_rent_position"]),  # verdict
                    Claim(text="The RTB average for 2-bed apartments here was €2,235 in 2026 Q1.", evidence_ids=["ev_rent_benchmark"]),
                ]),
                WriterSection(id="transport", claims=[Claim(text="A DART station is 90 m away.", evidence_ids=["ev_does_not_exist"])]),
            ],
            questions_to_ask=[Claim(text="When was the rent last registered with the RTB?", claim_type="question")]), "fake-model"

    monkeypatch.setattr(writer, "llm_available", lambda: True)
    monkeypatch.setattr(writer, "generate_structured", fake_generate)
    report, _ = await analyse(dublin8, tools=tools, store=store, use_llm=True, today=TODAY)
    assert report.generated_by == "llm" and report.model == "fake-model"
    texts = [c.text for s in report.sections for c in s.claims]
    assert not any("37 comparable" in t or "bargain" in t or "DART" in t for t in texts)
    assert any("€2,235 in 2026 Q1" in t for t in texts)
    # transport fell back to template claims because all LLM claims there were rejected
    transport = next(s for s in report.sections if s.id == "transport")
    assert transport.claims and all(c.evidence_ids for c in transport.claims)
    doc = await store.get(report.analysis_id)
    assert len(doc["agent"]["dropped_claims"]) == 3


async def test_llm_failure_falls_back_to_template(tools, store, dublin8, monkeypatch):
    async def boom(*a, **k):
        raise llm.LLMUnavailable("429 RESOURCE_EXHAUSTED")
    monkeypatch.setattr(writer, "llm_available", lambda: True)
    monkeypatch.setattr(writer, "generate_structured", boom)
    report, _ = await analyse(dublin8, tools=tools, store=store, use_llm=True, today=TODAY)
    assert report.generated_by == "template"


def test_schema_is_gemini_clean():
    schema = llm.clean_schema(WriterOutput)
    text = str(schema)
    assert "$ref" not in text and "$defs" not in text and "'default'" not in text

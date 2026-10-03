from rentcheck_agents.models import Claim, Evidence, EvidenceLedger, EvidenceValue, PropertyInput
from rentcheck_agents.verifier import check_claim, numbers_in

LEDGER = EvidenceLedger(evidence=[Evidence(
    id="ev_rent_benchmark", kind="rent_benchmark",
    statement="The RTB average registered rent for new 2-bed apartment tenancies in Rialto was €2,010 per month in 2025 Q4.",
    values=[EvidenceValue(name="benchmark_rent", value=2010, unit="EUR/month"), EvidenceValue(name="difference_pct", value=9.5, unit="%")])])
INP = PropertyInput(latitude=53.3, longitude=-6.3, monthly_rent=2200, bedrooms=2)


def test_numbers_in_handles_euro_and_commas():
    assert numbers_in("€2,200 is 9.5% above €2,010") == [2200, 9.5, 2010]


def test_grounded_claim_passes():
    c = Claim(text="The asking rent of €2,200 is 9.5% above the RTB average of €2,010 for 2025 Q4.", evidence_ids=["ev_rent_benchmark"])
    assert check_claim(c, LEDGER, INP) is None


def test_invented_number_is_rejected():
    c = Claim(text="37 recent lettings have a median of €1,980.", evidence_ids=["ev_rent_benchmark"])
    assert "numbers not in cited evidence" in check_claim(c, LEDGER, INP)


def test_unknown_evidence_id_is_rejected():
    c = Claim(text="Rents rose.", evidence_ids=["ev_made_up"])
    assert "unknown evidence" in check_claim(c, LEDGER, INP)


def test_fact_without_evidence_is_rejected_but_question_allowed():
    assert check_claim(Claim(text="The area is popular."), LEDGER, INP) is not None
    assert check_claim(Claim(text="Is the tenancy registered with the RTB?", claim_type="question"), LEDGER, INP) is None


def test_verdict_language_is_rejected():
    c = Claim(text="This flat is overpriced.", evidence_ids=["ev_rent_benchmark"])
    assert check_claim(c, LEDGER, INP) == "verdict language"


def test_rounding_tolerance():
    c = Claim(text="About €2,010, roughly 9.5% more.", evidence_ids=["ev_rent_benchmark"])
    assert check_claim(c, LEDGER, INP) is None


def test_year_must_match_exactly():
    c = Claim(text="RTB data from 2019 shows €2,010.", evidence_ids=["ev_rent_benchmark"])
    assert check_claim(c, LEDGER, INP) is not None


def test_spelled_out_quantity_rejected():
    c = Claim(text="Thirty-seven homes average €2,010.", evidence_ids=["ev_rent_benchmark"])
    assert "spelled-out" in check_claim(c, LEDGER, INP)


def test_comparables_wording_rejected():
    c = Claim(text="Comparable properties average €2,010.", evidence_ids=["ev_rent_benchmark"])
    assert "aggregate" in check_claim(c, LEDGER, INP)


def test_question_label_cannot_skip_evidence_outside_questions():
    c = Claim(text="Did you know rents fell 40%?", claim_type="question")
    assert check_claim(c, LEDGER, INP, allow_questions=False) is not None


def test_no_loose_rounding_on_money():
    c = Claim(text="The average is €2,000.", evidence_ids=["ev_rent_benchmark"])
    assert check_claim(c, LEDGER, INP) is not None

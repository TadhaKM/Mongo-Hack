from rentcheck_agents.investigators.rent import investigate_rent, investigate_trend
from rentcheck_agents.models import EvidenceLedger, PropertyInput
from tests.conftest import TODAY


async def _pid(tools, inp):
    return (await tools.create_property({"address": inp.address, "latitude": inp.latitude, "longitude": inp.longitude,
                                         "bedrooms": inp.bedrooms, "property_type": inp.property_type}))["property_id"]


async def test_benchmark_exact_match(tools, dublin8):
    ledger = EvidenceLedger()
    f = await investigate_rent(tools, await _pid(tools, dublin8), dublin8, ledger, TODAY)
    ev = ledger.get("ev_rent_benchmark")
    assert f.status == "ok" and ev.match_method == "exact"
    assert ev.period == "2026 Q1"
    pos = {v.name: v.value for v in ledger.get("ev_rent_position").values}
    assert pos["asking_rent"] == 2200 and pos["benchmark_rent"] == ev.values[0].value


async def test_unresolved_rtb_area_refuses_to_benchmark(tools):
    # Backend returns rows from OTHER areas when rtb_area is unresolved; the agent must not use them.
    inp = PropertyInput(latitude=53.564, longitude=-7.764, monthly_rent=1400, bedrooms=2, property_type="apartment")
    ledger = EvidenceLedger()
    pid = await _pid(tools, inp)
    raw = await tools.rental_comparables(pid, bedrooms=2, property_type="apartment")
    assert raw["count"] > 0 and raw["results"][0]["match"]["geography"] == "unresolved"
    f = await investigate_rent(tools, pid, inp, ledger, TODAY)
    assert f.status == "limited" and "insufficient_rent_data" in f.flags
    assert ledger.get("ev_rent_benchmark") is None


async def test_relaxed_match_lowers_confidence(tools):
    inp = PropertyInput(latitude=53.3392, longitude=-6.2905, monthly_rent=2600, bedrooms=3, property_type="bungalow")
    ledger = EvidenceLedger()
    f = await investigate_rent(tools, await _pid(tools, inp), inp, ledger, TODAY)
    assert ledger.get("ev_rent_benchmark").match_method == "property_type_relaxed"
    assert "benchmark_relaxed" in f.flags and f.confidence in ("medium", "low")


async def test_trend_filters_to_same_profile(tools, dublin8):
    ledger = EvidenceLedger()
    pid = await _pid(tools, dublin8)
    f_rent = await investigate_rent(tools, pid, dublin8, ledger, TODAY)
    f = await investigate_trend(tools, pid, dublin8, ledger, f_rent, TODAY)
    assert f.status == "ok"
    rents = [i["average_rent_eur"] for i in f.items]
    assert rents == sorted(rents), "demo series rises monotonically; mixing 1-bed/3-bed rows would break this"
    assert ledger.get("ev_rent_trend_adjusted").derived is True


async def test_relaxed_match_collapses_to_one_row_per_quarter(tools):
    inp = PropertyInput(latitude=53.3392, longitude=-6.2905, monthly_rent=2600, bedrooms=3, property_type="bungalow")
    ledger = EvidenceLedger()
    f = await investigate_rent(tools, await _pid(tools, inp), inp, ledger, TODAY)
    periods = [i["period"] for i in f.items]
    assert len(periods) == len(set(periods))
    ev = ledger.get("ev_rent_benchmark")
    assert ev.derived and "median of 2 RTB average" in ev.statement
    spread = ledger.get("ev_rent_spread")
    q = next(v.value for v in spread.values if v.name == "quarters")
    assert f"last {int(q)} quarters" in spread.statement and q <= len(periods)

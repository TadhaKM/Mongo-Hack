import httpx
import pytest
from fastapi.testclient import TestClient
from app.main import app
from app.config import get_settings

client = TestClient(app)


@pytest.fixture(autouse=True)
def _reset_settings():
    yield
    get_settings.cache_clear()


def test_engine_routes_are_in_the_public_contract():
    paths = client.get("/openapi.json").json()["paths"]
    for p in ["/engine/health", "/engine/analyses", "/engine/analyses/{analysis_id}", "/engine/tools/{tool}"]:
        assert p in paths


def test_engine_disabled_until_configured(monkeypatch):
    monkeypatch.delenv("ENGINE_URL", raising=False)
    get_settings.cache_clear()
    r = client.post("/engine/tools/rentContext", json={"params": {}})
    assert r.status_code == 503 and "ENGINE_URL" in r.json()["detail"]


def test_forwards_to_engine_and_returns_its_envelope(monkeypatch):
    monkeypatch.setenv("ENGINE_URL", "http://engine.test")
    get_settings.cache_clear()
    seen = {}

    def fake_request(method, url, json=None, timeout=None):
        seen.update(method=method, url=url, json=json)
        return httpx.Response(200, json={"ok": True, "data": {"x": 1}, "evidence": [{"id": "ev1"}], "coverage": {}, "warnings": []}, request=httpx.Request(method, url))

    monkeypatch.setattr(httpx, "request", fake_request)
    r = client.post("/engine/tools/rentContext", json={"params": {"lng": -6.25, "lat": 53.34}, "analysis_id": "abc"})
    assert r.status_code == 200 and r.json()["evidence"][0]["id"] == "ev1"
    assert seen["url"] == "http://engine.test/tools/rentContext"
    assert seen["json"] == {"params": {"lng": -6.25, "lat": 53.34}, "analysisId": "abc"}


def test_engine_validation_errors_pass_through_as_422(monkeypatch):
    monkeypatch.setenv("ENGINE_URL", "http://engine.test")
    get_settings.cache_clear()
    monkeypatch.setattr(httpx, "request", lambda m, u, json=None, timeout=None: httpx.Response(422, json={"error": "outside Ireland"}, request=httpx.Request(m, u)))
    r = client.post("/engine/tools/nearbyTransport", json={"params": {"lng": 53.3, "lat": -6.2}})
    assert r.status_code == 422 and "outside Ireland" in r.json()["detail"]


def test_unreachable_engine_is_a_502(monkeypatch):
    monkeypatch.setenv("ENGINE_URL", "http://engine.test")
    get_settings.cache_clear()
    def boom(*a, **k): raise httpx.ConnectError("refused")
    monkeypatch.setattr(httpx, "request", boom)
    assert client.get("/engine/health").status_code == 502

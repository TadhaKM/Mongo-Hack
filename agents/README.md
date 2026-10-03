# rentcheck_agents — RentCheck AI agent layer (Person 2)

Evidence-backed "Know Before You Rent" analysis. The pipeline is:
- Deterministic investigators call Person 4's backend tools (never MongoDB directly).
- Gemini writes the report from an evidence ledger.
- A verifier removes any claim that is not grounded in that evidence.
- A template report is used when no LLM is available.

```bash
cd agents && uv sync
cp .env.example .env            # add GEMINI_API_KEY (optional; template report works without it)
uv run pytest -q                # 22 tests, offline
uv run python scripts/demo.py   # mock data: Dublin 8, €2,200, 2-bed apartment
uv run python scripts/demo.py --hard                      # insufficient-data case
uv run python scripts/demo.py --client http --property-id property_demo   # Person 4 API at RENTCHECK_API_URL
uv run uvicorn rentcheck_agents.api:app --port 8001       # POST /ai/analyse (SSE), /ai/analyse/sync, GET /ai/analysis/{id}
```

| `TOOL_CLIENT` | Use when |
|---|---|
| `mock` | offline dev/demo backup; fixture shaped like Person 4's responses, labelled DEMO |
| `http` | agents run as their own service and call Person 4's API (`RENTCHECK_API_URL`) |
| `inprocess` | router mounted inside Person 4's FastAPI app; results saved to their `analyses` collection |

Design: `../docs/agent-design.md`. Contracts and backend issues: `../docs/TEAM_HANDOFF_PERSON2.md`.

#!/usr/bin/env python3
"""Run one analysis from the terminal and print the agent's progress + report.

    uv run python scripts/demo.py                       # mock data, Dublin 8, €2,200, 2-bed apartment
    uv run python scripts/demo.py --client http         # against Person 4's API (RENTCHECK_API_URL)
    uv run python scripts/demo.py --hard                # hard case: location with no RTB area
    uv run python scripts/demo.py --no-llm --json out.json
"""
from __future__ import annotations

import argparse
import asyncio
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from rentcheck_agents.models import PropertyInput  # noqa: E402
from rentcheck_agents.pipeline import run_analysis  # noqa: E402
from rentcheck_agents.tools.base import get_tool_client  # noqa: E402

ICON = {"running": "●", "done": "✓", "skipped": "–", "failed": "✗"}


async def main(args):
    if args.hard:
        inp = PropertyInput(address="Main Street, Ballymahon, Co. Longford", latitude=53.5640, longitude=-7.7640,
                            monthly_rent=1400, bedrooms=5, property_type="house")
    else:
        inp = PropertyInput(address=args.address, eircode=args.eircode, latitude=args.lat, longitude=args.lng,
                            monthly_rent=args.rent, bedrooms=args.beds, property_type=args.type, listing_text=args.listing,
                            property_id=args.property_id)
    report = None
    async for ev in run_analysis(inp, tools=get_tool_client(args.client), use_llm=not args.no_llm):
        if ev.type == "plan":
            print("\nPLAN")
            for s in ev.data["steps"]:
                print(f"  • {s['label']}: {s['reason']}")
            print()
        elif ev.type == "step":
            if ev.status != "running" or args.verbose:
                print(f"{ICON.get(ev.status, '?')} {ev.label}" + (f"  — {ev.detail}" if ev.detail else ""))
        elif ev.type == "error":
            print(f"✗ {ev.label}: {ev.detail}")
        elif ev.type == "report":
            report = ev.data
    if not report:
        return 1
    print("\n" + "=" * 78 + f"\nKNOW BEFORE YOU RENT — {report['property'].get('address')}  [{report['generated_by']}]\n" + "=" * 78)
    for c in report["summary"]:
        print(f"  {c['text']}  {c['evidence_ids']}")
    for s in report["sections"]:
        print(f"\n## {s['title']}  ({s['status']}{', ' + s['confidence'] + ' confidence' if s['confidence'] else ''})")
        for c in s["claims"]:
            print(f"  - {c['text']}  {c['evidence_ids']}")
    print("\n## Questions to ask")
    for q in report["questions_to_ask"]:
        print(f"  ? {q['text']}")
    print("\n## Sources")
    for src in report["sources"]:
        print(f"  {src.get('organisation')} — {src.get('dataset')} — {src.get('source_url')}")
    print(f"\n{report['disclaimer']}")
    if args.json:
        Path(args.json).write_text(json.dumps(report, indent=2, ensure_ascii=False))
        print(f"\nreport JSON written to {args.json}")
    return 0


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--client", default="mock", choices=["mock", "http", "inprocess"])
    p.add_argument("--address", default="South Circular Road, Dublin 8")
    p.add_argument("--eircode", default=None)
    p.add_argument("--lat", type=float, default=53.3392)
    p.add_argument("--lng", type=float, default=-6.2905)
    p.add_argument("--rent", type=float, default=2200)
    p.add_argument("--beds", type=int, default=2)
    p.add_argument("--type", default="apartment")
    p.add_argument("--listing", default=None)
    p.add_argument("--property-id", default=None, help="reuse a property already created in the backend")
    p.add_argument("--hard", action="store_true")
    p.add_argument("--no-llm", action="store_true")
    p.add_argument("--verbose", action="store_true")
    p.add_argument("--json", default=None)
    sys.exit(asyncio.run(main(p.parse_args())))

#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.daft.client import DaftApiError, DaftApiNotConfigured, live_property_search
from app.db.mongodb import collection


def main():
    parser = argparse.ArgumentParser(description="Live Daft API smoke test")
    parser.add_argument("property_id")
    parser.add_argument("--kind", choices=["rental", "sale"], default="rental")
    parser.add_argument("--radius-m", type=int, default=5000)
    parser.add_argument("--limit", type=int, default=5)
    args = parser.parse_args()

    prop = collection("properties").find_one({"_id": args.property_id})
    if not prop:
        raise SystemExit(f"Property not found: {args.property_id}")

    try:
        result = live_property_search(
            prop,
            ad_type=args.kind,
            radius_m=args.radius_m,
            limit=args.limit,
        )
    except (DaftApiNotConfigured, DaftApiError) as exc:
        raise SystemExit(str(exc)) from exc

    print(json.dumps(result, indent=2, default=str))


if __name__ == "__main__":
    main()

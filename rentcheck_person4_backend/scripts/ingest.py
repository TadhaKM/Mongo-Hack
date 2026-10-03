#!/usr/bin/env python3
from __future__ import annotations
import argparse, json, sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.db.indexes import ensure_indexes
from app.db.mongodb import collection
from app.ingestion.nta_gtfs import NtaGtfsImporter
from app.ingestion.planning import PlanningImporter
from app.ingestion.ppr import PprImporter
from app.ingestion.rtb import RtbManualImporter, CsoRiq02Importer
from app.ingestion.cso import CsoCsvImporter, VacancyCsvImporter
from app.ingestion.boundaries import GeoJsonBoundaryImporter
from app.ingestion.registry import seed_source_catalog


def log_run(dataset_id, result=None, status="started", error=None):
    doc={"_id": f"{dataset_id}:{datetime.now(timezone.utc).isoformat()}", "dataset": dataset_id, "status": status, "started_at": datetime.now(timezone.utc), "result": result, "error": error}
    collection("ingestion_runs").insert_one(doc)


def main():
    parser=argparse.ArgumentParser(description="RentCheck dataset ingestion")
    sub=parser.add_subparsers(dest="command", required=True)

    p=sub.add_parser("nta"); p.add_argument("--path", required=True)
    p=sub.add_parser("planning"); p.add_argument("--path"); p.add_argument("--url")
    p=sub.add_parser("ppr"); p.add_argument("--path", required=True)
    p=sub.add_parser("rtb"); p.add_argument("--path", required=True)
    p=sub.add_parser("riq02"); p.add_argument("--path", required=True)
    p=sub.add_parser("census"); p.add_argument("--path", required=True)
    p=sub.add_parser("vacancy"); p.add_argument("--path", required=True)
    p=sub.add_parser("boundary"); p.add_argument("--path", required=True); p.add_argument("--collection", required=True); p.add_argument("--dataset-id", default="official_boundaries"); p.add_argument("--source-url")
    sub.add_parser("seed-sources")
    args=parser.parse_args()
    ensure_indexes()

    if args.command == "seed-sources":
        print(json.dumps({"written": seed_source_catalog()}, indent=2, default=str)); return

    mapping={
        "nta": lambda: NtaGtfsImporter().import_path(args.path),
        "planning": lambda: PlanningImporter().import_path(args.path, args.url) if args.url or args.path else None,
        "ppr": lambda: PprImporter().import_path(args.path),
        "rtb": lambda: RtbManualImporter().import_path(args.path),
        "riq02": lambda: CsoRiq02Importer().import_path(args.path),
        "census": lambda: CsoCsvImporter().import_path(args.path),
        "vacancy": lambda: VacancyCsvImporter().import_path(args.path),
        "boundary": lambda: GeoJsonBoundaryImporter(args.collection, args.dataset_id).import_path(args.path, args.source_url)
    }
    try:
        log_run(args.command)
        result=mapping[args.command]()
        print(json.dumps(result, indent=2, default=str))
    except Exception as exc:
        log_run(args.command, status="failed", error=str(exc))
        raise

if __name__ == "__main__": main()

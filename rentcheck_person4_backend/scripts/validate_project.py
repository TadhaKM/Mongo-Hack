#!/usr/bin/env python3
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
REQUIRED = [
    "README.md",
    "HANDOFF_TO_TEAM.md",
    "schema.json",
    "source_catalog.json",
    "requirements.txt",
    "pyproject.toml",
    "Dockerfile",
    "docker-compose.yml",
    "app/main.py",
    "scripts/ingest.py",
    "scripts/seed_demo.py",
]

errors: list[str] = []

for rel in REQUIRED:
    if not (ROOT / rel).exists():
        errors.append(f"missing required file: {rel}")

for rel in ["schema.json", "source_catalog.json"]:
    path = ROOT / rel
    if path.exists():
        try:
            json.loads(path.read_text(encoding="utf-8"))
        except Exception as exc:
            errors.append(f"invalid JSON in {rel}: {exc}")

py_files = list((ROOT / "app").rglob("*.py")) + list((ROOT / "scripts").glob("*.py"))
for path in py_files:
    try:
        compile(path.read_text(encoding="utf-8"), str(path), "exec")
    except Exception as exc:
        errors.append(f"Python compile error in {path.relative_to(ROOT)}: {exc}")

if (ROOT / ".env").exists():
    print("WARNING: .env exists locally; make sure it is not committed.")

if errors:
    print("PROJECT CHECK: FAIL")
    for error in errors:
        print(f"- {error}")
    sys.exit(1)

print("PROJECT CHECK: PASS")
print(f"Python files checked: {len(py_files)}")
print("JSON files parsed: 2")
print("Required handoff files: present")
print("Python syntax: OK")

# Check Before Handoff

Run these commands from the project root.

## 1. Check project files and Python syntax

```bash
python3 scripts/validate_project.py
python3 -m compileall -q app scripts
```

Expected:

```text
PROJECT CHECK: PASS
```

## 2. Install dependencies

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
```

On Windows PowerShell:

```powershell
py -3 -m venv .venv
.\\.venv\\Scripts\\Activate.ps1
python -m pip install -r requirements.txt
```

## 3. Run tests

```bash
pytest -q
```

## 4. Start MongoDB + API

```bash
cp .env.example .env
docker compose up --build
```

Then open `http://localhost:8000/docs` and `http://localhost:8000/health`.

## 5. Seed demo data

In another terminal:

```bash
source .venv/bin/activate
python scripts/seed_demo.py
```

Then use the API docs to call the property/analyse/evidence endpoints.

## 6. Real dataset smoke test

Start with NTA GTFS because it is structured and geospatial:

```bash
python scripts/ingest.py nta --path data/raw/nta
```

Do not scrape RTB pages. Use only an official RTB/ESRI file the team is permitted to ingest.

## If anything fails

- `ModuleNotFoundError`: activate `.venv` and install `requirements.txt`.
- MongoDB connection error: make sure `docker compose up` is running and `.env` uses the Compose Mongo hostname.
- Test import mismatch: remove old `__pycache__` directories and duplicate nested copies, then rerun `pytest -q`.

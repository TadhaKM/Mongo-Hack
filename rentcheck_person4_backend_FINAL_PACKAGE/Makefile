.PHONY: install run test seed docker-up
install:
	python3 -m pip install -r requirements.txt
run:
	uvicorn app.main:app --reload
seed:
	python3 scripts/seed_demo.py
test:
	pytest -q
docker-up:
	docker compose up --build

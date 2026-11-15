.PHONY: install test lint api web-dev image run-image

install:
	uv sync
	cd web && npm install

test:
	uv run pytest
	cd web && npx vitest --run

lint:
	uv run ruff check .
	uv run ruff format --check .
	cd web && npm run lint

# Long-running: run manually.
api:
	uv run uvicorn hotspots.api.main:app --reload

# Long-running: run manually.
web-dev:
	cd web && npm run dev
# Build the container image (API + built front end; no data files, no secrets).
image:
	docker build -t hotspots .
# Long-running: run manually. Builds the image, then serves http://localhost:7860.
# Mounts ./outputs2.0 read-only as the data folder; reads ./.env (HF_DATASET_REPO, HF_TOKEN)
# when it exists. The stage-data target is not built (the data pipeline was delivered externally).
run-image: image
	docker run --rm -p 7860:7860 -v "$(CURDIR)/outputs2.0:/app/outputs2.0:ro" $(if $(wildcard .env),--env-file .env) hotspots

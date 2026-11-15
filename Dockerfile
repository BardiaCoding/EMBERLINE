# syntax=docker/dockerfile:1
# One image: FastAPI API + built React front end, served from one port (7860).
# The image holds no data files and no secrets. The two Parquet files are either downloaded at
# start by `hotspots.bootstrap` (HF_DATASET_REPO + HF_TOKEN, set as runtime environment
# variables or Space secrets) or mounted at /app/outputs2.0 (see README).

# ---- Stage 1: build the front end ------------------------------------------------------------
FROM node:22-slim AS web
WORKDIR /web
COPY web/package.json web/package-lock.json web/.npmrc ./
RUN npm ci
COPY web/ ./
# The Methods page imports ../docs/methodology.md at build time (design section 11.7).
COPY docs/ /docs/
RUN npm run build

# ---- Stage 2: Python runtime with uv ---------------------------------------------------------
FROM python:3.12-slim AS runtime

# DEFAULT (confirm): uv version matches the one that wrote uv.lock (0.13.8).
COPY --from=ghcr.io/astral-sh/uv:0.13.8 /uv /usr/local/bin/uv

ENV UV_LINK_MODE=copy \
    UV_COMPILE_BYTECODE=1 \
    UV_PYTHON_DOWNLOADS=never \
    PYTHONUNBUFFERED=1

# Hugging Face Spaces runs the container as uid 1000.
RUN useradd --create-home --uid 1000 app
WORKDIR /app

# Dependencies first (cached layer); uv.lock is authoritative.
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project

COPY README.md ./
COPY src/ ./src/
COPY config/ ./config/
RUN uv sync --frozen --no-dev

COPY --from=web /web/dist ./static
COPY --chmod=755 scripts/entrypoint.sh ./scripts/entrypoint.sh

# Empty data folder the app user can write to (bootstrap downloads into it).
# A bind mount at this path replaces it.
RUN mkdir -p /app/outputs2.0 && chown -R app:app /app/outputs2.0

ENV HOTSPOTS_CONFIG=/app/config/app.yaml \
    HOTSPOTS_STATIC_DIR=/app/static \
    PORT=7860
# Runtime settings, not set here (never bake them in): HF_DATASET_REPO, HF_TOKEN.

USER app
EXPOSE 7860

# Runs `hotspots.bootstrap`, then uvicorn. A failed download still starts the app, which then
# reports "data unavailable" on /api/health (Requirement 32.7).
ENTRYPOINT ["/app/scripts/entrypoint.sh"]

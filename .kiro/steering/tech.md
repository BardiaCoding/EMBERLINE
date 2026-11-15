# Tech

## Status
Stack installed and pinned (Python 3.12 via `uv`, `uv.lock`; Node 20 with exact pins in `web/package.json` and `web/package-lock.json`). Project scaffolding exists (`pyproject.toml`, `src/hotspots/constants.py`, `tests/conftest.py`, the `web/` Vite app); the application code is still being built. The data pipeline (acquisition, filtering, calibration, harmonization, validation) was built outside Kiro; its outputs are a fixed data contract in `data-contract.md`. This app only reads those files. The dependency files are the source of truth; the versions below were read from them (tasks 1.1 and 1.2). Update this file if they diverge.

## Stack
Chosen for: all required features (map drawing, calendar heatmap, downloads, online deployment), a modern UI, and finishing by the deadline.

### Data access (Python 3.12)
- `uv` for environments and dependency pinning (`pyproject.toml` + `uv.lock`). Python `>=3.12,<3.13` (`.python-version` 3.12).
- DuckDB `2.0.0` (exact pin, same as `DATA_README.md`) reads the delivered Parquet files through one access layer. Paths come from config.
- pyarrow 26.0.1, pandas 3.1.1, numpy 2.5.4, scipy 1.18.1 for statistics; shapely 2.2.0 for geometry validation and point-in-polygon.
- pyyaml 6.0.3 loads the YAML config in `config/`.
- huggingface_hub 2.4.0 downloads the data files at deploy time (Hugging Face Spaces).
- No acquisition, calibration or harmonization code, and no H3 or FIRMS key in this app. httpx is a test-only dependency (FastAPI `TestClient`), not used at runtime.
- Storage: delivered Parquet files (see `data-contract.md`), not committed to git.

### Backend API
- FastAPI 0.163.0 + uvicorn 0.54.0, pydantic 2.14.3 models. DuckDB queries the Parquet files per request.
- Serves the built front end as static files, so one container runs the whole app.

### Front end
- React 19.3.1 + TypeScript 5.9.3 (strict) + Vite 7.3.8. Node 20 (`engines`: `^20.19.0 || >=22.12.0`; `.npmrc` has `save-exact=true`).
- MapLibre GL JS 6.18.0 (open-source map, no token) with Terra Draw 1.39.0 and `terra-draw-maplibre-gl-adapter` 1.5.0 for polygon and rectangle drawing.
- Apache ECharts 6.1.0 for the calendar heatmap, time series, envelopes and PNG/SVG export.
- Tailwind CSS 4.3.5 (`@tailwindcss/vite`, `tw-animate-css`) + shadcn/ui (Radix primitives, accessible by default; `@radix-ui/react-slot`, `class-variance-authority`, `clsx`, `tailwind-merge`, `lucide-react`).
- TanStack Query 5.107.1 for data fetching. App state (area, dates) encoded in the URL.
- zod 4.6.7 validates API responses and URL state at the trust boundary.
- `openapi-typescript` 7.13.0 generates `web/src/lib/api.types.ts` from the FastAPI OpenAPI schema (`npm run gen:api`; source URL from `OPENAPI_SOURCE`, default `http://127.0.0.1:8000/openapi.json`).

### Testing and quality
- Python: pytest 9.2.0, Hypothesis 6.170.15 (property-based tests; profiles `ci` with 100 derandomized examples and `dev`, set in `tests/conftest.py`), ruff 0.17.5 (lint and format).
- `pytest-socket` 0.8.1 blocks network access in tests (`--disable-socket`; loopback `127.0.0.1`/`::1` and Unix sockets stay allowed). httpx 0.28.1 (dev group) backs FastAPI `TestClient`.
- The pytest marker `delivered` tags tests that read the real delivered files; they are skipped when `outputs2.0/` (or `HOTSPOTS_DATA_DIR`) is absent.
- Front end: Vitest 4.1.12 with jsdom 27.4.0, fast-check 4.10.2 (property-based tests), ESLint 9.39.5 + typescript-eslint 8.72.2 (a rule forbids raw hex colours outside `src/styles/tokens.css` and `palettes.ts`), Prettier 3.10.1.
- Front-end component and API tests: React Testing Library (`@testing-library/react` 16.3.3, `@testing-library/dom` 10.4.2, `@testing-library/user-event` 14.6.10), msw 2.15.0 (mock API server, `web/src/test/server.ts`), `vitest-axe` 0.1.0 with axe-core 4.14.0 for accessibility checks.

### Deployment
- One Docker image (FastAPI + built front end; how the data files reach the host is a design decision).
- Host: DEFAULT (confirm) Hugging Face Spaces (Docker), fallback Render or Fly.io, fallback local `docker run`.

### Rejected alternatives
- Streamlit or Dash: fastest to start, but map drawing, custom calendar layouts and a polished UI are harder.
- Browser-only DuckDB-WASM with no backend: cheaper hosting, but riskier for live FIRMS calls and large CSV exports.

## Data
Source, schema, filters, counting unit (cell-days), time convention (fixed UTC-8), extent and limitations are in `data-contract.md`. The harmonization method (per-region quantile mapping of VIIRS to MODIS-equivalent, switchover 2012) is documented there and in `DATA_README.md`. Do not reimplement or re-derive it.

## Conventions
- Pin all dependencies (`uv.lock`, `package-lock.json`). Record new libraries there.
- No FIRMS key is needed. Any secret goes in environment variables or an untracked `.env`, with an `.env.example`. Never commit or log keys.
- Data files stay out of git (`outputs2.0/` is in `.gitignore`). The data folder path comes from config.
- `acq_datetime_utc` is true UTC. Days, months and years use fixed UTC-8. State units (cell-days, MW) and CRS (EPSG:4326 for lat/lon) in code and UI.
- Type hints on all Python functions. Strict TypeScript.

## Common commands
- Install: `uv sync` and `cd web && npm install`
- API (dev): `uv run uvicorn hotspots.api.main:app --reload` (run manually, long-running)
- Front end (dev): `cd web && npm run dev` (run manually, long-running)
- Tests: `uv run pytest` and `cd web && npx vitest --run` (or `make test`)
- Lint: `uv run ruff check .`, `uv run ruff format --check .` and `cd web && npm run lint` (or `make lint`)
- Type check (front end): `cd web && npm run typecheck`
- Regenerate API types (API must be running, or set `OPENAPI_SOURCE`): `cd web && npm run gen:api`
- Build image: `docker build -t hotspots .` (planned; no `Dockerfile` yet)

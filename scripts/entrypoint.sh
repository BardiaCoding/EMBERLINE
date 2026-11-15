#!/bin/sh
# Container entrypoint: deliver the data files, then start the API.
# A failed delivery is reported but does not stop the API: it starts in the "data unavailable"
# state (/api/health answers 503) so the host shows a clear message instead of a crash loop.
# The token is read by hotspots.bootstrap from the environment and is never echoed here.

uv run --no-sync python -m hotspots.bootstrap || echo "WARNING: data delivery failed; starting without data." >&2

exec uv run --no-sync uvicorn hotspots.api.main:app --host 0.0.0.0 --port "${PORT:-7860}"

# Submission checklist

Deadline: Sunday 15 November 2026, 11:59 PM local time. The time zone is DEFAULT (confirm): the team's own time zone.

Status key: `[x]` done and verified in the repository, `[ ]` not done or not verified. Nothing below has been checked against a live deployment.

## Verification run (task 32, local only)
Date: 2026-11-15. No deployment was checked.
| Command | Result |
|---|---|
| `uv run pytest -q` | pass, 744 passed |
| `uv run ruff check .` | pass |
| `uv run ruff format --check .` | pass, 127 files formatted |
| `npx vitest --run` (web/) | pass, 97 files, 911 tests |
| `npm run lint` (web/) | pass (eslint and prettier) |
| `npm run typecheck` (web/) | pass |
| `npm run build` (web/) | pass. Vite warns that `index-*.js` is above 500 kB minified |
| Initial JS gzip (`dist/index.html` loads only `assets/index-CUawP67h.js`) | 520,102 bytes (about 508 KiB) against the 700 KB budget: within budget |
| `docker build -t hotspots .` | pass (exit 0), Docker 29.6.1 |
| `uv run python -m hotspots.smoke --help` | starts and prints usage; not run against any URL |
Not run: smoke check against a deployed URL, logged-out browser check, container run.

## Items (Requirement 33.1 to 33.7)

| Req | Item | Status | File or location |
|---|---|---|---|
| 33.1 | Deployed URL (or local run instructions, at most 3 commands) | [ ] URL not yet available. Local instructions written: [x] | `README.md`, section "Deployment" (local container run, 2 commands) |
| 33.2 | Public GitHub repository URL, with README sections purpose, features, setup, data, tests, deployment, license | [ ] Repo URL not yet available. README exists, but it has NO license section and the repository has NO LICENSE file | `README.md` |
| 33.3 | Demo: video of at most 30 seconds and/or deck of at most 7 slides | [ ] Not produced. No file in the repository | none yet (suggested `docs/submission/demo/`) |
| 33.4 | Project summary and project details text | [x] Draft written. Length limits from the live form not checked | `docs/submission/summary.md` |
| 33.5 | Methodology document, linked from the Web_App methods page | [x] Draft written. Link from the methods page not re-verified here | `docs/methodology.md` |
| 33.6 | NASA data used, other references, pinned libraries | [x] Draft written | `docs/submission/data_and_references.md` |
| 33.7 | AI disclosure (each AI tool and its tasks) | [ ] Draft written, `TEAM TO CONFIRM` lines remain | `docs/submission/ai_disclosure.md` |

Also required by 33.11: no secrets and no delivered data in the repository. Automated check: `uv run pytest tests/unit/test_repo_hygiene.py`.

## Commands

Docker build (passed in the local verification run below, not from a clean checkout):

```
docker build -t hotspots .
```

Local container run (fallback, from `README.md`):

```
docker run --rm -p 7860:7860 -v "$PWD/outputs2.0:/app/outputs2.0:ro" hotspots
```

Smoke check against the deployed URL (the module is `src/hotspots/smoke.py`; NOT yet run against a deployment):

```
uv run python -m hotspots.smoke <deployed URL>
```

## Final check, 24 hours before the deadline (Requirement 33.9)

Record pass or fail for each item. Not yet done.

- [ ] Docker image rebuilt from a clean checkout. (A local build passed, see Verification run; not a clean checkout.)
- [ ] Smoke check run against the deployed URL, exit code 0.
- [ ] Logged-out browser check in a private window:
  - [ ] Open the deployed URL. The Calendar for the pilot region loads without login.
  - [ ] Draw an area on the map.
  - [ ] View the Calendar for that area.
  - [ ] Download a CSV and check that its header states the detections are raw and not individually harmonized.
- [ ] Repository URL opens without login, and the README renders.
- [ ] Demo file opens (video of at most 30 seconds and/or deck of at most 7 slides).
- [ ] Summary, methodology, NASA data list and AI disclosure are final, with no `TEAM TO CONFIRM` lines left.

## Fallback (Requirement 33.10)

If the deployed URL fails to load the app during the check:

1. Redeploy to the fallback host (Render, then Fly.io) using the same Docker image. DEFAULT (confirm)
2. If no host works, submit the local run instructions: `docker build -t hotspots .` then the `docker run` command above, with the app at `http://localhost:7860`.
3. Re-run the smoke check and the browser check against the new address and update this file.

## Open items
- License: no LICENSE file and no license section in `README.md`. TEAM TO CHOOSE a license and add both (none invented here).

- Deployed URL: TEAM TO CONFIRM (none recorded yet).
- Repository URL: TEAM TO CONFIRM (none recorded yet).
- AI disclosure: TEAM TO CONFIRM the language models used, any other AI tool, whether AI was used on the pipeline, and who reviewed the AI-written work (see `docs/submission/ai_disclosure.md`).
- Demo video or deck: not produced.
- Time zone of the deadline: TEAM TO CONFIRM (DEFAULT: the team's own time zone).
- Hosting choice and how the data files reach the host: DEFAULT (confirm).

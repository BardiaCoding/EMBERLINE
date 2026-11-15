# AI tool disclosure

Requirement 33.7. This page names the AI tools used in this project and what each was used for.

## AI tools used

| Tool | Used for |
|---|---|
| Kiro (AI-assisted IDE and agent) | Building the web application in `src/hotspots/`, `web/`, `tests/`, `scripts/` and `docs/`. The work followed Kiro's spec-driven workflow: requirements, design and task list are in `.kiro/specs/harmonized-fire-calendar/`. AI sub-agents implemented individual tasks, wrote the unit and property-based tests, and drafted documentation. |

TEAM TO CONFIRM: the exact language models Kiro used (names and versions). The repository does not record them.

TEAM TO CONFIRM: whether any other AI tool was used (for example a chat assistant, an image generator, or a tool for the demo video, slides or summary text). None is recorded in the repository, so none is listed.

## Data pipeline

The data pipeline (acquisition, filtering, calibration, harmonization, validation) was built outside Kiro. Its outputs are the files in `outputs2.0/`. This app only reads them.

`outputs2.0/DATA_README.md` lists software versions and pipeline stages. It does not mention any AI tool.

TEAM TO CONFIRM: whether any AI tool was used to write or run the pipeline code or its documentation. The repository cannot establish this either way.

## Ideas and implementation

All extra features, meaning those that go beyond what the NASA challenge text asks for, were the team's own ideas. Kiro implemented them. Kiro wrote most of the code, tests and documentation. The team chose what to build and set the scope, priorities and data rules.

## What humans decided

The repository shows these human decisions:

- The scope, the priority order and the deadline (`product` rules).
- The fixed data contract: California region only, record start November 2000, cell-days as the counting unit, fixed UTC-8 time, the excluded stray cell, and the list of delivered files that are not used.
- The choice of tools and the stack (`tech` rules).
- Open decisions are marked `DEFAULT (confirm)` in the specs and docs. These are proposed defaults that the team has to confirm. They are not confirmed decisions.

TEAM TO CONFIRM: who on the team reviewed, accepted or changed the AI-written code and text, and how (for example code review, running the tests, manual checks of the app).

## Data integrity

No AI-generated numbers are presented as NASA data. All counts, anomalies and figures shown in the app come from the delivered FIRMS-derived files. Test data is synthetic, labelled "TEST FIXTURE, not NASA data", and is never shown in the app or documentation as real values.

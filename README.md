# ResQ Cells

**Agentic Crisis Command & Emergency Response.** ResQ Cells is a local, browser based emergency dispatch decision support prototype. It turns incident reports into structured needs, proposes capability matched units, explains the recommendation, and waits for an operator decision. The prototype runs without package installation or external services.

> **Training/demo only.** This is not an emergency services product. Do not use it to dispatch real responders or make clinical, evacuation, or public safety decisions. The map, distances, ETAs, units, and incidents are simulated.

## Run locally

Requires Node.js 18 or later.

```bash
npm start
```

In PowerShell on Windows, use `npm.cmd start` if script execution policy blocks `npm.ps1`.

Open <http://localhost:3000>. The server creates `data.json` for local persistence the first time it runs. Use the circular reset icon to restore the reproducible three incident scenario. Set `PORT` to change the port.

Run the integration scenario with `npm test` (or `npm.cmd test` in PowerShell).

## Demonstration path

1. Press **Reset** to load the Koramangala road accident, Indiranagar building fire, Jayanagar medical emergency, two ambulances, fire team, rescue team, hazmat unit, and police unit.
2. Load the example report: “Major fire reported near Indiranagar. Several people are trapped on the upper floor. Heavy smoke is visible.” Click **Understand & create incident**. The app extracts bounded fields, creates the incident, runs its coalition, and immediately calculates a plan. OpenAI is optional; deterministic extraction and agents work offline.
3. Inspect the extraction, specialist bid, Area Commander contention brief, optimized recommendations, and seeded 50-future ETA simulation.
4. Approve the Jayanagar medical recommendation so MED-02 is assigned. Then click **Simulate unit failure**. MED-02 is taken out of service, affected pending plans are invalidated, the dispatched medical incident returns to review, and the global queue replans.
5. Review the new recommendation and approve it if coverage is complete. The affected unit cannot be reused. Every approval remains an explicit operator action.
6. The structured incident form remains available as a fallback. Use **Recalculate** after other fleet or constraint changes.

### Agentic architecture and optional LLM agents

The architecture exposes 11 specialist roles across incident task forces, citywide command, human review, operator constraints, and post incident learning. The Assessor selects a dynamic incident scoped coalition; validated task force bids go to the Area Commander, while the application controlled global solver enforces unique unit assignments. Human Liaison creates a bounded decision card, NL2Constraint parses explicit lock/unlock requests against the exact responder roster, and Counterfactual compares recorded outcomes without updating parameters. The UI shows the roster, isolated incident thread IDs, command brief, bids, and decision card. The default provider is deterministic so the demo works offline. Copy `.env.example` to `.env`, set `AEGIS_AGENT_PROVIDER=openai`, add an OpenAI API key, and choose an `OPENAI_MODEL` that supports Structured Outputs. Restart the server. In AI mode all 11 roles have model-backed workflows; selected outputs use deterministic fallback, and assessment failures block the affected plan. Model output cannot approve or dispatch. Incident text is sent to OpenAI when enabled, so use synthetic demo reports only.

## What is implemented

- Responsive control room dashboard, schematic map, incident queue, fleet status, decision desk, and activity history.
- Incident intake with bounded server side validation, incident detail, queue, and outcome capture.
- Natural language `POST /api/intake/report` extraction, validation, automatic incident creation, specialist assessment, and immediate planning; deterministic fallback works without OpenAI.
- Eleven-role agent registry, incident-scoped task force threads, dynamic coalition selection, structured bids, and an Area Commander contention brief.
- Optional OpenAI Responses API orchestration with strict structured outputs for all 11 roles; deterministic demo remains the default.
- Global bounded-search allocation with an optional OR-Tools CP-SAT backend (`pip install -r requirements.txt`, then `AEGIS_SOLVER=ortools`), unique unit assignment, severity/wait/ETA scoring, and operator resource locks. It falls back to the built-in solver if OR-Tools is unavailable.
- Human approval, hold, documented override validation, and server side availability checks.
- Deterministic 50-future travel delay simulation with expected ETA, P90, and CVaR90 (synthetic inputs only).
- Post incident counterfactual comparison with no automatic parameter updates.
- Responder registration/status APIs, persistent audit history, and resettable seeded data.
- `POST /api/demo/failure` simulates an assigned responder becoming unavailable, reopens affected incidents, invalidates stale plans, reruns the global allocator, and records replanning history. `GET /api/replans` returns those events.
- Approval rejects stale plans after incident, fleet, weight, or constraint changes. Updated recommendations still require operator approval.
- APIs: `/api/intake/report`, `/api/incidents`, `/api/responders`, `/api/optimization/run`, `/api/demo/failure`, `/api/replans`, `/api/config/weights`, `/api/simulation/run`, `/api/constraints`, `/api/decisions`, `/api/audit`, and `/api/health`.

## What is simulated or not implemented

No medical authority, real maps/geocoding/routing, GPS, hospital capacity, production database, authentication, role enforcement, multi-user concurrency, external telemetry, or emergency network integration. Census, weather, OSRM, hospital, ERG, and SCADA tools in the proposed design are not live integrations; the prototype uses seeded/schematic inputs. The OpenAI provider and OR-Tools solver are optional. Risk labels and ETAs are illustrative heuristics. Google Fonts is an optional visual enhancement; the app remains usable if unavailable. The project plan in [docs/PROJECT_DESIGN.md](docs/PROJECT_DESIGN.md) describes the next safe steps.

## Project structure

```text
server.js                 Node HTTP API, validation, allocation, decision checks
public/index.html         Dashboard and operator dialogs
public/styles.css         Responsive dark control room interface
public/app.js             Browser rendering and API interactions
public/deep.css           Assessment, constraint, simulation panel styles
public/unit.css           Fleet control styles
docs/PROJECT_DESIGN.md    Expanded engineering design, rationale, evaluation, roadmap
data.json                 Created at runtime; local demonstration state
```

## Data handling

The prototype stores data in `data.json` beside the server. Treat it as disposable demo data. Do not enter personal, medical, or real incident information. There is no authentication or encryption. The server is intended for localhost only.

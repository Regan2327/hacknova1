# Aegis Command — Expanded Project Design

## 1. Project definition

Aegis Command is a human controlled decision support system for coordinating several simultaneous incidents against a limited responder fleet. The technical challenge is not merely to classify a call. It is to preserve a coherent operational picture, surface resource conflicts, explain the cost of a proposed assignment, and make it impossible for an unvalidated suggestion to silently become a dispatch action.

### Core rule

**AI may interpret and recommend. Validated data and deterministic rules constrain. A human operator authorizes. Every consequential transition is recorded.**

The prototype implements this rule with deterministic assessment and allocation. An LLM is deliberately not required to demonstrate the key safety boundary.

## 2. Users and operational boundary

### Primary user: dispatcher

- Registers and reviews incidents.
- Sees available units, capabilities, and current assignments.
- Recalculates a fleet wide plan as conditions change.
- Approves, holds, or closes a recommendation.
- Sees why a resource was selected and which requirements remain unmet.

### System boundary

The system supports a dispatcher with a simulated regional view. It is not an emergency call center, CAD replacement, medical device, field communications system, or source of authoritative road or weather data. Every data source in the local prototype is labeled as simulated.

## 3. User journey and state model

```text
Incoming report → Validate and register → Assess required capabilities
      → Build queue wide plan → Explain coverage and tradeoffs
      → Operator approves / holds / closes → Lock unit state → Audit event
```

Incident states:

| State | Meaning | Allowed next actions |
| --- | --- | --- |
| `awaiting_review` | Registered; needs a recommendation and operator review | approve, hold, close |
| `open` | Held for later review | recalculate, approve, close |
| `dispatched` | One or more units assigned by an approved action | close in a future version |
| `closed` | Removed from active queue | none in this prototype |

Unit states in this prototype are `available` and `assigned`. A future system should add `en_route`, `on_scene`, `returning`, `out_of_service`, and explicit availability timestamps.

## 4. Functional design

### Structured intake

An incident has an identifier, title, category, severity (1–5), location label, simulated coordinates, reported patient count, notes, creation time, and state. The API validates required text and bounds severity/patient counts. Free text is retained as context; it does not issue commands to resources.

### Capability requirements

The demo translates incident type and severity into fixed requirements:

| Category | Demonstration requirements |
| --- | --- |
| Medical | ALS for severity 4–5; otherwise BLS |
| Rescue | Extrication and BLS |
| Hazard | Hazmat and at least one BLS unit |
| Fire | BLS in this early prototype |

These are simplified demonstration rules, not operational protocols. A real deployment would require reviewed, jurisdiction specific protocols and qualified operational owners.

### Allocation

The planner expands requirements into assignment slots and searches compatible unit combinations across the active queue. Its objective favors severity and waiting time, with an ETA penalty; operator locks and one assignment per unit are hard constraints. Missing capabilities remain explicit. A bounded exact search runs up to 250,000 nodes, then clearly labels a priority greedy fallback if the search limit is reached. Each plan includes assignments, mock ETA, distance, priority score, solver mode, and rationale.

### Authorization and resource lock

Approval is a separate API operation. The server rejects approval when a requirement is missing or a selected unit is no longer available. It then changes unit status, incident status, records the operator action, and persists state. This check protects against stale recommendations in a single process. It does not yet provide multi-user transactions or durable concurrency guarantees.

Hold leaves the incident open; close removes it from active planning. Neither assigns resources. A future implementation should require an operator identity from an authenticated session instead of the demo's fixed dispatcher label.

## 5. Architecture

```text
Browser UI
  ├── Incident intake and queue
  ├── Map-like situational view (schematic only)
  ├── Decision desk and resource roster
  └── Audit activity
        │ JSON over local HTTP
        ▼
Node HTTP service
  ├── Input validation and state transitions
  ├── Requirement rules
  ├── Deterministic queue planner
  ├── Approval guard and assignment lock
  └── Audit event writer
        │
        ▼
Local JSON store (demo only)
```

The prototype intentionally has no build step or third party runtime dependency. A production shaped evolution would separate API, orchestration, optimization, simulation, persistence, and integrations into modules/services once those components exist. Avoid introducing infrastructure solely to match a diagram.

## 6. Deeper production design

### Typed contracts

Introduce versioned, validated contracts for `Incident`, `ResponderUnit`, `AgentAssessment`, `ResourceRequirement`, `ResourceBid`, `Constraint`, `OptimizationPlan`, `DecisionCard`, `DispatchAction`, `IncidentOutcome`, and `AuditEvent`. In a Python API, Pydantic models can enforce enums, numeric bounds, required provenance, and schema versions. Agent-produced payloads must pass schema validation and deterministic domain checks before planning.

### Agent orchestration

Use a finite state graph per incident (`incident_<id>`) with isolated context. Run only relevant specialist modules: medical assessment for patient reports, hazard analysis for chemical/fire hazards, rescue assessment for entrapment, and infrastructure assessment for utility failures. The area commander combines validated bids but cannot bypass the optimizer. Each assessment records source evidence, confidence, timestamp, model/provider, and failure state. A failure should degrade to manual intake and a clear warning, not silently invent a result.

### Optimization formulation

Let binary decision variable `x[i,u]` indicate unit `u` assigned to incident `i`. Only compatible, available units may be selected. Constraints include:

- each unit assigned to at most one incident per plan;
- locked units never move;
- each requirement gets no more than its required coverage;
- capability compatibility is mandatory;
- existing assignments and operator constraints are respected;
- a plan with unmet critical requirements is visibly incomplete.

The current objective combines severity, waiting time, and response ETA. Weights can be changed through `/api/config/weights` and are range validated. They are not yet versioned, displayed with sensitivity analysis, or calibrated against outcome data. OR-Tools CP-SAT remains a production shaped alternative; compare it against this bounded search and hand-solvable cases before relying on it.

### Simulation and uncertainty

Replace a single mock ETA with clearly labeled travel-time distributions and explicit assumptions. Simulate demand, travel delay, deterioration, and resource availability with a fixed seed for reproducible demonstrations. Report sample count, expected impact, tail percentile, and CVaR only when actually computed. If simulation fails or exceeds latency budget, show “unavailable” and retain the deterministic plan. Never present a heuristic risk color as a probabilistic result.

### Persistence and isolation

For a multi-user version use PostgreSQL with migrations and foreign keys. Every incident scoped query and state transition must include incident identity and authenticated operator/tenant scope. Use transactions or optimistic version checks for approval; revalidate availability atomically. Add immutable audit records with actor, action, timestamp, source, reason, plan version, and before/after references. Redis may later cache transient telemetry, but must not be the only source of truth.

### Integrations and provenance

Provide explicit provider interfaces: mock/local implementations by default, optional real integrations behind configuration. Tag each location, ETA, weather observation, road closure, hospital capacity, or telemetry item with provider, observed time, freshness, and simulated/live status. A UI must never imply mock data is live.

## 7. Security and safety controls

- Human authorization remains mandatory for dispatch and high impact actions.
- Validate all API input and agent output against bounded schemas.
- Reject ambiguous natural language constraints; ask for clarification rather than guessing.
- Enforce incident and operator scope on reads and writes; add cross-incident isolation tests.
- Revalidate unit state at approval time and record stale-plan conflicts.
- Keep audit history append only; record overrides and reasons.
- Minimize sensitive data, define retention/deletion, and encrypt data at rest and in transit in any real deployment.
- Add authentication, role based permissions, CSRF protection, rate limits, and secure headers before exposing a network service.
- Treat all external model output as untrusted data; no tool permission should directly dispatch a unit.

## 8. Failure behavior

| Failure | Safe response |
| --- | --- |
| Invalid incident payload | Reject with field level feedback; no state mutation |
| No compatible unit | Show missing capability and block approval |
| Unit becomes unavailable | Reject stale approval and require replanning |
| Specialist/provider timeout | Mark unavailable, retain raw report, allow manual review |
| Optimizer failure | Preserve last known state; show solver failure, offer manual procedure |
| Simulation failure | Keep deterministic allocation; label risk analysis unavailable |
| Persistence failure | Do not claim successful action; surface error and retain no false confirmation |

## 9. Evaluation plan

Measure operational quality, system quality, and safety behavior separately:

- Coverage: required capabilities served / required capabilities requested.
- Response: estimated or observed time by priority, with data provenance.
- Fairness: compare wait and coverage across incident classes/areas under defined scenarios.
- Stability: count unnecessary reassignments after new incidents arrive.
- Solver quality: compare against hand-built expected plans and greedy baseline.
- Human factors: recommendation comprehension, tradeoff visibility, and time to decision in usability sessions.
- Safety: invalid output rejection, cross incident isolation, locked resource protection, stale approval rejection, and complete audit coverage.
- Reliability: API latency, provider/agent failure rates, solver time, and degraded mode frequency.

Use synthetic, seeded scenarios for development. Do not claim real world performance without reviewed data, representative evaluation, and operational approval.

## 10. Build roadmap

| Phase | Deliverable | Exit evidence |
| --- | --- | --- |
| 1. Demonstrator (current) | Browser dashboard, intake, deterministic planner, human decision, local audit | Reproducible scenario; clear simulation labels |
| 2. Domain contracts | Typed schemas, explicit transitions, validation errors | Unit tests for boundary and invalid inputs |
| 3. Persistence/security | Relational schema, migrations, authentication, role scope, incident isolation | Integration and security tests |
| 4. Optimization | OR-Tools model, locked resources, configurable weights, explanation | Constraint tests and comparison scenarios |
| 5. Assessment agents | Optional specialist agents with isolated state and validated bids | Agent failure and schema rejection tests |
| 6. Routing/simulation | Provider interface, mock and optional routing, seeded futures | Provenance, reproducibility, unavailable state |
| 7. Evaluation | Outcome capture, counterfactual reports, versioned parameter review | Reproducible metrics and audit history |
| 8. Deployment hardening | Monitoring, backups, threat model, accessibility, operational review | Security review and deployment runbook |

Each phase must remain runnable. Do not add agent frameworks, databases, Redis, vector search, or real integrations before a concrete user journey needs them.

## 11. Current runnable model

The browser model includes raw report intake (`POST /api/intake/report`), field extraction, incident creation, per-incident assessments and bids, global allocation, resource locks, responder status, approve/hold/override validation, seeded ETA simulation, outcome capture, counterfactual review, and audit history. A deterministic responder failure control (`POST /api/demo/failure`) reopens any affected dispatched incident, invalidates stale pending plans, marks the failed unit out of service, reruns global allocation, and records a replan event available from `GET /api/replans`. Updated plans return to operator review. The seeded scenario uses the requested Koramangala, Indiranagar, and Jayanagar incidents with two ambulances and limited specialist units. Integration tests cover intake fallback, agent assessment, optimizer uniqueness, approval, stale plan rejection, failure-driven replan, locks, simulation, outcome recording, and reset.

The runnable architecture registers 11 roles: Area Commander; Assessor Specialist; Medical Triage; Hazard Analyst; Rescue Needs; Population & Shelter; Route & Logistics; Infrastructure; Human Liaison; NL2Constraint; and Counterfactual. Incident assessments carry `incident_<id>` thread identifiers, and each task force produces a validated bid for a citywide command brief. Raw reports use optional structured OpenAI extraction with exact-location and minimum-capability validation; unavailable or invalid AI extraction falls back to deterministic rules, then to deterministic incident agents for that report. Other explicitly configured AI specialist failures continue to block plans safely. The application validates stale plans and requires operator approval after replan. Google OR-Tools CP-SAT is an optional Python backend (`AEGIS_SOLVER=ortools`) with bounded-search fallback when unavailable. External OSRM, weather, census/GIS, ERG, hospital, and SCADA tools remain design targets, not live integrations. Other production gaps include PostgreSQL/PostGIS, authentication and role scope, encryption, multi-user transaction handling, live routing, and field telemetry.

## 12. Remaining limitations and completion criteria

The runnable app is still a single process and single operator; state is a local JSON file. The bounded planner falls back to a heuristic after its search budget; ETA uses schematic coordinates. Its 50 seeded travel delay futures vary only the mock ETA multiplier; CVaR90 is tail ETA, not expected harm. Risk labels remain simple rules. Incident classification and requirements are demonstration constants, not reviewed operational protocols. The local server has no authentication and is intended for localhost only. These limits are visible; this is a classroom model, not deployable emergency infrastructure.

Before a real-world pilot, the project would need domain expert protocol review, a threat model, authentication and authorization, transactional persistence, independent safety testing, robust monitoring, network security, user research, representative data evaluation, and operational approval. No amount of prototype test passing substitutes for that work.

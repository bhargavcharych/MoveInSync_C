# MoveSync Pulse

MoveSync Pulse is a demo-ready agentic intelligence and reporting layer for enterprise mobility. It turns the supplied May–July 2026 trip logs into a Jira-inspired operations workspace for three personas and grounds every AI claim in read-only DuckDB tools.

## What is included

- Three persona experiences: Transport Manager, Transport & Facilities Head, and Team / Line Manager.
- 2.8M+ normalized source rows across five immutable DuckDB tables.
- SLA-aware OTA/OTP trends, trip volume, delays, shift readiness, no-shows, cost, EV mix, alerts, compliance, and rider CSAT.
- Vendor scorecards with peer ranking and a composite performance signal.
- Jira-style trip board and detailed trip drawers joining trip, rider, alert, feedback, and billing evidence.
- Sarvam AI tool calling with bounded, persona-scoped analytical functions and generated metric/table/chart blocks.
- A second top-level Active Monitoring workspace with simulated route progress, speed telemetry, repeat-offender history, and live AI safety decisions.
- Responsive light/dark UI with `rgb(98, 174, 65)` (`#62AE41`) as the core accent.

## Quick start

Requirements: Node.js 22+, npm 10+, and Python 3.11+.

```bash
npm install
python3 -m venv .venv
.venv/bin/pip install duckdb pypdf
npm run db:ingest
cp .env.example .env.local
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). The ingestion script defaults to:

```text
/Users/bhargav/Downloads/MoveInSync - Anonymised Trip-Log Dataset
```

Use another source directory with:

```bash
.venv/bin/python scripts/ingest.py --source "/absolute/path/to/dataset"
```

To enable Sarvam, put the key in `.env.local` (never in client code):

```bash
SARVAM_API_KEY=sk_...
SARVAM_MODEL=sarvam-105b
```

The integration uses Sarvam's `POST /v1/chat/completions` endpoint and OpenAI-style function calling. No key is sent to the browser. There is deliberately no synthetic/local AI fallback: missing credentials or upstream failures are shown as errors.

## Active monitoring simulation

The monitoring workspace seeds eight active trips from real DuckDB vendor, vehicle, business-unit, office, and shift records. In-memory telemetry then advances every 1.6 seconds:

1. Route progress, vehicle speed, ETA, and a rolling speed trace are simulated.
2. A candidate event is emitted when speed is at least 8 km/h over the route limit.
3. The candidate includes current excess speed, trip repeat count, and recent vendor overspeed history.
4. The backend asks the real `sarvam-105b` model to call a forced, schema-constrained decision function.
5. The validated result supplies `Sev-1`, `Sev-2`, or `Sev-3`, a rationale, confidence, and one of `MONITOR`, `CALL_DRIVER`, `ESCALATE_VENDOR`, or `STOP_TRIP`.
6. The live decision stream and vendor risk table update without writing to the immutable historical database.

Use **Inject speed spike** for a deterministic demo trigger. It forces the lead trip 34 km/h above its speed limit for several simulation ticks; repeat events give Sarvam the context needed to escalate recurring behavior.

## Database model

| Table | Grain | Rows |
|---|---|---:|
| `rides` | One trip | 615,546 |
| `employees` | One rider leg | 1,637,906 |
| `feedback` | One rider's trip-leg rating | 512,873 |
| `alerts` | One trip safety/compliance event | 51,699 |
| `bills` | One billing line | 620,942 |

`v_trip_facts` is a read-only analytical view that pre-aggregates the many-side tables before joining, preventing multiplication of cost, ratings, or alerts.

The source dictionaries say `trip_id` is the join spine, but the actual data contains 6,753 IDs reused across business units. Every join and lookup therefore uses the tenant-safe composite key `(business_unit, trip_id)`.

### Messy-data decisions

- Comma-formatted IDs, epoch values, delays, and costs are normalized to numeric types.
- Dates are parsed with a per-file format.
- Negative rider distances are retained and flagged with `has_invalid_distance` rather than silently discarded.
- The stray alert severity `False` becomes `NULL` and is tracked by `had_invalid_severity`.
- The 160 billing rows labelled `OverHead` are retained with a null trip key and `is_overhead=true`.
- Zero ratings are treated as “not rated” in CSAT calculations.
- Cost per trip is the cross-tenant unit-economics metric. Cost per km is emitted only when at least 20 positive-cost, positive-distance billing lines exist in the selected slice.

## Metric definitions

- **OTA:** actual trip end is no more than 15 minutes after planned end. Target: 90%.
- **OTP:** actual trip start is no more than 10 minutes after planned start.
- **CSAT:** mean of non-zero route, driver, cab, safety, and marshal ratings.
- **Utilization:** actual employee count divided by actual cab capacity.
- **Vendor score:** weighted SLA gap and CSAT, with a Sev-1 safety penalty. It is a prioritization signal, not a contractual score.
- **No-show rate:** employee legs marked `is_no_show` divided by all employee legs in the selected slice.

Change OTA assumptions with `OTA_GRACE_MINUTES` / `OTA_SLA_PERCENT`. The current analytical view uses 15 minutes and 90%; rebuild after changing the grace period in `scripts/ingest.py`.

## Safety and role policy

The source database is protected in layers:

1. Ingestion writes to a temporary database and atomically publishes only after row-count validation.
2. Rebuilding an existing database requires the explicit `--force` flag.
3. The published file is chmod `0444`.
4. The Node backend opens DuckDB with `access_mode=READ_ONLY` and external access disabled.
5. The query wrapper rejects non-read statements.
6. The agent never receives SQL. It can only call a small allowlist of parameterized analytical functions.
7. Live monitoring state is kept separately in process memory; simulated events never mutate the five source tables.

Role enforcement happens in API routes, not just UI:

- Facilities Head receives aggregate financial/vendor views but no rider rows.
- Line Manager receives rider/shift outcomes but no bills, contracts, spend, or cost fields.
- Transport Manager receives operational trip, vendor, safety, and rider exception evidence.

The prototype intentionally uses a persona switch instead of production authentication, matching the hackathon brief. Replace it with SSO claims and server-side tenant scope before production use.

## Commands

```bash
npm run dev          # development server
npm run build        # production build
npm run lint         # ESLint
npm run typecheck    # TypeScript
npm run db:verify    # read-only database integrity/coverage check
npm run db:ingest -- --force  # explicit full rebuild
```

## Deployment

For the live hackathon demo, run the full app on a Node host with the immutable DuckDB file mounted beside it. A 159 MiB database plus native DuckDB bindings is a poor fit for a cold-start serverless function bundle.

For the credible production path, deploy the Next.js frontend on Vercel and move the existing API routes unchanged into a small autoscaled Node analytics service with a read-only volume (Railway, Fly.io, ECS/Fargate, or Kubernetes). Put an API gateway in front, pass verified tenant/persona claims, and keep Sarvam calls server-side. The architecture and scaling notes are in [`docs/architecture.md`](docs/architecture.md).

## Demo walkthrough

See [`docs/demo-script.md`](docs/demo-script.md) for a concise judge-facing story and sample agent prompts.

# Five-minute demo script

## 1. Establish the problem (30 seconds)

“A metric without context is just a number. MoveSync Pulse tells each operator what changed, how it compares with the 90% SLA and peers, and what to do next.”

Show the Transport Manager overview. Point out the OTA gap, open-alert count, rider CSAT, and vendor scorecard.

## 2. Move from signal to evidence (60 seconds)

Open **Trip board**, search or choose an SLA-missed trip, and open its drawer. Show:

- planned versus actual timing and distance;
- vehicle/fuel/compliance;
- rider boarding/no-show outcomes;
- safety events and acknowledgement time;
- feedback and billing evidence where the persona allows it.

Mention that the join is tenant-safe because the source reuses some trip IDs across business units.

## 3. Show role-aware experiences (60 seconds)

Switch to **Transport & facilities head**. The KPIs change to spend, SLA, cost per trip, and EV share. This view is leadership-forwardable and hides rider details.

Switch to **Team / line manager**. The KPIs change to pickup punctuality, boarded legs, no-shows, and late pickups. Billing and contract fields are removed by the server API.

## 4. Ask the agent (90 seconds)

Suggested prompts:

- “Which vendors need attention, and why?”
- “Give me a leadership summary of SLA, cost and sustainability.”
- “Which shifts are most at risk from late pickups and no-shows?”
- “What safety alert type should we act on first?”
- “Show me the riskiest trips.”

Point out that the answer is accompanied by generated evidence UI. Sarvam chooses a bounded tool, the backend queries read-only DuckDB, and the model never writes SQL or sees unrestricted tables.

## 5. Demonstrate active monitoring (60 seconds)

Switch the top-level tab from **Command center** to **Active monitoring**. The copilot stays in place while the entire operating workspace changes.

Click **Inject speed spike** and show:

- the vehicle turning red on the live route map;
- speed crossing the displayed limit in the telemetry chart;
- a pending candidate appearing in the decision stream;
- the real Sarvam result becoming a validated severity, rationale, confidence, and action;
- repeat events increasing the vendor's live risk.

## 6. Close with deployability (30 seconds)

“The demo handles 2.8 million source rows locally in a 159 MiB immutable analytical file. In production, the Next.js UI remains on Vercel, while the same typed analytics routes run as an autoscaled service with tenant claims, an audited tool layer, and versioned read-only data.”

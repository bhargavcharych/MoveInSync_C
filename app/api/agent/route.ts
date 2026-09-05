import { NextResponse } from "next/server";
import {
  getAlertBreakdown,
  getMonthlyTrend,
  getPerformanceContext,
  getRecentTrips,
  getShiftReadiness,
  getTripDetail,
  getVendorPerformance,
  getVendorHistory,
  searchVendorsByName,
} from "@/lib/analytics";
import type { DashboardFilters, Persona, UiBlock } from "@/lib/types";
import { chatSchema } from "@/lib/validation";
import { getSimulationSnapshot } from "@/lib/simulator";
import { runDeterministicAgent } from "@/lib/agent/server";
import type { AnalysisResult } from "@/lib/agent/analytical-engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const tools = [
  {
    type: "function",
    function: {
      name: "get_mobility_overview",
      description: "Get current KPIs: OTA, OTP, trips, delays, alerts, spend, CSAT, sustainability, boarding and no-shows.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "get_vendor_history",
      description: "Get one named vendor's OTA, CSAT, alerts, SLA gap and peer benchmark for each of the three source months. Use for vendor trend questions and follow-ups such as 'this vendor'.",
      parameters: {
        type: "object",
        properties: { vendor: { type: "string", minLength: 2, maxLength: 160 } },
        required: ["vendor"], additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_vendors",
      description: "Find every vendor whose name contains a supplied word or phrase. Use this for vendor-name lookup questions instead of compare_vendors.",
      parameters: {
        type: "object",
        properties: { name_contains: { type: "string", minLength: 1, maxLength: 80 } },
        required: ["name_contains"], additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_performance_trend",
      description: "Get the three-month OTA, CSAT, trip volume, spend and sustainability trend for historical benchmarking.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "compare_vendors",
      description: "Rank vendors using OTA versus SLA, CSAT, safety, cost, sustainability and compliance.",
      parameters: { type: "object", properties: { limit: { type: "integer", minimum: 3, maximum: 12 }, month: { type: "string", description: "Format: YYYY-MM (e.g. 2026-06 for June)" } }, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "investigate_risk_trips",
      description: "Find recent delayed, non-compliant, no-show or safety-alert trips that need action.",
      parameters: { type: "object", properties: { limit: { type: "integer", minimum: 3, maximum: 20 } }, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "analyze_alerts",
      description: "Get the breakdown of alerts by type (e.g. overspeeding, harsh braking, geofence violations, SOS).",
      parameters: { type: "object", properties: { month: { type: "string", description: "Format: YYYY-MM (e.g. 2026-06 for June)" } }, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "analyze_shift_readiness",
      description: "Compare shifts by scheduled riders, boarded riders, no-shows and late pickups.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "inspect_trip",
      description: "Inspect a trip by ID inside the currently selected business unit.",
      parameters: {
        type: "object",
        properties: { trip_id: { type: "string", pattern: "^[0-9]{6,10}$" } },
        required: ["trip_id"], additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_live_fleet_status",
      description: "Inspect active simulated trips, current speeds, limits, route progress and vendor repeat behavior in real time.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "get_live_safety_decisions",
      description: "Inspect latest individual real-time safety decisions. Do not use this raw event tool for repeated-driver questions.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "investigate_live_driver_risk",
      description: "Investigate which simulated driver is repeatedly speeding using driver, vehicle, vendor, route, time, frequency, excess-speed and current-status evidence. Use for 'which driver is speeding too often?'",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
];

const personaBrief: Record<Persona, string> = {
  transport_manager: "Output an operational incident: identify the specific driver/route/trip signal, explain its pattern, and recommend the next operational step. Consequential actions must be presented as approval requests for the Transport Manager.",
  facilities_head: "Output a strategic decision brief: show only systemic trend, SLA, peer, cost or vendor evidence; state the organizational decision and whether human approval is required. Do not expose rider-level data or dump individual events.",
  line_manager: "Output a readiness alert: state the affected employee/shift/route scope, expected operational impact, and the team action. Do not reveal cost, billing, contracts, vendor spend, or irrelevant safety-event logs.",
};

type ToolCall = { id: string; type: "function"; function: { name: string; arguments: string } };

function parseArgs(value: string) {
  try { return JSON.parse(value || "{}"); } catch { return {}; }
}

function redactPerformanceContext(result: Awaited<ReturnType<typeof getPerformanceContext>>, persona: Persona) {
  if (persona !== "line_manager") return result;
  const hidden = new Set(["spend", "cost_per_trip", "cost_per_km", "overhead_lines"]);
  const clean = (row: Record<string, unknown>) => Object.fromEntries(Object.entries(row).filter(([key]) => !hidden.has(key)));
  return { ...result, current: clean(result.current), monthlyTrend: result.monthlyTrend.map((row) => clean(row)) };
}

async function executeTool(name: string, args: Record<string, unknown>, filters: DashboardFilters, persona: Persona) {
  switch (name) {
    case "get_mobility_overview": return redactPerformanceContext(await getPerformanceContext(filters), persona);
    case "get_performance_trend": {
      const rows = await getMonthlyTrend(filters);
      if (persona !== "line_manager") return rows;
      return rows.map((row) => Object.fromEntries(Object.entries(row).filter(([key]) => !["spend", "cost_per_trip", "cost_per_km"].includes(key))));
    }
    case "search_vendors": {
      const term = String(args.name_contains || args.name || "").trim();
      if (!term) return { error: "A vendor-name fragment is required." };
      return searchVendorsByName(filters, term);
    }
    case "get_vendor_history": {
      const vendor = String(args.vendor || args.name || "").trim();
      if (!vendor) return { error: "A vendor name is required." };
      return getVendorHistory(filters, vendor);
    }
    case "compare_vendors": {
      const toolFilters = { ...filters };
      if (args.month) toolFilters.month = String(args.month);
      const rows = await getVendorPerformance(toolFilters, Math.min(Math.max(Number(args.limit) || 8, 3), 12));
      return persona === "line_manager" ? rows.map((row) => Object.fromEntries(Object.entries(row).filter(([key]) => !["spend", "cost_per_km"].includes(key)))) : rows;
    }
    case "investigate_risk_trips": {
      const rows = await getRecentTrips(filters, Math.min(Math.max(Number(args.limit) || 8, 3), 20), true);
      return persona === "line_manager" ? rows.map((row) => Object.fromEntries(Object.entries(row).filter(([key]) => key !== "cost"))) : rows;
    }
    case "analyze_alerts": {
      const toolFilters = { ...filters };
      if (args.month) toolFilters.month = String(args.month);
      return getAlertBreakdown(toolFilters);
    }
    case "analyze_shift_readiness": return getShiftReadiness(filters);
    case "inspect_trip": {
      if (!filters.businessUnit) return { error: "Select a business unit before inspecting a trip." };
      const id = String(args.trip_id || "");
      if (!/^\d{6,10}$/.test(id)) return { error: "A valid numeric trip ID is required." };
      return getTripDetail(filters.businessUnit, id, persona);
    }
    case "get_live_fleet_status": {
      const live = await getSimulationSnapshot();
      return { counts: live.counts, trips: live.trips.map((trip) => ({
        ...Object.fromEntries(Object.entries(trip).filter(([key]) => !["telemetry", "lastEventTick", "forcedSpikeTicks"].includes(key))),
        isCurrentlySpeeding: trip.status === "speeding",
        currentExcessKph: Math.max(0, trip.currentSpeed - trip.speedLimit),
      })), vendorRisk: live.vendorRisk };
    }
    case "get_live_safety_decisions": {
      const live = await getSimulationSnapshot();
      return { counts: live.counts, events: live.events.filter((event) => event.decisionStatus === "classified").slice(0, 12) };
    }
    case "investigate_live_driver_risk": {
      const live = await getSimulationSnapshot();
      const tripById = new Map(live.trips.map((trip) => [trip.tripId, trip]));
      const grouped = new Map<string, {
        driver: string; vendor: string; vehicle: string; tripId: string; route: string; shift: string;
        overspeedEvents: number; maxExcessKph: number; totalExcessKph: number; latestSeverity: string | null;
        latestAction: string | null; currentlySpeeding: boolean; currentSpeedKph: number; speedLimitKph: number;
      }>();
      for (const event of live.events.filter((candidate) => candidate.decisionStatus === "classified")) {
        const trip = tripById.get(event.tripId);
        if (!trip) continue;
        const row = grouped.get(trip.driver) || {
          driver: trip.driver, vendor: trip.vendor, vehicle: trip.vehicle, tripId: trip.tripId,
          route: `${trip.origin} → ${trip.destination}`, shift: trip.shift, overspeedEvents: 0,
          maxExcessKph: 0, totalExcessKph: 0, latestSeverity: event.severity,
          latestAction: event.recommendedAction, currentlySpeeding: trip.status === "speeding",
          currentSpeedKph: trip.currentSpeed, speedLimitKph: trip.speedLimit,
        };
        row.overspeedEvents += 1;
        row.maxExcessKph = Math.max(row.maxExcessKph, event.excessKph);
        row.totalExcessKph += event.excessKph;
        grouped.set(trip.driver, row);
      }
      return {
        drivers: [...grouped.values()].map((row) => ({ ...row, averageExcessKph: Math.round(row.totalExcessKph / row.overspeedEvents * 10) / 10 })).sort((a, b) => b.overspeedEvents - a.overspeedEvents || b.maxExcessKph - a.maxExcessKph).slice(0, 5),
      dataQuality: "Live telemetry is simulated; driver labels are masked; passenger status is unknown.",
        comparisonBasis: "Ranked by classified event frequency, then maximum excess speed. OTA SLA is not relevant to speed risk.",
      };
    }
    default: return { error: "Tool not permitted" };
  }
}

function blocksFor(name: string, result: unknown): UiBlock[] {
  if (name === "get_mobility_overview") {
    const context = result as { current?: Record<string, number> };
    const row = context.current || result as Record<string, number>;
    return [{ type: "metrics", title: "Current operating pulse", items: [
      { label: "OTA", value: `${row.ota ?? 0}%`, tone: (row.ota ?? 0) >= 90 ? "good" : "risk" },
      { label: "Trips", value: Number(row.trips || 0).toLocaleString("en-IN") },
      { label: "Open alerts", value: Number(row.open_alerts || 0).toLocaleString("en-IN"), tone: row.open_alerts ? "risk" : "good" },
      { label: "CSAT", value: `${row.csat ?? "—"}/5` },
    ] }];
  }
  if (name === "compare_vendors" && Array.isArray(result)) {
    return [{ type: "table", title: "Vendor evidence", columns: ["Vendor", "OTA", "CSAT", "Alerts"], rows: result.slice(0, 6).map((r) => {
      const row = r as Record<string, unknown>;
      return [String(row.vendor), `${row.ota}%`, row.csat ? `${row.csat}/5` : "—", String(row.alerts)];
    }) }];
  }
  if (name === "search_vendors") {
    const search = result as { vendors?: Array<Record<string, unknown>>; matchCount?: number };
    if (!search.vendors?.length) return [];
    return [{ type: "table", title: `${search.matchCount} matching vendors`, columns: ["Vendor", "OTA", "CSAT"], rows: search.vendors.slice(0, 3).map((row) => [String(row.vendor), `${row.ota}%`, row.csat ? `${row.csat}/5` : "—"]) }];
  }
  if (name === "get_vendor_history") {
    const history = result as { vendor?: string; months?: Array<Record<string, unknown>> };
    if (!history.months?.length) return [];
    return [{ type: "table", title: `${history.vendor} · 3-month trend`, columns: ["Month", "OTA", "Peer", "CSAT"], rows: history.months.slice(0, 3).map((row) => [String(row.month), `${row.ota}%`, `${row.peer_ota}%`, row.csat ? `${row.csat}/5` : "—"]) }];
  }
  if (name === "analyze_alerts" && Array.isArray(result)) {
    return [{ type: "bars", title: "Alerts by type", items: result.slice(0, 6).map((r) => {
      const row = r as Record<string, unknown>; return { label: String(row.event_type).replaceAll("_", " "), value: Number(row.count) };
    }) }];
  }
  if (name === "analyze_shift_readiness" && Array.isArray(result)) {
    return [{ type: "table", title: "Shift readiness", columns: ["Shift", "Scheduled", "Late", "No-shows"], rows: result.slice(0, 6).map((r) => {
      const row = r as Record<string, unknown>; return [String(row.shift_type), String(row.scheduled), String(row.late), String(row.no_shows)];
    }) }];
  }
  if (name === "investigate_risk_trips" && Array.isArray(result)) {
    return [{ type: "table", title: "Trips needing action", columns: ["Trip", "Vendor", "Delay", "Alerts"], rows: result.slice(0, 6).map((r) => {
      const row = r as Record<string, unknown>; return [`#${row.trip_id}`, String(row.vendor), `${row.delay_minutes} min`, String(row.alert_count)];
    }) }];
  }
  if (name === "get_live_fleet_status") {
    const live = result as { counts: Record<string, number> };
    return [{ type: "metrics", title: "Live fleet pulse", items: [
      { label: "Active trips", value: String(live.counts.activeTrips || 0) },
      { label: "Speeding now", value: String(live.counts.speedingNow || 0), tone: live.counts.speedingNow ? "risk" : "good" },
      { label: "AI pending", value: String(live.counts.pendingDecisions || 0) },
      { label: "Sev-1", value: String(live.counts.criticalEvents || 0), tone: live.counts.criticalEvents ? "risk" : "good" },
    ] }];
  }
  if (name === "get_live_safety_decisions") {
    const live = result as { events: Array<Record<string, unknown>> };
    return [{ type: "table", title: "Live AI decisions", columns: ["Severity", "Trip", "Speed", "Action"], rows: live.events.slice(0, 6).map((event) => [String(event.severity || "Analyzing"), `#${event.tripId}`, `${event.speed}/${event.speedLimit} km/h`, String(event.recommendedAction || "Pending").replaceAll("_", " ")]) }];
  }
  return [];
}

function leakedToolCall(content: string) {
  const name = content.match(/<tool_call>\s*([a-z_]+)/i)?.[1];
  if (!name || !tools.some((tool) => tool.function.name === name)) return null;
  const args: Record<string, unknown> = {};
  for (const match of content.matchAll(/<arg_key>\s*([^<]+?)\s*<\/arg_key>\s*<arg_value>\s*([^<]+?)\s*<\/arg_value>/gi)) args[match[1].trim()] = match[2].trim();
  return { name, args };
}

function cleanAnswer(content: string) {
  return content
    .replace(/<tool_call>[\s\S]*?<\/tool_call>/gi, "")
    .replace(/<\/?(?:arg_key|arg_value)>/gi, "")
    .trim();
}

function wantsEvidenceBlock(message: string) {
  return /\b(show|list|compare|table|chart|graph|breakdown|evidence)\b/i.test(message);
}

function forcedToolFor(message: string) {
  if (/\bdriver\b[\s\S]*\b(speed|speeding|overspeed)/i.test(message) || /\b(speed|speeding|overspeed)[\s\S]*\bdriver\b/i.test(message)) return "investigate_live_driver_risk";
  if (/\bOTA\b/i.test(message) && /\b(vendor|months?|trend|history)\b/i.test(message)) return "get_vendor_history";
  return null;
}

function generatedAnswerQuality(question: string, answer: string, executedTools: string[]) {
  const lowerQuestion = question.toLowerCase();
  const lowerAnswer = answer.toLowerCase();
  const roleBoundary = /outside.*(role|purview|scope)|not responsible for|ask the (?:transport|facilities|line) manager|contact.*persona/i.test(lowerAnswer);
  const factual = /\b(ota|otp|sla|vendors?|drivers?|trips?|alerts?|delays?|costs?|ratings?|feedback|speed|employees?|shifts?|safety|complaints?)\b/.test(lowerQuestion);
  const requestedMetric = /\bota\b/.test(lowerQuestion) ? /\bota\b|on[- ]?time|%/.test(lowerAnswer)
    : /speed|overspeed/.test(lowerQuestion) ? /speed|overspeed|km\/h|road limit/.test(lowerAnswer)
      : true;
  const vendor = question.match(/([A-Z][\w.-]+(?:\s+[A-Z][\w.-]+)*\s+Travel)/)?.[1];
  const wordCount = answer.trim().split(/\s+/).filter(Boolean).length;
  const checks = [
    { name: "no_tool_leak", passed: !/<tool_call>|<arg_key>|<arg_value>|\bsearch_vendors\b|\bget_vendor_history\b|evidence packet|evidence array|empty evidence|\bpacket\b|internal analysis|system returned/i.test(answer), detail: "Tool syntax and internal evidence machinery must never be rendered." },
    { name: "evidence_used", passed: !factual || roleBoundary || executedTools.length > 0, detail: factual ? `${executedTools.length} approved data tool(s) executed.` : "No data evidence was required." },
    { name: "requested_metric", passed: roleBoundary || requestedMetric, detail: "The requested metric must remain in the answer." },
    { name: "requested_entity", passed: roleBoundary || !vendor || lowerAnswer.includes(vendor.toLowerCase()), detail: vendor ? `The named vendor (${vendor}) must remain the primary entity.` : "No explicit named entity was required." },
    { name: "concise_rendering", passed: wordCount <= 75, detail: "Answer must contain no more than 75 words." },
  ];
  return { passed: checks.every((check) => check.passed), checks, confidence: checks.every((check) => check.passed) ? 0.82 : 0.4 };
}

function deterministicSynthesisChecks(result: AnalysisResult, answer: string) {
  const text = answer.toLowerCase();
  const contains = (value: unknown) => text.includes(String(value).toLowerCase());
  const checks: Array<{ name: string; passed: boolean; detail: string }> = [
    { name: "metric_preserved", passed: result.status === "refused" || result.querySpec.metric !== "ota" || /\bota\b|on[- ]?time/.test(text), detail: "The requested metric must remain explicit unless the request is semantically refused." },
    { name: "no_tool_syntax", passed: !/<tool_call>|<arg_key>|<arg_value>|\bget_[a-z_]+\b/.test(text), detail: "Internal tools must not be exposed." },
  ];
  if (result.querySpec.intent === "comparison") {
    const rows = result.data.comparison as Array<{ businessUnit: string }>;
    checks.push({ name: "all_groups", passed: rows.every((row) => contains(row.businessUnit)), detail: "Every requested business unit must appear." });
  }
  if (result.querySpec.intent === "ranking") {
    const ranking = result.data.ranking as Array<{ office?: string; vendor?: string }> | undefined;
    const winner = ranking?.[0]?.office || ranking?.[0]?.vendor;
    checks.push({ name: "ranked_entity", passed: result.status === "refused" || !winner || contains(winner), detail: "The requested superlative entity must lead the answer." });
  }
  if (result.status === "premise_false") checks.push({ name: "premise_failure", passed: /premise.*false|did not (?:drop|decline|fall)/.test(text), detail: "A false premise must be stated explicitly." });
  if (result.querySpec.intent === "feedback_diagnosis") {
    const weakest = result.data.weakest as { dimension?: string } | undefined;
    const offices = result.data.offices as Array<{ office: string }> | undefined;
    checks.push({ name: "feedback_dimension", passed: Boolean(weakest?.dimension && contains(weakest.dimension)), detail: "The weakest rated dimension must be stated." });
    checks.push({ name: "feedback_concentration", passed: Boolean(offices?.some((row) => row.office === "Denver Office") && /denver/.test(text) && /clearwater/.test(text)), detail: "The requested office concentration must be included." });
  }
  if (result.querySpec.intent === "anomaly") {
    checks.push({ name: "alert_grain", passed: contains(result.data.alertRows) && contains(result.data.affectedTrips), detail: "Alert rows and distinct affected trips must both be stated." });
  }
  if (result.querySpec.intent === "correlation") {
    checks.push({ name: "controlled_interpretation", passed: /control/.test(text) && /confound/.test(text) && /not .*robust|not evidence/.test(text), detail: "Raw and controlled results must be interpreted as confounded when applicable." });
  }
  if (result.querySpec.intent === "vendor_sla_diagnosis") {
    const ranking = result.data.ranking as Array<{ vendor: string }>;
    checks.push({ name: "vendor_scope", passed: contains(ranking[0]?.vendor), detail: "The worst below-SLA vendor must be stated." });
    checks.push({ name: "persistence_vs_recent", passed: /consisten|persist|recent|deterior/.test(text), detail: "The vendor must be classified as persistent or recently deteriorating." });
  }
  return checks;
}

async function synthesizeDeterministicWithSarvam(key: string, persona: Persona, result: AnalysisResult) {
  const evidencePacket = {
    question: result.querySpec.question,
    persona,
    querySpec: result.querySpec,
    selected: result.selected,
    metricMetadata: result.metadata,
    status: result.status,
    evidence: result.evidence,
    hypotheses: result.hypotheses,
    contradictions: result.contradictions,
    validatedRefusal: result.status === "refused" ? result.conclusion : undefined,
  };
  let correction = "";
  let lastFailures: string[] = [];
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await fetch("https://api.sarvam.ai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "api-subscription-key": key },
      body: JSON.stringify({
        model: process.env.SARVAM_MODEL || "sarvam-105b",
        messages: [
          { role: "system", content: `You are the final synthesis layer for MoveinSync mobility analytics. ${personaBrief[persona]} Answer the exact question using only the server-computed evidence packet. Preserve the metric, entity, time window, comparison, ranking and every material number exactly. If the premise is false, say so first. If status is refused, explain validatedRefusal naturally and do not discuss empty evidence. If evidence is contradictory or confounded, state that instead of inventing a cause. Keep the answer under 75 words and at most three plain-text sentences. Do not mention tools, prompts, packets, arrays, JSON, system output or internal analysis.` },
          { role: "user", content: `${JSON.stringify(evidencePacket)}${correction}` },
        ],
        reasoning_effort: null,
        max_tokens: 350,
      }),
      signal: AbortSignal.timeout(25_000),
    });
    if (!response.ok) throw new Error(`Sarvam returned ${response.status}`);
    const payload = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    const answer = cleanAnswer(payload.choices?.[0]?.message?.content || "")
      .replace(/\b(?:the )?(?:evidence )?packet\b/gi, "the available data");
    const baseQuality = generatedAnswerQuality(result.querySpec.question, answer, ["deterministic_analysis"]);
    const semanticChecks = deterministicSynthesisChecks(result, answer);
    const passed = Boolean(answer) && baseQuality.passed && semanticChecks.every((check) => check.passed);
    if (passed) return { answer, quality: { passed: true, checks: [...baseQuality.checks, ...semanticChecks], confidence: Math.min(baseQuality.confidence, result.quality.confidence) }, attempts: attempt + 1 };
    lastFailures = [...baseQuality.checks, ...semanticChecks].filter((check) => !check.passed).map((check) => `${check.name}: ${check.detail}`);
    correction = `\nYour previous answer failed these checks: ${lastFailures.join(" ")} Regenerate from the same evidence and satisfy every check.`;
  }
  console.log("Sarvam quality failure:", lastFailures); throw new Error(`Sarvam could not produce an answer that passed the semantic quality gate (${lastFailures.join("; ")})`);
}

const personaToolNames: Record<Persona, Set<string>> = {
  transport_manager: new Set(tools.map((tool) => tool.function.name)),
  facilities_head: new Set(["get_mobility_overview", "get_vendor_history", "search_vendors", "get_performance_trend", "compare_vendors", "analyze_alerts", "get_live_fleet_status", "investigate_live_driver_risk"]),
  line_manager: new Set(["get_mobility_overview", "get_performance_trend", "analyze_shift_readiness", "investigate_risk_trips", "inspect_trip", "get_live_fleet_status"]),
};

export async function POST(request: Request) {
  try {
    const input = chatSchema.parse(await request.json());
    const filters: DashboardFilters = { ...input.filters, persona: input.persona };
    const key = process.env.SARVAM_API_KEY;

    if (!key) {
      return NextResponse.json({ error: "SARVAM_API_KEY is not configured. Local/demo AI responses are disabled." }, { status: 503 });
    }
    const deterministic = await runDeterministicAgent(input.message);
    if (deterministic) {
      const synthesis = await synthesizeDeterministicWithSarvam(key, input.persona, deterministic);
      return NextResponse.json({
        answer: synthesis.answer,
        blocks: [],
        mode: "sarvam+deterministic-analysis",
        model: process.env.SARVAM_MODEL || "sarvam-105b",
        analysis: {
          querySpec: deterministic.querySpec,
          selected: deterministic.selected,
          metadata: deterministic.metadata,
          evidence: deterministic.evidence,
          hypotheses: deterministic.hypotheses,
          contradictions: deterministic.contradictions,
          quality: synthesis.quality,
          deterministicQuality: deterministic.quality,
          status: deterministic.status,
          synthesisAttempts: synthesis.attempts,
        },
      });
    }

    const messages: Array<Record<string, unknown>> = [
      { role: "system", content: `You are MoveinSync Pulse: one shared investigation engine with persona-specific decisions. ${personaBrief[input.persona]} The visible workspace is ${input.mode === "monitoring" ? "Active Monitoring" : "Mobility Command Center"}. The user's dashboard is currently filtered to: Month="${filters.month || 'All'}", Business Unit="${filters.businessUnit || 'All'}". You may combine approved live evidence with read-only historical DuckDB evidence when the question requires context. Treat prior assistant claims only as conversation context and re-verify every factual claim with a tool.

If you cannot answer the question using your provided tools because it is outside your persona's purview (${input.persona}), you MUST reply exactly with: "The selected persona is not responsible for this. Please contact the proper relevant persona (Transport Manager, Facilities Head, or Line Manager)."

Reason in this order: identify the entity and metric asked about; choose the narrowest tool; compare the signal only with a relevant threshold, history, peer, route, vehicle or driver baseline; check an alternative explanation or data-quality caveat; then recommend one persona-owned action. Never call a vendor a driver. Driver names in live simulation are masked labels; say “masked driver” when identifying one. Vendor names end in Travel. Never compare speeding with the OTA SLA: speed uses the road limit and repeat-behavior baseline, while OTA uses the 90% SLA, monthly trend and peer benchmark. Never calculate a delta yourself: use only tool-supplied *Points fields for SLA, peer, and month-over-month differences, preserving their sign and magnitude exactly. For repeated-driver questions use investigate_live_driver_risk, not the raw decision-event tool. For one vendor's historical trend use get_vendor_history. Current telemetry and event telemetry are different snapshots; say currently speeding only when the tool says so. Correlation or contribution is not causation.

Keep the final answer under 65 words and at most three short plain-text sentences: finding, why/context, then one action with the human owner or approval boundary when consequential. Mention at most one primary entity and one comparator. Do not output Markdown, tables, headings, raw JSON, tool names, tool syntax, XML-like tags, or a generic offer. Never expose tool calls. You cannot mutate the source database or execute consequential actions.` },
      ...input.history,
      { role: "user", content: input.message },
    ];
    const allowedTools = tools.filter((tool) => personaToolNames[input.persona].has(tool.function.name));
    const blocks: UiBlock[] = [];
    let answer = "";
    const executedTools: string[] = [];
    const includeBlock = wantsEvidenceBlock(input.message);
    const forcedTool = forcedToolFor(input.message);

    for (let step = 0; step < 4; step += 1) {
      const response = await fetch("https://api.sarvam.ai/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", "api-subscription-key": key },
        body: JSON.stringify({ model: process.env.SARVAM_MODEL || "sarvam-105b", messages, tools: allowedTools, tool_choice: step === 0 && forcedTool && personaToolNames[input.persona].has(forcedTool) ? { type: "function", function: { name: forcedTool } } : "auto", reasoning_effort: null, max_tokens: 300 }),
        signal: AbortSignal.timeout(25_000),
      });
      if (!response.ok) throw new Error(`Sarvam returned ${response.status}`);
      const payload = await response.json() as { choices?: Array<{ message?: { content?: string; tool_calls?: ToolCall[] } }> };
      const message = payload.choices?.[0]?.message;
      if (!message) throw new Error("Sarvam returned no message");
      const calls = message.tool_calls || [];
      if (!calls.length) {
        const rawContent = message.content || "";
        const leaked = leakedToolCall(rawContent);
        if (leaked && step < 3 && personaToolNames[input.persona].has(leaked.name)) {
          const result = await executeTool(leaked.name, leaked.args, filters, input.persona);
          executedTools.push(leaked.name);
          if (includeBlock) blocks.push(...blocksFor(leaked.name, result));
          messages.push({ role: "assistant", content: "I need verified evidence before answering." });
          messages.push({ role: "user", content: `Server-validated ${leaked.name} evidence: ${JSON.stringify(result).slice(0, 40_000)}. Answer the original question now without mentioning tools.` });
          continue;
        }
        answer = cleanAnswer(rawContent) || "I could not verify enough evidence for a precise answer.";
        break;
      }
      messages.push({ role: "assistant", content: message.content || null, tool_calls: calls });
      for (const call of calls.slice(0, 2)) {
        const result = await executeTool(call.function.name, parseArgs(call.function.arguments), filters, input.persona);
        executedTools.push(call.function.name);
        if (includeBlock) blocks.push(...blocksFor(call.function.name, result));
        messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(result).slice(0, 40_000) });
      }
    }
    let rendered = answer;
    let quality = generatedAnswerQuality(input.message, rendered, executedTools);
    if (!rendered || !quality.passed) {
      const failures = quality.checks.filter((check) => !check.passed).map((check) => check.detail).join(" ");
      const retry = await fetch("https://api.sarvam.ai/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", "api-subscription-key": key },
        body: JSON.stringify({
          model: process.env.SARVAM_MODEL || "sarvam-105b",
          messages: [
            ...messages,
            ...(rendered ? [{ role: "assistant", content: rendered }] : []),
            { role: "user", content: `Answer the original question again using the verified tool evidence already provided. The prior draft failed these checks: ${failures}. Keep the requested metric and entity, stay under 75 words, and do not mention tools or internal processing.` },
          ],
          reasoning_effort: null,
          max_tokens: 300,
        }),
        signal: AbortSignal.timeout(25_000),
      });
      if (!retry.ok) throw new Error(`Sarvam retry returned ${retry.status}`);
      const payload = await retry.json() as { choices?: Array<{ message?: { content?: string } }> };
      rendered = cleanAnswer(payload.choices?.[0]?.message?.content || "");
      quality = generatedAnswerQuality(input.message, rendered, executedTools);
    }
    if (!rendered || !quality.passed) throw new Error("Sarvam could not produce an answer that passed the final quality gate");
    return NextResponse.json({ answer: rendered, blocks: blocks.slice(0, 1), mode: "sarvam", model: process.env.SARVAM_MODEL || "sarvam-105b", analysis: { executedTools, quality } });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "I encountered an issue verifying the data. Please rephrase your question or try a different context." }, { status: 500 });
  }
}

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
      parameters: { type: "object", properties: { limit: { type: "integer", minimum: 3, maximum: 12 } }, additionalProperties: false },
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
      description: "Break down safety/compliance alert volume, severity and acknowledgement time.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
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
      const rows = await getVendorPerformance(filters, Math.min(Math.max(Number(args.limit) || 8, 3), 12));
      return persona === "line_manager" ? rows.map((row) => Object.fromEntries(Object.entries(row).filter(([key]) => !["spend", "cost_per_km"].includes(key)))) : rows;
    }
    case "investigate_risk_trips": {
      const rows = await getRecentTrips(filters, Math.min(Math.max(Number(args.limit) || 8, 3), 20), true);
      return persona === "line_manager" ? rows.map((row) => Object.fromEntries(Object.entries(row).filter(([key]) => key !== "cost"))) : rows;
    }
    case "analyze_alerts": return getAlertBreakdown(filters);
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

function precisionAnswerFor(name: string, result: unknown, persona: Persona) {
  if (name === "investigate_live_driver_risk" && persona === "transport_manager") {
    const investigation = result as { drivers?: Array<Record<string, unknown>> };
    const driver = investigation.drivers?.[0];
    if (!driver) return "No classified repeat-driver pattern is available yet. Live telemetry is still being evaluated. Continue monitoring; no escalation is warranted without repeated evidence.";
    const current = driver.currentlySpeeding
      ? `currently ${driver.currentSpeedKph} km/h in a ${driver.speedLimitKph} km/h zone`
      : "not currently above the road limit";
    const action = String(driver.latestAction || "START_ENHANCED_MONITORING").replaceAll("_", " ").toLowerCase();
    const approval = String(driver.latestAction || "").startsWith("REQUEST_") ? "Transport Manager approval is required." : "No approval is required.";
    return `Masked driver ${driver.driver} has ${driver.overspeedEvents} classified overspeed events on trip #${driver.tripId} and is ${current}. The pattern is concentrated on ${driver.route}; maximum excess was ${driver.maxExcessKph} km/h, so OTA SLA is not relevant. Recommended action: ${action}; ${approval}`;
  }
  if (name === "get_vendor_history") {
    const history = result as { found?: boolean; vendor?: string; months?: Array<Record<string, unknown>>; summary?: Record<string, unknown> | null };
    if (!history.found || !history.months?.length || !history.summary) return `No three-month history was found for ${history.vendor || "that vendor"}. The name may not match the source data exactly. Verify the vendor identity before drawing a conclusion.`;
    const labels = new Intl.DateTimeFormat("en", { month: "short", timeZone: "UTC" });
    const timeline = history.months.map((row) => `${labels.format(new Date(`${row.month}-01T00:00:00Z`))} ${row.ota}%`).join(", ");
    const latestChange = Number(history.summary.latestChangePoints);
    const movement = latestChange >= 0 ? `improved ${latestChange} points` : `declined ${Math.abs(latestChange)} points`;
    const slaGap = Number(history.summary.latestVsSlaPoints);
    const peerGap = Number(history.summary.latestVsPeerPoints);
    const slaPosition = `${Math.abs(slaGap)} points ${slaGap >= 0 ? "above" : "below"} SLA`;
    const peerPosition = `${Math.abs(peerGap)} points ${peerGap >= 0 ? "above" : "below"} peers`;
    const action = persona === "facilities_head"
      ? "Request a route-level investigation before approving any vendor escalation."
      : "Investigate the affected routes now; formal vendor escalation requires Transport Manager approval.";
    return `${history.vendor} OTA was ${timeline}. The latest month ${movement}; it is ${slaPosition} and ${peerPosition}. ${action}`;
  }
  return "";
}

function forcedToolFor(message: string) {
  if (/\bdriver\b[\s\S]*\b(speed|speeding|overspeed)/i.test(message) || /\b(speed|speeding|overspeed)[\s\S]*\bdriver\b/i.test(message)) return "investigate_live_driver_risk";
  if (/\bOTA\b/i.test(message) && /\b(vendor|months?|trend|history)\b/i.test(message)) return "get_vendor_history";
  return null;
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

    const messages: Array<Record<string, unknown>> = [
      { role: "system", content: `You are MoveSync Pulse: one shared investigation engine with persona-specific decisions. ${personaBrief[input.persona]} The visible workspace is ${input.mode === "monitoring" ? "Active Monitoring" : "Mobility Command Center"}, but you may combine approved live evidence with read-only historical DuckDB evidence when the question requires context. Treat prior assistant claims only as conversation context and re-verify every factual claim with a tool.

Reason in this order: identify the entity and metric asked about; choose the narrowest tool; compare the signal only with a relevant threshold, history, peer, route, vehicle or driver baseline; check an alternative explanation or data-quality caveat; then recommend one persona-owned action. Never call a vendor a driver. Driver names in live simulation are masked labels; say “masked driver” when identifying one. Vendor names end in Travel. Never compare speeding with the OTA SLA: speed uses the road limit and repeat-behavior baseline, while OTA uses the 90% SLA, monthly trend and peer benchmark. Never calculate a delta yourself: use only tool-supplied *Points fields for SLA, peer, and month-over-month differences, preserving their sign and magnitude exactly. For repeated-driver questions use investigate_live_driver_risk, not the raw decision-event tool. For one vendor's historical trend use get_vendor_history. Current telemetry and event telemetry are different snapshots; say currently speeding only when the tool says so. Correlation or contribution is not causation.

Keep the final answer under 65 words and at most three short plain-text sentences: finding, why/context, then one action with the human owner or approval boundary when consequential. Mention at most one primary entity and one comparator. Do not output Markdown, tables, headings, raw JSON, tool names, tool syntax, XML-like tags, or a generic offer. Never expose tool calls. You cannot mutate the source database or execute consequential actions.` },
      ...input.history,
      { role: "user", content: input.message },
    ];
    const allowedTools = tools.filter((tool) => personaToolNames[input.persona].has(tool.function.name));
    const blocks: UiBlock[] = [];
    let answer = "";
    let precisionAnswer = "";
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
          precisionAnswer = precisionAnswerFor(leaked.name, result, input.persona) || precisionAnswer;
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
        precisionAnswer = precisionAnswerFor(call.function.name, result, input.persona) || precisionAnswer;
        if (includeBlock) blocks.push(...blocksFor(call.function.name, result));
        messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(result).slice(0, 40_000) });
      }
    }
    return NextResponse.json({ answer: precisionAnswer || answer || "Analysis complete; the supporting evidence is shown below.", blocks: blocks.slice(0, 1), mode: "sarvam", model: process.env.SARVAM_MODEL || "sarvam-105b" });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "The mobility agent could not complete that analysis." }, { status: 500 });
  }
}

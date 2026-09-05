import "server-only";

import { z } from "zod";
import { query } from "@/lib/db";

export type LiveTelemetry = {
  at: string;
  speed: number;
  limit: number;
};

export type LiveTrip = {
  businessUnit: string;
  tripId: string;
  vendor: string;
  vehicle: string;
  driver: string;
  origin: string;
  destination: string;
  shift: string;
  progress: number;
  currentSpeed: number;
  speedLimit: number;
  etaMinutes: number;
  status: "on_route" | "speeding" | "attention";
  overspeedCount: number;
  lastEventTick: number;
  forcedSpikeTicks: number;
  telemetry: LiveTelemetry[];
};

export type SafetyDecision = {
  eventId: string;
  tripId: string;
  businessUnit: string;
  vendor: string;
  vehicle: string;
  driver: string;
  origin: string;
  destination: string;
  shift: string;
  eventType: "OVER_SPEEDING" | "EMP GEOFENCE VIOLATION" | "WOMAN TRAVELLING ALONE" | "DEVICE NOT REACHABLE" | "VEHICLE STOPPAGE" | "EMP SIGN OFF TIME VIOLATION" | "PANIC FIXED DEVICE";
  speed: number;
  speedLimit: number;
  excessKph: number;
  repeatCount: number;
  occurredAt: string;
  decisionStatus: "pending" | "analyzing" | "classified" | "failed";
  severity: "Sev-1" | "Sev-2" | "Sev-3" | null;
  rationale: string | null;
  reasonCode: string | null;
  recommendedAction: string | null;
  humanOwner: string | null;
  approvalRequired: boolean | null;
  confidence: number | null;
  model: string | null;
};

type SimulationState = {
  running: boolean;
  startedAt: string;
  lastAdvancedAt: number;
  tick: number;
  sequence: number;
  trips: LiveTrip[];
  events: SafetyDecision[];
  initializing?: Promise<void>;
};

declare global {
  var __moveSyncSimulation: SimulationState | undefined;
}

const origins = [
  "Whitefield Gate", "Indiranagar Hub", "Electronic City", "HSR Layout",
  "Koramangala Node", "Marathahalli", "Bellandur", "Hebbal Node",
];

const safetyDecisionSchema = z.object({
  severity: z.enum(["Sev-1", "Sev-2", "Sev-3"]),
  rationale: z.string().min(5).max(500),
  reason_code: z.string(),
  recommended_action: z.string(),
  human_owner: z.string(),
  approval_required: z.boolean(),
  confidence: z.number().min(0).max(1),
});

function policyDecision(event: SafetyDecision, readingCount: number) {
  if (event.eventType === "PANIC FIXED DEVICE" || event.eventType === "WOMAN TRAVELLING ALONE") return {
    severity: "Sev-1" as const, reasonCode: "SOS_ACTIVATED" as const,
    action: "DISPATCH_GUARD" as const, approvalRequired: true,
    rationale: `Critical ${event.eventType} alert triggered; immediate security response required.`,
  };
  if (event.eventType === "VEHICLE STOPPAGE") return {
    severity: "Sev-2" as const, reasonCode: "UNAUTHORIZED_STOP" as const,
    action: "CALL_DRIVER" as const, approvalRequired: false,
    rationale: `Vehicle stopped unexpectedly; call driver to verify status.`,
  };
  if (event.eventType === "EMP GEOFENCE VIOLATION") return {
    severity: "Sev-2" as const, reasonCode: "GEOFENCE_BREACH" as const,
    action: "START_ENHANCED_MONITORING" as const, approvalRequired: false,
    rationale: `Geofence breached; monitor closely and notify transport team.`,
  };
  if (event.eventType !== "OVER_SPEEDING") return {
    severity: "Sev-3" as const, reasonCode: "POLICY_VIOLATION" as const,
    action: "MONITOR" as const, approvalRequired: false,
    rationale: `${event.eventType} alert triggered; log and monitor.`,
  };

  if (readingCount < 3) return {
    severity: "Sev-3" as const, reasonCode: "POSSIBLE_TELEMETRY_ANOMALY" as const,
    action: "MONITOR" as const, approvalRequired: false,
    rationale: `${event.driver} recorded +${event.excessKph} km/h, but only ${readingCount} telemetry readings are available; verify the signal before attributing behavior.`,
  };
  if (event.excessKph >= 25) return {
    severity: "Sev-1" as const, reasonCode: "EXTREME_SPEED" as const,
    action: "REQUEST_STOP_TRIP_APPROVAL" as const, approvalRequired: true,
    rationale: `${event.driver} reached +${event.excessKph} km/h over the limit on occurrence ${event.repeatCount}; request Transport Manager approval for an immediate trip stop.`,
  };
  if (event.repeatCount >= 4) return {
    severity: "Sev-2" as const, reasonCode: "PERSISTENT_DRIVER_PATTERN" as const,
    action: "REQUEST_DRIVER_ESCALATION" as const, approvalRequired: true,
    rationale: `${event.driver} has ${event.repeatCount} overspeed occurrences, with a latest excess of +${event.excessKph} km/h; the persistent pattern requires Transport Manager review.`,
  };
  if (event.repeatCount >= 2) return {
    severity: "Sev-2" as const, reasonCode: "REPEATED_MODERATE_SPEEDING" as const,
    action: "CALL_DRIVER" as const, approvalRequired: false,
    rationale: `${event.driver} has ${event.repeatCount} moderate overspeed occurrences; call the driver and continue enhanced monitoring.`,
  };
  return {
    severity: "Sev-3" as const, reasonCode: "ISOLATED_BREACH" as const,
    action: "START_ENHANCED_MONITORING" as const, approvalRequired: false,
    rationale: `${event.driver} recorded one +${event.excessKph} km/h breach; monitor for recurrence before escalating.`,
  };
}

function state(): SimulationState {
  if (!globalThis.__moveSyncSimulation) {
    globalThis.__moveSyncSimulation = {
      running: true,
      startedAt: new Date().toISOString(),
      lastAdvancedAt: Date.now(),
      tick: 0,
      sequence: 0,
      trips: [],
      events: [],
    };
  }
  return globalThis.__moveSyncSimulation;
}

function maskedDriver(index: number) {
  const names = ["D. Kumar", "A. Singh", "R. Patil", "S. Rao", "M. Das", "V. Iyer", "P. Shah", "K. Nair"];
  return names[index % names.length];
}

export async function ensureSimulation() {
  const s = state();
  if (s.trips.length) return s;
  if (!s.initializing) {
    s.initializing = (async () => {
      const seeds = await query<Record<string, string>>(
        `SELECT business_unit, trip_id::VARCHAR AS trip_id, vendor_id AS vendor,
          actual_cab_registration AS vehicle, office, shift_type
        FROM rides
        QUALIFY row_number() OVER (PARTITION BY vendor_id ORDER BY trip_date DESC, trip_id) = 1
        LIMIT 8`,
      );
      s.trips = seeds.map((seed, index) => ({
        businessUnit: seed.business_unit,
        tripId: seed.trip_id,
        vendor: seed.vendor,
        vehicle: seed.vehicle,
        driver: maskedDriver(index),
        origin: origins[index],
        destination: seed.office,
        shift: seed.shift_type,
        progress: 7 + index * 8,
        currentSpeed: 34 + index * 2,
        speedLimit: index % 3 === 0 ? 50 : 60,
        etaMinutes: 42 - index * 3,
        status: "on_route",
        overspeedCount: 0,
        lastEventTick: -20,
        forcedSpikeTicks: 0,
        telemetry: [],
      }));
    })();
  }
  await s.initializing;
  return s;
}

function simulatedSpeed(trip: LiveTrip, index: number, tick: number) {
  if (trip.forcedSpikeTicks > 0) {
    trip.forcedSpikeTicks -= 1;
    return trip.speedLimit + 34;
  }
  const wave = Math.sin((tick + index * 3) / 3.2) * 8;
  const jitter = Math.sin((tick * 7 + index * 11) * 0.41) * 4;
  let spike = 0;
  if (index === 0 && tick % 15 >= 5 && tick % 15 <= 11) spike = 35;
  if (index === 2 && tick % 22 >= 13 && tick % 22 <= 16) spike = 23;
  if (index === 5 && tick % 30 === 18) spike = 31;
  return Math.max(12, Math.round(38 + index * 2 + wave + jitter + spike));
}

function addCandidateEvent(s: SimulationState, trip: LiveTrip) {
  s.sequence += 1;
  trip.lastEventTick = s.tick;
  trip.overspeedCount += 1;
  const eventTypes: Array<SafetyDecision["eventType"]> = [
  "OVER_SPEEDING", "EMP GEOFENCE VIOLATION", "WOMAN TRAVELLING ALONE", 
  "DEVICE NOT REACHABLE", "VEHICLE STOPPAGE", "EMP SIGN OFF TIME VIOLATION", 
  "PANIC FIXED DEVICE"
];
  const randomType = eventTypes[Math.floor(Math.random() * eventTypes.length)];
  const event: SafetyDecision = {
    eventId: `sim-${s.startedAt.slice(11, 19).replaceAll(":", "")}-${s.sequence}`,
    tripId: trip.tripId,
    businessUnit: trip.businessUnit,
    vendor: trip.vendor,
    vehicle: trip.vehicle,
    driver: trip.driver,
    origin: trip.origin,
    destination: trip.destination,
    shift: trip.shift,
    eventType: randomType,
    speed: trip.currentSpeed,
    speedLimit: trip.speedLimit,
    excessKph: trip.currentSpeed - trip.speedLimit,
    repeatCount: trip.overspeedCount,
    occurredAt: new Date().toISOString(),
    decisionStatus: "pending",
    severity: null,
    rationale: null,
    reasonCode: null,
    recommendedAction: null,
    humanOwner: null,
    approvalRequired: null,
    confidence: null,
    model: null,
  };
  s.events.unshift(event);
  s.events = s.events.slice(0, 60);
}

function advance(s: SimulationState) {
  if (!s.running) return;
  const now = Date.now();
  const elapsed = Math.max(1, Math.min(4, (now - s.lastAdvancedAt) / 1000));
  s.lastAdvancedAt = now;
  s.tick += 1;

  s.trips.forEach((trip, index) => {
    trip.currentSpeed = simulatedSpeed(trip, index, s.tick);
    trip.progress = Math.min(98, trip.progress + trip.currentSpeed / 360 * elapsed);
    trip.etaMinutes = Math.max(1, Math.round((100 - trip.progress) * 0.58));
    const overBy = trip.currentSpeed - trip.speedLimit;
    trip.status = overBy >= 10 ? "speeding" : overBy >= 4 ? "attention" : "on_route";
    trip.telemetry.push({ at: new Date().toISOString(), speed: trip.currentSpeed, limit: trip.speedLimit });
    trip.telemetry = trip.telemetry.slice(-36);
    if (overBy >= 8 && s.tick - trip.lastEventTick >= 5) addCandidateEvent(s, trip);
    // Random non-speed events: ~1 in 8 ticks per trip, staggered
    if (s.tick % 7 === index % 7 && Math.random() < 0.35 && s.tick - trip.lastEventTick >= 4) {
      addCandidateEvent(s, trip);
    }
  });
}

export async function getSimulationSnapshot() {
  const s = await ensureSimulation();
  advance(s);
  const counts = {
    activeTrips: s.trips.length,
    speedingNow: s.trips.filter((trip) => trip.status === "speeding").length,
    pendingDecisions: s.events.filter((event) => ["pending", "analyzing"].includes(event.decisionStatus)).length,
    criticalEvents: s.events.filter((event) => event.severity === "Sev-1").length,
    totalEvents: s.events.length,
    byType: s.events.reduce<Record<string, number>>((acc, e) => { acc[e.eventType] = (acc[e.eventType] || 0) + 1; return acc; }, {}),
  };
  const vendorRisk = Object.values(s.trips.reduce<Record<string, { vendor: string; activeTrips: number; speedingNow: number; repeatEvents: number; highestSeverity: string; eventBreakdown: Record<string, number> }>>((acc, trip) => {
    const row = acc[trip.vendor] || { vendor: trip.vendor, activeTrips: 0, speedingNow: 0, repeatEvents: 0, highestSeverity: "Clear", eventBreakdown: {} };
    row.activeTrips += 1;
    row.speedingNow += trip.status === "speeding" ? 1 : 0;
    row.repeatEvents += trip.overspeedCount;
    const vendorEvents = s.events.filter((event) => event.vendor === trip.vendor);
    vendorEvents.forEach((e) => { row.eventBreakdown[e.eventType] = (row.eventBreakdown[e.eventType] || 0) + 1; });
    if (vendorEvents.some((event) => event.severity === "Sev-1")) row.highestSeverity = "Sev-1";
    else if (vendorEvents.some((event) => event.severity === "Sev-2")) row.highestSeverity = "Sev-2";
    else if (vendorEvents.some((event) => event.severity === "Sev-3")) row.highestSeverity = "Sev-3";
    acc[trip.vendor] = row;
    return acc;
  }, {})).sort((a, b) => b.repeatEvents - a.repeatEvents);

  // Check if simulation is effectively done (all trips near 98% progress)
  const allDone = s.running && s.trips.every((t) => t.progress >= 95);
  const vendorSummary = allDone ? vendorRisk.map((v) => ({
    vendor: v.vendor,
    totalEvents: Object.values(v.eventBreakdown).reduce((s, n) => s + n, 0),
    sev1Count: s.events.filter((e) => e.vendor === v.vendor && e.severity === "Sev-1").length,
    sev2Count: s.events.filter((e) => e.vendor === v.vendor && e.severity === "Sev-2").length,
    sev3Count: s.events.filter((e) => e.vendor === v.vendor && e.severity === "Sev-3").length,
    eventBreakdown: v.eventBreakdown,
    highestSeverity: v.highestSeverity,
    verdict: v.highestSeverity === "Sev-1" ? "Critical — requires immediate review" : v.highestSeverity === "Sev-2" ? "Warning — needs attention" : "Acceptable",
  })) : null;

  return { running: s.running, startedAt: s.startedAt, tick: s.tick, counts, trips: s.trips, events: s.events, vendorRisk, vendorSummary, allTripsComplete: allDone };
}

export async function controlSimulation(action: "start" | "pause" | "reset" | "inject_spike" | "speed_run") {
  const s = await ensureSimulation();
  if (action === "start") { s.running = true; s.lastAdvancedAt = Date.now(); }
  if (action === "pause") s.running = false;
  if (action === "reset") {
    globalThis.__moveSyncSimulation = undefined;
    return getSimulationSnapshot();
  }
  if (action === "inject_spike") {
    s.tick += 1;
    const target = s.trips[0];
    target.currentSpeed = target.speedLimit + 34;
    target.status = "speeding";
    target.forcedSpikeTicks = 4;
    addCandidateEvent(s, target);
  }
  if (action === "speed_run") {
    s.running = true;
    s.lastAdvancedAt = Date.now();
    // Fast-forward ~150 ticks to complete all trips
    for (let i = 0; i < 150; i++) {
      s.tick += 1;
      s.trips.forEach((trip, index) => {
        trip.currentSpeed = simulatedSpeed(trip, index, s.tick);
        trip.progress = Math.min(98, trip.progress + 0.65);
        trip.etaMinutes = Math.max(1, Math.round((100 - trip.progress) * 0.58));
        const overBy = trip.currentSpeed - trip.speedLimit;
        trip.status = overBy >= 10 ? "speeding" : overBy >= 4 ? "attention" : "on_route";
        trip.telemetry.push({ at: new Date(Date.now() + i * 500).toISOString(), speed: trip.currentSpeed, limit: trip.speedLimit });
        trip.telemetry = trip.telemetry.slice(-36);
        if (overBy >= 8 && s.tick - trip.lastEventTick >= 5) addCandidateEvent(s, trip);
        if (s.tick % 7 === index % 7 && Math.random() < 0.4 && s.tick - trip.lastEventTick >= 4) {
          addCandidateEvent(s, trip);
        }
      });
    }
    // Auto-classify all pending events with policy decision (instant, no API call)
    s.events.forEach((event) => {
      if (event.decisionStatus !== "pending") return;
      const trip = s.trips.find((t) => t.tripId === event.tripId);
      const readingCount = trip?.telemetry.length || 0;
      const policy = policyDecision(event, readingCount);
      event.severity = policy.severity;
      event.rationale = policy.rationale;
      event.reasonCode = policy.reasonCode;
      event.recommendedAction = policy.action;
      event.humanOwner = "TRANSPORT_MANAGER";
      event.approvalRequired = policy.approvalRequired;
      event.confidence = 0.82;
      event.model = "policy-engine (speed-run)";
      event.decisionStatus = "classified";
    });
  }
  return getSimulationSnapshot();
}

export async function getSpeedRunSummary() {
  const snapshot = await getSimulationSnapshot();
  if (!snapshot.vendorSummary) return null;

  const key = process.env.SARVAM_API_KEY;
  if (!key) return { summary: "Sarvam API key not configured. Showing policy-engine classified results only." };

  const summaryPrompt = {
    simulation_results: {
      total_events: snapshot.counts.totalEvents,
      events_by_type: snapshot.counts.byType,
      vendor_performance: snapshot.vendorSummary.map((v) => ({
        vendor: v.vendor,
        total_events: v.totalEvents,
        sev1: v.sev1Count,
        sev2: v.sev2Count,
        sev3: v.sev3Count,
        event_types: v.eventBreakdown,
        verdict: v.verdict,
      })),
    },
  };

  try {
    const response = await fetch("https://api.sarvam.ai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "api-subscription-key": key },
      body: JSON.stringify({
        model: process.env.SARVAM_MODEL || "sarvam-105b",
        messages: [
          { role: "system", content: "You are a mobility operations analyst. Given simulation results, produce a brief executive summary (max 200 words). Highlight: which vendors are critical and why, what event types dominated, which escalations are needed, and your overall risk assessment. Be concise and actionable. Use bullet points." },
          { role: "user", content: JSON.stringify(summaryPrompt) },
        ],
        max_tokens: 500,
      }),
      signal: AbortSignal.timeout(25_000),
    });
    if (!response.ok) throw new Error(`Sarvam returned ${response.status}`);
    const payload = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    return { summary: payload.choices?.[0]?.message?.content || "No summary generated." };
  } catch {
    return { summary: "Could not generate Sarvam summary. Showing policy-engine classified results." };
  }
}

export async function classifySimulationEvent(eventId: string) {
  const s = await ensureSimulation();
  const event = s.events.find((candidate) => candidate.eventId === eventId);
  if (!event) throw new Error("Simulation event not found");
  if (event.decisionStatus === "classified") return event;
  if (event.decisionStatus === "analyzing") return event;
  event.decisionStatus = "analyzing";

  const key = process.env.SARVAM_API_KEY;
  if (!key) {
    event.decisionStatus = "failed";
    throw new Error("SARVAM_API_KEY is not configured");
  }
  const trip = s.trips.find((candidate) => candidate.tripId === event.tripId);
  const priorEvents = s.events.filter((candidate) => candidate.eventId !== event.eventId && candidate.tripId === event.tripId && candidate.eventType === event.eventType);
  const vendorEvents = s.events.filter((candidate) => candidate.eventId !== event.eventId && candidate.vendor === event.vendor && candidate.eventType === event.eventType).length;
  const recentReadings = trip?.telemetry.slice(-6).map((reading) => ({ speed_kph: reading.speed, limit_kph: reading.limit })) || [];
  const prompt = {
    current_event: {
      event_type: event.eventType,
      speed_kph: event.speed,
      speed_limit_kph: event.speedLimit,
      excess_kph: event.excessKph,
      trip_repeat_count: event.repeatCount,
      driver_prior_events: priorEvents.length,
      vendor_prior_events: vendorEvents,
    },
    operational_context: {
      trip_id: event.tripId,
      driver: event.driver,
      vendor: event.vendor,
      vehicle: event.vehicle,
      route: `${event.origin} → ${event.destination}`,
      shift: event.shift,
      trip_is_active: true,
      passenger_status: "unknown — do not assume whether passengers are on board",
      recent_speed_readings: recentReadings,
      telemetry_quality: recentReadings.length >= 3 ? "sufficient readings for simulated trend" : "limited readings; consider anomaly",
    },
    policy_guidance: {
      over_speeding: {
        isolated_breach: "An isolated 8–14 kph excess is Sev-3: start enhanced monitoring.",
        repeated_moderate: "Two or three moderate breaches are Sev-2: call the driver.",
        persistent_driver_pattern: "Four or more driver breaches without extreme speed are Sev-2: request driver escalation.",
        extreme_speed: "A 25+ kph excess is Sev-1: request Transport Manager approval to stop the trip.",
      },
      emp_geofence_violation: "Sev-2: Employee left the designated geofence zone. Start enhanced monitoring and alert transport team.",
      woman_travelling_alone: "Sev-1: Critical safety event. Dispatch security guard and notify emergency contacts immediately.",
      device_not_reachable: "Sev-3: Device lost connectivity. Monitor and attempt reconnection. Escalate if offline > 10 mins.",
      vehicle_stoppage: "Sev-2: Unauthorized vehicle stop detected. Call driver immediately to verify status and safety.",
      emp_sign_off_time_violation: "Sev-3: Employee sign-off time violated. Log event and notify line manager.",
      panic_fixed_device: "Sev-1: Panic button activated from fixed device. Dispatch security immediately. Approval required.",
    },
  };

  try {
    const response = await fetch("https://api.sarvam.ai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "api-subscription-key": key },
      body: JSON.stringify({
        model: process.env.SARVAM_MODEL || "sarvam-105b",
        messages: [
          { role: "system", content: "You are the bounded investigation core for live mobility safety. You handle 7 event types: OVER_SPEEDING, EMP GEOFENCE VIOLATION, WOMAN TRAVELLING ALONE, DEVICE NOT REACHABLE, VEHICLE STOPPAGE, EMP SIGN OFF TIME VIOLATION, PANIC FIXED DEVICE. Apply the supplied policy guidance for the specific event type. Distinguish driver, vehicle and vendor. Consider frequency, context, and data quality. Consequential actions require Transport Manager approval. Return one precise reason and action; never invent facts." },
          { role: "user", content: JSON.stringify(prompt) },
        ],
        tools: [{
          type: "function",
          function: {
            name: "record_safety_decision",
            description: "Record the final safety severity and required operational action for any mobility event type.",
            parameters: {
              type: "object",
              properties: {
                severity: { type: "string", enum: ["Sev-1", "Sev-2", "Sev-3"] },
                rationale: { type: "string", description: "One concise sentence, maximum 35 words." },
                reason_code: { type: "string", description: "Short code for the root cause, e.g. ISOLATED_BREACH, GEOFENCE_BREACH, SOS_ACTIVATED, UNAUTHORIZED_STOP, DEVICE_OFFLINE, SIGN_OFF_VIOLATION, POLICY_VIOLATION, REPEATED_MODERATE_SPEEDING, PERSISTENT_DRIVER_PATTERN, EXTREME_SPEED, POSSIBLE_TELEMETRY_ANOMALY" },
                recommended_action: { type: "string", description: "Action to take, e.g. MONITOR, START_ENHANCED_MONITORING, CALL_DRIVER, REQUEST_DRIVER_ESCALATION, REQUEST_STOP_TRIP_APPROVAL, DISPATCH_GUARD, NOTIFY_LINE_MANAGER" },
                human_owner: { type: "string", enum: ["TRANSPORT_MANAGER"] },
                approval_required: { type: "boolean" },
                confidence: { type: "number", minimum: 0, maximum: 1 },
              },
              required: ["severity", "rationale", "reason_code", "recommended_action", "human_owner", "approval_required", "confidence"],
              additionalProperties: false,
            },
          },
        }],
        tool_choice: { type: "function", function: { name: "record_safety_decision" } },
        reasoning_effort: null,
        max_tokens: 500,
      }),
      signal: AbortSignal.timeout(25_000),
    });
    if (!response.ok) throw new Error(`Sarvam returned ${response.status}: ${await response.text()}`);
    const payload = await response.json() as { choices?: Array<{ message?: { tool_calls?: Array<{ function?: { name?: string; arguments?: string } }> } }> };
    const toolCall = payload.choices?.[0]?.message?.tool_calls?.[0];
    if (toolCall?.function?.name !== "record_safety_decision" || !toolCall.function.arguments) {
      throw new Error("Sarvam returned no structured safety decision");
    }
    const decision = safetyDecisionSchema.parse(JSON.parse(toolCall.function.arguments));
    const policy = policyDecision(event, recentReadings.length);
    const isPolicyConsistent = decision.severity === policy.severity
      && decision.reason_code === policy.reasonCode
      && decision.recommended_action === policy.action
      && decision.approval_required === policy.approvalRequired;
    event.severity = policy.severity;
    event.rationale = isPolicyConsistent ? decision.rationale : policy.rationale;
    event.reasonCode = policy.reasonCode;
    event.recommendedAction = policy.action;
    event.humanOwner = decision.human_owner;
    event.approvalRequired = policy.approvalRequired;
    event.confidence = isPolicyConsistent ? Math.min(decision.confidence, 0.9) : Math.min(decision.confidence, 0.85);
    event.model = process.env.SARVAM_MODEL || "sarvam-105b";
    event.decisionStatus = "classified";
    return event;
  } catch (error) {
    event.decisionStatus = "failed";
    event.rationale = error instanceof Error ? error.message : "Sarvam decision failed";
    throw error;
  }
}

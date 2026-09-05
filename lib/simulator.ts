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
  eventType: "OVER_SPEEDING";
  speed: number;
  speedLimit: number;
  excessKph: number;
  repeatCount: number;
  occurredAt: string;
  decisionStatus: "pending" | "analyzing" | "classified" | "failed";
  severity: "Sev-1" | "Sev-2" | "Sev-3" | null;
  rationale: string | null;
  reasonCode: "ISOLATED_BREACH" | "REPEATED_MODERATE_SPEEDING" | "PERSISTENT_DRIVER_PATTERN" | "EXTREME_SPEED" | "POSSIBLE_TELEMETRY_ANOMALY" | null;
  recommendedAction: "MONITOR" | "START_ENHANCED_MONITORING" | "CALL_DRIVER" | "REQUEST_DRIVER_ESCALATION" | "REQUEST_STOP_TRIP_APPROVAL" | null;
  humanOwner: "TRANSPORT_MANAGER" | null;
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
  reason_code: z.enum(["ISOLATED_BREACH", "REPEATED_MODERATE_SPEEDING", "PERSISTENT_DRIVER_PATTERN", "EXTREME_SPEED", "POSSIBLE_TELEMETRY_ANOMALY"]),
  recommended_action: z.enum(["MONITOR", "START_ENHANCED_MONITORING", "CALL_DRIVER", "REQUEST_DRIVER_ESCALATION", "REQUEST_STOP_TRIP_APPROVAL"]),
  human_owner: z.literal("TRANSPORT_MANAGER"),
  approval_required: z.boolean(),
  confidence: z.number().min(0).max(1),
});

function policyDecision(event: SafetyDecision, readingCount: number) {
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
    eventType: "OVER_SPEEDING",
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
  };
  const vendorRisk = Object.values(s.trips.reduce<Record<string, { vendor: string; activeTrips: number; speedingNow: number; repeatEvents: number; highestSeverity: string }>>((acc, trip) => {
    const row = acc[trip.vendor] || { vendor: trip.vendor, activeTrips: 0, speedingNow: 0, repeatEvents: 0, highestSeverity: "Clear" };
    row.activeTrips += 1;
    row.speedingNow += trip.status === "speeding" ? 1 : 0;
    row.repeatEvents += trip.overspeedCount;
    const vendorEvents = s.events.filter((event) => event.vendor === trip.vendor);
    if (vendorEvents.some((event) => event.severity === "Sev-1")) row.highestSeverity = "Sev-1";
    else if (vendorEvents.some((event) => event.severity === "Sev-2")) row.highestSeverity = "Sev-2";
    else if (vendorEvents.some((event) => event.severity === "Sev-3")) row.highestSeverity = "Sev-3";
    acc[trip.vendor] = row;
    return acc;
  }, {})).sort((a, b) => b.repeatEvents - a.repeatEvents);
  return { running: s.running, startedAt: s.startedAt, tick: s.tick, counts, trips: s.trips, events: s.events, vendorRisk };
}

export async function controlSimulation(action: "start" | "pause" | "reset" | "inject_spike") {
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
  return getSimulationSnapshot();
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
  const priorEvents = s.events.filter((candidate) => candidate.eventId !== event.eventId && candidate.tripId === event.tripId && candidate.eventType === "OVER_SPEEDING");
  const vendorEvents = s.events.filter((candidate) => candidate.eventId !== event.eventId && candidate.vendor === event.vendor && candidate.eventType === "OVER_SPEEDING").length;
  const recentReadings = trip?.telemetry.slice(-6).map((reading) => ({ speed_kph: reading.speed, limit_kph: reading.limit })) || [];
  const prompt = {
    current_event: {
      speed_kph: event.speed,
      speed_limit_kph: event.speedLimit,
      excess_kph: event.excessKph,
      trip_repeat_count: event.repeatCount,
      driver_prior_overspeed_events: priorEvents.length,
      vendor_prior_overspeed_events: vendorEvents,
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
      isolated_breach: "An isolated 8–14 kph excess is Sev-3: start enhanced monitoring. No approval required.",
      repeated_moderate: "Two or three moderate breaches are Sev-2: call the driver. No trip-stop authority is implied.",
      persistent_driver_pattern: "Four or more driver breaches without extreme speed are Sev-2: request driver escalation from the Transport Manager. Approval required.",
      extreme_speed: "A 25+ kph excess supported by sufficient readings is Sev-1: request Transport Manager approval to stop the trip. Do not claim the stop was executed.",
      possible_anomaly: "Insufficient or inconsistent readings are Sev-3: monitor and investigate telemetry before attributing behavior.",
      attribution: "Classify the driver pattern first. Do not escalate the entire vendor from one driver's events, and never use OTA SLA for speed risk.",
    },
  };

  try {
    const response = await fetch("https://api.sarvam.ai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "api-subscription-key": key },
      body: JSON.stringify({
        model: process.env.SARVAM_MODEL || "sarvam-105b",
        messages: [
          { role: "system", content: "You are the bounded investigation core for live mobility safety. Apply the supplied decision ladder exactly. Distinguish driver, vehicle and vendor; do not make vendor-wide attribution from one driver. Consider frequency, excess speed, recent readings, route/shift and data quality. Do not make every repeat event Sev-1. Consequential actions require Transport Manager approval. Never mention OTA or its SLA in a speed decision. Return one precise reason and action; never invent facts." },
          { role: "user", content: JSON.stringify(prompt) },
        ],
        tools: [{
          type: "function",
          function: {
            name: "record_speed_safety_decision",
            description: "Record the final safety severity and required operational action.",
            parameters: {
              type: "object",
              properties: {
                severity: { type: "string", enum: ["Sev-1", "Sev-2", "Sev-3"] },
                rationale: { type: "string", description: "One concise sentence, maximum 35 words." },
                reason_code: { type: "string", enum: ["ISOLATED_BREACH", "REPEATED_MODERATE_SPEEDING", "PERSISTENT_DRIVER_PATTERN", "EXTREME_SPEED", "POSSIBLE_TELEMETRY_ANOMALY"] },
                recommended_action: { type: "string", enum: ["MONITOR", "START_ENHANCED_MONITORING", "CALL_DRIVER", "REQUEST_DRIVER_ESCALATION", "REQUEST_STOP_TRIP_APPROVAL"] },
                human_owner: { type: "string", enum: ["TRANSPORT_MANAGER"] },
                approval_required: { type: "boolean" },
                confidence: { type: "number", minimum: 0, maximum: 1 },
              },
              required: ["severity", "rationale", "reason_code", "recommended_action", "human_owner", "approval_required", "confidence"],
              additionalProperties: false,
            },
          },
        }],
        tool_choice: { type: "function", function: { name: "record_speed_safety_decision" } },
        reasoning_effort: null,
        max_tokens: 500,
      }),
      signal: AbortSignal.timeout(25_000),
    });
    if (!response.ok) throw new Error(`Sarvam returned ${response.status}: ${await response.text()}`);
    const payload = await response.json() as { choices?: Array<{ message?: { tool_calls?: Array<{ function?: { name?: string; arguments?: string } }> } }> };
    const toolCall = payload.choices?.[0]?.message?.tool_calls?.[0];
    if (toolCall?.function?.name !== "record_speed_safety_decision" || !toolCall.function.arguments) {
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
    event.confidence = isPolicyConsistent ? decision.confidence : Math.min(decision.confidence, 0.85);
    event.model = process.env.SARVAM_MODEL || "sarvam-105b";
    event.decisionStatus = "classified";
    return event;
  } catch (error) {
    event.decisionStatus = "failed";
    event.rationale = error instanceof Error ? error.message : "Sarvam decision failed";
    throw error;
  }
}

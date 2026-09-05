"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertOctagon, Bot, CarFront, CirclePause, CirclePlay, Maximize2,
  Radio, RefreshCw, ShieldAlert, Sparkles, X, Zap,
} from "lucide-react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

type LiveTrip = {
  businessUnit: string; tripId: string; vendor: string; vehicle: string; driver: string;
  origin: string; destination: string; shift: string; progress: number; currentSpeed: number;
  speedLimit: number; etaMinutes: number; status: "on_route" | "speeding" | "attention";
  overspeedCount: number; telemetry: Array<{ at: string; speed: number; limit: number }>;
};
type LiveEvent = {
  eventId: string; tripId: string; businessUnit: string; vendor: string; vehicle: string;
  driver?: string; origin?: string; destination?: string; shift?: string;
  eventType: string;
  speed: number; speedLimit: number; excessKph: number; repeatCount: number; occurredAt: string;
  decisionStatus: "pending" | "analyzing" | "classified" | "failed";
  severity: "Sev-1" | "Sev-2" | "Sev-3" | null; rationale: string | null;
  reasonCode?: string | null; recommendedAction: string | null; humanOwner?: string | null;
  approvalRequired?: boolean | null; confidence: number | null; model: string | null;
};
type Simulation = {
  running: boolean; startedAt: string; tick: number;
  counts: { activeTrips: number; speedingNow: number; pendingDecisions: number; criticalEvents: number; totalEvents: number; byType?: Record<string, number> };
  trips: LiveTrip[]; events: LiveEvent[];
  vendorRisk: Array<{ vendor: string; activeTrips: number; speedingNow: number; repeatEvents: number; highestSeverity: string; eventBreakdown?: Record<string, number> }>;
  vendorSummary?: Array<{ vendor: string; totalEvents: number; sev1Count: number; sev2Count: number; sev3Count: number; eventBreakdown: Record<string, number>; highestSeverity: string; verdict: string }> | null;
  allTripsComplete?: boolean;
};

const tooltipStyle = { border: "1px solid var(--border)", borderRadius: 9, background: "var(--surface-raised)", color: "var(--text)", fontSize: 11 };

function severityClass(severity: LiveEvent["severity"], pending = false) {
  if (pending) return "pending";
  return severity === "Sev-1" ? "critical" : severity === "Sev-2" ? "high" : "low";
}

function FleetMap({ trips, selectedId, onSelect }: { trips: LiveTrip[]; selectedId?: string; onSelect: (id: string) => void }) {
  return <div className="fleet-map">
    <div className="map-grid" />
    <svg viewBox="0 0 800 330" preserveAspectRatio="none" aria-hidden="true">
      <path d="M35,62 C180,20 245,125 390,83 S630,20 765,70" />
      <path d="M32,155 C175,205 260,92 406,160 S650,220 770,155" />
      <path d="M30,266 C165,215 280,310 420,250 S635,214 772,275" />
    </svg>
    <span className="map-place place-a">Whitefield</span><span className="map-place place-b">Indiranagar</span><span className="map-place place-c">Electronic City</span><span className="map-place place-d">Office cluster</span>
    {trips.map((trip, index) => {
      const lane = index % 3;
      const x = 5 + trip.progress * .88;
      const waves = [Math.sin(trip.progress / 12) * 8, Math.sin(trip.progress / 9) * 11, Math.sin(trip.progress / 10) * 7];
      const y = [18, 48, 78][lane] + waves[lane];
      return <button key={`${trip.businessUnit}-${trip.tripId}`} className={`map-vehicle ${trip.status} ${selectedId === trip.tripId ? "selected" : ""}`} style={{ left: `${x}%`, top: `${y}%` }} onClick={() => onSelect(trip.tripId)} title={`Trip #${trip.tripId} · ${trip.currentSpeed} km/h`}><CarFront size={13} /><span>{trip.currentSpeed}</span></button>;
    })}
    <div className="map-legend"><span><i className="moving" /> On route</span><span><i className="attention" /> Near limit</span><span><i className="speeding" /> Speeding</span></div>
  </div>;
}

export function ActiveMonitoring() {
  const [data, setData] = useState<Simulation | null>(null);
  const [selectedId, setSelectedId] = useState<string>();
  const [expandedEventId, setExpandedEventId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const classifying = useRef<Set<string>>(new Set());

  const classifyPending = useCallback(async (snapshot: Simulation) => {
    const pending = snapshot.events.find((event) => event.decisionStatus === "pending" && !classifying.current.has(event.eventId));
    if (!pending) return;
    classifying.current.add(pending.eventId);
    try {
      const response = await fetch("/api/monitoring/classify", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ eventId: pending.eventId }) });
      const decision = await response.json();
      if (!response.ok) throw new Error(decision.error || "Sarvam decision failed");
      setData((current) => current ? { ...current, events: current.events.map((event) => event.eventId === decision.eventId ? decision : event) } : current);
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Sarvam decision failed");
    } finally {
      classifying.current.delete(pending.eventId);
    }
  }, []);

  const poll = useCallback(async () => {
    try {
      const response = await fetch("/api/monitoring", { cache: "no-store" });
      const snapshot = await response.json() as Simulation & { error?: string };
      if (!response.ok) throw new Error(snapshot.error || "Simulation unavailable");
      setData(snapshot);
      setSelectedId((current) => current || snapshot.trips[0]?.tripId);
      void classifyPending(snapshot);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Simulation unavailable");
    }
  }, [classifyPending]);

  useEffect(() => {
    const immediate = window.setTimeout(() => void poll(), 0);
    const timer = window.setInterval(() => void poll(), 1_600);
    return () => { window.clearTimeout(immediate); window.clearInterval(timer); };
  }, [poll]);

  async function control(action: "start" | "pause" | "reset" | "inject_spike") {
    const response = await fetch("/api/monitoring", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }) });
    const snapshot = await response.json();
    if (response.ok) { setData(snapshot); setError(""); void classifyPending(snapshot); }
    else setError(snapshot.error || "Simulation control failed");
  }

  const importantEvents = useMemo(() => {
    const seenTrips = new Set<string>();
    return (data?.events || []).filter((event) => {
      if (event.decisionStatus !== "classified" || (event.severity !== "Sev-1" && event.severity !== "Sev-2") || seenTrips.has(event.tripId)) return false;
      seenTrips.add(event.tripId);
      return true;
    }).slice(0, 6);
  }, [data]);
  const groupedCount = useMemo(() => Math.max(0, (data?.events.filter((event) => event.decisionStatus === "classified").length || 0) - importantEvents.length), [data, importantEvents]);
  const expandedEvent = data?.events.find((event) => event.eventId === expandedEventId);
  const selected = useMemo(() => data?.trips.find((trip) => trip.tripId === (expandedEvent?.tripId || selectedId)) || data?.trips[0], [data, expandedEvent, selectedId]);
  const selectedVendorRisk = data?.vendorRisk.find((vendor) => vendor.vendor === expandedEvent?.vendor);

  if (!data) return <div className="monitor-loading"><Radio size={24} /><strong>Starting live mobility simulation…</strong><span>Loading active trips and telemetry</span></div>;

  return <div className="monitoring-workspace">
    <div className="monitor-heading compact-monitor-heading">
      <div><div className="eyebrow"><span>Active monitoring</span><i /> Simulated real-time telemetry</div><h1>AI-curated vendor alerts</h1><p>Sarvam surfaces only incidents that need attention. Low-priority telemetry stays out of the way.</p></div>
      <div className="simulation-controls"><span className={`simulation-state ${data.running ? "live" : "paused"}`}><i />{data.running ? "Simulation live" : "Paused"}</span><button onClick={() => control(data.running ? "pause" : "start")}>{data.running ? <CirclePause size={15} /> : <CirclePlay size={15} />}{data.running ? "Pause" : "Resume"}</button><button onClick={() => control("inject_spike")} className="inject"><Zap size={15} /> Inject speed spike</button><button onClick={() => control("reset")} title="Reset simulation"><RefreshCw size={15} /></button></div>
    </div>

    {error && <div className="monitor-error"><AlertOctagon size={16} /><span><strong>Sarvam decision error</strong>{error}</span></div>}

    <div className="monitor-status-strip" aria-label="Live monitoring status">
      <span><i className="status-live-dot" />{data.counts.activeTrips} trips monitored</span>
      {data.counts.pendingDecisions > 0 && <span><Sparkles size={12} />Sarvam reviewing {data.counts.pendingDecisions}</span>}
      <span className="suppressed-status">{groupedCount} repeat or low-priority {groupedCount === 1 ? "event" : "events"} grouped</span>
      <span className="real-ai-badge"><Bot size={12} /> Real Sarvam API</span>
    </div>

    <section className="panel priority-alert-inbox">
      <header><div><h3>Alerts requiring attention</h3><p>Only Sarvam-classified Sev-1 and Sev-2 events are shown</p></div><span className="streaming-label"><Radio size={12} /> Live</span></header>
      <div className="priority-alert-list">{importantEvents.length ? importantEvents.map((event) => <article className={`priority-alert-card ${severityClass(event.severity)}`} key={event.eventId}>
        <div className="priority-alert-severity"><b className={`severity-badge ${severityClass(event.severity)}`}>{event.severity}</b><span>{new Date(event.occurredAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span></div>
        <div className="priority-alert-vendor"><span>{event.eventType.replaceAll("_", " ")}</span><strong>{event.driver || "Masked driver"}</strong><small>{event.vendor} · Trip #{event.tripId}</small></div>
        <div className="priority-alert-signal"><span>Signal</span><strong>{event.eventType === "OVER_SPEEDING" ? `${event.speed} km/h in a ${event.speedLimit} zone` : event.eventType}</strong><small>{event.eventType === "OVER_SPEEDING" ? `+${event.excessKph} km/h · ` : ""}occurrence #{event.repeatCount}</small></div>
        <div className="priority-alert-decision"><span>Sarvam decision</span><strong>{event.recommendedAction?.replaceAll("_", " ")}</strong><small>{event.rationale}{event.approvalRequired ? " · Human approval required" : ""}</small></div>
        <button className="maximize-alert" onClick={() => { setExpandedEventId(event.eventId); setSelectedId(event.tripId); }}><Maximize2 size={14} /> Maximize</button>
      </article>) : <div className="no-live-alerts"><ShieldAlert size={25} /><strong>No important alerts right now</strong><span>Sarvam is monitoring {data.counts.activeTrips} live trips and suppressing low-priority noise.</span><button onClick={() => control("inject_spike")}><Zap size={13} /> Simulate a speed breach</button></div>}</div>
    </section>

    {expandedEvent && selected && <div className="monitor-detail-backdrop" onClick={() => setExpandedEventId(null)} role="presentation"><section className="monitor-detail" onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-label={`Alert details for trip ${expandedEvent.tripId}`}>
      <header className="monitor-detail-header"><div><span className={`severity-badge ${severityClass(expandedEvent.severity)}`}>{expandedEvent.severity}</span><h2>{expandedEvent.driver || "Masked driver"}</h2><p>{expandedEvent.vendor} · Trip #{expandedEvent.tripId} · {expandedEvent.vehicle}</p></div><button onClick={() => setExpandedEventId(null)} aria-label="Close alert details"><X size={18} /></button></header>
      <div className="monitor-detail-summary"><div><span>Recommended action</span><strong>{expandedEvent.recommendedAction?.replaceAll("_", " ")}</strong></div><p>{expandedEvent.rationale}{expandedEvent.approvalRequired ? " Transport Manager approval is required before execution." : ""}</p><div className="decision-evidence"><div><span>Reason</span><strong>{expandedEvent.reasonCode?.replaceAll("_", " ") || "Speed pattern"}</strong></div><div><span>Repeat count</span><strong>{expandedEvent.repeatCount}</strong></div><div><span>Confidence</span><strong>{Math.round(Number(expandedEvent.confidence) * 100)}%</strong></div></div></div>
      <div className="monitor-detail-grid"><section className="panel"><header><div><h3>Live fleet map</h3><p>{selected.origin} → {selected.destination}</p></div><span className={`trip-live-status ${selected.status}`}>{selected.status.replace("_", " ")}</span></header><FleetMap trips={data.trips} selectedId={selected.tripId} onSelect={setSelectedId} /></section>
      <section className="panel"><header><div><h3>Trip telemetry</h3><p>Current speed against route limit</p></div></header><div className="live-trip-meta"><div><span>Current speed</span><strong className={selected.status === "speeding" ? "text-risk" : ""}>{selected.currentSpeed}<small> km/h</small></strong></div><div><span>Speed limit</span><strong>{selected.speedLimit}<small> km/h</small></strong></div><div><span>ETA</span><strong>{selected.etaMinutes}<small> min</small></strong></div></div><div className="telemetry-chart"><ResponsiveContainer width="100%" height={170}><LineChart data={selected.telemetry} margin={{ top: 8, right: 10, left: -22, bottom: 0 }}><CartesianGrid stroke="var(--chart-grid)" strokeDasharray="3 5" vertical={false} /><XAxis dataKey="at" tickFormatter={(v) => new Date(v).toLocaleTimeString([], { minute: "2-digit", second: "2-digit" })} tick={{ fill: "var(--text-muted)", fontSize: 9 }} axisLine={false} tickLine={false} minTickGap={25} /><YAxis domain={[0, 100]} tick={{ fill: "var(--text-muted)", fontSize: 9 }} axisLine={false} tickLine={false} /><Tooltip contentStyle={tooltipStyle} labelFormatter={(v) => new Date(String(v)).toLocaleTimeString()} /><Line type="monotone" dataKey="speed" name="Vehicle speed" stroke="#f15b50" strokeWidth={2.4} dot={false} /><Line type="stepAfter" dataKey="limit" name="Speed limit" stroke="#8c9bab" strokeDasharray="5 4" dot={false} /></LineChart></ResponsiveContainer></div><div className="live-trip-footer"><span><CarFront size={13} /> {selected.driver}</span><span>{Math.round(selected.progress)}% complete</span></div></section></div>
      <div className="monitor-vendor-context"><span>Vendor context</span><strong>{selectedVendorRisk?.activeTrips || 0} active trips</strong><strong>{selectedVendorRisk?.repeatEvents || 0} repeat events</strong><strong>Highest: {selectedVendorRisk?.highestSeverity || "None"}</strong><small><Bot size={11} /> {expandedEvent.model} · structured decision output</small></div>
    </section></div>}

    {data.vendorSummary && <section className="panel vendor-summary-panel">
      <header><div><h3>Simulation Complete — Vendor Performance Summary</h3><p>All trips have reached their destination. Here is the vendor-based performance breakdown.</p></div></header>
      <div className="vendor-summary-grid">
        {data.vendorSummary.map((v: { vendor: string; totalEvents: number; sev1Count: number; sev2Count: number; sev3Count: number; eventBreakdown: Record<string, number>; highestSeverity: string; verdict: string }) => (
          <div key={v.vendor} className={`vendor-summary-card ${v.highestSeverity === "Sev-1" ? "critical" : v.highestSeverity === "Sev-2" ? "high" : "low"}`}>
            <div className="vendor-summary-header"><strong>{v.vendor}</strong><span className={`severity-badge ${v.highestSeverity === "Sev-1" ? "critical" : v.highestSeverity === "Sev-2" ? "high" : "low"}`}>{v.verdict}</span></div>
            <div className="vendor-summary-stats">
              <div><span>Total events</span><strong>{v.totalEvents}</strong></div>
              <div><span>Sev-1</span><strong className="text-risk">{v.sev1Count}</strong></div>
              <div><span>Sev-2</span><strong className="text-warn">{v.sev2Count}</strong></div>
              <div><span>Sev-3</span><strong>{v.sev3Count}</strong></div>
            </div>
            <div className="vendor-summary-breakdown">{Object.entries(v.eventBreakdown).map(([type, count]) => (
              <span key={type}>{type.replaceAll("_", " ")}: {count as number}</span>
            ))}</div>
          </div>
        ))}
      </div>
    </section>}
  </div>;
}

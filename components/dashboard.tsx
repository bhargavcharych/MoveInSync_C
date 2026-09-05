"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlertOctagon, BarChart3, Bell, Building2, CalendarDays, CarFront, Check,
  ChevronDown, CircleDollarSign, Clock3, Download, Gauge, Headphones, LayoutDashboard,
  Leaf, Menu, Moon, Radio, Search, ShieldAlert, Sparkles, Star, Sun, UsersRound, X,
} from "lucide-react";
import { ActiveMonitoring } from "@/components/active-monitoring";
import { AgentPanel } from "@/components/agent-panel";
import { AlertChart, MonthlyStory, OperationsTrend, ShiftChart, Sparkline } from "@/components/charts";
import { TripDrawer } from "@/components/trip-drawer";
import type { DashboardFilters, Persona } from "@/lib/types";

type Row = Record<string, number | string | boolean | null>;
type DashboardData = {
  overview: Record<string, number>;
  daily: Row[];
  monthly: Row[];
  vendors: Row[];
  trips: Row[];
  alerts: Row[];
  shifts: Row[];
  options: { businessUnits: string[]; offices: string[]; vendors: string[]; months: string[] };
  generatedAt: string;
};

const personas: Array<{ id: Persona; label: string; short: string; icon: typeof CarFront }> = [
  { id: "transport_manager", label: "Transport manager", short: "TM", icon: CarFront },
  { id: "facilities_head", label: "Transport & facilities head", short: "FH", icon: Building2 },
  { id: "line_manager", label: "Team / line manager", short: "LM", icon: UsersRound },
];

const navigation = [
  { id: "overview", label: "Overview", icon: LayoutDashboard },
  { id: "trips", label: "Trip board", icon: CarFront },
  { id: "vendors", label: "Vendors", icon: BarChart3 },
  { id: "safety", label: "Safety & alerts", icon: ShieldAlert },
  { id: "experience", label: "Experience", icon: Star },
];

const formatters = {
  number: (v: number) => Number(v || 0).toLocaleString("en-IN"),
  percent: (v: number) => `${Number(v || 0).toFixed(1)}%`,
  currency: (v: number) => `₹${Intl.NumberFormat("en-IN", { notation: "compact", maximumFractionDigits: 1 }).format(v || 0)}`,
  decimal: (v: number) => Number(v || 0).toFixed(2),
};

function HeaderSelect({ icon: Icon, value, onChange, options, placeholder, label }: { icon: typeof Building2; value: string; onChange: (v: string) => void; options: string[]; placeholder: string; label: string }) {
  return <label className="header-select"><Icon size={14} /><span><small>{label}</small><select value={value} onChange={(e) => onChange(e.target.value)}><option value="">{placeholder}</option>{options.map((option) => <option value={option} key={option}>{option}</option>)}</select></span><ChevronDown size={13} /></label>;
}

function MetricCard({ label, value, formatter, delta, target, icon: Icon, tone, sparkData, sparkKey }: { label: string; value: number; formatter: keyof typeof formatters; delta?: number | null; target?: number; icon: typeof Gauge; tone?: "good" | "risk" | "neutral"; sparkData: Row[]; sparkKey: string }) {
  const positive = Number(delta || 0) >= 0;
  return <article className="metric-card">
    <div className="metric-top"><span className={`metric-icon ${tone || "neutral"}`}><Icon size={17} /></span><span className="metric-label">{label}</span>{target !== undefined && <span className="metric-target">Target {target}%</span>}</div>
    <div className="metric-value">{formatters[formatter](value)}</div>
    <div className="metric-foot"><span className={positive ? "delta-up" : "delta-down"}>{delta === null || delta === undefined ? "Baseline" : `${positive ? "+" : ""}${delta.toFixed(1)} vs Jun`}</span><span>May–Jul 2026</span></div>
    <div className="metric-spark"><Sparkline data={sparkData} dataKey={sparkKey} tone={tone === "risk" ? "red" : tone === "neutral" ? "blue" : "green"} /></div>
  </article>;
}

function Panel({ title, subtitle, action, children, className = "" }: { title: string; subtitle?: string; action?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return <section className={`panel ${className}`}><header><div><h3>{title}</h3>{subtitle && <p>{subtitle}</p>}</div>{action}</header>{children}</section>;
}

function VendorTable({ rows, selected, onSelect }: { rows: Row[]; selected: string; onSelect: (vendor: string) => void }) {
  return <div className="data-table vendor-table"><table><thead><tr><th>Vendor</th><th>Score</th><th>Trips</th><th>OTA / SLA</th><th>CSAT</th><th>Alerts</th><th>EV mix</th><th></th></tr></thead><tbody>{rows.map((row, index) => {
    const ota = Number(row.ota); const pass = ota >= 90;
    return <tr key={String(row.vendor)} className={selected === row.vendor ? "selected" : ""} onClick={() => onSelect(selected === row.vendor ? "" : String(row.vendor))}>
      <td><span className="vendor-rank">{index + 1}</span><strong>{row.vendor}</strong></td><td><span className={`score ${Number(row.score) >= 0 ? "positive" : "negative"}`}>{Number(row.score).toFixed(1)}</span></td><td>{Number(row.trips).toLocaleString("en-IN")}</td><td><span className={pass ? "text-good" : "text-risk"}>{row.ota}%</span><small className="sla-marker">/ 90%</small></td><td>{row.csat ? <><Star size={13} fill="#f5a524" color="#f5a524" /> {row.csat}</> : "—"}</td><td>{row.alerts}<small>{Number(row.sev1) > 0 ? ` · ${row.sev1} Sev-1` : ""}</small></td><td>{row.electric_share}%</td><td><ChevronDown size={15} /></td>
    </tr>;
  })}</tbody></table></div>;
}

function TripTable({ rows, onSelect, search }: { rows: Row[]; onSelect: (trip: { business_unit: string; trip_id: string }) => void; search: string }) {
  const filtered = rows.filter((row) => !search || String(row.trip_id).includes(search) || String(row.vendor).toLowerCase().includes(search.toLowerCase()) || String(row.office).toLowerCase().includes(search.toLowerCase()));
  return <div className="data-table trip-table"><table><thead><tr><th>Trip</th><th>Status</th><th>Vendor / site</th><th>Shift</th><th>Arrival</th><th>Signals</th><th>CSAT</th></tr></thead><tbody>{filtered.map((row) => <tr key={`${row.business_unit}-${row.trip_id}`} onClick={() => onSelect({ business_unit: String(row.business_unit), trip_id: String(row.trip_id) })}>
    <td><strong>#{row.trip_id}</strong><small>{row.trip_date} · {row.trip_direction}</small></td>
    <td><span className={`status ${row.is_ota ? "success" : "danger"}`}>{row.is_ota ? "On time" : "SLA missed"}</span></td>
    <td><strong>{row.vendor}</strong><small>{row.office}</small></td>
    <td>{row.shift_type}<small>{row.product_type}</small></td>
    <td><span className={Number(row.delay_minutes) > 15 ? "text-risk" : Number(row.delay_minutes) > 5 ? "text-warn" : "text-good"}>{Number(row.delay_minutes) > 0 ? "+" : ""}{row.delay_minutes} min</span></td>
    <td><div className="signal-stack">{Number(row.sev1_count) > 0 && <span className="signal danger"><AlertOctagon size={12} />{row.sev1_count} critical</span>}{Number(row.open_alert_count) > 0 && <span className="signal warning"><Bell size={12} />{row.open_alert_count} open</span>}{Number(row.noshow_cnt) > 0 && <span className="signal neutral"><UsersRound size={12} />{row.noshow_cnt} no-show</span>}{Number(row.alert_count) === 0 && Number(row.noshow_cnt) === 0 && <span className="quiet"><Check size={13} /> Clear</span>}</div></td>
    <td>{row.csat ? <><Star size={13} fill="#f5a524" color="#f5a524" /> {row.csat}</> : <span className="muted">—</span>}</td>
  </tr>)}</tbody></table>{!filtered.length && <div className="empty-state">No trips match that search.</div>}</div>;
}

function Skeleton() {
  return <div className="dashboard-skeleton"><div /><div /><div /><div /><section /><section /></div>;
}

export function Dashboard() {
  const [workspace, setWorkspace] = useState<"command" | "monitoring">("command");
  const [persona, setPersona] = useState<Persona>("transport_manager");
  const [active, setActive] = useState("overview");
  const [filters, setFilters] = useState<Omit<DashboardFilters, "persona">>({});
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [theme, setTheme] = useState("light");
  const [agentCollapsed, setAgentCollapsed] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [tripSearch, setTripSearch] = useState("");
  const [tripSelection, setTripSelection] = useState<{ business_unit: string; trip_id: string } | null>(null);

  useEffect(() => {
    const saved = localStorage.getItem("movesync-theme");
    const next = saved || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    queueMicrotask(() => {
      setTheme(next);
      if (matchMedia("(max-width: 1120px)").matches) setAgentCollapsed(true);
    });
    document.documentElement.dataset.theme = next;
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({ persona });
    Object.entries(filters).forEach(([key, value]) => { if (value) params.set(key, value); });
    fetch(`/api/dashboard?${params}`, { signal: controller.signal })
      .then(async (response) => { if (!response.ok) throw new Error("Could not load the dashboard"); return response.json(); })
      .then((payload) => setData(payload))
      .catch((err) => { if (err.name !== "AbortError") setError(err.message); })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [persona, filters]);

  function toggleTheme() {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next); document.documentElement.dataset.theme = next; localStorage.setItem("movesync-theme", next);
  }

  function updateFilter(key: keyof Omit<DashboardFilters, "persona">, value: string) {
    setLoading(true); setError("");
    setFilters((old) => ({ ...old, [key]: value || undefined, ...(key === "businessUnit" ? { office: undefined, vendor: undefined } : {}) }));
  }

  const monthlyDelta = useMemo(() => {
    if (!data?.monthly?.length) return { ota: null, spend: null, csat: null };
    const rows = data.monthly; const last = rows[rows.length - 1]; const prior = rows[rows.length - 2] || last;
    return { ota: Number(last.ota) - Number(prior.ota), spend: Number(last.spend) / Math.max(Number(prior.spend), 1) * 100 - 100, csat: Number(last.csat) - Number(prior.csat) };
  }, [data]);
  const currentPersona = personas.find((p) => p.id === persona)!;
  const metricCards = data ? persona === "facilities_head" ? [
    { label: "Total spend", value: data.overview.spend, formatter: "currency" as const, delta: monthlyDelta.spend, icon: CircleDollarSign, tone: "neutral" as const, sparkKey: "spend" },
    { label: "Arrival SLA", value: data.overview.ota, formatter: "percent" as const, delta: monthlyDelta.ota, target: 90, icon: Gauge, tone: data.overview.ota >= 90 ? "good" as const : "risk" as const, sparkKey: "ota" },
    { label: "Cost per trip", value: data.overview.cost_per_trip, formatter: "currency" as const, icon: BarChart3, tone: "neutral" as const, sparkKey: "cost_per_trip" },
    { label: "Electric fleet", value: data.overview.electric_share, formatter: "percent" as const, icon: Leaf, tone: "good" as const, sparkKey: "electric_share" },
  ] : persona === "line_manager" ? [
    { label: "Pickup punctuality", value: data.overview.otp, formatter: "percent" as const, icon: Clock3, tone: data.overview.otp >= 90 ? "good" as const : "risk" as const, sparkKey: "otp" },
    { label: "Employees boarded", value: data.overview.boarded, formatter: "number" as const, icon: UsersRound, tone: "good" as const, sparkKey: "trips" },
    { label: "No-show rate", value: data.overview.no_show_rate, formatter: "percent" as const, icon: AlertOctagon, tone: data.overview.no_show_rate < 5 ? "good" as const : "risk" as const, sparkKey: "no_shows" },
    { label: "Late pickups", value: data.overview.late_pickups, formatter: "number" as const, icon: Clock3, tone: "risk" as const, sparkKey: "alerts" },
  ] : [
    { label: "Arrival OTA", value: data.overview.ota, formatter: "percent" as const, delta: monthlyDelta.ota, target: 90, icon: Gauge, tone: data.overview.ota >= 90 ? "good" as const : "risk" as const, sparkKey: "ota" },
    { label: "Trips operated", value: data.overview.trips, formatter: "number" as const, icon: CarFront, tone: "neutral" as const, sparkKey: "trips" },
    { label: "Open alerts", value: data.overview.open_alerts, formatter: "number" as const, icon: ShieldAlert, tone: data.overview.open_alerts ? "risk" as const : "good" as const, sparkKey: "alerts" },
    { label: "Rider CSAT", value: data.overview.csat, formatter: "decimal" as const, delta: monthlyDelta.csat, icon: Star, tone: "good" as const, sparkKey: "csat" },
  ] : [];

  return <div className={`app-shell ${agentCollapsed ? "agent-collapsed" : ""}`}>
    <aside className={`sidebar ${sidebarOpen ? "open" : ""}`}>
      <div className="brand"><span><Sparkles size={19} /></span><div><strong>MoveSync</strong><small>Pulse intelligence</small></div><button className="mobile-close" onClick={() => setSidebarOpen(false)}><X size={18} /></button></div>
      <div className="workspace-label">{workspace === "command" ? "Command center" : "Active monitoring"}</div>
      {workspace === "command" ? <>
        <nav>{navigation.map((item) => <button className={active === item.id ? "active" : ""} onClick={() => { setActive(item.id); setSidebarOpen(false); }} key={item.id}><item.icon size={17} /><span>{item.label}</span>{item.id === "safety" && data && Number(data.overview.open_alerts) > 0 && <b>{data.overview.open_alerts > 99 ? "99+" : data.overview.open_alerts}</b>}</button>)}</nav>
        <div className="sidebar-section"><div className="workspace-label">Saved views</div><button><span className="dot danger" />SLA breaches</button><button><span className="dot warning" />Open Sev-1 alerts</button><button><span className="dot green" />EV performance</button></div>
      </> : <>
        <nav><button className="active"><Radio size={17} /><span>Live fleet</span><b>LIVE</b></button></nav>
        <div className="sidebar-section"><div className="workspace-label">Live intelligence</div><button><span className="dot green" />Active trips</button><button><span className="dot danger" />Speed violations</button><button><span className="dot warning" />AI decisions</button></div>
      </>}
      <div className="sidebar-bottom"><Headphones size={17} /><span><strong>Hackathon demo</strong><small>5 tables · Read-only</small></span><span className="live-dot" /></div>
    </aside>
    {sidebarOpen && <div className="mobile-overlay" onClick={() => setSidebarOpen(false)} />}

    <div className="main-column">
      <header className="topbar">
        <button className="mobile-menu" onClick={() => setSidebarOpen(true)}><Menu size={20} /></button>
        <div className="persona-switch"><span className="persona-avatar">{currentPersona.short}</span><select value={persona} onChange={(e) => { setLoading(true); setError(""); setPersona(e.target.value as Persona); setFilters({}); }} aria-label="Active persona">{personas.map((p) => <option value={p.id} key={p.id}>{p.label}</option>)}</select><ChevronDown size={14} /></div>
        <div className="topbar-separator" />
        <div className="workspace-tabs" role="tablist" aria-label="Product workspace"><button role="tab" aria-selected={workspace === "command"} className={workspace === "command" ? "active" : ""} onClick={() => setWorkspace("command")}><LayoutDashboard size={14} /> Command center</button><button role="tab" aria-selected={workspace === "monitoring"} className={workspace === "monitoring" ? "active" : ""} onClick={() => setWorkspace("monitoring")}><Radio size={14} /> Active monitoring<span className="tab-live-dot" /></button></div>
        {workspace === "command" && data && <div className="global-filters">
          <HeaderSelect icon={Building2} label="Business unit" value={filters.businessUnit || ""} onChange={(v) => updateFilter("businessUnit", v)} options={data.options.businessUnits} placeholder="All units" />
          <HeaderSelect icon={CalendarDays} label="Period" value={filters.month || ""} onChange={(v) => updateFilter("month", v)} options={data.options.months} placeholder="May – Jul 2026" />
        </div>}
        <div className="topbar-actions"><button onClick={toggleTheme} title="Toggle theme">{theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}</button><button className="notification"><Bell size={18} /><i /></button><span className="user-avatar">BK</span></div>
      </header>

      {workspace === "monitoring" ? <main className="content monitoring-content"><ActiveMonitoring /></main> : <main className="content">
        <div className="page-heading"><div><div className="eyebrow"><span>Mobility command center</span><i /> Live from locked DuckDB</div><h1>{active === "overview" ? "Good morning, Bhargav" : navigation.find((n) => n.id === active)?.label}</h1><p>{persona === "facilities_head" ? "A leadership-ready view of cost, SLA, safety, experience and sustainability." : persona === "line_manager" ? "Shift readiness, pickup punctuality and rider impact—without billing data." : "Today’s exceptions, vendor accountability and operational signals in one place."}</p></div><div className="page-actions"><button><Download size={15} /> Export brief</button><button className="primary" onClick={() => setAgentCollapsed(false)}><Sparkles size={15} /> Ask copilot</button></div></div>

        {error ? <div className="error-state"><AlertOctagon size={22} /><div><strong>Dashboard unavailable</strong><p>{error}. Confirm the DuckDB file exists and run npm run db:verify.</p></div></div> : loading || !data ? <Skeleton /> : <>
          {active === "overview" && <>
            <div className="metric-grid">{metricCards.map((card) => <MetricCard key={card.label} {...card} sparkData={data.monthly} />)}</div>
            <div className="overview-grid">
              <Panel title={persona === "line_manager" ? "Pickup readiness trend" : "SLA performance"} subtitle="Daily performance against the 90% on-time benchmark" action={<span className={`benchmark ${data.overview.ota >= 90 ? "pass" : "fail"}`}>{data.overview.ota >= 90 ? "SLA met" : `${(90 - data.overview.ota).toFixed(1)} pt gap`}</span>} className="trend-panel"><OperationsTrend data={data.daily} /></Panel>
              <Panel title="Three-month story" subtitle={persona === "facilities_head" ? "Spend and unit economics" : "OTA and rider experience"}><MonthlyStory data={data.monthly} persona={persona} /></Panel>
            </div>
            <Panel title="Vendor performance" subtitle="Composite score: SLA delivery, rider experience, safety and compliance" action={<button className="text-button" onClick={() => setActive("vendors")}>View all vendors</button>}><VendorTable rows={data.vendors.slice(0, 7)} selected={filters.vendor || ""} onSelect={(v) => updateFilter("vendor", v)} /></Panel>
            <div className="overview-grid lower">
              <Panel title={persona === "line_manager" ? "Shifts needing attention" : "Safety signal mix"} subtitle={persona === "line_manager" ? "Late pickups and no-shows by shift" : "Highest-volume alert categories"}>{persona === "line_manager" ? <ShiftChart data={data.shifts} /> : <AlertChart data={data.alerts} />}</Panel>
              <Panel title="Recent exceptions" subtitle="Prioritized by impact and urgency" action={<button className="text-button" onClick={() => setActive("trips")}>Open board</button>}><div className="exception-list">{data.trips.filter((t) => !t.is_ota || Number(t.alert_count) > 0 || Number(t.noshow_cnt) > 0).slice(0, 5).map((trip) => <button key={`${trip.business_unit}-${trip.trip_id}`} onClick={() => setTripSelection({ business_unit: String(trip.business_unit), trip_id: String(trip.trip_id) })}><span className={`exception-icon ${Number(trip.sev1_count) ? "critical" : !trip.is_ota ? "late" : "watch"}`}>{Number(trip.sev1_count) ? <AlertOctagon size={15} /> : <Clock3 size={15} />}</span><span><strong>Trip #{trip.trip_id}</strong><small>{trip.vendor} · {trip.office}</small></span><span><b className={Number(trip.delay_minutes) > 15 ? "text-risk" : ""}>{Number(trip.delay_minutes) > 0 ? "+" : ""}{trip.delay_minutes} min</b><small>{trip.alert_count} alerts</small></span></button>)}</div></Panel>
            </div>
          </>}

          {active === "trips" && <Panel title="Trip board" subtitle={`${Number(data.overview.trips).toLocaleString("en-IN")} trips in the selected operating slice`} action={<div className="table-search"><Search size={15} /><input value={tripSearch} onChange={(e) => setTripSearch(e.target.value)} placeholder="Search trip, vendor, site…" /></div>}><div className="board-summary"><span><i className="green" /> On time <strong>{data.overview.ota}%</strong></span><span><i className="red" /> SLA missed <strong>{(100 - data.overview.ota).toFixed(1)}%</strong></span><span><i className="amber" /> Open alerts <strong>{data.overview.open_alerts}</strong></span><span><i className="blue" /> No-shows <strong>{data.overview.trip_no_shows.toLocaleString("en-IN")}</strong></span></div><TripTable rows={data.trips} search={tripSearch} onSelect={setTripSelection} /></Panel>}

          {active === "vendors" && <><div className="metric-grid compact"><MetricCard label="Vendors active" value={data.vendors.length} formatter="number" icon={Building2} tone="neutral" sparkData={data.monthly} sparkKey="trips" /><MetricCard label="Best OTA" value={Math.max(...data.vendors.map((v) => Number(v.ota)))} formatter="percent" icon={Gauge} tone="good" sparkData={data.monthly} sparkKey="ota" /><MetricCard label="Vendor CSAT" value={data.overview.csat} formatter="decimal" icon={Star} tone="good" sparkData={data.monthly} sparkKey="csat" /><MetricCard label="Sev-1 events" value={data.overview.sev1} formatter="number" icon={ShieldAlert} tone="risk" sparkData={data.monthly} sparkKey="ota" /></div><Panel title="Vendor scorecard" subtitle="Click a vendor to apply it as a dashboard filter"><VendorTable rows={data.vendors} selected={filters.vendor || ""} onSelect={(v) => updateFilter("vendor", v)} /></Panel></>}

          {active === "safety" && <div className="overview-grid safety-page"><Panel title="Alert concentration" subtitle="Event categories, volume and severity"><AlertChart data={data.alerts} /></Panel><Panel title="Response performance" subtitle="Acknowledgement time by event"><div className="alert-response-list">{data.alerts.slice(0, 8).map((alert) => <div key={String(alert.event_type)}><span><i className={Number(alert.sev1) ? "risk" : ""} />{String(alert.event_type).replaceAll("_", " ")}</span><strong>{alert.ack_minutes ?? "—"} min</strong><small>{alert.count} events · {alert.sev1} Sev-1</small></div>)}</div></Panel></div>}

          {active === "experience" && <><div className="metric-grid compact"><MetricCard label="Rider CSAT" value={data.overview.csat} formatter="decimal" delta={monthlyDelta.csat} icon={Star} tone="good" sparkData={data.monthly} sparkKey="csat" /><MetricCard label="No-show rate" value={data.overview.no_show_rate} formatter="percent" icon={UsersRound} tone="risk" sparkData={data.daily} sparkKey="no_shows" /><MetricCard label="Boarded legs" value={data.overview.boarded} formatter="number" icon={Check} tone="good" sparkData={data.daily} sparkKey="trips" /><MetricCard label="Invalid distances" value={data.overview.invalid_distances} formatter="number" icon={AlertOctagon} tone="neutral" sparkData={data.daily} sparkKey="alerts" /></div><div className="overview-grid"><Panel title="Experience trend" subtitle="Non-zero feedback responses only"><MonthlyStory data={data.monthly} persona="transport_manager" /></Panel><Panel title="Shift rider impact" subtitle="Late pickups and no-shows"><ShiftChart data={data.shifts} /></Panel></div></>}
        </>}
      </main>
      }
    </div>

    <AgentPanel persona={persona} filters={filters} mode={workspace} collapsed={agentCollapsed} onToggle={() => setAgentCollapsed((v) => !v)} />
    <TripDrawer selection={tripSelection} persona={persona} onClose={() => setTripSelection(null)} />
  </div>;
}

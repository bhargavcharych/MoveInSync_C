"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlertOctagon, BarChart3, Bell, Building2, CalendarDays, CarFront, Check,
  ChevronDown, CircleDollarSign, Clock3, Gauge, LayoutDashboard,
  Leaf, Menu, Moon, Radio, Search, ShieldAlert, Sparkles, Star, Sun, UsersRound, X, LogOut, PanelRightClose, PanelRightOpen
} from "lucide-react";
import { ActiveMonitoring } from "@/components/active-monitoring";
import { AgentPanel } from "@/components/agent-panel";
import { AlertChart, MonthlyStory, Sparkline } from "@/components/charts";
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
  { id: "vendors", label: "Vendors", icon: BarChart3 },
  { id: "trips", label: "Trip board", icon: CarFront },
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

function VendorTable({ rows, selected, onSelect, renderExpanded }: { rows: Row[]; selected: string; onSelect: (vendor: string) => void; renderExpanded: (vendor: string) => React.ReactNode }) {
  return <div className="data-table vendor-table"><table><thead><tr><th>Vendor</th><th>Score</th><th>Trips</th><th>OTA / SLA</th><th>CSAT</th><th>Alerts</th><th>EV mix</th><th></th></tr></thead><tbody>{rows.map((row, index) => {
    const ota = Number(row.ota); const pass = ota >= 90;
    const isExpanded = selected === row.vendor;
    return (
      <React.Fragment key={String(row.vendor)}>
        <tr className={isExpanded ? "selected" : ""} onClick={() => onSelect(isExpanded ? "" : String(row.vendor))}>
          <td><span className="vendor-rank">{index + 1}</span><strong>{row.vendor}</strong></td><td><span className={`score ${Number(row.score) >= 0 ? "positive" : "negative"}`}>{Number(row.score).toFixed(1)}</span></td><td>{Number(row.trips).toLocaleString("en-IN")}</td><td><span className={pass ? "text-good" : "text-risk"}>{row.ota}%</span><small className="sla-marker">/ 90%</small></td><td>{row.csat ? <><Star size={13} fill="#f5a524" color="#f5a524" /> {row.csat}</> : "—"}</td><td>{row.alerts}<small>{Number(row.sev1) > 0 ? ` · ${row.sev1} Sev-1` : ""}</small></td><td>{row.electric_share}%</td><td><ChevronDown size={15} style={{ transform: isExpanded ? "rotate(180deg)" : "none", transition: "transform 0.2s" }} /></td>
        </tr>
        {isExpanded && (
          <tr>
            <td colSpan={8} className="vendor-accordion-content">
              {renderExpanded(String(row.vendor))}
            </td>
          </tr>
        )}
      </React.Fragment>
    );
  })}</tbody></table></div>;
}

import React from "react";

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

export function Dashboard({ initialPersona, onLogout }: { initialPersona: Persona; onLogout: () => void }) {
  const [workspace, setWorkspace] = useState<"command" | "monitoring">("command");
  const persona = initialPersona;
  const [active, setActive] = useState("vendors");
  const [filters, setFilters] = useState<Omit<DashboardFilters, "persona">>({});
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [theme, setTheme] = useState("light");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [rightPanelOpen, setRightPanelOpen] = useState(true);
  const [tripSearch, setTripSearch] = useState("");
  const [tripSelection, setTripSelection] = useState<{ business_unit: string; trip_id: string } | null>(null);

  useEffect(() => {
    const saved = localStorage.getItem("movesync-theme");
    const next = saved || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    queueMicrotask(() => {
      setTheme(next);
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

  return <div className={`app-shell three-col ${!rightPanelOpen ? "right-collapsed" : ""}`}>
    <aside className={`sidebar ${sidebarOpen ? "open" : ""}`}>
      <div className="brand"><span><Sparkles size={19} /></span><div><strong>MoveinSync</strong><small>Pulse intelligence</small></div><button className="mobile-close" onClick={() => setSidebarOpen(false)}><X size={18} /></button></div>
      <div className="workspace-label">{workspace === "command" ? "Command center" : "Active monitoring"}</div>
      {workspace === "command" ? <>
        <nav>{navigation.map((item) => <button className={active === item.id ? "active" : ""} onClick={() => { setActive(item.id); setSidebarOpen(false); if (!rightPanelOpen) setRightPanelOpen(true); }} key={item.id}><item.icon size={17} /><span>{item.label}</span>{item.id === "safety" && data && Number(data.overview.open_alerts) > 0 && <b>{data.overview.open_alerts > 99 ? "99+" : data.overview.open_alerts}</b>}</button>)}</nav>
      </> : <>
        <nav><button className="active"><Radio size={17} /><span>Live fleet</span><b>LIVE</b></button></nav>
      </>}
      <div style={{ marginTop: "auto", padding: "16px" }}>
        <button onClick={onLogout} style={{ display: "flex", alignItems: "center", gap: "8px", background: "none", border: "none", color: "var(--text-secondary)", cursor: "pointer", fontSize: "14px", fontWeight: 600 }}>
          <LogOut size={16} /> Logout
        </button>
      </div>
    </aside>
    {sidebarOpen && <div className="mobile-overlay" onClick={() => setSidebarOpen(false)} />}

    <div className="main-column copilot-center">
      <header className="topbar">
        <button className="mobile-menu" onClick={() => setSidebarOpen(true)}><Menu size={20} /></button>
        <div className="persona-switch"><span className="persona-avatar">{currentPersona.short}</span><strong>{currentPersona.label}</strong></div>
        <div className="topbar-separator" />
        <div className="workspace-tabs" role="tablist" aria-label="Product workspace"><button role="tab" aria-selected={workspace === "command"} className={workspace === "command" ? "active" : ""} onClick={() => setWorkspace("command")}><LayoutDashboard size={14} /> Command center</button><button role="tab" aria-selected={workspace === "monitoring"} className={workspace === "monitoring" ? "active" : ""} onClick={() => setWorkspace("monitoring")}><Radio size={14} /> Active monitoring<span className="tab-live-dot" /></button></div>
        
        <div className="topbar-actions">
          <button onClick={toggleTheme} title="Toggle theme">{theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}</button>
          <button onClick={() => setRightPanelOpen(!rightPanelOpen)} title="Toggle Right Panel">
            {rightPanelOpen ? <PanelRightClose size={18} /> : <PanelRightOpen size={18} />}
          </button>
        </div>
      </header>

      <main className="content copilot-container">
        <AgentPanel persona={persona} filters={filters} mode={workspace} />
      </main>
    </div>

    <aside className={`right-panel ${!rightPanelOpen ? 'collapsed' : ''}`}>
        <header className="topbar right-panel-header" style={{ display: workspace === "command" && data ? "flex" : "none", gap: "12px", minWidth: "500px" }}>
          {workspace === "command" && data && <>
            <HeaderSelect icon={Building2} label="Business unit" value={filters.businessUnit || ""} onChange={(v) => updateFilter("businessUnit", v)} options={data.options.businessUnits} placeholder="All units" />
            <HeaderSelect icon={CalendarDays} label="Period" value={filters.month || ""} onChange={(v) => updateFilter("month", v)} options={data.options.months} placeholder="May – Jul 2026" />
          </>}
        </header>
        <div className="right-panel-content" style={{ minWidth: "500px" }}>
          {error ? <div className="error-state"><AlertOctagon size={22} /><div><strong>Data unavailable</strong><p>{error}</p></div></div> : loading || !data ? <Skeleton /> : <>
            
            {workspace === "command" && active === "trips" && <Panel title="Trip board" subtitle={`${Number(data.overview.trips).toLocaleString("en-IN")} trips`} action={<div className="table-search"><Search size={15} /><input value={tripSearch} onChange={(e) => setTripSearch(e.target.value)} placeholder="Search..." /></div>}><TripTable rows={data.trips} search={tripSearch} onSelect={setTripSelection} /></Panel>}

            {workspace === "command" && active === "vendors" && <Panel title="Vendors" subtitle="Select to filter context"><VendorTable rows={data.vendors} selected={filters.vendor || ""} onSelect={(v) => updateFilter("vendor", v)} renderExpanded={() => (
                <div className="metric-grid compact" style={{ gridTemplateColumns: "1fr 1fr", gap: "10px", padding: "16px", background: "var(--surface-subtle)", borderRadius: "8px" }}>
                  {metricCards.map((card) => <MetricCard key={card.label} {...card} sparkData={data.monthly} />)}
                </div>
            )} /></Panel>}

            {workspace === "command" && active === "safety" && <div className="overview-grid safety-page"><Panel title="Alert concentration" subtitle="Categories and severity"><AlertChart data={data.alerts} /></Panel></div>}

            {workspace === "command" && active === "experience" && <div className="overview-grid"><Panel title="Experience trend" subtitle="Feedback responses"><MonthlyStory data={data.monthly} persona="transport_manager" /></Panel></div>}

            {workspace === "monitoring" && <ActiveMonitoring />}
          </>}
        </div>
      </aside>
    
    <TripDrawer selection={tripSelection} persona={persona} onClose={() => setTripSelection(null)} />
  </div>;
}

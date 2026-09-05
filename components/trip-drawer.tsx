"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, ArrowRight, Car, Clock3, IndianRupee, MapPin, ShieldCheck, Star, UsersRound, X } from "lucide-react";
import type { Persona } from "@/lib/types";

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return <div className="detail-field"><span>{label}</span><strong>{value ?? "—"}</strong></div>;
}

type TripDetail = {
  is_ota: boolean; product_type: string; trip_direction: string; office: string; vendor: string;
  trip_date: string; shift_type: string; arrival_delay_minutes: number; traveled_km: number;
  planned_km: number; delay_reason: string; actual_cab_registration: string;
  planned_cab_registration: string; actual_cab_fuel_type: string; is_driver_nc: boolean;
  is_cab_nc: boolean; plannedemployee_cnt: number; actualemployee_cnt: number; noshow_cnt: number;
  actual_cab_capacity: number; csat: number | null; trip_cost: number | null; cost_per_km: number | null;
};
type EmployeeDetail = { rider_id: string; is_no_show: boolean; pickup_delay_minutes: number | null };
type AlertDetail = { event_type: string; state_text: string; ack_minutes: number | null; severity: string | null };
type DrawerData = {
  error?: boolean; trip?: TripDetail; employees?: EmployeeDetail[]; alerts?: AlertDetail[];
  feedback?: { driver: number | null; safety: number | null; responses: number };
  bills?: Array<{ contract: string | null; billed_km: number | null }>;
};

export function TripDrawer({ selection, persona, onClose }: { selection: { business_unit: string; trip_id: string } | null; persona: Persona; onClose: () => void }) {
  const [data, setData] = useState<DrawerData | null>(null);
  useEffect(() => {
    queueMicrotask(() => setData(null));
    if (!selection) return;
    fetch(`/api/trips/${encodeURIComponent(selection.business_unit)}/${selection.trip_id}?persona=${persona}`)
      .then((r) => r.json()).then(setData).catch(() => setData({ error: true }));
  }, [selection, persona]);
  if (!selection) return null;
  const trip = data?.trip;
  return <div className="drawer-backdrop" onMouseDown={(e) => { if (e.currentTarget === e.target) onClose(); }}>
    <aside className="trip-drawer">
      <div className="drawer-top"><div><small>{selection.business_unit} / TRIP</small><h2>#{selection.trip_id}</h2></div><button onClick={onClose} aria-label="Close"><X size={19} /></button></div>
      {!data ? <div className="drawer-loading"><i /><i /><i /><i /></div> : data.error || !trip ? <div className="empty-state">Trip details could not be loaded.</div> : <>
        <div className="trip-status-line"><span className={trip.is_ota ? "status success" : "status danger"}>{trip.is_ota ? "On time" : "SLA missed"}</span><span>{trip.product_type}</span><span>{trip.trip_direction}</span></div>
        <h3 className="trip-route"><MapPin size={18} /> {trip.office}<ArrowRight size={17} />{trip.vendor}</h3>
        <div className="detail-grid">
          <Field label="Date & shift" value={`${trip.trip_date} · ${trip.shift_type}`} />
          <Field label="Arrival variance" value={<span className={trip.arrival_delay_minutes > 15 ? "text-risk" : "text-good"}>{trip.arrival_delay_minutes} min</span>} />
          <Field label="Distance" value={`${trip.traveled_km} km / ${trip.planned_km} km`} />
          <Field label="Delay reason" value={trip.delay_reason} />
        </div>
        <section className="drawer-section"><h4><Car size={16} /> Vehicle & compliance</h4><div className="detail-grid"><Field label="Actual cab" value={trip.actual_cab_registration} /><Field label="Planned cab" value={trip.planned_cab_registration} /><Field label="Fuel" value={trip.actual_cab_fuel_type} /><Field label="Compliance" value={trip.is_driver_nc || trip.is_cab_nc ? <span className="text-risk">Review required</span> : <span className="text-good">Compliant</span>} /></div></section>
        <section className="drawer-section"><h4><UsersRound size={16} /> Rider outcome</h4><div className="detail-grid"><Field label="Planned" value={trip.plannedemployee_cnt} /><Field label="Boarded" value={trip.actualemployee_cnt} /><Field label="No-shows" value={trip.noshow_cnt} /><Field label="Capacity" value={trip.actual_cab_capacity} /></div>{Boolean(data.employees?.length) && <div className="rider-list">{data.employees!.slice(0, 8).map((employee) => <div key={employee.rider_id}><span>Rider •••{String(employee.rider_id).slice(-4)}</span><strong className={employee.is_no_show ? "text-risk" : employee.pickup_delay_minutes === null ? "muted" : employee.pickup_delay_minutes > 10 ? "text-warn" : "text-good"}>{employee.is_no_show ? "No-show" : employee.pickup_delay_minutes === null ? "Not recorded" : `${employee.pickup_delay_minutes}m pickup`}</strong></div>)}</div>}</section>
        {persona !== "line_manager" && <section className="drawer-section"><h4><Star size={16} /> Experience</h4><div className="detail-grid"><Field label="Overall CSAT" value={trip.csat ? `${trip.csat}/5` : "No response"} /><Field label="Driver" value={data.feedback?.driver ? `${data.feedback.driver}/5` : "—"} /><Field label="Safety" value={data.feedback?.safety ? `${data.feedback.safety}/5` : "—"} /><Field label="Responses" value={data.feedback?.responses || 0} /></div></section>}
        <section className="drawer-section"><h4><ShieldCheck size={16} /> Safety events <span>{data.alerts?.length || 0}</span></h4>{data.alerts?.length ? <div className="event-list">{data.alerts.map((alert, i) => <div key={i}><AlertTriangle size={15} /><span><strong>{String(alert.event_type).replaceAll("_", " ")}</strong><small>{alert.state_text} · {alert.ack_minutes ?? "—"} min to acknowledge</small></span><b className={alert.severity === "Sev-1" ? "sev1" : ""}>{alert.severity || "Unrated"}</b></div>)}</div> : <div className="quiet-state"><ShieldCheck size={18} /> No safety events on this trip</div>}</section>
        {persona !== "line_manager" && <section className="drawer-section"><h4><IndianRupee size={16} /> Billing</h4><div className="detail-grid"><Field label="Trip cost" value={trip.trip_cost ? `₹${Number(trip.trip_cost).toLocaleString("en-IN")}` : "Unmatched"} /><Field label="Cost / km" value={trip.cost_per_km ? `₹${trip.cost_per_km}` : "—"} /><Field label="Contract" value={data.bills?.[0]?.contract} /><Field label="Billed distance" value={data.bills?.[0]?.billed_km ? `${data.bills[0].billed_km} km` : "—"} /></div></section>}
        <div className="drawer-footer"><Clock3 size={14} /> Read-only evidence from five source tables</div>
      </>}
    </aside>
  </div>;
}

"use client";

import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, ComposedChart,
  Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";

const green = "#62ae41";
const blue = "#579dff";
const amber = "#f5a524";
const red = "#f15b50";
const muted = "#8c9bab";
type ChartRow = Record<string, number | string | boolean | null>;

const tooltipStyle = {
  border: "1px solid var(--border)",
  borderRadius: 10,
  background: "var(--surface-raised)",
  color: "var(--text)",
  boxShadow: "var(--shadow-lg)",
  fontSize: 12,
};

export function OperationsTrend({ data }: { data: ChartRow[] }) {
  return (
    <ResponsiveContainer width="100%" height={270}>
      <ComposedChart data={data} margin={{ top: 10, right: 4, left: -20, bottom: 0 }}>
        <defs>
          <linearGradient id="otaFill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor={green} stopOpacity={0.26} />
            <stop offset="100%" stopColor={green} stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke="var(--chart-grid)" strokeDasharray="3 5" vertical={false} />
        <XAxis dataKey="date" tickFormatter={(value) => String(value).slice(5)} tick={{ fill: "var(--text-muted)", fontSize: 11 }} axisLine={false} tickLine={false} minTickGap={28} />
        <YAxis domain={[40, 100]} tick={{ fill: "var(--text-muted)", fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={(v) => `${v}%`} />
        <Tooltip contentStyle={tooltipStyle} labelStyle={{ color: "var(--text)", fontWeight: 650 }} />
        <Legend iconType="circle" iconSize={7} wrapperStyle={{ fontSize: 12, paddingTop: 12 }} />
        <Area type="monotone" dataKey="ota" name="Arrival OTA" stroke={green} strokeWidth={2.5} fill="url(#otaFill)" dot={false} activeDot={{ r: 4 }} />
        <Line type="monotone" dataKey="otp" name="Pickup OTP" stroke={blue} strokeWidth={2} dot={false} />
        <Line type="monotone" dataKey={() => 90} name="SLA" stroke={muted} strokeDasharray="5 5" dot={false} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

export function MonthlyStory({ data, persona }: { data: ChartRow[]; persona: string }) {
  const isFacilities = persona === "facilities_head";
  return (
    <ResponsiveContainer width="100%" height={230}>
      <ComposedChart data={data} margin={{ top: 8, right: 2, left: -12, bottom: 0 }}>
        <CartesianGrid stroke="var(--chart-grid)" strokeDasharray="3 5" vertical={false} />
        <XAxis dataKey="month" tickFormatter={(v) => ({ "2026-05": "May", "2026-06": "Jun", "2026-07": "Jul" }[String(v)] || String(v))} tick={{ fill: "var(--text-muted)", fontSize: 11 }} axisLine={false} tickLine={false} />
        <YAxis yAxisId="left" tick={{ fill: "var(--text-muted)", fontSize: 11 }} axisLine={false} tickLine={false} />
        <YAxis yAxisId="right" orientation="right" tick={{ fill: "var(--text-muted)", fontSize: 11 }} axisLine={false} tickLine={false} />
        <Tooltip contentStyle={tooltipStyle} />
        <Legend iconSize={8} wrapperStyle={{ fontSize: 12 }} />
        {isFacilities ? (
          <>
            <Bar yAxisId="left" dataKey="spend" name="Spend (₹)" fill={green} radius={[5, 5, 0, 0]} barSize={34} />
            <Line yAxisId="right" dataKey="cost_per_trip" name="₹ / trip" stroke={amber} strokeWidth={2.5} />
          </>
        ) : (
          <>
            <Bar yAxisId="left" dataKey="ota" name="OTA %" fill={green} radius={[5, 5, 0, 0]} barSize={34} />
            <Line yAxisId="right" dataKey="csat" name="CSAT / 5" stroke={amber} strokeWidth={2.5} />
          </>
        )}
      </ComposedChart>
    </ResponsiveContainer>
  );
}

export function AlertChart({ data }: { data: ChartRow[] }) {
  return (
    <ResponsiveContainer width="100%" height={260}>
      <BarChart data={data.slice(0, 7)} layout="vertical" margin={{ top: 0, right: 12, left: 34, bottom: 0 }}>
        <CartesianGrid stroke="var(--chart-grid)" strokeDasharray="3 5" horizontal={false} />
        <XAxis type="number" tick={{ fill: "var(--text-muted)", fontSize: 11 }} axisLine={false} tickLine={false} />
        <YAxis type="category" dataKey="event_type" width={105} tickFormatter={(v) => String(v).replaceAll("_", " ").replace("EMPLOYEE ", "EMP ")} tick={{ fill: "var(--text-muted)", fontSize: 10 }} axisLine={false} tickLine={false} />
        <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "var(--hover)" }} />
        <Bar dataKey="count" name="Alerts" radius={[0, 5, 5, 0]}>
          {data.slice(0, 7).map((_, i) => <Cell key={i} fill={i === 0 ? red : i < 3 ? amber : green} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

export function ShiftChart({ data }: { data: ChartRow[] }) {
  return (
    <ResponsiveContainer width="100%" height={260}>
      <BarChart data={data.slice(0, 8)} margin={{ top: 0, right: 2, left: -18, bottom: 0 }}>
        <CartesianGrid stroke="var(--chart-grid)" strokeDasharray="3 5" vertical={false} />
        <XAxis dataKey="shift_type" tick={{ fill: "var(--text-muted)", fontSize: 10 }} axisLine={false} tickLine={false} />
        <YAxis tick={{ fill: "var(--text-muted)", fontSize: 11 }} axisLine={false} tickLine={false} />
        <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "var(--hover)" }} />
        <Legend iconSize={8} wrapperStyle={{ fontSize: 12 }} />
        <Bar dataKey="late" name="Late" stackId="exceptions" fill={amber} radius={[0, 0, 0, 0]} />
        <Bar dataKey="no_shows" name="No-show" stackId="exceptions" fill={red} radius={[5, 5, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function Sparkline({ data, dataKey, tone = "green" }: { data: ChartRow[]; dataKey: string; tone?: "green" | "blue" | "red" }) {
  const color = tone === "blue" ? blue : tone === "red" ? red : green;
  return (
    <ResponsiveContainer width="100%" height={46}>
      <AreaChart data={data} margin={{ top: 4, right: 0, left: 0, bottom: 0 }}>
        <Area type="monotone" dataKey={dataKey} stroke={color} strokeWidth={1.8} fill={color} fillOpacity={0.12} dot={false} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

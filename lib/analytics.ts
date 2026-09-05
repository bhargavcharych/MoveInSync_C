import "server-only";

import { query } from "@/lib/db";
import type { DashboardFilters, Persona } from "@/lib/types";

type Param = string | number | boolean | bigint | null;

function where(filters: DashboardFilters, alias = "f") {
  const clauses = ["1=1"];
  const params: Param[] = [];
  if (filters.businessUnit) {
    clauses.push(`${alias}.business_unit = ?`);
    params.push(filters.businessUnit);
  }
  if (filters.office) {
    clauses.push(`${alias}.office = ?`);
    params.push(filters.office);
  }
  if (filters.month) {
    clauses.push(`strftime(${alias}.trip_date, '%Y-%m') = ?`);
    params.push(filters.month);
  }
  if (filters.vendor) {
    clauses.push(`${alias}.vendor_id = ?`);
    params.push(filters.vendor);
  }
  return { sql: clauses.join(" AND "), params };
}

function scopedWhere(filters: DashboardFilters, alias: string, dateColumn: string, vendorColumn?: string) {
  const clauses = ["1=1"];
  const params: Param[] = [];
  if (filters.businessUnit) { clauses.push(`${alias}.business_unit = ?`); params.push(filters.businessUnit); }
  if (filters.office && alias !== "a" && alias !== "fb") { clauses.push(`${alias}.office = ?`); params.push(filters.office); }
  if (filters.month) { clauses.push(`strftime(${alias}.${dateColumn}, '%Y-%m') = ?`); params.push(filters.month); }
  if (filters.vendor && vendorColumn) { clauses.push(`${alias}.${vendorColumn} = ?`); params.push(filters.vendor); }
  return { sql: clauses.join(" AND "), params };
}

export async function getFilterOptions() {
  const [businessUnits, offices, vendors] = await Promise.all([
    query<{ value: string }>("SELECT DISTINCT business_unit AS value FROM rides ORDER BY 1"),
    query<{ value: string }>("SELECT DISTINCT office AS value FROM rides ORDER BY 1"),
    query<{ value: string }>("SELECT DISTINCT vendor_id AS value FROM rides ORDER BY 1"),
  ]);
  return {
    businessUnits: businessUnits.map((row) => row.value),
    offices: offices.map((row) => row.value),
    vendors: vendors.map((row) => row.value),
    months: ["2026-05", "2026-06", "2026-07"],
  };
}

export async function getOverview(filters: DashboardFilters) {
  const w = where(filters);
  const bill = scopedWhere(filters, "b", "cycle_start", "vendor");
  const employee = scopedWhere(filters, "e", "trip_date");
  const [tripRows, spendRows, employeeRows] = await Promise.all([
    query<Record<string, number>>(
      `SELECT count(*)::INTEGER AS trips,
        round(100 * avg(is_ota::INTEGER), 1) AS ota,
        round(100 * avg(is_otp::INTEGER), 1) AS otp,
        round(avg(arrival_delay_minutes), 1) AS avg_delay,
        round(100 * avg((actual_cab_fuel_type = 'Electric')::INTEGER), 1) AS electric_share,
        round(100 * avg(utilization), 1) AS utilization,
        sum(alert_count)::INTEGER AS alerts,
        sum(sev1_count)::INTEGER AS sev1,
        sum(open_alert_count)::INTEGER AS open_alerts,
        round(avg(csat), 2) AS csat,
        sum(noshow_cnt)::INTEGER AS trip_no_shows
      FROM v_trip_facts f WHERE ${w.sql}`,
      w.params,
    ),
    query<Record<string, number>>(
      `SELECT round(sum(trip_cost), 0) AS spend,
        round(sum(trip_cost) / nullif(count(*) FILTER (WHERE NOT is_overhead), 0), 2) AS cost_per_trip,
        CASE WHEN count(*) FILTER (WHERE total_trip_km > 0 AND trip_cost > 0) >= 20
          THEN round(sum(trip_cost) FILTER (WHERE total_trip_km > 0 AND trip_cost > 0)
            / nullif(sum(total_trip_km) FILTER (WHERE total_trip_km > 0 AND trip_cost > 0), 0), 2)
        END AS cost_per_km,
        count(*) FILTER (WHERE is_overhead)::INTEGER AS overhead_lines
      FROM bills b WHERE ${bill.sql}`,
      bill.params,
    ),
    query<Record<string, number>>(
      `SELECT count(*)::INTEGER AS employee_legs,
        count(*) FILTER (WHERE boarding_status = 'Boarded')::INTEGER AS boarded,
        round(100 * avg(is_no_show::INTEGER), 1) AS no_show_rate,
        count(*) FILTER (WHERE actual_pickup_epoch > planned_pickup_epoch + 600)::INTEGER AS late_pickups,
        count(*) FILTER (WHERE has_invalid_distance)::INTEGER AS invalid_distances
      FROM employees e WHERE ${employee.sql}`,
      employee.params,
    ),
  ]);
  return { ...tripRows[0], ...spendRows[0], ...employeeRows[0], sla: Number(process.env.OTA_SLA_PERCENT || 90) } as Record<string, number>;
}

export async function getDailyTrend(filters: DashboardFilters) {
  const w = where(filters);
  return query<Record<string, number | string>>(
    `SELECT strftime(trip_date, '%Y-%m-%d') AS date,
      round(100 * avg(is_ota::INTEGER), 1) AS ota,
      round(100 * avg(is_otp::INTEGER), 1) AS otp,
      count(*)::INTEGER AS trips,
      sum(noshow_cnt)::INTEGER AS no_shows,
      sum(alert_count)::INTEGER AS alerts
    FROM v_trip_facts f WHERE ${w.sql}
    GROUP BY trip_date ORDER BY trip_date`,
    w.params,
  );
}

export async function getMonthlyTrend(filters: DashboardFilters) {
  const w = { ...filters, month: undefined };
  const f = where(w);
  const b = scopedWhere(w, "b", "cycle_start", "vendor");
  const [ops, spend] = await Promise.all([
    query<Record<string, number | string>>(
      `SELECT strftime(trip_date, '%Y-%m') AS month,
        round(100 * avg(is_ota::INTEGER), 1) AS ota,
        round(avg(csat), 2) AS csat,
        count(*)::INTEGER AS trips,
        round(100 * avg((actual_cab_fuel_type = 'Electric')::INTEGER), 1) AS electric_share
      FROM v_trip_facts f WHERE ${f.sql} GROUP BY 1 ORDER BY 1`, f.params,
    ),
    query<Record<string, number | string>>(
      `SELECT strftime(cycle_start, '%Y-%m') AS month,
        round(sum(trip_cost), 0) AS spend,
        round(sum(trip_cost) / nullif(count(*) FILTER (WHERE NOT is_overhead), 0), 2) AS cost_per_trip,
        round(sum(trip_cost) / nullif(sum(total_trip_km), 0), 2) AS cost_per_km
      FROM bills b WHERE ${b.sql} GROUP BY 1 ORDER BY 1`, b.params,
    ),
  ]);
  const spendByMonth = new Map(spend.map((row) => [row.month, row]));
  return ops.map((row) => ({ ...row, ...(spendByMonth.get(row.month) || {}) }));
}

export async function getPerformanceContext(filters: DashboardFilters) {
  const w = where(filters);
  const [current, monthlyTrend, gapDrivers] = await Promise.all([
    getOverview(filters),
    getMonthlyTrend(filters),
    query<Record<string, number | string>>(
      `WITH vendor_gaps AS (
        SELECT vendor_id AS vendor,
          count(*)::INTEGER AS trips,
          count(*) FILTER (WHERE NOT is_ota)::INTEGER AS missed_ota,
          round(100 * avg(is_ota::INTEGER), 1) AS ota
        FROM v_trip_facts f WHERE ${w.sql}
        GROUP BY vendor_id
      )
      SELECT vendor, trips, missed_ota, ota,
        round(100 * missed_ota / nullif(sum(missed_ota) OVER (), 0), 1) AS share_of_gap
      FROM vendor_gaps
      ORDER BY missed_ota DESC
      LIMIT 3`,
      w.params,
    ),
  ]);
  return { current, monthlyTrend, gapDrivers };
}

export async function getVendorPerformance(filters: DashboardFilters, limit = 12) {
  const w = where({ ...filters, vendor: undefined });
  return query<Record<string, number | string>>(
    `SELECT vendor_id AS vendor,
      count(*)::INTEGER AS trips,
      round(100 * avg(is_ota::INTEGER), 1) AS ota,
      round(avg(csat), 2) AS csat,
      round(sum(trip_cost), 0) AS spend,
      round(sum(trip_cost) / nullif(sum(billed_km), 0), 2) AS cost_per_km,
      round(100 * avg((actual_cab_fuel_type = 'Electric')::INTEGER), 1) AS electric_share,
      sum(alert_count)::INTEGER AS alerts,
      sum(sev1_count)::INTEGER AS sev1,
      round(100 * avg((is_driver_nc OR is_cab_nc)::INTEGER), 2) AS non_compliance,
      round((100 * avg(is_ota::INTEGER) - 90) * 0.45
        + (coalesce(avg(csat), 3) - 3) * 10
        - least(sum(sev1_count)::DOUBLE / nullif(count(*), 0) * 1000, 20), 1) AS score
    FROM v_trip_facts f WHERE ${w.sql}
    GROUP BY vendor_id HAVING count(*) >= 20
    ORDER BY score DESC LIMIT ?`,
    [...w.params, limit],
  );
}

export async function searchVendorsByName(filters: DashboardFilters, nameContains: string) {
  const w = where({ ...filters, vendor: undefined });
  const pattern = `%${nameContains.trim().toLowerCase()}%`;
  const [vendors, peer] = await Promise.all([
    query<Record<string, number | string>>(
      `SELECT vendor_id AS vendor,
        count(*)::INTEGER AS trips,
        round(100 * avg(is_ota::INTEGER), 1) AS ota,
        round(avg(csat), 2) AS csat,
        sum(alert_count)::INTEGER AS alerts,
        sum(sev1_count)::INTEGER AS sev1,
        round(100 * avg((is_driver_nc OR is_cab_nc)::INTEGER), 2) AS non_compliance
      FROM v_trip_facts f
      WHERE ${w.sql} AND lower(vendor_id) LIKE ?
      GROUP BY vendor_id
      ORDER BY trips DESC, vendor_id
      LIMIT 50`,
      [...w.params, pattern],
    ),
    query<Record<string, number>>(
      `SELECT count(DISTINCT vendor_id)::INTEGER AS vendor_count,
        round(100 * avg(is_ota::INTEGER), 1) AS peer_ota,
        round(avg(csat), 2) AS peer_csat
      FROM v_trip_facts f WHERE ${w.sql}`,
      w.params,
    ),
  ]);
  return {
    query: nameContains,
    matchCount: vendors.length,
    vendors,
    benchmark: { ...peer[0], otaSla: Number(process.env.OTA_SLA_PERCENT || 90) },
  };
}

export async function getVendorHistory(filters: DashboardFilters, vendor: string) {
  const w = where({ ...filters, vendor: undefined, month: undefined });
  const rows = await query<Record<string, number | string | null>>(
    `SELECT strftime(trip_date, '%Y-%m') AS month,
      max(vendor_id) FILTER (WHERE lower(vendor_id) = lower(?)) AS vendor,
      count(*) FILTER (WHERE lower(vendor_id) = lower(?))::INTEGER AS trips,
      round(100 * avg(is_ota::INTEGER) FILTER (WHERE lower(vendor_id) = lower(?)), 1) AS ota,
      round(avg(csat) FILTER (WHERE lower(vendor_id) = lower(?)), 2) AS csat,
      sum(alert_count) FILTER (WHERE lower(vendor_id) = lower(?))::INTEGER AS alerts,
      round(100 * avg(is_ota::INTEGER), 1) AS peer_ota
    FROM v_trip_facts f
    WHERE ${w.sql}
    GROUP BY 1 ORDER BY 1`,
    [vendor, vendor, vendor, vendor, vendor, ...w.params],
  );
  const matched = rows.filter((row) => Number(row.trips) > 0);
  const sla = Number(process.env.OTA_SLA_PERCENT || 90);
  const round1 = (value: number) => Math.round(value * 10) / 10;
  type VendorHistoryMonth = Record<string, number | string | null> & {
    otaVsSlaPoints: number; otaVsPeerPoints: number; changeVsPreviousMonthPoints: number | null;
  };
  const months: VendorHistoryMonth[] = matched.map((row, index) => {
    const ota = Number(row.ota);
    const peerOta = Number(row.peer_ota);
    const priorOta = index > 0 ? Number(matched[index - 1].ota) : null;
    return {
      ...row,
      otaVsSlaPoints: round1(ota - sla),
      otaVsPeerPoints: round1(ota - peerOta),
      changeVsPreviousMonthPoints: priorOta === null ? null : round1(ota - priorOta),
    } as VendorHistoryMonth;
  });
  const latest = months.at(-1);
  const worst = months.reduce<(typeof months)[number] | undefined>((lowest, row) => !lowest || Number(row.ota) < Number(lowest.ota) ? row : lowest, undefined);
  return {
    vendor: months[0]?.vendor || vendor,
    found: months.length > 0,
    otaSla: sla,
    months,
    summary: latest && worst ? {
      latestMonth: latest.month,
      latestOta: latest.ota,
      latestVsSlaPoints: latest.otaVsSlaPoints,
      latestVsPeerPoints: latest.otaVsPeerPoints,
      latestChangePoints: latest.changeVsPreviousMonthPoints,
      worstMonth: worst.month,
      worstOta: worst.ota,
      worstVsSlaPoints: worst.otaVsSlaPoints,
    } : null,
  };
}

export async function getRecentTrips(filters: DashboardFilters, limit = 40, riskOnly = false) {
  const w = where(filters);
  const risk = riskOnly
    ? "AND (NOT is_ota OR sev1_count > 0 OR open_alert_count > 0 OR is_driver_nc OR is_cab_nc OR noshow_cnt > 0)"
    : "";
  return query<Record<string, number | string | boolean | null>>(
    `SELECT business_unit, trip_id::VARCHAR AS trip_id, strftime(trip_date, '%d %b') AS trip_date,
      shift_type, office, vendor_id AS vendor, trip_direction, product_type,
      round(arrival_delay_minutes, 0) AS delay_minutes, is_ota,
      alert_count, sev1_count, open_alert_count, noshow_cnt,
      round(csat, 1) AS csat, round(trip_cost, 0) AS cost,
      actual_cab_registration AS cab
    FROM v_trip_facts f WHERE ${w.sql} ${risk}
    ORDER BY trip_date DESC, sev1_count DESC, abs(arrival_delay_minutes) DESC LIMIT ?`,
    [...w.params, limit],
  );
}

export async function getAlertBreakdown(filters: DashboardFilters) {
  const a = scopedWhere(filters, "a", "start_time");
  return query<Record<string, number | string>>(
    `SELECT event_type, count(*)::INTEGER AS count,
      count(*) FILTER (WHERE severity = 'Sev-1')::INTEGER AS sev1,
      round(avg(date_diff('minute', start_time, acknowledge_time)), 1) AS ack_minutes
    FROM alerts a WHERE ${a.sql}
    GROUP BY event_type ORDER BY count DESC`, a.params,
  );
}

export async function getShiftReadiness(filters: DashboardFilters) {
  const e = scopedWhere(filters, "e", "trip_date");
  return query<Record<string, number | string>>(
    `SELECT shift_type,
      count(*)::INTEGER AS scheduled,
      count(*) FILTER (WHERE boarding_status = 'Boarded')::INTEGER AS boarded,
      count(*) FILTER (WHERE is_no_show)::INTEGER AS no_shows,
      count(*) FILTER (WHERE actual_pickup_epoch > planned_pickup_epoch + 600)::INTEGER AS late,
      round(100 * avg((actual_pickup_epoch <= planned_pickup_epoch + 600)::INTEGER), 1) AS on_time
    FROM employees e WHERE ${e.sql}
    GROUP BY shift_type HAVING count(*) >= 20
    ORDER BY late DESC LIMIT 12`, e.params,
  );
}

export async function getTripDetail(businessUnit: string, tripId: string, persona: Persona) {
  const [trip, employees, alerts, feedback, bills] = await Promise.all([
    query<Record<string, unknown>>(
      `SELECT business_unit, trip_id::VARCHAR AS trip_id, trip_date::VARCHAR AS trip_date,
        office, vendor_id AS vendor, product_type, trip_direction, shift_type,
        planned_cab_registration, actual_cab_registration, actual_cab_capacity,
        round(planned_km, 1) AS planned_km, round(traveled_km, 1) AS traveled_km,
        round(arrival_delay_minutes, 1) AS arrival_delay_minutes, is_ota, delay_reason,
        actual_cab_fuel_type, is_driver_nc, is_cab_nc, plannedemployee_cnt,
        actualemployee_cnt, noshow_cnt, alert_count, sev1_count, round(csat, 2) AS csat,
        round(trip_cost, 0) AS trip_cost, round(cost_per_km, 2) AS cost_per_km
      FROM v_trip_facts WHERE business_unit = ? AND trip_id = ? LIMIT 1`, [businessUnit, BigInt(tripId)],
    ),
    persona === "facilities_head" ? Promise.resolve([]) : query<Record<string, unknown>>(
      `SELECT stwid::VARCHAR AS rider_id, boarding_status, is_no_show, not_boarding_reason,
        round((actual_pickup_epoch - planned_pickup_epoch) / 60.0, 1) AS pickup_delay_minutes,
        gender, signintype
      FROM employees WHERE business_unit = ? AND trip_id = ? ORDER BY is_no_show DESC LIMIT 100`,
      [businessUnit, BigInt(tripId)],
    ),
    query<Record<string, unknown>>(
      `SELECT event_type, severity, state_text, start_time::VARCHAR AS start_time,
        round(date_diff('minute', start_time, acknowledge_time), 1) AS ack_minutes
      FROM alerts WHERE business_unit = ? AND trip_id = ? ORDER BY start_time DESC`,
      [businessUnit, BigInt(tripId)],
    ),
    persona === "line_manager" ? Promise.resolve([]) : query<Record<string, unknown>>(
      `SELECT round(avg(nullif(route_rating, 0)), 2) AS route,
        round(avg(nullif(driver_rating, 0)), 2) AS driver,
        round(avg(nullif(cab_rating, 0)), 2) AS cab,
        round(avg(nullif(safety_rating, 0)), 2) AS safety,
        count(*)::INTEGER AS responses
      FROM feedback WHERE business_unit = ? AND trip_id = ?`, [businessUnit, BigInt(tripId)],
    ),
    persona === "line_manager" ? Promise.resolve([]) : query<Record<string, unknown>>(
      `SELECT contract, slab_name, round(total_trip_km, 1) AS billed_km, round(trip_cost, 0) AS cost
      FROM bills WHERE business_unit = ? AND trip_id = ?`, [businessUnit, BigInt(tripId)],
    ),
  ]);
  return { trip: trip[0] || null, employees, alerts, feedback: feedback[0] || null, bills };
}

export async function getDashboard(filters: DashboardFilters) {
  const [overview, daily, monthly, vendors, trips, alerts, shifts, options] = await Promise.all([
    getOverview(filters), getDailyTrend(filters), getMonthlyTrend(filters),
    getVendorPerformance(filters), getRecentTrips(filters), getAlertBreakdown(filters),
    getShiftReadiness(filters), getFilterOptions(),
  ]);
  return { overview, daily, monthly, vendors, trips, alerts, shifts, options, generatedAt: new Date().toISOString() };
}

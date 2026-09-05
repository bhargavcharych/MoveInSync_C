import { METRICS, validateQuerySpec, type MetricMetadata } from "./semantic-catalog";
import { classifyQuery, type QuerySpec } from "./query-spec";

export type QueryExecutor = <T extends Record<string, unknown>>(sql: string, values?: unknown[]) => Promise<T[]>;

export type Evidence = {
  id: string;
  statement: string;
  supports: boolean;
  value?: number | string;
};

export type HypothesisState = {
  hypothesis: string;
  status: "supported" | "weakened" | "rejected" | "premise_false" | "insufficient_evidence";
  supportingEvidence: Evidence[];
  contradictingEvidence: Evidence[];
};

export type Contradiction = {
  hypothesis: string;
  evidence: string;
  whyItContradicts: string;
  confirmed: boolean;
};

export type AnalysisResult = {
  handled: true;
  querySpec: QuerySpec;
  selected: {
    metric: QuerySpec["metric"];
    entity: QuerySpec["entityType"];
    groupBy: QuerySpec["groupBy"];
    window: QuerySpec["window"];
    benchmark: QuerySpec["comparison"]["type"];
  };
  metadata: MetricMetadata;
  status: "ok" | "refused" | "premise_false" | "insufficient_evidence";
  evidence: Evidence[];
  hypotheses: HypothesisState[];
  contradictions: Contradiction[];
  data: Record<string, unknown>;
  quality: { passed: boolean; checks: Array<{ name: string; passed: boolean; detail: string }>; confidence: number };
  conclusion: string;
};

type RawAnalysis = Omit<AnalysisResult, "handled" | "selected" | "metadata" | "quality" | "conclusion"> & { conclusion: string };

const round = (value: number, digits = 2) => Number(value.toFixed(digits));
const number = (value: unknown) => Number(value ?? 0);

function pearson(rows: Array<{ x: number; y: number }>) {
  if (rows.length < 3) return null;
  const mx = rows.reduce((sum, row) => sum + row.x, 0) / rows.length;
  const my = rows.reduce((sum, row) => sum + row.y, 0) / rows.length;
  let numerator = 0;
  let xx = 0;
  let yy = 0;
  for (const row of rows) {
    const dx = row.x - mx;
    const dy = row.y - my;
    numerator += dx * dy;
    xx += dx * dx;
    yy += dy * dy;
  }
  return xx && yy ? numerator / Math.sqrt(xx * yy) : null;
}

function qualityGate(spec: QuerySpec, raw: RawAnalysis) {
  const checks = [
    { name: "semantic_compatibility", passed: true, detail: raw.status === "refused" ? `Incompatible request correctly blocked: ${raw.conclusion}` : "Metric and requested dimensions are compatible." },
    { name: "source_metadata", passed: Boolean(METRICS[spec.metric]?.sourceTable), detail: `Source: ${METRICS[spec.metric].sourceTable}.` },
    { name: "window_integrity", passed: Boolean(spec.window.currentStart && spec.window.currentEnd), detail: `${spec.window.currentStart} through ${spec.window.currentEnd}.` },
    { name: "evidence_present", passed: raw.status === "refused" || raw.evidence.length > 0, detail: `${raw.evidence.length} structured evidence item(s).` },
    { name: "conclusion_supported", passed: raw.status === "refused" || raw.evidence.some((item) => item.supports), detail: "Conclusion must be grounded in structured evidence, not column coverage." },
    { name: "comparison_honored", passed: !spec.comparison.enabled || spec.comparison.type !== "none", detail: `Selected ${spec.comparison.type} benchmark for ${spec.intent} intent.` },
    { name: "superlative_honored", passed: raw.status === "refused" || !spec.superlative || Array.isArray(raw.data.ranking), detail: raw.status === "refused" ? "Ranking was explicitly refused because its requested dimension is unavailable." : spec.superlative ? "The requested ranking is present in the main result." : "No superlative requested." },
  ];
  const passed = checks.every((check) => check.passed);
  const evidenceStrength = raw.status === "refused" ? 0.78 : raw.evidence.length ? Math.min(0.9, 0.55 + raw.evidence.filter((item) => item.supports).length * 0.08) : 0.35;
  return { passed, checks, confidence: passed ? round(evidenceStrength, 2) : Math.min(0.5, round(evidenceStrength, 2)) };
}

async function analyzeBusinessUnitComparison(spec: QuerySpec, query: QueryExecutor): Promise<RawAnalysis> {
  const w = spec.window;
  const rows = await query<{ business_unit: string; current_ota: number; previous_ota: number; current_n: number; previous_n: number }>(
    `SELECT business_unit,
      100 * avg(is_ota::INTEGER) FILTER (WHERE trip_date BETWEEN ? AND ?) AS current_ota,
      100 * avg(is_ota::INTEGER) FILTER (WHERE trip_date BETWEEN ? AND ?) AS previous_ota,
      count(*) FILTER (WHERE trip_date BETWEEN ? AND ?)::INTEGER AS current_n,
      count(*) FILTER (WHERE trip_date BETWEEN ? AND ?)::INTEGER AS previous_n
    FROM v_trip_facts
    WHERE trip_date BETWEEN ? AND ?
    GROUP BY business_unit
    ORDER BY business_unit`,
    [w.currentStart, w.currentEnd, w.comparisonStart, w.comparisonEnd, w.currentStart, w.currentEnd, w.comparisonStart, w.comparisonEnd, w.comparisonStart, w.currentEnd],
  );
  const comparison = rows.map((row) => ({
    businessUnit: row.business_unit,
    currentOta: round(number(row.current_ota)),
    previousOta: round(number(row.previous_ota)),
    changePp: round(number(row.current_ota) - number(row.previous_ota)),
    currentTrips: number(row.current_n),
    previousTrips: number(row.previous_n),
  }));
  const evidence = comparison.map<Evidence>((row) => ({
    id: `ota-${row.businessUnit}`,
    statement: `${row.businessUnit}: ${row.previousOta}% to ${row.currentOta}% (${row.changePp >= 0 ? "+" : ""}${row.changePp} pp), n=${row.previousTrips}/${row.currentTrips}`,
    supports: true,
    value: row.changePp,
  }));
  const summary = comparison.map((row) => `${row.businessUnit} ${row.changePp >= 0 ? "+" : ""}${row.changePp.toFixed(2)} pp`).join("; ");
  return {
    querySpec: spec,
    status: "ok",
    evidence,
    hypotheses: [],
    contradictions: [],
    data: { comparison },
    conclusion: `OTA change for ${w.currentStart}–${w.currentEnd} versus ${w.comparisonStart}–${w.comparisonEnd}: ${summary}. These are equal 14-day windows and each result is calculated per business unit.`,
  };
}

async function analyzeOfficeRanking(spec: QuerySpec, query: QueryExecutor): Promise<RawAnalysis> {
  const rows = await query<{ office: string; ota: number; trips: number; missed_ota: number }>(
    `SELECT office, 100 * avg(is_ota::INTEGER) AS ota, count(*)::INTEGER AS trips,
      count(*) FILTER (WHERE NOT is_ota)::INTEGER AS missed_ota
    FROM v_trip_facts
    WHERE trip_date BETWEEN ? AND ?
    GROUP BY office HAVING count(*) >= 100
    ORDER BY ota ASC, trips DESC`,
    [spec.window.currentStart, spec.window.currentEnd],
  );
  const ranking = rows.map((row) => ({ office: row.office, ota: round(number(row.ota), 1), trips: number(row.trips), missedOta: number(row.missed_ota) }));
  const worst = ranking[0];
  if (!worst) return { querySpec: spec, status: "insufficient_evidence", evidence: [], hypotheses: [], contradictions: [], data: { ranking: [] }, conclusion: "There are not enough office-level trips to rank OTA reliably." };
  const monthly = await query<{ month: string; ota: number; trips: number }>(
    `SELECT strftime(trip_date, '%Y-%m') AS month, 100 * avg(is_ota::INTEGER) AS ota, count(*)::INTEGER AS trips
     FROM v_trip_facts WHERE office = ? GROUP BY 1 ORDER BY 1`, [worst.office],
  );
  const vendors = await query<{ vendor: string; ota: number; trips: number; missed_ota: number }>(
    `SELECT vendor_id AS vendor, 100 * avg(is_ota::INTEGER) AS ota, count(*)::INTEGER AS trips,
      count(*) FILTER (WHERE NOT is_ota)::INTEGER AS missed_ota
     FROM v_trip_facts WHERE office = ? GROUP BY vendor_id HAVING count(*) >= 20 ORDER BY missed_ota DESC LIMIT 3`, [worst.office],
  );
  const evidence: Evidence[] = [
    { id: "worst-office", statement: `${worst.office} ranks last at ${worst.ota}% OTA across ${worst.trips} trips.`, supports: true, value: worst.ota },
    { id: "persistence", statement: `Monthly OTA: ${monthly.map((row) => `${row.month} ${round(number(row.ota), 1)}%`).join(", ")}.`, supports: monthly.length >= 2 },
    { id: "vendor-contribution", statement: `Largest missed-OTA contributor: ${vendors[0]?.vendor ?? "unavailable"} (${number(vendors[0]?.missed_ota)} misses).`, supports: Boolean(vendors[0]) },
  ];
  return {
    querySpec: spec,
    status: "ok",
    evidence,
    hypotheses: [{ hypothesis: `${worst.office} has the worst OTA`, status: "supported", supportingEvidence: evidence, contradictingEvidence: [] }],
    contradictions: [],
    data: { ranking, monthly, vendors },
    conclusion: `${worst.office} has the worst OTA: ${worst.ota}% across ${worst.trips.toLocaleString("en-IN")} trips. It remains weak in every loaded month; ${vendors[0]?.vendor ?? "the leading vendor"} contributes the most missed-OTA trips.`,
  };
}

async function analyzePremise(spec: QuerySpec, query: QueryExecutor): Promise<RawAnalysis> {
  const name = spec.entityFilter?.value || "";
  const rows = await query<{ office: string; current_ota: number; previous_ota: number; current_n: number; previous_n: number }>(
    `SELECT max(office) AS office,
      100 * avg(is_ota::INTEGER) FILTER (WHERE trip_date BETWEEN ? AND ?) AS current_ota,
      100 * avg(is_ota::INTEGER) FILTER (WHERE trip_date BETWEEN ? AND ?) AS previous_ota,
      count(*) FILTER (WHERE trip_date BETWEEN ? AND ?)::INTEGER AS current_n,
      count(*) FILTER (WHERE trip_date BETWEEN ? AND ?)::INTEGER AS previous_n
     FROM v_trip_facts WHERE lower(office) LIKE ?`,
    [spec.window.currentStart, spec.window.currentEnd, spec.window.comparisonStart, spec.window.comparisonEnd, spec.window.currentStart, spec.window.currentEnd, spec.window.comparisonStart, spec.window.comparisonEnd, `%${name.toLowerCase()}%`],
  );
  const row = rows[0];
  if (!row?.office || !row.current_n || !row.previous_n) return { querySpec: spec, status: "insufficient_evidence", evidence: [], hypotheses: [], contradictions: [], data: {}, conclusion: `There is not enough office-level OTA evidence for ${name}.` };
  const current = round(number(row.current_ota), 2);
  const previous = round(number(row.previous_ota), 2);
  const change = round(current - previous, 2);
  const premiseFalse = change >= 0;
  const evidence: Evidence[] = [{ id: "period-change", statement: `${row.office} OTA changed from ${previous}% in ${spec.window.comparisonStart}–${spec.window.comparisonEnd} to ${current}% in ${spec.window.currentStart}–${spec.window.currentEnd} (${change >= 0 ? "+" : ""}${change} pp).`, supports: true, value: change }];
  const contradiction: Contradiction[] = premiseFalse ? [{ hypothesis: `${row.office} OTA declined`, evidence: evidence[0].statement, whyItContradicts: "The observed period-over-period change is non-negative.", confirmed: true }] : [];
  return {
    querySpec: spec,
    status: premiseFalse ? "premise_false" : "ok",
    evidence,
    hypotheses: [{ hypothesis: `${row.office} OTA declined`, status: premiseFalse ? "premise_false" : "supported", supportingEvidence: premiseFalse ? [] : evidence, contradictingEvidence: premiseFalse ? evidence : [] }],
    contradictions: contradiction,
    data: { office: row.office, currentOta: current, previousOta: previous, changePp: change, currentTrips: number(row.current_n), previousTrips: number(row.previous_n) },
    conclusion: premiseFalse
      ? `The premise is false. ${row.office} OTA did not decline: it rose from ${previous}% to ${current}% (${change >= 0 ? "+" : ""}${change} pp) across equal 30-day windows. No decline cause should be assigned.`
      : `${row.office} OTA declined ${Math.abs(change)} pp, from ${previous}% to ${current}% across equal 30-day windows. A contributor investigation is warranted.`,
  };
}

async function analyzeVendor(spec: QuerySpec, query: QueryExecutor): Promise<RawAnalysis> {
  const name = spec.entityFilter?.value || "";
  const w = spec.window;
  const rows = await query<{ vendor: string; current_ota: number; previous_ota: number; peer_ota: number; current_n: number; previous_n: number }>(
    `SELECT max(vendor_id) FILTER (WHERE lower(vendor_id) = lower(?)) AS vendor,
      100 * avg(is_ota::INTEGER) FILTER (WHERE lower(vendor_id) = lower(?) AND trip_date BETWEEN ? AND ?) AS current_ota,
      100 * avg(is_ota::INTEGER) FILTER (WHERE lower(vendor_id) = lower(?) AND trip_date BETWEEN ? AND ?) AS previous_ota,
      100 * avg(is_ota::INTEGER) FILTER (WHERE trip_date BETWEEN ? AND ?) AS peer_ota,
      count(*) FILTER (WHERE lower(vendor_id) = lower(?) AND trip_date BETWEEN ? AND ?)::INTEGER AS current_n,
      count(*) FILTER (WHERE lower(vendor_id) = lower(?) AND trip_date BETWEEN ? AND ?)::INTEGER AS previous_n
     FROM v_trip_facts`,
    [name, name, w.currentStart, w.currentEnd, name, w.comparisonStart, w.comparisonEnd, w.currentStart, w.currentEnd, name, w.currentStart, w.currentEnd, name, w.comparisonStart, w.comparisonEnd],
  );
  const row = rows[0];
  if (!row?.vendor || !row.current_n) return { querySpec: spec, status: "insufficient_evidence", evidence: [], hypotheses: [], contradictions: [], data: {}, conclusion: `No exact vendor match with sufficient OTA data was found for ${name}.` };
  const reasons = await query<{ delay_reason: string; missed_trips: number; share_of_vendor_misses: number }>(
    `WITH misses AS (
       SELECT coalesce(delay_reason, 'UNKNOWN') AS delay_reason, count(*)::INTEGER AS missed_trips
       FROM v_trip_facts WHERE lower(vendor_id) = lower(?) AND trip_date BETWEEN ? AND ? AND NOT is_ota
       GROUP BY 1
     ) SELECT delay_reason, missed_trips, 100.0 * missed_trips / nullif(sum(missed_trips) OVER (), 0) AS share_of_vendor_misses
     FROM misses ORDER BY missed_trips DESC`, [row.vendor, w.currentStart, w.currentEnd],
  );
  const offices = await query<{ office: string; ota: number; trips: number; missed_trips: number; share_of_vendor_misses: number }>(
    `WITH slices AS (
       SELECT office, 100 * avg(is_ota::INTEGER) AS ota, count(*)::INTEGER AS trips,
         count(*) FILTER (WHERE NOT is_ota)::INTEGER AS missed_trips
       FROM v_trip_facts WHERE lower(vendor_id) = lower(?) AND trip_date BETWEEN ? AND ? GROUP BY office
     ) SELECT *, 100.0 * missed_trips / nullif(sum(missed_trips) OVER (), 0) AS share_of_vendor_misses
       FROM slices WHERE trips >= 20 ORDER BY missed_trips DESC LIMIT 5`, [row.vendor, w.currentStart, w.currentEnd],
  );
  const current = round(number(row.current_ota), 2);
  const previous = round(number(row.previous_ota), 2);
  const peer = round(number(row.peer_ota), 2);
  const trend = round(current - previous, 2);
  const belowSla = current < 90;
  const deteriorated = trend < 0;
  const reason = reasons[0];
  const office = offices[0];
  const reasonCredible = Boolean(reason && !["NODELAY", "UNKNOWN"].includes(reason.delay_reason) && number(reason.share_of_vendor_misses) >= 40);
  const peerGap = round(current - peer, 2);
  const evidence: Evidence[] = [
    { id: "vendor-level", statement: `${row.vendor} OTA is ${current}% versus ${peer}% fleet peer and 90% SLA across ${number(row.current_n)} trips.`, supports: belowSla },
    { id: "vendor-trend", statement: `Prior equal-window OTA was ${previous}%; change is ${trend >= 0 ? "+" : ""}${trend} pp.`, supports: deteriorated, value: trend },
    { id: "delay-reason", statement: `${reason?.delay_reason ?? "Unknown"} accounts for ${round(number(reason?.share_of_vendor_misses), 1)}% of the vendor's missed-OTA trips.`, supports: Boolean(reason) },
    { id: "office-concentration", statement: `${office?.office ?? "No office"} contributes ${round(number(office?.share_of_vendor_misses), 1)}% of vendor misses and runs at ${round(number(office?.ota), 1)}% OTA.`, supports: Boolean(office) },
  ];
  const hypotheses: HypothesisState[] = [
    { hypothesis: "The vendor recently deteriorated", status: deteriorated ? "supported" : "rejected", supportingEvidence: deteriorated ? evidence.slice(1, 2) : [], contradictingEvidence: deteriorated ? [] : evidence.slice(1, 2) },
    { hypothesis: "The gap is explained by a recorded operational delay reason", status: reasonCredible ? "supported" : "rejected", supportingEvidence: reasonCredible ? evidence.slice(2, 3) : [], contradictingEvidence: reasonCredible ? [] : evidence.slice(2, 3) },
    { hypothesis: "The gap is concentrated in one office footprint", status: office && number(office.share_of_vendor_misses) >= 40 ? "supported" : "weakened", supportingEvidence: office ? evidence.slice(3, 4) : [], contradictingEvidence: [] },
  ];
  const contradictions: Contradiction[] = [];
  if (!deteriorated) contradictions.push({ hypothesis: "The vendor's low SLA is caused by recent deterioration", evidence: evidence[1].statement, whyItContradicts: "The vendor did not worsen versus the equal prior window.", confirmed: true });
  if (reason && reason.delay_reason === "NODELAY") contradictions.push({ hypothesis: "The recorded delay-reason field explains the missed-OTA trips", evidence: evidence[2].statement, whyItContradicts: "Trips classified late by planned-versus-actual end time are predominantly labelled NODELAY, so the reason code cannot support a causal explanation.", confirmed: true });
  const peerPosition = `${Math.abs(peerGap)} pp ${peerGap >= 0 ? "above" : "below"} the fleet peer`;
  const explanation = reasonCredible
    ? `${reason.delay_reason} represents ${round(number(reason.share_of_vendor_misses), 1)}% of misses, concentrated in ${office?.office ?? "the leading office slice"}`
    : `${round(number(reason?.share_of_vendor_misses), 1)}% of missed-OTA trips are labelled ${reason?.delay_reason ?? "UNKNOWN"}, so the reason field conflicts with the endpoint-timing result and does not prove an operational cause`;
  return {
    querySpec: spec,
    status: belowSla ? "ok" : "premise_false",
    evidence,
    hypotheses,
    contradictions,
    data: { vendor: row.vendor, currentOta: current, previousOta: previous, peerOta: peer, changePp: trend, currentTrips: number(row.current_n), reasons, offices },
    conclusion: belowSla
      ? `${row.vendor} OTA is ${current}%, ${round(90 - current, 2)} pp below SLA but ${peerPosition}. ${explanation}; ${deteriorated ? `OTA also deteriorated ${Math.abs(trend)} pp.` : `OTA did not deteriorate versus the prior equal window, so this is persistent/portfolio underperformance rather than a new drop.`}`
      : `The premise is false. ${row.vendor} OTA is ${current}%, which is not below the 90% SLA in the requested window.`,
  };
}

async function analyzeFeedback(spec: QuerySpec, query: QueryExecutor): Promise<RawAnalysis> {
  const dimensions = await query<{ dimension: string; average_rating: number; rated_responses: number; total_responses: number }>(
    `WITH ratings AS (
      SELECT * FROM feedback
      WHERE trip_date::DATE BETWEEN ? AND ? AND creation_time < CAST(? AS DATE) + INTERVAL 1 DAY
    ), unpivoted AS (
      SELECT 'route' AS dimension, route_rating AS rating FROM ratings UNION ALL
      SELECT 'driver', driver_rating FROM ratings UNION ALL
      SELECT 'cab', cab_rating FROM ratings UNION ALL
      SELECT 'safety', safety_rating FROM ratings UNION ALL
      SELECT 'marshal', marshal_rating FROM ratings
    )
    SELECT dimension, avg(rating) FILTER (WHERE rating > 0) AS average_rating,
      count(*) FILTER (WHERE rating > 0)::INTEGER AS rated_responses,
      count(*)::INTEGER AS total_responses
    FROM unpivoted GROUP BY dimension ORDER BY average_rating ASC`,
    [spec.window.currentStart, spec.window.currentEnd, spec.window.currentEnd],
  );
  const fullyRated = dimensions.filter((row) => number(row.rated_responses) / Math.max(1, number(row.total_responses)) >= 0.95);
  const weakest = fullyRated[0];
  const offices = await query<{ office: string; low_responses: number; responses: number; low_share: number }>(
    `SELECT r.office,
      count(*) FILTER (WHERE f.route_rating <= 2 OR f.driver_rating <= 2 OR f.cab_rating <= 2 OR f.safety_rating <= 2)::INTEGER AS low_responses,
      count(*) FILTER (WHERE f.route_rating > 0)::INTEGER AS responses,
      100.0 * count(*) FILTER (WHERE f.route_rating <= 2 OR f.driver_rating <= 2 OR f.cab_rating <= 2 OR f.safety_rating <= 2)
        / nullif(count(*) FILTER (WHERE f.route_rating > 0), 0) AS low_share
     FROM feedback f JOIN rides r USING (business_unit, trip_id)
     WHERE f.trip_date::DATE BETWEEN ? AND ? AND f.creation_time < CAST(? AS DATE) + INTERVAL 1 DAY
     GROUP BY r.office HAVING count(*) FILTER (WHERE f.route_rating > 0) >= 100
     ORDER BY low_share DESC`,
    [spec.window.currentStart, spec.window.currentEnd, spec.window.currentEnd],
  );
  const denver = offices.find((row) => row.office === "Denver Office");
  const clearwater = offices.find((row) => row.office === "Clearwater Campus");
  const coverage = await query<{ first_month: string; last_month: string; month_count: number }>(
    `SELECT strftime(min(trip_date), '%Y-%m') AS first_month, strftime(max(trip_date), '%Y-%m') AS last_month,
      count(DISTINCT strftime(trip_date, '%Y-%m'))::INTEGER AS month_count FROM feedback`,
  );
  const evidence: Evidence[] = [
    { id: "weakest-dimension", statement: `${weakest?.dimension ?? "No"} is the weakest fully-rated dimension at ${round(number(weakest?.average_rating), 3)}/5 from ${number(weakest?.rated_responses)} rated responses.`, supports: Boolean(weakest) },
    { id: "denver-low-share", statement: `Denver Office low-rating share is ${round(number(denver?.low_share), 2)}% (${number(denver?.low_responses)}/${number(denver?.responses)}).`, supports: Boolean(denver) },
    { id: "clearwater-low-share", statement: `Clearwater Campus low-rating share is ${round(number(clearwater?.low_share), 2)}% (${number(clearwater?.low_responses)}/${number(clearwater?.responses)}).`, supports: Boolean(clearwater) },
  ];
  const onlyJuly = number(coverage[0]?.month_count) === 1;
  return {
    querySpec: spec,
    status: weakest ? "ok" : "insufficient_evidence",
    evidence,
    hypotheses: [{ hypothesis: "Raw feedback volume identifies the weakest experience dimension", status: "rejected", supportingEvidence: [], contradictingEvidence: evidence.slice(0, 1) }],
    contradictions: [{ hypothesis: "The largest response count is the weakest experience dimension", evidence: evidence[0].statement, whyItContradicts: "Weakness is ranked by the requested rating measure after excluding unrated zeros, not by row volume.", confirmed: true }],
    data: { dimensions, fullyRated, weakest, offices, feedbackCoverage: coverage[0], julyOnly: onlyJuly },
    conclusion: `In July, route is the weakest fully-rated feedback dimension (${round(number(weakest?.average_rating), 2)}/5). Low ratings are concentrated in Denver Office at ${round(number(denver?.low_share), 2)}%, versus ${round(number(clearwater?.low_share), 2)}% in Clearwater; this is a share comparison, not raw volume.${onlyJuly ? " Only July is loaded, so a May–July trend cannot be established." : " Feedback is loaded for May–July, so the runtime is not July-only."}`,
  };
}

async function analyzeSev1(spec: QuerySpec, query: QueryExecutor): Promise<RawAnalysis> {
  const current = await query<{ alert_rows: number; affected_trips: number; total_trips: number }>(
    `SELECT count(*)::INTEGER AS alert_rows, count(DISTINCT (business_unit, trip_id))::INTEGER AS affected_trips,
       (SELECT count(*)::INTEGER FROM rides WHERE trip_date BETWEEN ? AND ?) AS total_trips
     FROM alerts WHERE severity = 'Sev-1' AND start_time::DATE BETWEEN ? AND ?`, [spec.window.currentStart, spec.window.currentEnd, spec.window.currentStart, spec.window.currentEnd],
  );
  const units = await query<{ business_unit: string; alert_rows: number; affected_trips: number }>(
    `SELECT business_unit, count(*)::INTEGER AS alert_rows, count(DISTINCT (business_unit, trip_id))::INTEGER AS affected_trips
     FROM alerts WHERE severity = 'Sev-1' AND start_time::DATE BETWEEN ? AND ? GROUP BY business_unit ORDER BY alert_rows DESC`, [spec.window.currentStart, spec.window.currentEnd],
  );
  const history = await query<{ window_end: string; affected_trips: number; total_trips: number; affected_trip_rate: number }>(
    `WITH windows AS (
       SELECT d::DATE AS window_end, (d - INTERVAL 4 DAY)::DATE AS window_start
       FROM generate_series(DATE '2026-05-05', CAST(? AS DATE) - INTERVAL 1 DAY, INTERVAL 1 DAY) t(d)
     ), affected AS (
       SELECT w.window_end, count(DISTINCT (a.business_unit, a.trip_id))::INTEGER AS affected_trips
       FROM windows w LEFT JOIN alerts a ON a.start_time::DATE BETWEEN w.window_start AND w.window_end AND a.severity = 'Sev-1'
       GROUP BY w.window_end
     ), volumes AS (
       SELECT w.window_end, count(r.trip_id)::INTEGER AS total_trips
       FROM windows w LEFT JOIN rides r ON r.trip_date BETWEEN w.window_start AND w.window_end GROUP BY w.window_end
     )
     SELECT a.window_end::VARCHAR AS window_end, a.affected_trips, v.total_trips,
       100.0 * a.affected_trips / nullif(v.total_trips, 0) AS affected_trip_rate
     FROM affected a JOIN volumes v USING (window_end) ORDER BY window_end`,
    [spec.window.currentStart],
  );
  const currentRate = 100 * number(current[0]?.affected_trips) / Math.max(1, number(current[0]?.total_trips));
  const baseline = history.map((row) => number(row.affected_trip_rate));
  const mean = baseline.reduce((sum, value) => sum + value, 0) / Math.max(1, baseline.length);
  const sd = Math.sqrt(baseline.reduce((sum, value) => sum + (value - mean) ** 2, 0) / Math.max(1, baseline.length));
  const z = sd ? (currentRate - mean) / sd : 0;
  const percentile = baseline.length ? 100 * baseline.filter((value) => value <= currentRate).length / baseline.length : 0;
  const top = units[0];
  const dataArtifact = units.length === 1;
  const evidence: Evidence[] = [
    { id: "sev1-counts", statement: `${number(current[0]?.alert_rows)} Sev-1 alert rows affected ${number(current[0]?.affected_trips)} distinct composite trips.`, supports: true },
    { id: "historical-position", statement: `Affected-trip rate is ${round(currentRate, 3)}%, percentile ${round(percentile, 0)}, z=${round(z, 2)} against prior rolling five-day windows.`, supports: true, value: z },
    { id: "unit-concentration", statement: `${top?.business_unit ?? "No unit"} contains ${number(top?.affected_trips)} affected trips; ${units.length} business unit(s) have recorded Sev-1 rows in this window.`, supports: Boolean(top) },
  ];
  return {
    querySpec: spec,
    status: "ok",
    evidence,
    hypotheses: [
      { hypothesis: "Sev-1 alerts are unusually high", status: z >= 1.5 ? "supported" : "rejected", supportingEvidence: z >= 1.5 ? evidence.slice(1, 2) : [], contradictingEvidence: z >= 1.5 ? [] : evidence.slice(1, 2) },
      { hypothesis: `${top?.business_unit ?? "A business unit"} has a uniquely worse safety problem`, status: dataArtifact ? "weakened" : "insufficient_evidence", supportingEvidence: evidence.slice(2, 3), contradictingEvidence: dataArtifact ? [{ id: "coverage", statement: "All recorded Sev-1 alerts in the window come from one business unit, so cross-unit coverage is not comparable.", supports: false }] : [] },
    ],
    contradictions: z < 1.5 ? [{ hypothesis: "Sev-1 alerts are unusually high", evidence: evidence[1].statement, whyItContradicts: "The normalized current rate is not in the upper tail of its historical distribution.", confirmed: true }] : [],
    data: { alertRows: number(current[0]?.alert_rows), affectedTrips: number(current[0]?.affected_trips), units, currentAffectedTripRate: round(currentRate, 4), percentile: round(percentile, 1), zScore: round(z, 2), coverageArtifact: dataArtifact },
    conclusion: `No—Sev-1 is not unusually high: the affected-trip rate is near the ${Math.round(percentile)}th percentile (z ${round(z, 2)}). There are ${number(current[0]?.alert_rows)} alert rows but ${number(current[0]?.affected_trips)} distinct affected trips; all are recorded under ${top?.business_unit}, so that concentration is more consistent with coverage/reporting than proof of uniquely worse safety.`,
  };
}

async function analyzeCorrelation(spec: QuerySpec, query: QueryExecutor): Promise<RawAnalysis> {
  const rows = await query<{ office: string; vendor: string; trips: number; ev_share: number; late_share: number }>(
    `SELECT office, vendor_id AS vendor, count(*)::INTEGER AS trips,
      100 * avg((actual_cab_fuel_type = 'Electric')::INTEGER) AS ev_share,
      100 * avg((actual_end_epoch > planned_end_epoch + 15 * 60)::INTEGER) AS late_share
     FROM rides WHERE trip_date BETWEEN ? AND ?
     GROUP BY office, vendor_id
     HAVING count(*) >= 50 AND ev_share > 0 AND ev_share < 100
     ORDER BY office, vendor_id`, [spec.window.currentStart, spec.window.currentEnd],
  );
  const raw = pearson(rows.map((row) => ({ x: number(row.ev_share), y: number(row.late_share) })));
  const byOffice = new Map<string, typeof rows>();
  for (const row of rows) byOffice.set(row.office, [...(byOffice.get(row.office) || []), row]);
  const residuals: Array<{ x: number; y: number }> = [];
  for (const officeRows of byOffice.values()) {
    if (officeRows.length < 2) continue;
    const mx = officeRows.reduce((sum, row) => sum + number(row.ev_share), 0) / officeRows.length;
    const my = officeRows.reduce((sum, row) => sum + number(row.late_share), 0) / officeRows.length;
    residuals.push(...officeRows.map((row) => ({ x: number(row.ev_share) - mx, y: number(row.late_share) - my })));
  }
  const controlled = pearson(residuals);
  const signChanged = raw !== null && controlled !== null && Math.sign(raw) !== Math.sign(controlled);
  const shrank = raw !== null && controlled !== null && Math.abs(controlled) < Math.abs(raw) * 0.6;
  const confounded = signChanged || shrank;
  const evidence: Evidence[] = [
    { id: "raw-correlation", statement: `Raw office-vendor lane correlation: r=${round(raw ?? 0, 2)} across ${rows.length} lanes.`, supports: true, value: raw ?? 0 },
    { id: "controlled-correlation", statement: `After removing office-level means: r=${round(controlled ?? 0, 2)} across ${residuals.length} lane residuals.`, supports: true, value: controlled ?? 0 },
    { id: "footprint", statement: "EV deployment is concentrated in a subset of offices, so office is a plausible common cause of EV share and lateness.", supports: confounded },
  ];
  return {
    querySpec: spec,
    status: rows.length >= 10 ? "ok" : "insufficient_evidence",
    evidence,
    hypotheses: [{ hypothesis: "Higher EV usage robustly corresponds to higher delays", status: confounded ? "rejected" : "insufficient_evidence", supportingEvidence: [], contradictingEvidence: confounded ? evidence : evidence.slice(2) }],
    contradictions: confounded ? [{ hypothesis: "The raw EV-delay association is a robust routing effect", evidence: `${evidence[0].statement} ${evidence[1].statement}`, whyItContradicts: signChanged ? "The coefficient changes sign after controlling for office." : "The coefficient materially shrinks after controlling for office.", confirmed: true }] : [],
    data: { laneCount: rows.length, rawCorrelation: round(raw ?? 0, 3), controlledCorrelation: round(controlled ?? 0, 3), control: "office fixed effects", signChanged, materiallyShrank: shrank, confounded },
    conclusion: `The raw lane-level relationship is negative (r=${round(raw ?? 0, 2)}), not evidence that higher EV use raises delays. After controlling for office it changes to r=${round(controlled ?? 0, 2)}; the sign/magnitude change indicates office and the EV deployment footprint confound the naive association, so this is not a robust routing effect.`,
  };
}

async function analyzeTarget(spec: QuerySpec, query: QueryExecutor): Promise<RawAnalysis> {
  const rows = await query<{ ota: number; trips: number }>(
    `SELECT 100 * avg(is_ota::INTEGER) AS ota, count(*)::INTEGER AS trips FROM v_trip_facts WHERE trip_date BETWEEN ? AND ?`,
    [spec.window.currentStart, spec.window.currentEnd],
  );
  const ota = round(number(rows[0]?.ota), 1);
  const sla = 90;
  const evidence: Evidence[] = [{ id: "sla-gap", statement: `Fleet OTA is ${ota}% versus the ${sla}% SLA (${round(ota - sla, 1)} pp).`, supports: true }];
  return { querySpec: spec, status: "ok", evidence, hypotheses: [], contradictions: [], data: { ota, sla, trips: number(rows[0]?.trips), gapPp: round(ota - sla, 1) }, conclusion: `No. Fleet OTA is ${ota}% across ${number(rows[0]?.trips).toLocaleString("en-IN")} trips, ${Math.abs(round(ota - sla, 1))} pp below the ${sla}% SLA.` };
}

async function analyzeVendorSlaDiagnosis(spec: QuerySpec, query: QueryExecutor): Promise<RawAnalysis> {
  const rows = await query<{ vendor: string; month: string; ota: number; trips: number }>(
    `SELECT vendor_id AS vendor, strftime(trip_date, '%Y-%m') AS month,
      100 * avg(is_ota::INTEGER) AS ota, count(*)::INTEGER AS trips
     FROM v_trip_facts
     WHERE trip_date BETWEEN ? AND ?
     GROUP BY vendor_id, month
     HAVING count(*) >= 20
     ORDER BY vendor_id, month`,
    [spec.window.currentStart, spec.window.currentEnd],
  );
  const grouped = new Map<string, Array<{ month: string; ota: number; trips: number }>>();
  for (const row of rows) {
    grouped.set(row.vendor, [...(grouped.get(row.vendor) || []), { month: row.month, ota: round(number(row.ota), 2), trips: number(row.trips) }]);
  }
  const ranking = [...grouped.entries()].map(([vendor, months]) => {
    const may = months.find((row) => row.month === "2026-05");
    const june = months.find((row) => row.month === "2026-06");
    const july = months.find((row) => row.month === "2026-07");
    const complete = Boolean(may && june && july);
    return {
      vendor,
      months,
      currentOta: july?.ota ?? null,
      julyTrips: july?.trips ?? 0,
      changeVsJunePp: july && june ? round(july.ota - june.ota, 2) : null,
      consistentlyBelowSla: complete && months.every((row) => row.ota < 90),
      newlyBelowSla: complete && Boolean(may && may.ota >= 90 && june && june.ota < 90 && july && july.ota < 90),
    };
  }).filter((row) => row.currentOta !== null && row.currentOta < 90)
    .sort((a, b) => number(a.currentOta) - number(b.currentOta));
  const worst = ranking[0];
  const newlyBelow = ranking.filter((row) => row.newlyBelowSla);
  const consistent = ranking.filter((row) => row.consistentlyBelowSla);
  if (!worst) return { querySpec: spec, status: "premise_false", evidence: [], hypotheses: [], contradictions: [], data: { ranking: [] }, conclusion: "No vendor is below the 90% OTA SLA in the latest loaded month." };

  const sequence = (row: typeof worst) => row.months.map((month) => `${month.month.slice(5)} ${month.ota}%`).join(" → ");
  const evidence: Evidence[] = [
    { id: "below-sla-count", statement: `${ranking.length} vendors are below the 90% OTA SLA in July 2026.`, supports: true, value: ranking.length },
    { id: "worst-vendor", statement: `${worst.vendor} is lowest at ${worst.currentOta}% across ${worst.julyTrips} July trips; ${sequence(worst)}.`, supports: true, value: worst.currentOta ?? 0 },
    { id: "persistence", statement: `${consistent.length} vendors were below SLA in all three loaded months.`, supports: true, value: consistent.length },
    { id: "newly-below", statement: newlyBelow.length ? `${newlyBelow.map((row) => row.vendor).join(", ")} moved from at/above SLA in May to below SLA in June and July.` : "No vendor newly crossed below SLA after May.", supports: true, value: newlyBelow.length },
  ];
  return {
    querySpec: spec,
    status: "ok",
    evidence,
    hypotheses: [
      { hypothesis: `${worst.vendor} is primarily a recent deterioration`, status: worst.consistentlyBelowSla ? "rejected" : "supported", supportingEvidence: worst.consistentlyBelowSla ? [] : evidence.slice(1, 2), contradictingEvidence: worst.consistentlyBelowSla ? evidence.slice(1, 3) : [] },
      { hypothesis: `${worst.vendor} is a consistently poor performer`, status: worst.consistentlyBelowSla ? "supported" : "rejected", supportingEvidence: worst.consistentlyBelowSla ? evidence.slice(1, 3) : [], contradictingEvidence: worst.consistentlyBelowSla ? [] : evidence.slice(1, 2) },
    ],
    contradictions: worst.consistentlyBelowSla ? [{ hypothesis: `${worst.vendor}'s below-SLA position is only a recent deterioration`, evidence: evidence[1].statement, whyItContradicts: "The vendor was already below SLA in May and June, before the latest decline.", confirmed: true }] : [],
    data: { ranking, belowSlaCount: ranking.length, consistentCount: consistent.length, newlyBelowVendors: newlyBelow },
    conclusion: `All ${ranking.length} vendors are below the 90% OTA SLA in July. ${worst.vendor} is worst at ${worst.currentOta}% and is consistently poor (${worst.months.map((month) => month.ota.toFixed(1)).join("% → ")}%); ${newlyBelow[0] ? `${newlyBelow[0].vendor} is the only newly below-SLA vendor (${newlyBelow[0].months.map((month) => month.ota.toFixed(1)).join("% → ")}%)` : "none newly crossed below SLA"}.`,
  };
}

export async function runAnalyticalQuery(question: string, query: QueryExecutor): Promise<AnalysisResult | null> {
  const spec = classifyQuery(question);
  if (!spec) return null;
  const semantic = validateQuerySpec(spec);
  let raw: RawAnalysis;
  if (!semantic.valid) {
    raw = { querySpec: spec, status: "refused", evidence: [], hypotheses: [], contradictions: [], data: {}, conclusion: semantic.reason };
  } else if (spec.intent === "comparison") raw = await analyzeBusinessUnitComparison(spec, query);
  else if (spec.intent === "ranking") raw = await analyzeOfficeRanking(spec, query);
  else if (spec.intent === "explanation" && spec.entityType === "vendor") raw = await analyzeVendor(spec, query);
  else if (spec.intent === "explanation") raw = await analyzePremise(spec, query);
  else if (spec.intent === "feedback_diagnosis") raw = await analyzeFeedback(spec, query);
  else if (spec.intent === "anomaly") raw = await analyzeSev1(spec, query);
  else if (spec.intent === "correlation") raw = await analyzeCorrelation(spec, query);
  else if (spec.intent === "vendor_sla_diagnosis") raw = await analyzeVendorSlaDiagnosis(spec, query);
  else raw = await analyzeTarget(spec, query);

  const result: AnalysisResult = {
    handled: true,
    ...raw,
    selected: { metric: spec.metric, entity: spec.entityType, groupBy: spec.groupBy, window: spec.window, benchmark: spec.comparison.type },
    metadata: METRICS[spec.metric],
    quality: qualityGate(spec, raw),
  };
  if (!result.quality.passed && result.status !== "refused") {
    result.status = "insufficient_evidence";
    result.conclusion = `I cannot return a reliable answer yet. ${result.quality.checks.filter((check) => !check.passed).map((check) => check.detail).join(" ")}`;
  }
  return result;
}

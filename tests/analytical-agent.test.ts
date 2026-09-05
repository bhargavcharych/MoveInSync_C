import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { DuckDBInstance, type DuckDBValue } from "@duckdb/node-api";
import { classifyQuery } from "../lib/agent/query-spec";
import { runAnalyticalQuery, type QueryExecutor } from "../lib/agent/analytical-engine";

const instancePromise = DuckDBInstance.fromCache(path.join(process.cwd(), "data", "moveinsync.duckdb"), {
  access_mode: "READ_ONLY",
  enable_external_access: "false",
});

const query: QueryExecutor = async <T extends Record<string, unknown>>(sql: string, values: unknown[] = []) => {
  const instance = await instancePromise;
  const connection = await instance.connect();
  try {
    const reader = await connection.runAndReadAll(sql, values as DuckDBValue[]);
    return reader.getRowObjectsJson() as T[];
  } finally {
    connection.closeSync();
  }
};

async function analyze(question: string) {
  const result = await runAnalyticalQuery(question, query);
  assert.ok(result, `Expected deterministic handling for: ${question}`);
  return result;
}

test("Q1 preserves a per-business-unit symmetric OTA comparison", async () => {
  const question = "How did OTA change for each business unit over the last 14 days versus the 14 days before that?";
  const spec = classifyQuery(question);
  assert.equal(spec?.metric, "ota");
  assert.deepEqual(spec?.groupBy, ["business_unit"]);
  assert.equal(spec?.comparison.enabled, true);
  assert.equal(spec?.comparison.type, "prior_period");
  assert.deepEqual(spec?.window, {
    label: "last 14 days versus previous 14 days",
    currentStart: "2026-07-18",
    currentEnd: "2026-07-31",
    comparisonStart: "2026-07-04",
    comparisonEnd: "2026-07-17",
  });
  const result = await analyze(question);
  const rows = result.data.comparison as Array<{ businessUnit: string; changePp: number }>;
  assert.equal(rows.length, 5);
  assert.ok(rows.some((row) => row.businessUnit === "vanta-Sea"));
  assert.ok(rows.some((row) => row.businessUnit === "vanta-Aus"));
  assert.match(result.conclusion, /vanta-Sea/);
  assert.match(result.conclusion, /vanta-Aus/);
  assert.match(result.conclusion, /equal 14-day windows/);
});

test("Q2 ranks the requested office dimension and exposes sample and persistence", async () => {
  const result = await analyze("Which office has the worst OTA?");
  const ranking = result.data.ranking as Array<{ office: string; ota: number; trips: number }>;
  assert.equal(result.selected.entity, "office");
  assert.equal(result.selected.metric, "ota");
  assert.equal(ranking[0].office, "San Jose Commons");
  assert.ok(ranking[0].trips >= 100);
  assert.match(result.conclusion, /^San Jose Commons has the worst OTA:/);
  assert.doesNotMatch(result.conclusion, /fleet aggregate/i);
});

test("Q3 rejects a false decline premise using structured evidence", async () => {
  const result = await analyze("Why did Denver OTA drop?");
  assert.equal(result.status, "premise_false");
  assert.ok(Number(result.data.changePp) > 0);
  assert.equal(result.contradictions.length, 1);
  assert.equal(result.contradictions[0].confirmed, true);
  assert.equal(result.hypotheses[0].status, "premise_false");
  assert.match(result.conclusion, /^The premise is false\./);
  assert.match(result.conclusion, /did not decline/);
});

test("Q4 selects SLA only for an explicit target question", async () => {
  const result = await analyze("Are we meeting the OTA target?");
  assert.equal(result.selected.benchmark, "sla");
  assert.equal(result.selected.metric, "ota");
  assert.match(result.conclusion, /90% SLA/);
});

test("vendor SLA question preserves vendor ranking and persistence intent", async () => {
  const question = "Which vendor is currently below the 90% OTA SLA, and is the problem a recent deterioration or a consistently poor performer?";
  const result = await analyze(question);
  const ranking = result.data.ranking as Array<{ vendor: string; currentOta: number; consistentlyBelowSla: boolean }>;
  assert.equal(result.querySpec.intent, "vendor_sla_diagnosis");
  assert.equal(result.selected.entity, "vendor");
  assert.deepEqual(result.selected.groupBy, ["vendor"]);
  assert.equal(result.selected.benchmark, "historical_trend");
  assert.equal(ranking[0].vendor, "Pooja Sokolov Travel");
  assert.equal(ranking[0].consistentlyBelowSla, true);
  assert.equal(result.data.belowSlaCount, 23);
  assert.match(result.conclusion, /All 23 vendors are below/);
  assert.match(result.conclusion, /Pooja Sokolov Travel is worst/);
  assert.match(result.conclusion, /consistently poor/);
  assert.match(result.conclusion, /Sneha Mikhailov Travel is the only newly below-SLA vendor/);
});

test("vendor SLA explanation tests trend, peer, reason-code conflict, and concentration", async () => {
  const result = await analyze("Why is Sneha Mikhailov Travel OTA low?");
  assert.equal(result.selected.entity, "vendor");
  assert.equal(result.querySpec.entityFilter?.value, "sneha mikhailov travel");
  assert.ok(Number(result.data.currentOta) < 90);
  assert.ok(Number(result.data.currentOta) > Number(result.data.peerOta));
  assert.ok(result.contradictions.some((row) => row.confirmed && /reason/i.test(row.hypothesis)));
  assert.match(result.conclusion, /below SLA but .*above the fleet peer/);
  assert.match(result.conclusion, /does not prove an operational cause/);
});

test("Q5 ranks feedback by rating measure and reports office shares", async () => {
  const result = await analyze("What is the employee-feedback problem in July?");
  const weakest = result.data.weakest as { dimension: string };
  const offices = result.data.offices as Array<{ office: string; low_share: number }>;
  assert.equal(weakest.dimension, "route");
  assert.equal(Number(offices.find((row) => row.office === "Denver Office")?.low_share.toFixed(2)), 9.06);
  assert.equal(Number(offices.find((row) => row.office === "Clearwater Campus")?.low_share.toFixed(2)), 0.64);
  assert.equal(result.selected.groupBy.includes("office"), true);
  assert.match(result.conclusion, /route is the weakest fully-rated feedback dimension/i);
  assert.match(result.conclusion, /Denver Office/);
  assert.match(result.conclusion, /Clearwater/);
  assert.match(result.conclusion, /share comparison, not raw volume/);
});

test("Q6 distinguishes alert rows from affected trips and qualifies concentration", async () => {
  const result = await analyze("Are the Sev-1 alerts unusually high, and which business unit is driving them?");
  assert.equal(result.data.alertRows, 44);
  assert.equal(result.data.affectedTrips, 34);
  assert.equal((result.data.units as Array<{ business_unit: string }>)[0].business_unit, "catalyst-Sac");
  assert.equal(result.data.coverageArtifact, true);
  assert.ok(Number(result.data.percentile) >= 30 && Number(result.data.percentile) <= 40);
  assert.ok(Number(result.data.zScore) < -0.4 && Number(result.data.zScore) > -0.7);
  assert.match(result.conclusion, /44 alert rows but 34 distinct affected trips/);
  assert.match(result.conclusion, /coverage\/reporting/);
});

test("Q7 refuses driver OTA rather than substituting driver rating", async () => {
  const result = await analyze("Which driver has the worst on-time record?");
  assert.equal(result.status, "refused");
  assert.equal(result.quality.passed, true);
  assert.equal(result.selected.entity, "driver");
  assert.equal(result.selected.metric, "ota");
  assert.match(result.conclusion, /does not provide a reliable driver-level OTA dimension/);
  assert.match(result.conclusion, /driver rating/i);
});

test("Q8 compares raw and office-controlled EV-delay association", async () => {
  const result = await analyze("Does higher EV usage correspond to higher delays?");
  assert.ok(Number(result.data.rawCorrelation) < 0);
  assert.ok(Number(result.data.controlledCorrelation) > 0);
  assert.equal(result.data.confounded, true);
  assert.equal(result.contradictions[0].confirmed, true);
  assert.match(result.conclusion, /controlling for office/);
  assert.match(result.conclusion, /confound/);
  assert.match(result.conclusion, /not a robust routing effect/);
});

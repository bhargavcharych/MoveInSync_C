import path from "node:path";
import { DuckDBInstance, type DuckDBValue } from "@duckdb/node-api";
import { runAnalyticalQuery, type QueryExecutor } from "../lib/agent/analytical-engine";

const questions = [
  "How did OTA change for each business unit over the last 14 days versus the 14 days before that?",
  "Which office has the worst OTA?",
  "Why did Denver OTA drop?",
  "Are we meeting the OTA target?",
  "What is the employee-feedback problem in July?",
  "Are the Sev-1 alerts unusually high, and which business unit is driving them?",
  "Which driver has the worst on-time record?",
  "Does higher EV usage correspond to higher delays?",
];

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

async function main() {
  for (const [index, question] of questions.entries()) {
    const result = await runAnalyticalQuery(question, query);
    console.log(`\nQ${index + 1}: ${question}`);
    if (!result) {
      console.log("UNHANDLED");
      continue;
    }
    console.log("QuerySpec:", JSON.stringify(result.querySpec));
    console.log("Selected:", JSON.stringify(result.selected));
    console.log("Evidence:", JSON.stringify(result.evidence));
    console.log("Quality:", JSON.stringify(result.quality));
    console.log("Conclusion:", result.conclusion);
  }
}

void main();

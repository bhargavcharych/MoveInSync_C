import "server-only";

import { query } from "@/lib/db";
import { runAnalyticalQuery, type QueryExecutor } from "./analytical-engine";

const execute: QueryExecutor = (sql, values = []) => query(sql, values as never[]);

export function runDeterministicAgent(question: string) {
  return runAnalyticalQuery(question, execute);
}


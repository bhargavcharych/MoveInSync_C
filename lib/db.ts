import "server-only";

import { access } from "node:fs/promises";
import path from "node:path";
import { DuckDBInstance, type DuckDBValue } from "@duckdb/node-api";

let instancePromise: Promise<DuckDBInstance> | undefined;

function databasePath() {
  const localDatabase = path.join(process.cwd(), "data", "moveinsync.duckdb");
  return process.env.DUCKDB_PATH
    ? path.resolve(/* turbopackIgnore: true */ process.env.DUCKDB_PATH)
    : localDatabase;
}

async function getInstance() {
  if (!instancePromise) {
    const dbPath = databasePath();
    await access(dbPath);
    instancePromise = DuckDBInstance.fromCache(dbPath, {
      access_mode: "READ_ONLY",
      threads: "4",
      enable_external_access: "false",
    });
  }
  return instancePromise;
}

export async function query<T extends Record<string, unknown>>(
  sql: string,
  values: DuckDBValue[] = [],
): Promise<T[]> {
  if (!/^\s*(select|with|from|describe|show)\b/i.test(sql)) {
    throw new Error("The analytics connection only accepts read-only statements.");
  }
  const instance = await getInstance();
  const connection = await instance.connect();
  try {
    const reader = await connection.runAndReadAll(sql, values);
    return reader.getRowObjectsJson() as T[];
  } finally {
    connection.closeSync();
  }
}

export function dbInfo() {
  return { path: databasePath(), mode: "READ_ONLY" as const };
}

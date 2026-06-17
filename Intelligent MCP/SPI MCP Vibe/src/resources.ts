import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { MetricCatalog, MetricDefinition } from "./types.js";

const root = resolve(process.cwd(), "resources");

/** Snowflake database prefix — set via SNOWFLAKE_DATABASE env var */
function dbPrefix(): string {
  return process.env.SNOWFLAKE_DATABASE ?? "{DB}";
}

/** Replace the {DB} token in any SQL string with the real database name */
export function resolveDb(sql: string): string {
  return sql.replaceAll("{DB}", dbPrefix());
}

export async function loadMetricCatalog(): Promise<MetricCatalog> {
  const raw = await readFile(resolve(root, "metric_mappings.json"), "utf8");
  const catalog = JSON.parse(raw) as MetricCatalog;
  // Resolve {DB} tokens in all sqlTemplate and sourceTable fields
  catalog.metrics = catalog.metrics.map((m: MetricDefinition) => ({
    ...m,
    sourceTable: resolveDb(m.sourceTable),
    sqlTemplate: resolveDb(m.sqlTemplate),
  }));
  return catalog;
}

export async function loadColumnDictionary(): Promise<Record<string, unknown>> {
  const raw = await readFile(resolve(root, "column_dictionary.json"), "utf8");
  return JSON.parse(raw) as Record<string, unknown>;
}

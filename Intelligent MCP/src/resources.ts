import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type {
  ContextAssetIndex,
  MetricCatalog,
  MetricContextRegistry,
  MetricRegressionSpec,
  MetricScenarioCatalog
} from "./types.js";

const metricsPrimaryPath = resolve(process.cwd(), "resources/metric_mappings.json");
const metricsFallbackPath = resolve(process.cwd(), "resources/metric_mappings.example.json");
const columnsPrimaryPath = resolve(process.cwd(), "resources/column_dictionary.json");
const columnsFallbackPath = resolve(process.cwd(), "resources/column_dictionary.example.json");
const contextRegistryPath = resolve(process.cwd(), "resources/context_registry.json");
const regressionSpecPath = resolve(process.cwd(), "resources/metric_regression_checks.json");
const scenarioCatalogPath = resolve(process.cwd(), "resources/metric_scenarios.json");
const contextAssetIndexPath = resolve(process.cwd(), "resources/context_assets_index.json");

export async function loadMetricCatalog(): Promise<MetricCatalog> {
  const raw = await readWithFallback(metricsPrimaryPath, metricsFallbackPath);
  const parsed = JSON.parse(raw) as MetricCatalog;
  if (!Array.isArray(parsed.metrics) && Array.isArray(parsed.metric_definitions)) {
    parsed.metrics = parsed.metric_definitions
      .filter((m) => typeof m.snowflake_sql === "string" && m.snowflake_sql.trim().length > 0)
      .map((m) => ({
        id: m.id,
        name: m.name,
        description: m.description ?? "",
        sourceTable: "UNKNOWN",
        grain: "quarter",
        dimensions: [],
        sqlTemplate: m.snowflake_sql ?? "",
        crmaFields: {},
        snowflakeColumns: {}
      }));
  }
  return parsed;
}

export async function loadColumnDictionary(): Promise<Record<string, string>> {
  const raw = await readWithFallback(columnsPrimaryPath, columnsFallbackPath);
  return JSON.parse(raw) as Record<string, string>;
}

export async function loadContextRegistry(): Promise<MetricContextRegistry> {
  const raw = await readFile(contextRegistryPath, "utf8");
  return JSON.parse(raw) as MetricContextRegistry;
}

export async function loadMetricRegressionSpec(): Promise<MetricRegressionSpec> {
  const raw = await readFile(regressionSpecPath, "utf8");
  return JSON.parse(raw) as MetricRegressionSpec;
}

export async function loadMetricScenarioCatalog(): Promise<MetricScenarioCatalog> {
  const raw = await readFile(scenarioCatalogPath, "utf8");
  return JSON.parse(raw) as MetricScenarioCatalog;
}

export async function loadContextAssetIndex(): Promise<ContextAssetIndex> {
  const raw = await readFile(contextAssetIndexPath, "utf8");
  return JSON.parse(raw) as ContextAssetIndex;
}

async function readWithFallback(primaryPath: string, fallbackPath: string): Promise<string> {
  try {
    return await readFile(primaryPath, "utf8");
  } catch {
    return await readFile(fallbackPath, "utf8");
  }
}

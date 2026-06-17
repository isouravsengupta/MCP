import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
const metricsPrimaryPath = resolve(process.cwd(), "resources/metric_mappings.json");
const metricsFallbackPath = resolve(process.cwd(), "resources/metric_mappings.example.json");
const columnsPrimaryPath = resolve(process.cwd(), "resources/column_dictionary.json");
const columnsFallbackPath = resolve(process.cwd(), "resources/column_dictionary.example.json");
const contextRegistryPath = resolve(process.cwd(), "resources/context_registry.json");
const regressionSpecPath = resolve(process.cwd(), "resources/metric_regression_checks.json");
const scenarioCatalogPath = resolve(process.cwd(), "resources/metric_scenarios.json");
const contextAssetIndexPath = resolve(process.cwd(), "resources/context_assets_index.json");
const dashboardLensCatalogPath = resolve(process.cwd(), "resources/dashboard_lens_catalog.json");
const dashboardDatasetRegistryPath = resolve(process.cwd(), "resources/dashboard_dataset_registry.json");
const formulaMetricsPath = resolve(process.cwd(), "resources/formula_metrics.json");
const semanticCatalogPath = resolve(process.cwd(), "resources/semantic_catalog.json");
export async function loadMetricCatalog() {
    const raw = await readWithFallback(metricsPrimaryPath, metricsFallbackPath);
    const parsed = JSON.parse(raw);
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
export async function loadColumnDictionary() {
    const raw = await readWithFallback(columnsPrimaryPath, columnsFallbackPath);
    return JSON.parse(raw);
}
export async function loadContextRegistry() {
    const raw = await readFile(contextRegistryPath, "utf8");
    return JSON.parse(raw);
}
export async function loadMetricRegressionSpec() {
    const raw = await readFile(regressionSpecPath, "utf8");
    return JSON.parse(raw);
}
export async function loadMetricScenarioCatalog() {
    const raw = await readFile(scenarioCatalogPath, "utf8");
    return JSON.parse(raw);
}
export async function loadContextAssetIndex() {
    const raw = await readFile(contextAssetIndexPath, "utf8");
    return JSON.parse(raw);
}
export async function loadDashboardLensCatalog() {
    const raw = await readFile(dashboardLensCatalogPath, "utf8");
    return JSON.parse(raw);
}
export async function loadDashboardDatasetRegistry() {
    const raw = await readFile(dashboardDatasetRegistryPath, "utf8");
    return JSON.parse(raw);
}
export async function loadFormulaMetrics() {
    const raw = await readFile(formulaMetricsPath, "utf8");
    return JSON.parse(raw);
}
export async function loadSemanticCatalog() {
    const raw = await readFile(semanticCatalogPath, "utf8");
    return JSON.parse(raw);
}
async function readWithFallback(primaryPath, fallbackPath) {
    try {
        return await readFile(primaryPath, "utf8");
    }
    catch {
        return await readFile(fallbackPath, "utf8");
    }
}

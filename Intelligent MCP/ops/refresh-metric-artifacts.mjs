#!/usr/bin/env node
import { promises as fs } from "node:fs";
import path from "node:path";

const baseDir = process.env.BASE_DIR ?? "/Users/sourav.sengupta/Documents/GitHub/Personal";
const spiDir = process.env.SPI_MCP_DIR ?? path.join(baseDir, "spi-mcp");
const resourcesDir = path.join(spiDir, "resources");

const lensCatalogPath = path.join(resourcesDir, "dashboard_lens_catalog.json");
const datasetRegistryPath = path.join(resourcesDir, "dashboard_dataset_registry.json");
const metricMappingsPath = path.join(resourcesDir, "metric_mappings.json");
const scenarioPath = path.join(resourcesDir, "metric_scenarios.json");
const formulaMetricPath = path.join(resourcesDir, "formula_metrics.json");
const intakeQueuePath = path.join(resourcesDir, "metric_intake_queue.json");
const semanticCatalogPath = path.join(resourcesDir, "semantic_catalog.json");

function readJson(filePath) {
  return fs.readFile(filePath, "utf8").then((raw) => JSON.parse(raw));
}

function writeJson(filePath, value) {
  return fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function normalizeDatasetName(name) {
  return String(name ?? "")
    .trim()
    .toLowerCase();
}

function slugify(input) {
  return String(input ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function estimateSourceTable(datasetName, datasetRegistry) {
  const ds = datasetRegistry.datasets.find((entry) => normalizeDatasetName(entry.dataset) === normalizeDatasetName(datasetName));
  const candidate = ds?.table_candidates?.[0];
  return typeof candidate === "string" && candidate.length > 0 ? candidate : "UNKNOWN";
}

function toMetricsFromDefinitions(definitions) {
  return definitions
    .filter((def) => typeof def?.id === "string" && typeof def?.snowflake_sql === "string" && def.snowflake_sql.trim().length > 0)
    .map((def) => ({
      id: def.id,
      name: def.name ?? def.id,
      description: def.description ?? "",
      sourceTable: "UNKNOWN",
      grain: "quarter",
      dimensions: [],
      sqlTemplate: def.snowflake_sql,
      crmaFields: {},
      snowflakeColumns: {}
    }));
}

function buildScenarioStub(metric) {
  const sourceTable = String(metric?.sourceTable ?? "");
  const looksForecast = /forecast/i.test(sourceTable) || /forecast/i.test(metric?.id ?? "");
  const valueColumn = looksForecast ? "FORECAST_AMT" : "CLOUD_AMT";
  const yearColumn = looksForecast ? "FISCAL_CMPGN_STRT_YEAR" : "FISCAL_FLIP_YEAR";
  return {
    metric_id: metric.id,
    value_column: valueColumn,
    year_column: yearColumn,
    fixed_filters: {},
    groupable_dimensions: {
      fiscal_year: yearColumn
    },
    status: "needs_review"
  };
}

async function main() {
  const [lensCatalog, datasetRegistry, metricMappings, scenarioCatalog, formulaMetrics] = await Promise.all([
    readJson(lensCatalogPath),
    readJson(datasetRegistryPath),
    readJson(metricMappingsPath),
    readJson(scenarioPath),
    readJson(formulaMetricPath).catch(() => ({ metrics: [] }))
  ]);

  const lenses = Array.isArray(lensCatalog?.lenses) ? lensCatalog.lenses : [];
  const discoveredDatasets = [...new Set(lenses.flatMap((l) => (Array.isArray(l?.datasets) ? l.datasets : [])).filter(Boolean))].sort();

  // 1) Keep dataset registry in sync with new CRMA datasets.
  const existingDatasetNames = new Set(datasetRegistry.datasets.map((d) => normalizeDatasetName(d.dataset)));
  for (const dataset of discoveredDatasets) {
    if (existingDatasetNames.has(normalizeDatasetName(dataset))) {
      continue;
    }
    datasetRegistry.datasets.push({
      dataset,
      table_candidates: [],
      preferred_dimensions: [],
      preferred_measures: [],
      status: "needs_mapping"
    });
  }
  datasetRegistry.datasets.sort((a, b) => String(a.dataset).localeCompare(String(b.dataset)));

  // 2) Keep `metrics` mirror synced from canonical `metric_definitions`.
  const definitions = Array.isArray(metricMappings.metric_definitions) ? metricMappings.metric_definitions : [];
  const generatedMetrics = toMetricsFromDefinitions(definitions);
  const generatedById = new Map(generatedMetrics.map((m) => [m.id, m]));
  const existingMetrics = Array.isArray(metricMappings.metrics) ? metricMappings.metrics : [];
  const mergedMetrics = [];
  const seenMetricIds = new Set();
  for (const metric of existingMetrics) {
    if (!metric?.id) continue;
    const replacement = generatedById.get(metric.id);
    mergedMetrics.push(
      replacement
        ? {
            ...metric,
            ...replacement,
            sourceTable: metric.sourceTable ?? replacement.sourceTable,
            dimensions: Array.isArray(metric.dimensions) ? metric.dimensions : replacement.dimensions,
            crmaFields: metric.crmaFields ?? replacement.crmaFields,
            snowflakeColumns: metric.snowflakeColumns ?? replacement.snowflakeColumns
          }
        : metric
    );
    seenMetricIds.add(metric.id);
  }
  for (const metric of generatedMetrics) {
    if (!seenMetricIds.has(metric.id)) {
      mergedMetrics.push(metric);
    }
  }
  metricMappings.metrics = mergedMetrics.sort((a, b) => String(a.id).localeCompare(String(b.id)));

  // 3) Create intake queue for new dashboard lenses not yet represented as explicit metrics.
  const existingMetricIds = new Set(definitions.map((d) => d.id));
  const formulaMetricIds = new Set((formulaMetrics.metrics ?? []).map((m) => m.id));
  const queueItems = [];
  for (const lens of lenses) {
    const stepName = String(lens?.step_name ?? "");
    const datasets = Array.isArray(lens?.datasets) ? lens.datasets : [];
    const candidateId = `lens_${slugify(stepName)}`;
    if (!stepName || existingMetricIds.has(candidateId) || formulaMetricIds.has(candidateId)) {
      continue;
    }
    const primaryDataset = datasets[0] ?? null;
    queueItems.push({
      candidate_metric_id: candidateId,
      source_step: stepName,
      label: lens?.label ?? null,
      type: lens?.type ?? null,
      dataset_candidates: datasets,
      inferred_source_table: primaryDataset ? estimateSourceTable(primaryDataset, datasetRegistry) : "UNKNOWN",
      query_preview: lens?.query_preview ?? null,
      widgets: Array.isArray(lens?.widgets) ? lens.widgets : [],
      status: "needs_metric_definition"
    });
  }

  // 4) Track metrics missing adaptive scenarios.
  const existingScenarioMetricIds = new Set((scenarioCatalog.scenarios ?? []).map((s) => s.metric_id));
  const scenarioBacklog = [];
  for (const metric of metricMappings.metrics) {
    if (!metric?.id || existingScenarioMetricIds.has(metric.id)) continue;
    scenarioBacklog.push(buildScenarioStub(metric));
  }

  const intakePayload = {
    generated_at_utc: new Date().toISOString(),
    sources: {
      dashboard_lens_catalog: path.relative(spiDir, lensCatalogPath),
      metric_mappings: path.relative(spiDir, metricMappingsPath),
      dashboard_dataset_registry: path.relative(spiDir, datasetRegistryPath),
      metric_scenarios: path.relative(spiDir, scenarioPath)
    },
    counts: {
      lenses_total: lenses.length,
      datasets_discovered: discoveredDatasets.length,
      metric_definitions_total: definitions.length,
      formula_metrics_total: formulaMetricIds.size,
      intake_candidates: queueItems.length,
      scenarios_missing: scenarioBacklog.length
    },
    intake_candidates: queueItems,
    scenario_backlog: scenarioBacklog
  };

  const semanticCatalog = {
    version: "1.0.0",
    generated_at_utc: new Date().toISOString(),
    intents: [
      {
        id: "forecast_attainment",
        description: "Forecast attainment questions must use formula metric routing.",
        match_phrases: ["forecast attainment", "attainment percentage", "attainment %"],
        route_tool: "run_forecast_attainment",
        required_context: ["fiscal_year", "fiscal_quarter"]
      },
      {
        id: "opportunity_amount_lookup",
        description: "Opportunity-level amount lookup by opportunity id.",
        match_phrases: ["opportunity", "opty", "end amount", "amount for opportunity"],
        route_tool: "lookup_opportunity_amount",
        required_context: ["opportunity_id"]
      },
      {
        id: "spm_pipegen_forecast",
        description: "SPM pipegen forecast metric query route.",
        match_phrases: ["spm pipegen forecast", "pipegen forecast amount"],
        route_tool: "run_metric_query",
        default_arguments: { metric_id: "spm_pipegen_forecast_fy27_q1" }
      },
      {
        id: "spm_top_programs",
        description: "Top programs performance route.",
        match_phrases: ["top programs", "top performing programs", "spm performance metrics"],
        route_tool: "run_adaptive_metric_query",
        default_arguments: { metric_id: "spm_performance_top_programs_fy27" }
      }
    ],
    graph: {
      metrics: [
        ...definitions.map((d) => ({
          metric_id: d.id,
          dataset: d.crma_dataset ?? null,
          source_table: null,
          route_tool: "run_metric_query"
        })),
        ...(formulaMetrics.metrics ?? []).map((m) => ({
          metric_id: m.id,
          dataset: null,
          source_table: null,
          route_tool: "run_formula_metric"
        }))
      ],
      datasets: datasetRegistry.datasets.map((d) => ({
        dataset: d.dataset,
        table_candidates: d.table_candidates ?? []
      }))
    }
  };

  await Promise.all([
    writeJson(datasetRegistryPath, datasetRegistry),
    writeJson(metricMappingsPath, metricMappings),
    writeJson(intakeQueuePath, intakePayload),
    writeJson(semanticCatalogPath, semanticCatalog)
  ]);

  process.stdout.write(
    [
      `Refreshed dataset registry: ${datasetRegistry.datasets.length} datasets`,
      `Synced metric mappings: ${metricMappings.metrics.length} metrics`,
      `Metric intake queue: ${queueItems.length} candidates`,
      `Scenario backlog: ${scenarioBacklog.length} missing`,
      `Semantic catalog intents: ${semanticCatalog.intents.length}`
    ].join("\n") + "\n"
  );
}

await main();

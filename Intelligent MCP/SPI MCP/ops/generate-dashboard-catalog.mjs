#!/usr/bin/env node
import { promises as fs } from "node:fs";
import path from "node:path";

const baseDir = process.env.BASE_DIR ?? "/Users/sourav.sengupta/Documents/GitHub/Personal";
const dashboardPath =
  process.env.CRMA_DASHBOARD_PATH ??
  path.join(
    baseDir,
    "business_logic",
    "gsp_analytics",
    "gsp analytics CRMA",
    "Global SPM Performance Dashboard.json"
  );
const outputPath =
  process.env.DASHBOARD_CATALOG_PATH ?? path.join(baseDir, "spi-mcp", "resources", "dashboard_lens_catalog.json");

function extractDatasetsFromSaql(query) {
  if (typeof query !== "string") {
    return [];
  }
  const matches = [...query.matchAll(/load\s+"([^"]+)"/g)];
  return [...new Set(matches.map((m) => m[1]))];
}

async function main() {
  const raw = await fs.readFile(dashboardPath, "utf8");
  const dashboard = JSON.parse(raw);
  const steps = dashboard?.state?.steps ?? {};
  const widgets = dashboard?.state?.widgets ?? {};

  const widgetByStep = new Map();
  for (const [widgetName, widgetDef] of Object.entries(widgets)) {
    const step = widgetDef?.parameters?.step;
    if (!step) continue;
    if (!widgetByStep.has(step)) {
      widgetByStep.set(step, []);
    }
    widgetByStep.get(step).push(widgetName);
  }

  const lenses = [];
  for (const [stepName, stepDef] of Object.entries(steps)) {
    const query = stepDef?.query;
    const datasets = Array.isArray(stepDef?.datasets)
      ? [...new Set(stepDef.datasets.map((d) => d?.name).filter(Boolean))]
      : extractDatasetsFromSaql(query);
    const queryPreview = typeof query === "string" ? query.slice(0, 220) : undefined;
    lenses.push({
      step_name: stepName,
      label: stepDef?.label,
      type: stepDef?.type,
      datasets,
      query_preview: queryPreview,
      widgets: widgetByStep.get(stepName) ?? []
    });
  }

  lenses.sort((a, b) => a.step_name.localeCompare(b.step_name));
  const payload = {
    generated_at_utc: new Date().toISOString(),
    dashboard_file: dashboardPath,
    lenses
  };
  await fs.writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  process.stdout.write(`Wrote ${lenses.length} dashboard lenses to ${outputPath}\n`);
}

await main();

import test from "node:test";
import assert from "node:assert/strict";
import { loadContextRegistry, loadMetricCatalog, loadMetricRegressionSpec } from "../src/resources.js";

test("loadMetricCatalog includes core sales program metrics", async () => {
  const catalog = await loadMetricCatalog();
  const ids = new Set(catalog.metrics.map((m) => m.id));
  assert.equal(ids.has("spm_pipegen_cloud_fy27_q1"), true);
  assert.equal(ids.has("spm_pipegen_forecast_fy27_q1"), true);
});

test("context registry has expected source priority", async () => {
  const registry = await loadContextRegistry();
  assert.equal(registry.preferred_source_order[0], "crma_saql");
  assert.equal(registry.repositories.length > 0, true);
});

test("metric regression checks reference valid metric IDs", async () => {
  const catalog = await loadMetricCatalog();
  const ids = new Set(catalog.metrics.map((m) => m.id));
  const regressionSpec = await loadMetricRegressionSpec();
  for (const check of regressionSpec.checks) {
    assert.equal(ids.has(check.metric_id), true, `Unknown metric in regression check: ${check.metric_id}`);
  }
});

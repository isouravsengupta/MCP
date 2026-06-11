import test from "node:test";
import assert from "node:assert/strict";
import { buildAdaptiveQuery } from "../src/analysisPlanner.js";
import type { MetricScenarioCatalog } from "../src/types.js";

const catalog: MetricScenarioCatalog = {
  scenarios: [
    {
      metric_id: "m1",
      value_column: "CLOUD_AMT",
      year_column: "FISCAL_YEAR",
      fixed_filters: { PROGRAM_TEAM: "Sales Program" },
      groupable_dimensions: {
        region: "GEO_REGION",
        fiscal_year: "FISCAL_YEAR"
      }
    }
  ]
};

test("buildAdaptiveQuery creates grouped aggregate SQL", () => {
  const out = buildAdaptiveQuery({
    metricId: "m1",
    scenarioCatalog: catalog,
    sourceTable: "SSE_DM_GDSO_PRD.AIO.GSP_SPM_PIPEGEN",
    groupBy: ["region"],
    filters: { region: "EMEA" },
    topN: 10
  });
  assert.match(out.sqlText, /GROUP BY GEO_REGION/);
  assert.deepEqual(out.binds, ["Sales Program", "EMEA"]);
});

test("buildAdaptiveQuery creates YoY SQL", () => {
  const out = buildAdaptiveQuery({
    metricId: "m1",
    scenarioCatalog: catalog,
    sourceTable: "SSE_DM_GDSO_PRD.AIO.GSP_SPM_PIPEGEN",
    groupBy: ["region"],
    filters: {},
    includeYoy: true,
    fiscalYear: "2027"
  });
  assert.match(out.sqlText, /"Y\/Y"/);
  assert.deepEqual(out.binds.slice(-2), ["2027", "2026"]);
});

import test from "node:test";
import assert from "node:assert/strict";
import { buildVisualizationPayload } from "../src/visualization.js";

test("single row with YoY prefers KPI component", () => {
  const payload = buildVisualizationPayload(
    [{ CLOUD_AMT: 5_830_000_000, "Y/Y": 0.27, PY_CLOUD_AMT: 4_600_000_000 }],
    "SPM Pipegen Cloud FY27 Q1"
  );
  assert.equal(payload.component, "kpi_with_yoy");
});

test("multi-row categorical data prefers bar chart", () => {
  const payload = buildVisualizationPayload(
    [
      { REGION: "AMER", CLOUD_AMT: 120 },
      { REGION: "EMEA", CLOUD_AMT: 95 }
    ],
    "Regional Cloud"
  );
  assert.equal(payload.component, "bar_chart");
  assert.equal(payload.xKey, "REGION");
});

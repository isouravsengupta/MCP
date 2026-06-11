import test from "node:test";
import assert from "node:assert/strict";
import { buildSql } from "../src/sqlBuilder.js";
import type { MetricDefinition } from "../src/types.js";

const metric: MetricDefinition = {
  id: "m1",
  name: "Test Metric",
  description: "Test metric",
  sourceTable: "ANALYTICS.SALES_PROGRAM_FACT",
  grain: "month",
  dimensions: ["region"],
  sqlTemplate: "SELECT REGION, SUM(OPEN_PIPE_AMT) AS OPEN_PIPE_AMT FROM ANALYTICS.SALES_PROGRAM_FACT",
  crmaFields: {},
  snowflakeColumns: {
    region: "REGION",
    owner: "OWNER_NAME"
  }
};

test("buildSql includes mapped filters and limit", () => {
  const result = buildSql({
    metric,
    filters: { region: "EMEA", owner: "Markus", ignored: "x" },
    limit: 5
  });

  assert.equal(
    result.sqlText,
    "SELECT REGION, SUM(OPEN_PIPE_AMT) AS OPEN_PIPE_AMT FROM ANALYTICS.SALES_PROGRAM_FACT\nWHERE REGION = ? AND OWNER_NAME = ?\nLIMIT 5"
  );
  assert.deepEqual(result.binds, ["EMEA", "Markus"]);
});

test("buildSql clamps limit to [1, 1000]", () => {
  assert.equal(buildSql({ metric, filters: {}, limit: 0 }).sqlText.endsWith("LIMIT 1"), true);
  assert.equal(buildSql({ metric, filters: {}, limit: 50000 }).sqlText.endsWith("LIMIT 1000"), true);
});

test("buildSql rejects unsafe identifier", () => {
  const unsafeMetric: MetricDefinition = {
    ...metric,
    snowflakeColumns: { region: "REGION;DROP TABLE X" }
  };

  assert.throws(
    () => buildSql({ metric: unsafeMetric, filters: { region: "EMEA" }, limit: 10 }),
    /Unsafe identifier/
  );
});

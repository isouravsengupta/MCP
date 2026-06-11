import type { MetricScenarioCatalog } from "./types.js";

const IDENTIFIER = /^[A-Z_][A-Z0-9_]*$/;

function safeIdentifier(value: string): string {
  const upper = value.toUpperCase();
  if (!IDENTIFIER.test(upper)) {
    throw new Error(`Unsafe identifier: ${value}`);
  }
  return upper;
}

export interface AdaptiveQueryInput {
  metricId: string;
  scenarioCatalog: MetricScenarioCatalog;
  sourceTable: string;
  groupBy: string[];
  filters: Record<string, string | number>;
  includeYoy?: boolean;
  fiscalYear?: string;
  topN?: number;
}

export function buildAdaptiveQuery(input: AdaptiveQueryInput): { sqlText: string; binds: Array<string | number> } {
  const scenario = input.scenarioCatalog.scenarios.find((s) => s.metric_id === input.metricId);
  if (!scenario) {
    throw new Error(`No scenario definition found for metric: ${input.metricId}`);
  }

  const binds: Array<string | number> = [];
  const where: string[] = [];
  const groupCols = input.groupBy
    .map((d) => scenario.groupable_dimensions[d])
    .filter((col): col is string => typeof col === "string")
    .map((col) => safeIdentifier(col));

  for (const [k, v] of Object.entries(scenario.fixed_filters ?? {})) {
    const column = safeIdentifier(k);
    where.push(`${column} = ?`);
    binds.push(v);
  }

  for (const [k, v] of Object.entries(input.filters)) {
    const column = scenario.groupable_dimensions[k] ?? k;
    where.push(`${safeIdentifier(column)} = ?`);
    binds.push(v);
  }

  const whereClause = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
  const valueCol = safeIdentifier(scenario.value_column);
  const boundedTopN = Number.isFinite(input.topN) ? Math.max(1, Math.min(200, Number(input.topN))) : 50;

  if (input.includeYoy && scenario.year_column && input.fiscalYear) {
    const yearCol = safeIdentifier(scenario.year_column);
    const prevYear = String(Number(input.fiscalYear) - 1);
    binds.push(input.fiscalYear, prevYear);
    const groupSelect = groupCols.length > 0 ? `${groupCols.join(", ")}, ` : "";
    const groupByClause = groupCols.length > 0 ? `GROUP BY ${groupCols.join(", ")}` : "";
    const joinClause = groupCols.length > 0 ? `LEFT JOIN py USING (${groupCols.join(", ")})` : "CROSS JOIN py";

    return {
      sqlText: `WITH base AS (
  SELECT ${groupSelect}${valueCol} AS VALUE_COL, ${yearCol} AS FY
  FROM ${input.sourceTable}
  ${whereClause}
),
cy AS (
  SELECT ${groupSelect}SUM(VALUE_COL) AS CY_VALUE
  FROM base
  WHERE FY = ?
  ${groupByClause}
),
py AS (
  SELECT ${groupSelect}SUM(VALUE_COL) AS PY_VALUE
  FROM base
  WHERE FY = ?
  ${groupByClause}
)
SELECT ${groupSelect}COALESCE(CY_VALUE, 0) AS VALUE, COALESCE(PY_VALUE, 0) AS PY_VALUE,
CASE WHEN COALESCE(PY_VALUE,0)=0 THEN NULL ELSE COALESCE(CY_VALUE,0)/COALESCE(PY_VALUE,0)-1 END AS "Y/Y"
FROM cy
${joinClause}
ORDER BY VALUE DESC
LIMIT ${boundedTopN}`,
      binds
    };
  }

  const selectGroup = groupCols.length > 0 ? `${groupCols.join(", ")}, ` : "";
  const groupByClause = groupCols.length > 0 ? `GROUP BY ${groupCols.join(", ")}` : "";
  return {
    sqlText: `SELECT ${selectGroup}COALESCE(SUM(${valueCol}), 0) AS VALUE
FROM ${input.sourceTable}
${whereClause}
${groupByClause}
ORDER BY VALUE DESC
LIMIT ${boundedTopN}`,
    binds
  };
}

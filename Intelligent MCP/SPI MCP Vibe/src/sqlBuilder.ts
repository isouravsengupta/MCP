import type { MetricDefinition } from "./types.js";

const SAFE_IDENTIFIER = /^[A-Z_][A-Z0-9_]*$/;

function safeIdentifier(value: string): string {
  const upper = value.toUpperCase();
  if (!SAFE_IDENTIFIER.test(upper)) {
    throw new Error(`Unsafe column identifier rejected: '${value}'`);
  }
  return upper;
}

export interface SqlBuildResult {
  sqlText: string;
  binds: Array<string | number>;
}

export function buildSql(
  metric: MetricDefinition,
  filters: Record<string, string | number>,
  limit = 200
): SqlBuildResult {
  const where: string[] = [];
  const binds: Array<string | number> = [];

  for (const [filterKey, value] of Object.entries(filters)) {
    const snowflakeColumn = metric.snowflakeColumns[filterKey];
    if (!snowflakeColumn) {
      // Silently skip unknown filter keys (don't throw — the agent may pass extra context)
      continue;
    }
    where.push(`${safeIdentifier(snowflakeColumn)} = ?`);
    binds.push(value);
  }

  const predicate = where.length > 0 ? `\nWHERE ${where.join(" AND ")}` : "";
  const boundedLimit = Math.max(1, Math.min(1000, limit));
  const sqlText = `${metric.sqlTemplate.trim()}${predicate}\nLIMIT ${boundedLimit}`;

  return { sqlText, binds };
}

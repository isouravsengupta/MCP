import type { MetricDefinition } from "./types.js";

export interface SqlBuildInput {
  metric: MetricDefinition;
  filters: Record<string, string | number>;
  limit?: number;
}

const IDENTIFIER = /^[A-Z_][A-Z0-9_]*$/;

function safeIdentifier(value: string): string {
  const upper = value.toUpperCase();
  if (!IDENTIFIER.test(upper)) {
    throw new Error(`Unsafe identifier: ${value}`);
  }
  return upper;
}

export function buildSql({ metric, filters, limit = 200 }: SqlBuildInput): {
  sqlText: string;
  binds: Array<string | number>;
} {
  const where: string[] = [];
  const binds: Array<string | number> = [];

  for (const [k, v] of Object.entries(filters)) {
    const column = metric.snowflakeColumns[k];
    if (!column) {
      continue;
    }
    where.push(`${safeIdentifier(column)} = ?`);
    binds.push(v);
  }

  const base = metric.sqlTemplate.trim();
  const predicate = where.length > 0 ? `\nWHERE ${where.join(" AND ")}` : "";
  const boundedLimit = Number.isFinite(limit) ? Math.max(1, Math.min(1000, limit)) : 200;
  const sqlText = `${base}${predicate}\nLIMIT ${boundedLimit}`;

  return { sqlText, binds };
}

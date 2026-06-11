import { loadSnowflakeConfig } from "./config.js";
import {
  loadColumnDictionary,
  loadContextAssetIndex,
  loadContextRegistry,
  loadMetricCatalog,
  loadMetricRegressionSpec,
  loadMetricScenarioCatalog
} from "./resources.js";
import { buildAdaptiveQuery } from "./analysisPlanner.js";
import { buildSql } from "./sqlBuilder.js";
import { SnowflakeClient } from "./snowflake.js";
import { buildVisualizationPayload } from "./visualization.js";

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: string | number | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

const snowflake = new SnowflakeClient(loadSnowflakeConfig());

export async function handleMcpRequest(request: JsonRpcRequest): Promise<JsonRpcResponse> {
  try {
    switch (request.method) {
      case "initialize":
        return ok(request.id, {
          protocolVersion: "2025-03-26",
          serverInfo: { name: "spi-mcp", version: "0.1.0" },
          capabilities: { tools: {}, resources: {} }
        });
      case "tools/list":
        return ok(request.id, {
          tools: [
            {
              name: "list_crma_metrics",
              description: "List mapped CRMA business metrics available in SPI catalog.",
              inputSchema: { type: "object", properties: {} }
            },
            {
              name: "generate_sql_from_metric",
              description: "Generate SQL for a mapped metric with optional filters.",
              inputSchema: {
                type: "object",
                properties: {
                  metric_id: { type: "string" },
                  filters: { type: "object", additionalProperties: true },
                  limit: { type: "number" }
                },
                required: ["metric_id"]
              }
            },
            {
              name: "run_metric_query",
              description: "Generate SQL, execute against Snowflake, and return visualization hints.",
              inputSchema: {
                type: "object",
                properties: {
                  metric_id: { type: "string" },
                  filters: { type: "object", additionalProperties: true },
                  limit: { type: "number" },
                  include_visualization: { type: "boolean" }
                },
                required: ["metric_id"]
              }
            },
            {
              name: "health_ping",
              description: "Lightweight health check that does not hit Snowflake.",
              inputSchema: { type: "object", properties: {} }
            },
            {
              name: "snowflake_connectivity_probe",
              description: "Run a minimal Snowflake query and return runtime network/user context.",
              inputSchema: { type: "object", properties: {} }
            },
            {
              name: "explain_metric_context",
              description: "Return metric lineage/context from CRMA, ETL, and DAG registry.",
              inputSchema: {
                type: "object",
                properties: {
                  metric_id: { type: "string" }
                },
                required: ["metric_id"]
              }
            },
            {
              name: "validate_metric_regressions",
              description: "Run configured metric checks and validate expected output ranges.",
              inputSchema: {
                type: "object",
                properties: {
                  metric_ids: { type: "array", items: { type: "string" } }
                }
              }
            },
            {
              name: "run_adaptive_metric_query",
              description: "Run grouped/trend/YoY analysis using scenario definitions for a metric.",
              inputSchema: {
                type: "object",
                properties: {
                  metric_id: { type: "string" },
                  group_by: { type: "array", items: { type: "string" } },
                  filters: { type: "object", additionalProperties: true },
                  include_yoy: { type: "boolean" },
                  fiscal_year: { type: "string" },
                  top_n: { type: "number" }
                },
                required: ["metric_id"]
              }
            },
            {
              name: "search_context_assets",
              description: "Search ETL/DAG/CRMA context assets by keyword tags.",
              inputSchema: {
                type: "object",
                properties: {
                  query: { type: "string" },
                  limit: { type: "number" }
                },
                required: ["query"]
              }
            }
          ]
        });
      case "tools/call":
        return ok(request.id, await handleToolCall(request.params ?? {}));
      case "resources/list":
        return ok(request.id, {
          resources: [
            {
              uri: "spi://resources/metric-mappings",
              name: "CRMA to Snowflake metric mappings",
              mimeType: "application/json"
            },
            {
              uri: "spi://resources/column-dictionary",
              name: "CRMA field to Snowflake column dictionary",
              mimeType: "application/json"
            },
            {
              uri: "spi://resources/context-registry",
              name: "SPI context registry for lineage-aware metric routing",
              mimeType: "application/json"
            },
            {
              uri: "spi://resources/metric-regression-checks",
              name: "Golden checks for key dashboard metrics",
              mimeType: "application/json"
            },
            {
              uri: "spi://resources/metric-scenarios",
              name: "Scenario definitions for grouped, trend, and YoY analysis",
              mimeType: "application/json"
            },
            {
              uri: "spi://resources/context-assets-index",
              name: "Indexed ETL/DAG/CRMA context assets for lineage-aware planning",
              mimeType: "application/json"
            }
          ]
        });
      case "resources/read":
        return ok(request.id, await handleResourceRead(request.params ?? {}));
      default:
        return fail(request.id, -32601, `Method not found: ${request.method}`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown server error";
    return fail(request.id, -32000, message);
  }
}

async function handleToolCall(params: Record<string, unknown>): Promise<unknown> {
  const toolName = String(params.name ?? "");
  const args = (params.arguments ?? {}) as Record<string, unknown>;

  if (toolName === "health_ping") {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ ok: true, service: "spi-mcp", timestamp: new Date().toISOString() }, null, 2)
        }
      ]
    };
  }

  if (toolName === "snowflake_connectivity_probe") {
    const rows = await snowflake.execute(
      "SELECT CURRENT_USER() AS USER_NAME, CURRENT_ROLE() AS ROLE_NAME, CURRENT_WAREHOUSE() AS WH_NAME, CURRENT_IP_ADDRESS() AS IP_ADDR"
    );
    return {
      content: [{ type: "text", text: JSON.stringify({ ok: true, rowCount: rows.length, rows }, null, 2) }]
    };
  }

  const catalog = await loadMetricCatalog();

  if (toolName === "list_crma_metrics") {
    return {
      content: [{ type: "text", text: JSON.stringify(catalog.metrics, null, 2) }]
    };
  }

  if (toolName === "explain_metric_context") {
    const metricId = String(args.metric_id ?? "");
    const metricDoc = catalog.metric_definitions?.find((m) => m.id === metricId);
    if (!metricDoc) {
      throw new Error(`Metric context not found: ${metricId}`);
    }
    const context = await loadContextRegistry();
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              metric_id: metricId,
              preferred_source_order: context.preferred_source_order,
              focus_areas: context.focus_areas,
              metric_context: metricDoc
            },
            null,
            2
          )
        }
      ]
    };
  }

  if (toolName === "validate_metric_regressions") {
    const regressionSpec = await loadMetricRegressionSpec();
    const includeMetricIds = Array.isArray(args.metric_ids) ? new Set(args.metric_ids.map(String)) : null;
    const checks = includeMetricIds
      ? regressionSpec.checks.filter((check) => includeMetricIds.has(check.metric_id))
      : regressionSpec.checks;
    const results: Array<Record<string, unknown>> = [];

    for (const check of checks) {
      const metric = catalog.metrics.find((m) => m.id === check.metric_id);
      if (!metric) {
        results.push({ metric_id: check.metric_id, ok: false, reason: "metric not found" });
        continue;
      }
      const rows = await snowflake.execute(metric.sqlTemplate);
      const row = (rows[0] ?? {}) as Record<string, unknown>;
      const missingColumns = check.expected_columns.filter((column) => !(column in row));
      const rangeViolations: Array<Record<string, unknown>> = [];

      for (const [column, range] of Object.entries(check.numeric_ranges)) {
        const value = Number(row[column]);
        if (Number.isNaN(value)) {
          rangeViolations.push({ column, value: row[column], reason: "not numeric" });
          continue;
        }
        if (typeof range.min === "number" && value < range.min) {
          rangeViolations.push({ column, value, min: range.min });
        }
        if (typeof range.max === "number" && value > range.max) {
          rangeViolations.push({ column, value, max: range.max });
        }
      }

      const ok = missingColumns.length === 0 && rangeViolations.length === 0;
      results.push({
        metric_id: check.metric_id,
        ok,
        row_preview: row,
        missing_columns: missingColumns,
        range_violations: rangeViolations
      });
    }

    return {
      content: [{ type: "text", text: JSON.stringify({ ok: results.every((r) => r.ok === true), results }, null, 2) }]
    };
  }

  if (toolName === "search_context_assets") {
    const index = await loadContextAssetIndex();
    const query = String(args.query ?? "").toLowerCase();
    const limit = typeof args.limit === "number" ? Math.max(1, Math.min(50, args.limit)) : 10;
    const terms = query.split(/\s+/).filter(Boolean);
    const matches = index.assets
      .map((asset) => {
        const haystack = `${asset.repo} ${asset.path} ${asset.tags.join(" ")}`.toLowerCase();
        const score = terms.reduce((acc, term) => (haystack.includes(term) ? acc + 1 : acc), 0);
        return { asset, score };
      })
      .filter((row) => row.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((row) => row.asset);
    return {
      content: [{ type: "text", text: JSON.stringify({ query, matchCount: matches.length, matches }, null, 2) }]
    };
  }

  const metricId = String(args.metric_id ?? "");
  const metric = catalog.metrics.find((m) => m.id === metricId);
  if (!metric) {
    throw new Error(`Metric not found: ${metricId}`);
  }

  const { sqlText, binds } = buildSql({
    metric,
    filters: (args.filters ?? {}) as Record<string, string | number>,
    limit: typeof args.limit === "number" ? args.limit : undefined
  });

  if (toolName === "generate_sql_from_metric") {
    return {
      content: [{ type: "text", text: JSON.stringify({ sqlText, binds }, null, 2) }]
    };
  }

  if (toolName === "run_metric_query") {
    const rows = await snowflake.execute(sqlText, binds);
    const includeVisualization = args.include_visualization !== false;
    const visualization = includeVisualization ? buildVisualizationPayload(rows, metric.name) : null;
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              sqlText,
              rowCount: rows.length,
              rows,
              visualization,
              presentation_hints: {
                render_component: visualization?.component ?? "table",
                reason: "Auto-selected based on row shape and YoY/grouping columns"
              }
            },
            null,
            2
          )
        }
      ]
    };
  }

  if (toolName === "run_adaptive_metric_query") {
    const scenarioCatalog = await loadMetricScenarioCatalog();
    const groupBy = Array.isArray(args.group_by) ? args.group_by.map(String) : [];
    const filters = (args.filters ?? {}) as Record<string, string | number>;
    const includeYoy = args.include_yoy === true;
    const fiscalYear = typeof args.fiscal_year === "string" ? args.fiscal_year : undefined;
    const topN = typeof args.top_n === "number" ? args.top_n : undefined;
    const adaptive = buildAdaptiveQuery({
      metricId: metric.id,
      scenarioCatalog,
      sourceTable: metric.sourceTable,
      groupBy,
      filters,
      includeYoy,
      fiscalYear,
      topN
    });
    const rows = await snowflake.execute(adaptive.sqlText, adaptive.binds);
    const visualization = buildVisualizationPayload(rows, `${metric.name} adaptive analysis`);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              metric_id: metric.id,
              sqlText: adaptive.sqlText,
              binds: adaptive.binds,
              rowCount: rows.length,
              rows,
              visualization
            },
            null,
            2
          )
        }
      ]
    };
  }

  throw new Error(`Tool not found: ${toolName}`);
}

async function handleResourceRead(params: Record<string, unknown>): Promise<unknown> {
  const uri = String(params.uri ?? "");
  if (uri === "spi://resources/metric-mappings") {
    const data = await loadMetricCatalog();
    return { contents: [{ uri, mimeType: "application/json", text: JSON.stringify(data, null, 2) }] };
  }
  if (uri === "spi://resources/column-dictionary") {
    const data = await loadColumnDictionary();
    return { contents: [{ uri, mimeType: "application/json", text: JSON.stringify(data, null, 2) }] };
  }
  if (uri === "spi://resources/context-registry") {
    const data = await loadContextRegistry();
    return { contents: [{ uri, mimeType: "application/json", text: JSON.stringify(data, null, 2) }] };
  }
  if (uri === "spi://resources/metric-regression-checks") {
    const data = await loadMetricRegressionSpec();
    return { contents: [{ uri, mimeType: "application/json", text: JSON.stringify(data, null, 2) }] };
  }
  if (uri === "spi://resources/metric-scenarios") {
    const data = await loadMetricScenarioCatalog();
    return { contents: [{ uri, mimeType: "application/json", text: JSON.stringify(data, null, 2) }] };
  }
  if (uri === "spi://resources/context-assets-index") {
    const data = await loadContextAssetIndex();
    return { contents: [{ uri, mimeType: "application/json", text: JSON.stringify(data, null, 2) }] };
  }
  throw new Error(`Resource not found: ${uri}`);
}

function ok(id: string | number | null, result: unknown): JsonRpcResponse {
  return { jsonrpc: "2.0", id, result };
}

function fail(id: string | number | null, code: number, message: string): JsonRpcResponse {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

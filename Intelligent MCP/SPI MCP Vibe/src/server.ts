/**
 * MCP protocol handler for the SPI MCP server.
 *
 * Implements:
 *   initialize
 *   tools/list     — 5 tools: list_crma_metrics, generate_sql_from_metric,
 *                              run_metric_query, list_tables, describe_table
 *   tools/call
 *   resources/list — 2 resources: metric-mappings, column-dictionary
 *   resources/read
 */

import { loadConfig } from "./config.js";
import { loadColumnDictionary, loadMetricCatalog } from "./resources.js";
import { buildSql } from "./sqlBuilder.js";
import { SnowflakeClient } from "./snowflake.js";

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
  error?: { code: number; message: string };
}

// Lazy-initialised Snowflake client (created on first tool call)
let _snowflake: SnowflakeClient | null = null;
async function getSnowflake(): Promise<SnowflakeClient> {
  if (!_snowflake) {
    const config = await loadConfig();
    _snowflake = new SnowflakeClient(config);
  }
  return _snowflake;
}

// ---------------------------------------------------------------------------

export async function handleMcpRequest(request: JsonRpcRequest): Promise<JsonRpcResponse> {
  try {
    switch (request.method) {
      case "initialize":
        return ok(request.id, {
          protocolVersion: "2025-03-26",
          serverInfo: { name: "spi-mcp-vibe", version: "1.0.0" },
          capabilities: { tools: {}, resources: {} },
        });

      case "tools/list":
        return ok(request.id, { tools: TOOL_DEFINITIONS });

      case "tools/call":
        return ok(request.id, await handleToolCall(request.params ?? {}));

      case "resources/list":
        return ok(request.id, {
          resources: [
            {
              uri: "spi://resources/metric-mappings",
              name: "CRMA to Snowflake metric catalog",
              description:
                "All SPI metric definitions with SQL expressions, CRMA field names, and " +
                "Snowflake column names. Read this before calling run_metric_query to " +
                "understand available metric IDs and valid filter keys.",
              mimeType: "application/json",
            },
            {
              uri: "spi://resources/column-dictionary",
              name: "CRMA field → Snowflake column dictionary",
              description:
                "Maps every CRMA field name (e.g. FiscalYear__c) to its Snowflake column " +
                "equivalent (e.g. FISCAL_YEAR). Use when constructing ad-hoc queries.",
              mimeType: "application/json",
            },
          ],
        });

      case "resources/read":
        return ok(request.id, await handleResourceRead(request.params ?? {}));

      default:
        return fail(request.id, -32601, `Method not found: ${request.method}`);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown server error";
    return fail(request.id, -32000, message);
  }
}

// ---------------------------------------------------------------------------

const TOOL_DEFINITIONS = [
  {
    name: "list_crma_metrics",
    description:
      "List all CRMA business metrics in the SPI catalog with their IDs, names, descriptions, " +
      "and available filter dimensions. Always call this first to discover available metric IDs.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "generate_sql_from_metric",
    description:
      "Generate the Snowflake SQL for a named CRMA metric with optional dimension filters, " +
      "without executing it. Use to inspect the query before running.",
    inputSchema: {
      type: "object",
      properties: {
        metric_id: {
          type: "string",
          description: "Metric ID from list_crma_metrics, e.g. 'spm_acv_attainment_pct'.",
        },
        filters: {
          type: "object",
          additionalProperties: true,
          description:
            "Optional dimension filters using CRMA field key names as defined in the metric, " +
            "e.g. {\"fiscal_year\": \"FY27\", \"region\": \"EMEA\"}.",
        },
        limit: { type: "number", description: "Max rows (default 200, max 1000)." },
      },
      required: ["metric_id"],
    },
  },
  {
    name: "run_metric_query",
    description:
      "Run a named CRMA metric query against Snowflake and return the results. " +
      "Results match CRMA dashboard calculations exactly — the SQL expression is taken " +
      "directly from the metric catalog which replicates the dashboard business logic.",
    inputSchema: {
      type: "object",
      properties: {
        metric_id: {
          type: "string",
          description: "Metric ID from list_crma_metrics, e.g. 'qap_acv_attainment_pct'.",
        },
        filters: {
          type: "object",
          additionalProperties: true,
          description:
            "Optional dimension filters, e.g. {\"fiscal_quarter\": \"Q2FY27\", \"segment\": \"ENTR\"}.",
        },
        limit: { type: "number", description: "Max rows (default 200, max 1000)." },
      },
      required: ["metric_id"],
    },
  },
  {
    name: "list_tables",
    description:
      "List all tables and views in the configured Snowflake schema. " +
      "Use to discover available data for ad-hoc queries.",
    inputSchema: {
      type: "object",
      properties: {
        schema: {
          type: "string",
          description: "Optional schema name override. Defaults to SNOWFLAKE_SCHEMA env var.",
        },
      },
    },
  },
  {
    name: "describe_table",
    description:
      "Return column names, types, and comments for a Snowflake table or view. " +
      "Use before writing an ad-hoc execute_query call.",
    inputSchema: {
      type: "object",
      properties: {
        table_name: { type: "string", description: "Table or view name (case-insensitive)." },
        schema: { type: "string", description: "Optional schema override." },
      },
      required: ["table_name"],
    },
  },
];

// ---------------------------------------------------------------------------

async function handleToolCall(params: Record<string, unknown>): Promise<unknown> {
  const toolName = String(params.name ?? "");
  const args = (params.arguments ?? {}) as Record<string, unknown>;
  const sf = await getSnowflake();
  const currentSchema = (process.env.SNOWFLAKE_SCHEMA ?? "PUBLIC").replace(/[^A-Z0-9_]/gi, "").toUpperCase();

  // ── Schema exploration tools ──────────────────────────────────────────────

  if (toolName === "list_tables") {
    const schema = typeof args.schema === "string"
      ? args.schema.replace(/[^A-Z0-9_]/gi, "").toUpperCase()
      : currentSchema;
    const rows = await sf.execute(
      `SELECT table_name AS name, table_type AS kind, row_count
       FROM information_schema.tables
       WHERE table_schema = '${schema}'
       ORDER BY table_name`,
      []
    );
    return { content: [{ type: "text", text: JSON.stringify(rows, null, 2) }] };
  }

  if (toolName === "describe_table") {
    const tableName = String(args.table_name ?? "").replace(/[^A-Z0-9_]/gi, "").toUpperCase();
    const schema = typeof args.schema === "string"
      ? args.schema.replace(/[^A-Z0-9_]/gi, "").toUpperCase()
      : currentSchema;
    const rows = await sf.execute(
      `SELECT column_name, data_type, is_nullable, comment
       FROM information_schema.columns
       WHERE table_schema = '${schema}' AND table_name = '${tableName}'
       ORDER BY ordinal_position`,
      []
    );
    return { content: [{ type: "text", text: JSON.stringify(rows, null, 2) }] };
  }

  // ── Metric catalog tools ──────────────────────────────────────────────────

  const catalog = await loadMetricCatalog();

  if (toolName === "list_crma_metrics") {
    const summary = catalog.metrics.map(({ id, name, description, sourceTable, dimensions }) => ({
      id, name, description, sourceTable, dimensions,
    }));
    return { content: [{ type: "text", text: JSON.stringify(summary, null, 2) }] };
  }

  const metricId = String(args.metric_id ?? "");
  const metric = catalog.metrics.find((m) => m.id === metricId);
  if (!metric) {
    const available = catalog.metrics.map((m) => m.id).join(", ");
    throw new Error(`Metric '${metricId}' not found. Available: ${available}`);
  }

  const filters = (args.filters ?? {}) as Record<string, string | number>;
  const limit = typeof args.limit === "number" ? args.limit : 200;
  const { sqlText, binds } = buildSql(metric, filters, limit);

  if (toolName === "generate_sql_from_metric") {
    return { content: [{ type: "text", text: JSON.stringify({ metric_id: metricId, sqlText, binds }, null, 2) }] };
  }

  if (toolName === "run_metric_query") {
    const rows = await sf.execute(sqlText, binds);
    return {
      content: [{
        type: "text",
        text: JSON.stringify({ metric_id: metricId, sqlText, rowCount: rows.length, rows }, null, 2),
      }],
    };
  }

  throw new Error(`Tool not found: ${toolName}`);
}

// ---------------------------------------------------------------------------

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

  throw new Error(`Resource not found: ${uri}`);
}

// ---------------------------------------------------------------------------

function ok(id: string | number | null, result: unknown): JsonRpcResponse {
  return { jsonrpc: "2.0", id, result };
}

function fail(id: string | number | null, code: number, message: string): JsonRpcResponse {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

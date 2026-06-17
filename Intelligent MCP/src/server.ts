import { loadSnowflakeConfig } from "./config.js";
import { getToken } from "./tokenStore.js";
import { buildAuthUrl, refreshAccessToken } from "./snowflakeOAuth.js";
import {
  loadColumnDictionary,
  loadDashboardDatasetRegistry,
  loadDashboardLensCatalog,
  loadFormulaMetrics,
  loadSemanticCatalog,
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
import { buildSlackBlocks } from "./slackBlocks.js";
import { renderAndUploadChart } from "./chartRenderer.js";
import type { DashboardDatasetRegistry, MetricScenarioCatalog } from "./types.js";

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

const IDENTIFIER = /^[A-Z_][A-Z0-9_]*$/;

// OAuth mode is active when SNOWFLAKE_OAUTH_CLIENT_ID is set.
const OAUTH_MODE = !!process.env.SNOWFLAKE_OAUTH_CLIENT_ID;

// Fallback service-account client used when OAuth mode is off.
const serviceAccountSnowflake = OAUTH_MODE ? null : new SnowflakeClient(loadSnowflakeConfig());
const CONTROL_DATASETS = new Set(["FiscalYearFix", "FixMonth", "INTL_USRSET_SS"]);

export async function handleMcpRequest(request: JsonRpcRequest, slackUserId?: string): Promise<JsonRpcResponse> {
  try {
    // Resolve the Snowflake client for this request
    let snowflake: SnowflakeClient;

    if (OAUTH_MODE) {
      if (!slackUserId) {
        return fail(request.id, -32001, "auth_required: No Slack user identity provided. Ensure X-Slack-User-Id header is set.");
      }

      let token = await getToken(slackUserId);

      // Attempt refresh if token is stale but we have a refresh token
      if (!token) {
        const authUrl = buildAuthUrl(slackUserId);
        return {
          jsonrpc: "2.0",
          id: request.id,
          result: {
            auth_required: true,
            auth_url: authUrl,
            message: `Please authorise your Snowflake access by clicking this link: ${authUrl} — then re-ask your question.`
          }
        };
      }

      // Proactively refresh if within 5 minutes of expiry
      if (token.expiresAt - Date.now() < 5 * 60 * 1000 && token.refreshToken) {
        try {
          await refreshAccessToken(slackUserId, token.refreshToken);
          token = await getToken(slackUserId);
        } catch {
          // If refresh fails, force re-auth
          const authUrl = buildAuthUrl(slackUserId);
          return {
            jsonrpc: "2.0",
            id: request.id,
            result: {
              auth_required: true,
              auth_url: authUrl,
              message: `Your Snowflake session has expired. Please re-authorise: ${authUrl}`
            }
          };
        }
      }

      const config = loadSnowflakeConfig();
      snowflake = new SnowflakeClient({
        ...config,
        authMode: "sso",
        authenticator: "oauth",
        accessToken: token!.accessToken
      });
    } else {
      snowflake = serviceAccountSnowflake!;
    }

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
              description: "Run grouped/trend/YoY analysis with filter validation and clarification hints.",
              inputSchema: {
                type: "object",
                properties: {
                  metric_id: { type: "string" },
                  group_by: { type: "array", items: { type: "string" } },
                  filters: { type: "object", additionalProperties: true },
                  include_yoy: { type: "boolean" },
                  fiscal_year: { type: "string" },
                  top_n: { type: "number" },
                  require_disambiguation: { type: "boolean" }
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
            },
            {
              name: "resolve_sales_play_for_hierarchy",
              description:
                "Find top sales play by program count for an SPM hierarchy member (for example L4 person).",
              inputSchema: {
                type: "object",
                properties: {
                  person_name: { type: "string" },
                  hierarchy_level: { type: "string", enum: ["SPM_HIER_LVL_2", "SPM_HIER_LVL_3", "SPM_HIER_LVL_4"] },
                  fiscal_year: { type: "string" }
                },
                required: ["person_name"]
              }
            },
            {
              name: "dashboard_usecase_coverage",
              description: "List CRMA dashboard lens coverage and highlight unsupported lens use cases.",
              inputSchema: { type: "object", properties: {} }
            },
            {
              name: "list_dashboard_datasets",
              description: "List CRMA datasets with mapped Snowflake table candidates.",
              inputSchema: { type: "object", properties: {} }
            },
            {
              name: "describe_dashboard_dataset",
              description: "Describe available dimensions/measures for a dashboard dataset.",
              inputSchema: {
                type: "object",
                properties: { dataset: { type: "string" } },
                required: ["dataset"]
              }
            },
            {
              name: "query_dashboard_dataset",
              description: "Generic metric query for any mapped dashboard dataset with clarification safeguards.",
              inputSchema: {
                type: "object",
                properties: {
                  dataset: { type: "string" },
                  measure: { type: "string" },
                  aggregation: { type: "string", enum: ["sum", "count", "avg", "max", "min"] },
                  group_by: { type: "array", items: { type: "string" } },
                  filters: { type: "object", additionalProperties: true },
                  limit: { type: "number" }
                },
                required: ["dataset", "measure"]
              }
            },
            {
              name: "run_formula_metric",
              description: "Run exact CRMA-formula metric (SAQL-equivalent SQL) with fiscal filters.",
              inputSchema: {
                type: "object",
                properties: {
                  metric_id: { type: "string" },
                  fiscal_year: { type: "string" },
                  fiscal_quarter: { type: "string" },
                  months: { type: "array", items: { type: "string" } }
                },
                required: ["metric_id", "fiscal_year", "fiscal_quarter"]
              }
            },
            {
              name: "run_forecast_attainment",
              description:
                "Preferred path for 'forecast attainment' questions. Runs CRMA-equivalent formula metric (not SPM performance rollups).",
              inputSchema: {
                type: "object",
                properties: {
                  fiscal_year: { type: "string" },
                  fiscal_quarter: { type: "string" },
                  months: { type: "array", items: { type: "string" } }
                },
                required: ["fiscal_year", "fiscal_quarter"]
              }
            },
            {
              name: "run_pg_contribution",
              description:
                "Preferred path for 'PG Contribution (%)' questions. Runs CRMA-equivalent PG contribution metric.",
              inputSchema: {
                type: "object",
                properties: {
                  fiscal_year: { type: "string" },
                  fiscal_quarter: { type: "string" },
                  months: { type: "array", items: { type: "string" } }
                },
                required: ["fiscal_year", "fiscal_quarter"]
              }
            },
            {
              name: "lookup_opportunity_amount",
              description:
                "Look up an opportunity by ID directly in SPI Snowflake datasets and return available amount fields.",
              inputSchema: {
                type: "object",
                properties: {
                  opportunity_id: { type: "string" }
                },
                required: ["opportunity_id"]
              }
            },
            {
              name: "route_semantic_query",
              description: "Resolve a natural-language query into the deterministic SPI tool route.",
              inputSchema: {
                type: "object",
                properties: {
                  query: { type: "string" },
                  fiscal_year: { type: "string" },
                  fiscal_quarter: { type: "string" },
                  opportunity_id: { type: "string" }
                },
                required: ["query"]
              }
            },
            {
              name: "run_semantic_query",
              description: "Route and execute a natural-language query through deterministic SPI tooling.",
              inputSchema: {
                type: "object",
                properties: {
                  query: { type: "string" },
                  fiscal_year: { type: "string" },
                  fiscal_quarter: { type: "string" },
                  opportunity_id: { type: "string" }
                },
                required: ["query"]
              }
            },
            {
              name: "render_slack_blocks",
              description: "Convert a visualization payload into Slack Block Kit blocks (Option B). Optionally also generates a chart PNG via S3 (Option A) if SPI_CHART_BUCKET is configured. Pass the visualization object returned by any metric query tool.",
              inputSchema: {
                type: "object",
                properties: {
                  visualization: {
                    type: "object",
                    description: "VisualizationPayload returned by run_metric_query, run_adaptive_metric_query, or query_dashboard_dataset."
                  },
                  include_chart_image: {
                    type: "boolean",
                    description: "If true, render a PNG chart and embed its URL in the blocks (requires SPI_CHART_BUCKET env var). Defaults to true."
                  }
                },
                required: ["visualization"]
              }
            }
          ]
        });
      case "tools/call":
        return ok(request.id, await handleToolCall(request.params ?? {}, snowflake));
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
            },
            {
              uri: "spi://resources/dashboard-lens-catalog",
              name: "Catalog of CRMA dashboard lens steps and datasets",
              mimeType: "application/json"
            },
            {
              uri: "spi://resources/dashboard-dataset-registry",
              name: "Dataset-to-table mapping for dashboard execution",
              mimeType: "application/json"
            },
            {
              uri: "spi://resources/semantic-catalog",
              name: "Canonical semantic intent catalog and graph mapping",
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

async function handleToolCall(params: Record<string, unknown>, snowflake: SnowflakeClient): Promise<unknown> {
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
    const formulas = await loadFormulaMetrics();
    const formulaMetrics = formulas.metrics.map((m) => ({
      id: m.id,
      name: m.name,
      description: m.description ?? "",
      query_path: "run_formula_metric"
    }));
    return {
      content: [{ type: "text", text: JSON.stringify([...catalog.metrics, ...formulaMetrics], null, 2) }]
    };
  }

  if (toolName === "render_slack_blocks") {
    const viz = args.visualization as import("./visualization.js").VisualizationPayload;
    if (!viz || typeof viz !== "object") {
      throw new Error("render_slack_blocks requires a visualization object.");
    }
    const includeChart = args.include_chart_image !== false;
    const chartImageUrl = includeChart ? await renderAndUploadChart(viz, `render_slack_blocks_${Date.now()}`) : null;
    const blocks = buildSlackBlocks(viz, chartImageUrl);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              slack_blocks: blocks,
              chart_image_url: chartImageUrl,
              block_count: blocks.length,
              chart_rendered: chartImageUrl !== null
            },
            null,
            2
          )
        }
      ]
    };
  }

  if (toolName === "route_semantic_query") {
    const semanticCatalog = await loadSemanticCatalog();
    const route = buildSemanticRoute(
      {
        query: String(args.query ?? ""),
        fiscalYear: typeof args.fiscal_year === "string" ? args.fiscal_year : undefined,
        fiscalQuarter: typeof args.fiscal_quarter === "string" ? args.fiscal_quarter : undefined,
        opportunityId: typeof args.opportunity_id === "string" ? args.opportunity_id : undefined
      },
      semanticCatalog
    );
    return {
      content: [{ type: "text", text: JSON.stringify(route, null, 2) }]
    };
  }

  if (toolName === "run_semantic_query") {
    const originalQuery = String(args.query ?? "");
    const semanticCatalog = await loadSemanticCatalog();
    const route = buildSemanticRoute(
      {
        query: originalQuery,
        fiscalYear: typeof args.fiscal_year === "string" ? args.fiscal_year : undefined,
        fiscalQuarter: typeof args.fiscal_quarter === "string" ? args.fiscal_quarter : undefined,
        opportunityId: typeof args.opportunity_id === "string" ? args.opportunity_id : undefined
      },
      semanticCatalog
    );
    if (route.clarification_needed) {
      return {
        content: [{ type: "text", text: JSON.stringify(route, null, 2) }]
      };
    }
    const result = await handleToolCall({
      name: route.route_tool,
      arguments: {
        ...route.arguments,
        original_query: originalQuery
      }
    }, snowflake);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              route,
              result
            },
            null,
            2
          )
        }
      ]
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

  if (toolName === "dashboard_usecase_coverage") {
    const lensCatalog = await loadDashboardLensCatalog();
    const registry = await loadDashboardDatasetRegistry();
    const uniqueDatasets = [...new Set(lensCatalog.lenses.flatMap((l) => l.datasets))];
    const registrySet = new Set(registry.datasets.map((d) => d.dataset));
    const datasetResolution = new Map<string, { covered: boolean; table: string | null; mode: string }>();
    for (const dataset of uniqueDatasets) {
      if (CONTROL_DATASETS.has(dataset)) {
        datasetResolution.set(dataset, { covered: true, table: null, mode: "control-dataset" });
        continue;
      }
      const hasRegistryMapping = registrySet.has(dataset);
      datasetResolution.set(dataset, {
        covered: hasRegistryMapping,
        table: hasRegistryMapping ? "registry-mapped" : null,
        mode: hasRegistryMapping ? "registry" : "unmapped"
      });
    }
    const datasetCoverage = lensCatalog.lenses.map((lens) => {
      const unresolved = lens.datasets.filter((d) => !(datasetResolution.get(d)?.covered ?? false));
      return {
        step_name: lens.step_name,
        datasets: lens.datasets,
        widgets: lens.widgets,
        covered: unresolved.length === 0,
        unresolved_datasets: unresolved
      };
    });
    const unsupported = datasetCoverage.filter((x) => !x.covered);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              total_lenses: lensCatalog.lenses.length,
              covered_lenses: datasetCoverage.length - unsupported.length,
              unsupported_lenses: unsupported.length,
              dataset_resolution: Object.fromEntries(
                [...datasetResolution.entries()].map(([k, v]) => [
                  k,
                  { covered: v.covered, table: v.table, mode: v.mode }
                ])
              ),
              unsupported_examples: unsupported.slice(0, 25)
            },
            null,
            2
          )
        }
      ]
    };
  }

  if (toolName === "list_dashboard_datasets") {
    const registry = await loadDashboardDatasetRegistry();
    const lensCatalog = await loadDashboardLensCatalog();
    const datasets = [...new Set(lensCatalog.lenses.flatMap((l) => l.datasets))].sort();
    const rows: Array<Record<string, unknown>> = [];
    for (const dataset of datasets) {
      const table = CONTROL_DATASETS.has(dataset) ? null : await resolveDatasetTable(dataset, registry, snowflake);
      rows.push({
        dataset,
        control_dataset: CONTROL_DATASETS.has(dataset),
        resolved_table: table,
        covered: CONTROL_DATASETS.has(dataset) || table !== null
      });
    }
    return {
      content: [{ type: "text", text: JSON.stringify({ datasets: rows }, null, 2) }]
    };
  }

  if (toolName === "describe_dashboard_dataset") {
    const registry = await loadDashboardDatasetRegistry();
    const dataset = String(args.dataset ?? "").trim();
    if (CONTROL_DATASETS.has(dataset)) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                dataset,
                control_dataset: true,
                message: "This dataset is a dashboard control/facet step, not a physical Snowflake dataset."
              },
              null,
              2
            )
          }
        ]
      };
    }
    const def = registry.datasets.find((d) => d.dataset === dataset);
    const table = await resolveDatasetTable(dataset, registry, snowflake);
    if (!table) {
      throw new Error(`Could not resolve table for dataset: ${dataset}`);
    }
    const sampleRows = await snowflake.execute(`SELECT * FROM ${table} LIMIT 1`);
    const columns = Object.keys((sampleRows[0] ?? {}) as Record<string, unknown>);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              dataset,
              resolved_table: table,
              columns,
              preferred_dimensions: def?.preferred_dimensions ?? [],
              preferred_measures: def?.preferred_measures ?? []
            },
            null,
            2
          )
        }
      ]
    };
  }

  if (toolName === "query_dashboard_dataset") {
    const registry = await loadDashboardDatasetRegistry();
    const dataset = String(args.dataset ?? "").trim();
    const measure = String(args.measure ?? "").trim().toUpperCase();
    const aggregation = String(args.aggregation ?? "sum").toLowerCase();
    const filters = (args.filters ?? {}) as Record<string, string | number>;
    const groupBy = Array.isArray(args.group_by) ? args.group_by.map((v) => String(v).toUpperCase()) : [];
    const limit = typeof args.limit === "number" ? Math.max(1, Math.min(200, args.limit)) : 50;

    if (CONTROL_DATASETS.has(dataset)) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                clarification_needed: true,
                message: `Dataset '${dataset}' is a control/facet dataset. Please choose a physical dashboard dataset.`
              },
              null,
              2
            )
          }
        ]
      };
    }
    const def = registry.datasets.find((d) => d.dataset === dataset);
    const table = await resolveDatasetTable(dataset, registry, snowflake);
    if (!table) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                clarification_needed: true,
                message: `Could not resolve a Snowflake table for dataset '${dataset}'.`,
                suggestions: registry.datasets.map((d) => d.dataset)
              },
              null,
              2
            )
          }
        ]
      };
    }
    const sampleRows = await snowflake.execute(`SELECT * FROM ${table} LIMIT 1`);
    const available = new Set(Object.keys((sampleRows[0] ?? {}) as Record<string, unknown>).map((c) => c.toUpperCase()));

    if (!available.has(measure)) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                clarification_needed: true,
                message: `Unknown measure '${measure}' for dataset '${dataset}'.`,
                suggestions: [...available].filter((c) => def?.preferred_measures?.includes(c) ?? false).slice(0, 20)
                  .concat([...available].slice(0, 10))
              },
              null,
              2
            )
          }
        ]
      };
    }

    const badGroupBy = groupBy.filter((g) => !available.has(g));
    if (badGroupBy.length > 0) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                clarification_needed: true,
                message: "One or more group_by fields do not exist in dataset.",
                invalid_group_by: badGroupBy,
                suggestions: def?.preferred_dimensions ?? [...available].slice(0, 20)
              },
              null,
              2
            )
          }
        ]
      };
    }

    const where: string[] = [];
    const binds: Array<string | number> = [];
    for (const [k, v] of Object.entries(filters)) {
      const col = String(k).toUpperCase();
      if (!available.has(col)) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  clarification_needed: true,
                  message: `Unknown filter field '${k}'.`,
                  suggestions: def?.preferred_dimensions ?? [...available].slice(0, 20)
                },
                null,
                2
              )
            }
          ]
        };
      }
      where.push(`${col} = ?`);
      binds.push(v);
    }

    const aggExpr =
      aggregation === "count"
        ? `COUNT(${measure})`
        : aggregation === "avg"
          ? `AVG(${measure})`
          : aggregation === "max"
            ? `MAX(${measure})`
            : aggregation === "min"
              ? `MIN(${measure})`
              : `SUM(${measure})`;
    const selectGroup = groupBy.length > 0 ? `${groupBy.join(", ")}, ` : "";
    const whereSql = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
    const groupSql = groupBy.length > 0 ? `GROUP BY ${groupBy.join(", ")}` : "";
    const orderSql = "ORDER BY VALUE DESC";
    const sqlText = `SELECT ${selectGroup}COALESCE(${aggExpr}, 0) AS VALUE FROM ${table} ${whereSql} ${groupSql} ${orderSql} LIMIT ${limit}`;
    const rows = await snowflake.execute(sqlText, binds);
    const quality = assessResultQuality(rows);
    if (quality.clarificationNeeded) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                clarification_needed: true,
                message: "Result is low-signal. Please refine filters or fiscal scope.",
                diagnostics: quality,
                suggestions: {
                  dimensions: def?.preferred_dimensions ?? [...available].slice(0, 20),
                  measures: def?.preferred_measures ?? [...available].slice(0, 20)
                }
              },
              null,
              2
            )
          }
        ]
      };
    }
    const vizQdd = buildVisualizationPayload(rows, `${dataset} ${measure} by ${groupBy.join(", ") || "all"}`);
    const chartImageUrlQdd = await renderAndUploadChart(vizQdd, `query_dashboard_dataset_${dataset}_${Date.now()}`);
    const slackBlocksQdd = buildSlackBlocks(vizQdd, chartImageUrlQdd);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              dataset,
              resolved_table: table,
              sqlText,
              binds,
              rowCount: rows.length,
              rows,
              visualization: vizQdd,
              chart_image_url: chartImageUrlQdd,
              slack_blocks: slackBlocksQdd
            },
            null,
            2
          )
        }
      ]
    };
  }

  if (toolName === "run_forecast_attainment") {
    const originalQuery = String(args.original_query ?? "");
    if (!isScopeConfirmedByQuery(originalQuery, String(args.fiscal_year ?? ""), String(args.fiscal_quarter ?? ""))) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                clarification_needed: true,
                message:
                  "Please confirm fiscal scope in your question (example: 'Forecast attainment FY27 Q2')."
              },
              null,
              2
            )
          }
        ]
      };
    }
    return handleToolCall({
      name: "run_formula_metric",
      arguments: {
        metric_id: "spm_forecast_attainment",
        original_query: originalQuery,
        fiscal_year: args.fiscal_year,
        fiscal_quarter: args.fiscal_quarter,
        months: args.months
      }
    }, snowflake);
  }

  if (toolName === "run_pg_contribution") {
    const originalQuery = String(args.original_query ?? "");
    if (!isScopeConfirmedByQuery(originalQuery, String(args.fiscal_year ?? ""), String(args.fiscal_quarter ?? ""))) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                clarification_needed: true,
                message: "Please confirm fiscal scope in your question (example: 'PG Contribution FY27 Q2')."
              },
              null,
              2
            )
          }
        ]
      };
    }
    return handleToolCall({
      name: "run_formula_metric",
      arguments: {
        metric_id: "spm_pg_contribution",
        original_query: originalQuery,
        fiscal_year: args.fiscal_year,
        fiscal_quarter: args.fiscal_quarter,
        months: args.months
      }
    }, snowflake);
  }

  if (toolName === "lookup_opportunity_amount") {
    const opportunityId = String(args.opportunity_id ?? "").trim();
    if (!opportunityId) {
      throw new Error("opportunity_id is required.");
    }
    const opp15 = opportunityId.slice(0, 15);
    const tableCandidates = [
      "SSE_DM_GDSO_PRD.AIO.GSP_SPM_PIPEGEN",
      "SSE_DM_GDSO_PRD.AIO.GSP_SPM_ACV",
      "SSE_DM_GDSO_PRD.AIO.GSP_SPM_FORECAST"
    ];
    const nearbyMatches: Array<Record<string, unknown>> = [];

    for (const table of tableCandidates) {
      let resolvedTable = "";
      try {
        resolvedTable = await resolveWorkingTable([table], snowflake);
      } catch {
        continue;
      }
      const idCol = await resolveWorkingColumnOptional(resolvedTable, ["OPTY_ID_18", "OPTY_ID", "OPPORTUNITY_ID", "ID"], snowflake);
      if (!idCol) {
        continue;
      }
      const rows = await snowflake.execute(
        `SELECT * FROM ${resolvedTable}
         WHERE ${idCol} = ? OR LEFT(${idCol}, 15) = ?
         LIMIT 1`,
        [opportunityId, opp15]
      );
      if (rows.length === 0) {
        const candidates = await snowflake.execute(
          `SELECT DISTINCT ${idCol} AS OPP_ID
           FROM ${resolvedTable}
           WHERE ${idCol} ILIKE ?
           ORDER BY 1
           LIMIT 5`,
          [`${opp15.slice(0, 8)}%`]
        );
        for (const c of candidates) {
          nearbyMatches.push({
            table: resolvedTable,
            id_column: idCol,
            opportunity_id: (c as Record<string, unknown>).OPP_ID
          });
        }
        continue;
      }
      const row = (rows[0] ?? {}) as Record<string, unknown>;
      const numericAmountFields = Object.fromEntries(
        Object.entries(row).filter(([k, v]) => /(?:^|_)(AMT|AMOUNT|ACV|CLOUD)(?:_|$)/i.test(k) && typeof v === "number")
      );
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                opportunity_id: opportunityId,
                resolved_table: resolvedTable,
                id_column: idCol,
                amount_fields: numericAmountFields,
                raw_row: row
              },
              null,
              2
            )
          }
        ]
      };
    }

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              clarification_needed: true,
              message: "Opportunity ID not found in SPI mapped Snowflake datasets.",
              opportunity_id: opportunityId,
              nearby_matches: nearbyMatches.slice(0, 10)
            },
            null,
            2
          )
        }
      ]
    };
  }

  if (toolName === "run_formula_metric") {
    const metricId = String(args.metric_id ?? "");
    const fiscalYear = normalizeFiscalYear(String(args.fiscal_year ?? ""));
    const fiscalQuarter = normalizeFiscalQuarter(String(args.fiscal_quarter ?? ""));
    const explicitMonthsProvided = Array.isArray(args.months) && args.months.length > 0;
    const months = explicitMonthsProvided ? (args.months as unknown[]).map((m) => String(m)) : [];
    if (!metricId || !fiscalYear || !fiscalQuarter) {
      throw new Error("metric_id, fiscal_year, and fiscal_quarter are required.");
    }
    const originalQuery = String(args.original_query ?? "");
    if (
      ["spm_forecast_attainment", "spm_pg_contribution"].includes(metricId) &&
      !isScopeConfirmedByQuery(originalQuery, fiscalYear, fiscalQuarter)
    ) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                clarification_needed: true,
                message:
                  "For this financial formula metric, fiscal scope must be explicitly present in the user query (for example FY27 Q2)."
              },
              null,
              2
            )
          }
        ]
      };
    }
    const formulas = await loadFormulaMetrics();
    const formula = formulas.metrics.find((m) => m.id === metricId);
    if (!formula) {
      throw new Error(`Unknown formula metric: ${metricId}`);
    }
    let sqlText = "";
    let binds: Array<string | number> = [];
    if (metricId === "spm_forecast_attainment") {
      const pipegenTable = await resolveWorkingTable([
        "SSE_DM_GDSO_PRD.AIO.GSP_SPM_PIPEGEN",
        "SSE_DM_GDSO_PRD.AIO.GSP_SPM_PG"
      ], snowflake);
      const forecastTable = await resolveWorkingTable([
        "SSE_DM_GDSO_PRD.AIO.GSP_SPM_FORECAST",
        "SSE_DM_GDSO_PRD.AIO.GSP_SPM_FRCST"
      ], snowflake);
      const pgYearCol = await resolveWorkingColumn(pipegenTable, ["FISCAL_FLIP_YEAR", "STG_2_FLG_DT_YEAR_FISCAL"], snowflake);
      const pgQuarterCol = await resolveWorkingColumn(pipegenTable, ["FISCAL_FLIP_QTR", "STG_2_FLG_DT_QUARTER_FISCAL"], snowflake);
      const pgMonthCol = await resolveWorkingColumn(pipegenTable, [
        "FISCAL_FLIP_MON_NUM_LABEL",
        "STG_2_FLG_DT_MONTH",
        "STG_2_FLG_DT_MONTH_FISCAL",
        "STG_2_FLG_DT_MONTH_NUM",
        "FISCAL_FLIP_MONTH"
      ], snowflake);
      const frcstYearCol = await resolveWorkingColumn(forecastTable, [
        "FISCAL_CMPGN_STRT_YEAR",
        "START_DT_YEAR_FISCAL",
        "FISCAL_YEAR"
      ], snowflake);
      const frcstQuarterCol = await resolveWorkingColumn(forecastTable, [
        "FISCAL_CMPGN_STRT_QTR",
        "FISCAL_QUARTER_FORECAST",
        "FISCAL_QUARTER"
      ], snowflake);
      const monthBindPlaceholders = months.map(() => "?").join(", ");
      const yearDigits = fiscalYear.replace(/[^0-9]/g, "");
      const year2 = yearDigits.length >= 2 ? yearDigits.slice(-2) : yearDigits;
      const year4 = yearDigits.length === 2 ? `20${yearDigits}` : yearDigits;
      const quarterDigit = fiscalQuarter.replace(/[^0-9]/g, "");
      const monthDigits = months.map((m) => Number(m));
      const monthPredicate = explicitMonthsProvided
        ? `AND TRY_TO_NUMBER(REGEXP_SUBSTR(TO_VARCHAR(${pgMonthCol}), '[0-9]{1,2}')) IN (${monthBindPlaceholders})`
        : "";

      sqlText = `WITH SPM_PG AS (
        SELECT GDSO_ID, MAX(CLOUD_AMT) AS CLOUD_AMT
        FROM ${pipegenTable}
        WHERE SNAP_YEAR_STATUS='CY'
          AND REGEXP_SUBSTR(TO_VARCHAR(${pgYearCol}), '[0-9]{2,4}') IN (?, ?)
          AND REGEXP_SUBSTR(TO_VARCHAR(${pgQuarterCol}), '[1-4]') = ?
          ${monthPredicate}
        GROUP BY GDSO_ID
      ),
      SPM_FRCST AS (
        SELECT FORECAST_AMT
        FROM ${forecastTable}
        WHERE PROGRAM_TYPE <> 'Pipe Progression'
          AND FORECAST_TYPE = 'Pipe'
          AND REGEXP_SUBSTR(TO_VARCHAR(${frcstYearCol}), '[0-9]{2,4}') IN (?, ?)
          AND REGEXP_SUBSTR(TO_VARCHAR(${frcstQuarterCol}), '[1-4]') = ?
      )
      SELECT
        CASE WHEN COALESCE((SELECT SUM(FORECAST_AMT) FROM SPM_FRCST),0)=0 THEN NULL
             ELSE COALESCE((SELECT SUM(CLOUD_AMT) FROM SPM_PG),0)/COALESCE((SELECT SUM(FORECAST_AMT) FROM SPM_FRCST),0)
        END AS ATTAINMENT,
        COALESCE((SELECT SUM(CLOUD_AMT) FROM SPM_PG),0) AS PIPEGEN_CLOUD_AMT,
        COALESCE((SELECT SUM(FORECAST_AMT) FROM SPM_FRCST),0) AS FORECAST_AMT`;
      binds = explicitMonthsProvided
        ? [year2, year4, quarterDigit, ...monthDigits, year2, year4, quarterDigit]
        : [year2, year4, quarterDigit, year2, year4, quarterDigit];
    } else if (metricId === "spm_pg_contribution") {
      const pipegenTable = await resolveWorkingTable([
        "SSE_DM_GDSO_PRD.AIO.GSP_SPM_PIPEGEN",
        "SSE_DM_GDSO_PRD.AIO.GSP_SPM_PG"
      ], snowflake);
      const totalPgTable = await resolveWorkingTable([
        "SSE_DM_GDSO_PRD.AIO.GDSO_CRT_PIPEGEN",
        "SSE_DM_GDSO_PRD.AIO.GSP_CRT_PIPEGEN",
        "SSE_DM_GDSO_PRD.AIO.GSP_SPM_PIPEGEN"
      ], snowflake);
      const pgYearCol = await resolveWorkingColumn(pipegenTable, ["FISCAL_FLIP_YEAR", "STG_2_FLG_DT_YEAR_FISCAL"], snowflake);
      const pgQuarterCol = await resolveWorkingColumn(pipegenTable, ["FISCAL_FLIP_QTR", "STG_2_FLG_DT_QUARTER_FISCAL"], snowflake);
      const pgMonthCol = await resolveWorkingColumnOptional(pipegenTable, [
        "FISCAL_FLIP_MON_NUM_LABEL",
        "STG_2_FLG_DT_MONTH",
        "STG_2_FLG_DT_MONTH_NUM",
        "FISCAL_FLIP_MONTH"
      ], snowflake);
      const totalYearCol = await resolveWorkingColumn(totalPgTable, ["FISCAL_FLIP_YEAR", "STG_2_FLG_DT_YEAR_FISCAL"], snowflake);
      const totalQuarterCol = await resolveWorkingColumn(totalPgTable, ["FISCAL_FLIP_QTR", "STG_2_FLG_DT_QUARTER_FISCAL"], snowflake);
      const totalMonthCol = await resolveWorkingColumnOptional(totalPgTable, [
        "FISCAL_FLIP_MON_NUM_LABEL",
        "STG_2_FLG_DT_MONTH",
        "STG_2_FLG_DT_MONTH_NUM",
        "FISCAL_FLIP_MONTH"
      ], snowflake);
      const totalSnapCol = await resolveWorkingColumnOptional(totalPgTable, ["SNAP_YEAR_STATUS", "SNAP_STATUS"], snowflake);

      const yearDigits = fiscalYear.replace(/[^0-9]/g, "");
      const year2 = yearDigits.length >= 2 ? yearDigits.slice(-2) : yearDigits;
      const year4 = yearDigits.length === 2 ? `20${yearDigits}` : yearDigits;
      const quarterDigit = fiscalQuarter.replace(/[^0-9]/g, "");
      const monthDigits = months.map((m) => Number(m));
      const monthBindPlaceholders = monthDigits.map(() => "?").join(", ");
      const pgMonthPredicate =
        explicitMonthsProvided && pgMonthCol
          ? `AND TRY_TO_NUMBER(REGEXP_SUBSTR(TO_VARCHAR(${pgMonthCol}), '[0-9]{1,2}')) IN (${monthBindPlaceholders})`
          : "";
      const totalMonthPredicate =
        explicitMonthsProvided && totalMonthCol
          ? `AND TRY_TO_NUMBER(REGEXP_SUBSTR(TO_VARCHAR(${totalMonthCol}), '[0-9]{1,2}')) IN (${monthBindPlaceholders})`
          : "";
      const totalSnapPredicate = totalSnapCol ? `AND ${totalSnapCol} = 'CY'` : "";

      sqlText = `WITH SPM_PG AS (
        SELECT GDSO_ID, MAX(CLOUD_AMT) AS CLOUD_AMT
        FROM ${pipegenTable}
        WHERE SNAP_YEAR_STATUS='CY'
          AND PRODUCT_MATCH='Product Match'
          AND PROGRAM_TEAM='Sales Program'
          AND REGEXP_SUBSTR(TO_VARCHAR(${pgYearCol}), '[0-9]{2,4}') IN (?, ?)
          AND REGEXP_SUBSTR(TO_VARCHAR(${pgQuarterCol}), '[1-4]') = ?
          ${pgMonthPredicate}
        GROUP BY GDSO_ID
      ),
      TOTAL_PG AS (
        SELECT CLOUD_AMT
        FROM ${totalPgTable}
        WHERE REGEXP_SUBSTR(TO_VARCHAR(${totalYearCol}), '[0-9]{2,4}') IN (?, ?)
          AND REGEXP_SUBSTR(TO_VARCHAR(${totalQuarterCol}), '[1-4]') = ?
          ${totalMonthPredicate}
          ${totalSnapPredicate}
      )
      SELECT
        CASE WHEN COALESCE((SELECT SUM(CLOUD_AMT) FROM TOTAL_PG),0)=0 THEN NULL
             ELSE COALESCE((SELECT SUM(CLOUD_AMT) FROM SPM_PG),0)/COALESCE((SELECT SUM(CLOUD_AMT) FROM TOTAL_PG),0)
        END AS PG_CONTRIBUTION,
        COALESCE((SELECT SUM(CLOUD_AMT) FROM SPM_PG),0) AS SPM_PG_CLOUD_AMT,
        COALESCE((SELECT SUM(CLOUD_AMT) FROM TOTAL_PG),0) AS TOTAL_PG_CLOUD_AMT`;
      binds = explicitMonthsProvided
        ? [year2, year4, quarterDigit, ...monthDigits, year2, year4, quarterDigit, ...monthDigits]
        : [year2, year4, quarterDigit, year2, year4, quarterDigit];
    } else {
      const monthBindPlaceholders = months.map(() => "?").join(", ");
      sqlText = formula.sql_template.replace("{{MONTH_BINDS}}", monthBindPlaceholders);
      binds = [fiscalYear, fiscalQuarter, ...months, fiscalYear, fiscalQuarter];
    }
    const rows = await snowflake.execute(sqlText, binds);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              metric_id: metricId,
              fiscal_year: fiscalYear,
              fiscal_quarter: fiscalQuarter,
              months,
              sqlText,
              rowCount: rows.length,
              rows
            },
            null,
            2
          )
        }
      ]
    };
  }

  if (toolName === "resolve_sales_play_for_hierarchy") {
    const personName = String(args.person_name ?? "").trim();
    const hierarchyLevel = String(args.hierarchy_level ?? "SPM_HIER_LVL_4").toUpperCase();
    const fiscalYear = String(args.fiscal_year ?? "FY27").toUpperCase();
    if (!personName) {
      throw new Error("person_name is required");
    }
    if (!["SPM_HIER_LVL_2", "SPM_HIER_LVL_3", "SPM_HIER_LVL_4"].includes(hierarchyLevel)) {
      throw new Error("hierarchy_level must be one of SPM_HIER_LVL_2/SPM_HIER_LVL_3/SPM_HIER_LVL_4");
    }

    const hierarchyCandidates =
      hierarchyLevel === "SPM_HIER_LVL_4"
        ? ["SPM_HIER_LVL_4", "OWNER_L4_EMP_NAME", "PROGRAM_OWNER_NAME"]
        : hierarchyLevel === "SPM_HIER_LVL_3"
          ? ["SPM_HIER_LVL_3", "OWNER_L3_EMP_NAME"]
          : ["SPM_HIER_LVL_2", "OWNER_L2_EMP_NAME"];
    const fiscalYearCandidates = ["FISCAL_START_YEAR", "FISCAL_YEAR", "FISCALYEAR__C"];
    const salesPlayCandidates = ["SALES_PLAY_NAME", "SALES_PLAY", "PROGRAM_TYPE"];

    const resolvedHierarchyColumn = await resolveWorkingColumn(
      "SSE_DM_GDSO_PRD.AIO.GSP_SPM_TARGET_ACCTS",
      hierarchyCandidates,
      snowflake
    );
    const resolvedFiscalYearColumn = await resolveWorkingColumnOptional(
      "SSE_DM_GDSO_PRD.AIO.GSP_SPM_TARGET_ACCTS",
      fiscalYearCandidates,
      snowflake
    );
    const resolvedSalesPlayColumn = await resolveWorkingColumn(
      "SSE_DM_GDSO_PRD.AIO.GSP_SPM_TARGET_ACCTS",
      salesPlayCandidates,
      snowflake
    );

    const nameMatches = await snowflake.execute(
      `SELECT DISTINCT ${resolvedHierarchyColumn} AS PERSON_NAME
       FROM SSE_DM_GDSO_PRD.AIO.GSP_SPM_TARGET_ACCTS
       WHERE ${resolvedHierarchyColumn} ILIKE ?
       ORDER BY 1
       LIMIT 10`,
      [`%${personName}%`]
    );

    const exact = nameMatches.find((row) => String((row as Record<string, unknown>).PERSON_NAME ?? "") === personName);
    if (!exact) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                clarification_needed: true,
                message: "I need the exact hierarchy person name before running the final sales-play query.",
                suggestions: nameMatches.map((row) => (row as Record<string, unknown>).PERSON_NAME)
              },
              null,
              2
            )
          }
        ]
      };
    }

    const fiscalFilterClause = resolvedFiscalYearColumn ? `AND ${resolvedFiscalYearColumn} = ?` : "";
    const binds = resolvedFiscalYearColumn ? [personName, fiscalYear] : [personName];
    const rows = await snowflake.execute(
      `SELECT ${resolvedSalesPlayColumn} AS SALES_PLAY_NAME, COUNT(DISTINCT PROGRAM_ID) AS PROGRAM_COUNT
       FROM SSE_DM_GDSO_PRD.AIO.GSP_SPM_TARGET_ACCTS
       WHERE ${resolvedHierarchyColumn} = ?
         ${fiscalFilterClause}
       GROUP BY ${resolvedSalesPlayColumn}
       ORDER BY PROGRAM_COUNT DESC
       LIMIT 20`,
      binds
    );

    const quality = assessResultQuality(rows);
    if (quality.clarificationNeeded) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                clarification_needed: true,
                message: "No valid rows for this person/year scope. Please confirm hierarchy level and fiscal year.",
                clarifying_questions: [
                  "Is the person at SPM_HIER_LVL_4, or should I use L2/L3?",
                  "Should I use FY27 or another fiscal year?",
                  "Should I broaden beyond one hierarchy person?"
                ]
              },
              null,
              2
            )
          }
        ]
      };
    }

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              person_name: personName,
              hierarchy_level: hierarchyLevel,
              fiscal_year: resolvedFiscalYearColumn ? fiscalYear : "ALL_AVAILABLE",
              top_sales_play: rows[0] ?? null,
              top_sales_plays: rows
            },
            null,
            2
          )
        }
      ]
    };
  }

  const metricId = String(args.metric_id ?? "");
  const metric = catalog.metrics.find((m) => m.id === metricId);
  if (!metric) {
    if (metricId.toLowerCase().includes("forecast_attainment")) {
      throw new Error(
        "Forecast attainment is a formula metric. Use run_forecast_attainment or run_formula_metric(metric_id='spm_forecast_attainment', fiscal_year, fiscal_quarter)."
      );
    }
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
    const qualityGate = assessResultQuality(rows);
    if (qualityGate.clarificationNeeded) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                clarification_needed: true,
                message:
                  "Query returned low-signal output (empty/all-null). Please confirm scope to avoid misleading results.",
                clarifying_questions: defaultClarifyingQuestions(metric.snowflakeColumns),
                diagnostics: qualityGate
              },
              null,
              2
            )
          }
        ]
      };
    }
    const includeVisualization = args.include_visualization !== false;
    const visualization = includeVisualization ? buildVisualizationPayload(rows, metric.name) : null;
    const chartImageUrl = visualization ? await renderAndUploadChart(visualization, `run_metric_query_${metric.id}_${Date.now()}`) : null;
    const slackBlocks = visualization ? buildSlackBlocks(visualization, chartImageUrl) : null;
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
              chart_image_url: chartImageUrl,
              slack_blocks: slackBlocks,
              presentation_hints: {
                render_component: visualization?.component ?? "table",
                chart_available: chartImageUrl !== null,
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
    const scenario = scenarioCatalog.scenarios.find((s) => s.metric_id === metric.id);
    if (!scenario) {
      throw new Error(`No scenario definition found for metric: ${metric.id}`);
    }
    const groupBy = Array.isArray(args.group_by) ? args.group_by.map(String) : [];
    const filters = (args.filters ?? {}) as Record<string, string | number>;
    const includeYoy = args.include_yoy === true;
    const fiscalYear = typeof args.fiscal_year === "string" ? args.fiscal_year : undefined;
    const topN = typeof args.top_n === "number" ? args.top_n : undefined;
    const requireDisambiguation = args.require_disambiguation !== false;
    const filterValidation = await validateFilters({
      sourceTable: metric.sourceTable,
      scenarioCatalog,
      metricId: metric.id,
      filters,
      snowflake
    });
    if (requireDisambiguation && filterValidation.clarificationNeeded) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                clarification_needed: true,
                message:
                  "One or more filter values did not match table data. Please pick one of the suggested values.",
                filter_issues: filterValidation.issues
              },
              null,
              2
            )
          }
        ]
      };
    }

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
    let rows = await snowflake.execute(adaptive.sqlText, adaptive.binds);
    let fallbackApplied = false;
    let fallbackReason: string | null = null;

    // If the selected slice returns empty, retry once without fixed fiscal-year filter.
    if (
      rows.length === 0 &&
      args.auto_period_fallback !== false &&
      Object.keys(scenario.fixed_filters ?? {}).some((k) => k.toUpperCase().includes("FISCAL_YEAR"))
    ) {
      const fallbackCatalog = withFiscalYearFixedFiltersRemoved(scenarioCatalog, metric.id);
      const fallbackQuery = buildAdaptiveQuery({
        metricId: metric.id,
        scenarioCatalog: fallbackCatalog,
        sourceTable: metric.sourceTable,
        groupBy,
        filters,
        includeYoy,
        fiscalYear,
        topN
      });
      const fallbackRows = await snowflake.execute(fallbackQuery.sqlText, fallbackQuery.binds);
      if (fallbackRows.length > 0) {
        rows = fallbackRows;
        fallbackApplied = true;
        fallbackReason = "No rows for requested fixed fiscal year; retried using broader period.";
      }
    }
    const qualityGate = assessResultQuality(rows);
    if (qualityGate.clarificationNeeded) {
      const allowedFilters = Object.keys(scenario.groupable_dimensions);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                clarification_needed: true,
                message:
                  "Result set is empty or low-signal. Please refine filters before final output.",
                clarifying_questions: [
                  "Which fiscal period should I use (FY/quarter/month)?",
                  "Which program scope should I apply (program_type, program_status, seller_type)?",
                  "Should I include only non-null performance records?"
                ],
                suggested_filter_keys: allowedFilters,
                diagnostics: {
                  qualityGate,
                  fallbackApplied,
                  fallbackReason
                }
              },
              null,
              2
            )
          }
        ]
      };
    }
    const visualization = buildVisualizationPayload(rows, `${metric.name} adaptive analysis`);
    const chartImageUrl = await renderAndUploadChart(visualization, `run_adaptive_metric_query_${metric.id}_${Date.now()}`);
    const slackBlocks = buildSlackBlocks(visualization, chartImageUrl);
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
              visualization,
              chart_image_url: chartImageUrl,
              slack_blocks: slackBlocks,
              diagnostics: {
                fallbackApplied,
                fallbackReason,
                filterValidation
              }
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

async function resolveDatasetTable(dataset: string, registry: DashboardDatasetRegistry, snowflake: SnowflakeClient): Promise<string | null> {
  const entry = registry.datasets.find((d) => d.dataset === dataset);
  const candidates = new Set<string>(entry?.table_candidates ?? []);
  const normalized = dataset.replace(/^dev_/i, "");
  const upper = normalized.toUpperCase();
  candidates.add(`SSE_DM_GDSO_PRD.AIO.${upper}`);
  candidates.add(`SSE_DM_GDSO_PRD.AIO.${upper}_PERM`);
  candidates.add(`SSE_DM_GDSO_PRD.AIO.${upper}_VW`);
  if (!upper.startsWith("GSP_")) {
    candidates.add(`SSE_DM_GDSO_PRD.AIO.GSP_${upper}`);
  }
  try {
    return await resolveWorkingTable([...candidates], snowflake);
  } catch {
    return null;
  }
}

function normalizeFiscalYear(input: string): string {
  const s = input.trim().toUpperCase();
  if (!s) return "";
  if (s.startsWith("FY ")) return s;
  if (s.startsWith("FY")) {
    const year = s.replace("FY", "").trim();
    return `FY ${year}`;
  }
  if (/^\d{4}$/.test(s)) return `FY ${s}`;
  return s;
}

function normalizeFiscalQuarter(input: string): string {
  const s = input.trim().toUpperCase();
  if (!s) return "";
  if (s.startsWith("FQ ")) return s;
  if (s.startsWith("FQ")) {
    const q = s.replace("FQ", "").trim();
    return `FQ ${q}`;
  }
  if (/^[1-4]$/.test(s)) return `FQ ${s}`;
  if (/^Q[1-4]$/.test(s)) return `FQ ${s.slice(1)}`;
  return s;
}

function defaultMonthsForQuarter(fiscalQuarter: string): string[] {
  const q = fiscalQuarter.replace(/[^0-9]/g, "").trim();
  if (q === "1") return ["02", "03", "04"];
  if (q === "2") return ["05", "06", "07"];
  if (q === "3") return ["08", "09", "10"];
  if (q === "4") return ["11", "12", "01"];
  return ["02", "03", "04"];
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
  if (uri === "spi://resources/dashboard-lens-catalog") {
    const data = await loadDashboardLensCatalog();
    return { contents: [{ uri, mimeType: "application/json", text: JSON.stringify(data, null, 2) }] };
  }
  if (uri === "spi://resources/dashboard-dataset-registry") {
    const data = await loadDashboardDatasetRegistry();
    return { contents: [{ uri, mimeType: "application/json", text: JSON.stringify(data, null, 2) }] };
  }
  if (uri === "spi://resources/semantic-catalog") {
    const data = await loadSemanticCatalog();
    return { contents: [{ uri, mimeType: "application/json", text: JSON.stringify(data, null, 2) }] };
  }
  throw new Error(`Resource not found: ${uri}`);
}

function buildSemanticRoute(
  input: { query: string; fiscalYear?: string; fiscalQuarter?: string; opportunityId?: string },
  semanticCatalog: {
    intents: Array<{
      id: string;
      match_phrases: string[];
      route_tool: string;
      required_context?: string[];
      default_arguments?: Record<string, unknown>;
    }>;
  }
): {
  intent_id: string;
  route_tool: string;
  arguments: Record<string, unknown>;
  clarification_needed: boolean;
  message?: string;
} {
  const query = input.query.trim();
  const q = query.toLowerCase();
  const inferredScope = extractFiscalScope(query);
  const fiscalYear = input.fiscalYear ?? inferredScope.fiscalYear;
  const fiscalQuarter = input.fiscalQuarter ?? inferredScope.fiscalQuarter;
  const financialIntent =
    q.includes("contribution") ||
    q.includes("attainment") ||
    q.includes("forecast") ||
    q.includes("pipegen") ||
    q.includes("acv") ||
    q.includes("closed rate");
  const oppMatch = input.opportunityId ?? query.match(/\b006[a-z0-9]{12,15}\b/i)?.[0];
  if (oppMatch) {
    return {
      intent_id: "opportunity_amount_lookup",
      route_tool: "lookup_opportunity_amount",
      arguments: { opportunity_id: oppMatch },
      clarification_needed: false
    };
  }
  if (q.includes("forecast attainment") || (q.includes("attainment") && q.includes("forecast"))) {
    if (!fiscalYear || !fiscalQuarter) {
      return {
        intent_id: "forecast_attainment",
        route_tool: "run_forecast_attainment",
        arguments: {},
        clarification_needed: true,
        message: "Please provide fiscal_year and fiscal_quarter for forecast attainment."
      };
    }
    return {
      intent_id: "forecast_attainment",
      route_tool: "run_forecast_attainment",
      arguments: {
        fiscal_year: fiscalYear,
        fiscal_quarter: fiscalQuarter,
        original_query: query
      },
      clarification_needed: false
    };
  }

  if (q.includes("pg contribution") || q.includes("pg contribution (%)")) {
    if (!fiscalYear || !fiscalQuarter) {
      return {
        intent_id: "pg_contribution",
        route_tool: "run_pg_contribution",
        arguments: {},
        clarification_needed: true,
        message: "Please provide fiscal_year and fiscal_quarter for PG Contribution (%)."
      };
    }
    return {
      intent_id: "pg_contribution",
      route_tool: "run_pg_contribution",
      arguments: {
        fiscal_year: fiscalYear,
        fiscal_quarter: fiscalQuarter,
        original_query: query
      },
      clarification_needed: false
    };
  }

  if (financialIntent && (!fiscalYear || !fiscalQuarter)) {
    return {
      intent_id: "financial_scope_required",
      route_tool: "route_semantic_query",
      arguments: {},
      clarification_needed: true,
      message:
        "Please confirm fiscal scope before I run this financial metric. Share fiscal_year (for example FY27) and fiscal_quarter (for example Q1/Q2)."
    };
  }

  const scored = semanticCatalog.intents
    .map((intent) => {
      const score = intent.match_phrases.reduce(
        (acc, phrase) => (q.includes(phrase.toLowerCase()) ? acc + Math.max(phrase.length, 1) : acc),
        0
      );
      return { intent, score };
    })
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score);
  const top = scored[0]?.intent;
  const second = scored[1];
  if (top && second && second.score === scored[0].score && scored[0].score > 0) {
    return {
      intent_id: "ambiguous_metric",
      route_tool: "route_semantic_query",
      arguments: {},
      clarification_needed: true,
      message:
        "I found multiple matching metrics for this query. Please specify the exact metric name shown in dashboard."
    };
  }
  if (top) {
    const required = new Set(top.required_context ?? []);
    if (required.has("fiscal_year") && !fiscalYear) {
      return {
        intent_id: top.id,
        route_tool: top.route_tool,
        arguments: {},
        clarification_needed: true,
        message: "Please provide fiscal_year (for example FY27)."
      };
    }
    if (required.has("fiscal_quarter") && !fiscalQuarter) {
      return {
        intent_id: top.id,
        route_tool: top.route_tool,
        arguments: {},
        clarification_needed: true,
        message: "Please provide fiscal_quarter (for example Q1/Q2)."
      };
    }
    return {
      intent_id: top.id,
      route_tool: top.route_tool,
      arguments: {
        ...(top.default_arguments ?? {}),
        ...(fiscalYear ? { fiscal_year: fiscalYear } : {}),
        ...(fiscalQuarter ? { fiscal_quarter: fiscalQuarter } : {}),
        original_query: query
      },
      clarification_needed: false
    };
  }

  return {
    intent_id: "fallback",
    route_tool: "query_dashboard_dataset",
    arguments: {},
    clarification_needed: true,
    message:
      "Could not deterministically route this query yet. Please provide metric name or dataset/measure to avoid wrong answers."
  };
}

function extractFiscalScope(query: string): { fiscalYear?: string; fiscalQuarter?: string } {
  const yearMatch = query.match(/\b(?:fy\s*)?(\d{2}|\d{4})\b/i);
  const quarterMatch = query.match(/\b(?:f?q(?:uarter)?\s*)([1-4])\b/i);
  const fiscalYear = yearMatch
    ? yearMatch[1].length === 2
      ? `FY${yearMatch[1]}`
      : `FY${yearMatch[1].slice(-2)}`
    : undefined;
  const fiscalQuarter = quarterMatch ? `Q${quarterMatch[1]}` : undefined;
  return { fiscalYear, fiscalQuarter };
}

function isScopeConfirmedByQuery(query: string, fiscalYear: string, fiscalQuarter: string): boolean {
  const q = query.toLowerCase();
  if (!q.trim()) return false;
  const fyDigits = fiscalYear.replace(/[^0-9]/g, "");
  const fy2 = fyDigits.length >= 2 ? fyDigits.slice(-2) : fyDigits;
  const fy4 = fyDigits.length === 2 ? `20${fyDigits}` : fyDigits;
  const fq = fiscalQuarter.replace(/[^0-9]/g, "");
  const hasYear = !!fy2 && (q.includes(`fy${fy2}`) || (!!fy4 && q.includes(fy4)));
  const hasQuarter = !!fq && (q.includes(`q${fq}`) || q.includes(`fq${fq}`) || q.includes(`quarter ${fq}`));
  return hasYear && hasQuarter;
}

function ok(id: string | number | null, result: unknown): JsonRpcResponse {
  return { jsonrpc: "2.0", id, result };
}

function fail(id: string | number | null, code: number, message: string): JsonRpcResponse {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

function safeIdentifier(value: string): string {
  const upper = value.toUpperCase();
  if (!IDENTIFIER.test(upper)) {
    throw new Error(`Unsafe identifier: ${value}`);
  }
  return upper;
}

function withFiscalYearFixedFiltersRemoved(
  scenarioCatalog: MetricScenarioCatalog,
  metricId: string
): MetricScenarioCatalog {
  return {
    scenarios: scenarioCatalog.scenarios.map((scenario) => {
      if (scenario.metric_id !== metricId || !scenario.fixed_filters) {
        return scenario;
      }
      const filtered = Object.fromEntries(
        Object.entries(scenario.fixed_filters).filter(([k]) => !k.toUpperCase().includes("FISCAL_YEAR"))
      );
      return { ...scenario, fixed_filters: filtered };
    })
  };
}

function assessResultQuality(rows: unknown[]): {
  clarificationNeeded: boolean;
  reason: string | null;
  rowCount: number;
} {
  if (rows.length === 0) {
    return { clarificationNeeded: true, reason: "no rows", rowCount: 0 };
  }
  const objectRows = rows.filter((r): r is Record<string, unknown> => typeof r === "object" && r !== null);
  if (objectRows.length === 0) {
    return { clarificationNeeded: true, reason: "non-tabular rows", rowCount: rows.length };
  }
  const numericKeys = Object.keys(objectRows[0]).filter((k) =>
    objectRows.some((row) => typeof row[k] === "number" || row[k] === null)
  );
  if (numericKeys.length === 0) {
    return { clarificationNeeded: false, reason: null, rowCount: rows.length };
  }
  const allNullOrZero = numericKeys.every((key) =>
    objectRows.every((row) => row[key] === null || row[key] === 0)
  );
  if (allNullOrZero) {
    return { clarificationNeeded: true, reason: "all numeric measures are null/zero", rowCount: rows.length };
  }
  return { clarificationNeeded: false, reason: null, rowCount: rows.length };
}

function defaultClarifyingQuestions(availableFilterMap: Record<string, string>): string[] {
  const keys = Object.keys(availableFilterMap);
  return [
    "Which fiscal period should I use (FY/quarter/month)?",
    "Do you want a specific region/segment/program scope?",
    keys.length > 0
      ? `Please choose filters from: ${keys.slice(0, 8).join(", ")}${keys.length > 8 ? ", ..." : ""}`
      : "Do you want me to broaden the filters to include non-empty records?"
  ];
}

async function resolveWorkingColumn(tableName: string, candidates: string[], snowflake: SnowflakeClient): Promise<string> {
  for (const candidate of candidates) {
    try {
      await snowflake.execute(`SELECT ${candidate} FROM ${tableName} LIMIT 1`);
      return candidate;
    } catch {
      // try next candidate
    }
  }
  throw new Error(`Could not resolve a valid column in ${tableName} from candidates: ${candidates.join(", ")}`);
}

async function resolveWorkingColumnOptional(tableName: string, candidates: string[], snowflake: SnowflakeClient): Promise<string | null> {
  for (const candidate of candidates) {
    try {
      await snowflake.execute(`SELECT ${candidate} FROM ${tableName} LIMIT 1`);
      return candidate;
    } catch {
      // try next candidate
    }
  }
  return null;
}

async function resolveWorkingTable(candidates: string[], snowflake: SnowflakeClient): Promise<string> {
  for (const candidate of candidates) {
    try {
      await snowflake.execute(`SELECT 1 FROM ${candidate} LIMIT 1`);
      return candidate;
    } catch {
      // try next table
    }
  }
  throw new Error(`Could not resolve a valid table from candidates: ${candidates.join(", ")}`);
}

async function validateFilters(input: {
  sourceTable: string;
  scenarioCatalog: MetricScenarioCatalog;
  metricId: string;
  filters: Record<string, string | number>;
  snowflake: SnowflakeClient;
}): Promise<{
  clarificationNeeded: boolean;
  issues: Array<{ filterKey: string; filterValue: string | number; column: string; suggestions: string[]; reason?: string }>;
}> {
  const scenario = input.scenarioCatalog.scenarios.find((s) => s.metric_id === input.metricId);
  if (!scenario) {
    return { clarificationNeeded: false, issues: [] };
  }

  const issues: Array<{
    filterKey: string;
    filterValue: string | number;
    column: string;
    suggestions: string[];
    reason?: string;
  }> = [];

  for (const [filterKey, filterValue] of Object.entries(input.filters)) {
    const mapped = scenario.groupable_dimensions[filterKey];
    if (!mapped) {
      issues.push({
        filterKey,
        filterValue,
        column: "",
        suggestions: Object.keys(scenario.groupable_dimensions),
        reason: "unknown filter key"
      });
      continue;
    }
    if (typeof filterValue !== "string") {
      continue;
    }
    const column = safeIdentifier(mapped);
    const exactRows = await input.snowflake.execute(
      `SELECT COUNT(1) AS CNT FROM ${input.sourceTable} WHERE ${column} = ?`,
      [filterValue]
    );
    const exactCount = Number((exactRows[0] as Record<string, unknown> | undefined)?.CNT ?? 0);
    if (exactCount > 0) {
      continue;
    }
    const suggestionRows = await input.snowflake.execute(
      `SELECT DISTINCT ${column} AS VALUE FROM ${input.sourceTable} WHERE ${column} ILIKE ? ORDER BY 1 LIMIT 8`,
      [`%${filterValue}%`]
    );
    const suggestions = (suggestionRows as Array<Record<string, unknown>>)
      .map((row) => String(row.VALUE ?? ""))
      .filter((v) => v.length > 0);
    issues.push({ filterKey, filterValue, column, suggestions });
  }

  return { clarificationNeeded: issues.length > 0, issues };
}

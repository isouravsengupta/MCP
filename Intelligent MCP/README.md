# SPI MCP (Snowflake + Slack Surface)

This project is a starter MCP server for the SPI use case discussed in:
- `Knowledge Sharing - MCP  - 2026/06/05 15:30 IST - Notes by Gemini`
- `SPI-AOS Agent Roundtable: Use Cases & Best Practices - 2026/06/05 11:58 BST - Notes by Gemini`

It is designed to:
- expose deterministic tools for Slack-driven usage (Markus scenario),
- map CRMA metric logic to Snowflake SQL,
- expose mappings as MCP resources,
- run on AWS Lambda behind API Gateway.

## What this starter includes

- JSON-RPC MCP endpoint with:
  - `initialize`
  - `tools/list`
  - `tools/call`
  - `resources/list`
  - `resources/read`
- Tools:
  - `list_crma_metrics`
  - `generate_sql_from_metric`
  - `run_metric_query` (returns `visualization` + `presentation_hints` for Slack component rendering)
  - `run_adaptive_metric_query` (grouping, top-N, and YoY scenarios from metric scenario definitions)
  - `search_context_assets` (find ETL/DAG/CRMA lineage files by topic keywords)
- Resources:
  - `spi://resources/metric-mappings`
  - `spi://resources/column-dictionary`
  - `spi://resources/context-registry`
  - `spi://resources/metric-regression-checks`
  - `spi://resources/metric-scenarios`
  - `spi://resources/context-assets-index`
- Snowflake execution support with two auth modes:
 - Snowflake execution support with auth modes:
  - `password` (service user)
  - `keypair` (service principal keypair)
  - `sso` (SSO authenticator; can be used for local testing)

> Note: interactive personal SSO (for example `externalbrowser`) is typically not suitable inside Lambda. Keep production Lambda on non-interactive auth (`password` or `keypair`) unless your Snowflake team provides non-interactive SSO/OAuth token exchange.

## Setup

```bash
npm install
npm run build
```

Required env vars:

```bash
SNOWFLAKE_ACCOUNT=...
SNOWFLAKE_USERNAME=...
SNOWFLAKE_WAREHOUSE=...
SNOWFLAKE_DATABASE=...
SNOWFLAKE_SCHEMA=...
SNOWFLAKE_ROLE=...                  # optional
SNOWFLAKE_AUTHENTICATOR=...         # optional
SPI_SNOWFLAKE_AUTH_MODE=password    # password | keypair | sso
SNOWFLAKE_AUTHENTICATOR=...         # required for sso (e.g. externalbrowser or Okta URL)

# if password mode
SNOWFLAKE_PASSWORD=...

# if keypair mode
SNOWFLAKE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----..."
SNOWFLAKE_PRIVATE_KEY_PASSPHRASE=... # optional

# if sso mode (optional token for oauth-based flows)
SNOWFLAKE_ACCESS_TOKEN=...
```

## Deploy on AWS Lambda

Recommended path (automated script):

```bash
export AWS_PROFILE=<your-profile>
export AWS_REGION=us-east-1
export SNOWFLAKE_PASSWORD='<snowflake-password>'
export MCP_AUTH_TOKEN="$(openssl rand -hex 32)"
export SPI_SNOWFLAKE_AUTH_MODE=password
./infra/deploy-prod.sh
```

What the script does:
1. Builds TypeScript output.
2. Creates/updates Secrets Manager secret for Snowflake password.
3. Deploys SAM stack (`spi-mcp-prod`) with IAM + Lambda + HTTP API.
4. Invokes Lambda once for a smoke check.
5. Prints MCP endpoint URL for Slack admin configuration.

### SSO testing option (additional mode)

You can test SSO wiring in this same MCP codebase without removing service-account auth:

```bash
export SPI_SNOWFLAKE_AUTH_MODE=sso
export SNOWFLAKE_AUTHENTICATOR=externalbrowser
./infra/deploy-prod.sh
```

For Lambda workloads, keep `password` mode unless non-interactive SSO/OAuth is available.

## Operations and recoverability

- Daily context sync script: `ops/sync-context.sh`
- Rebuild/deployment runbook: `ops/REBUILD_AND_RECOVER.md`
- Snapshot backup script: `ops/backup-mcp.sh`
- Deployment smoke check: `ops/smoke-check.sh`

## How to adapt for your CRMA dashboard

1. Replace `resources/metric_mappings.example.json` with your dashboard logic.
2. Add CRMA -> Snowflake field map in `resources/column_dictionary.example.json`.
3. For each metric:
   - define deterministic `sqlTemplate`,
   - explicitly whitelist allowed filter keys in `snowflakeColumns`.
4. Add validation tests that compare SPI MCP output with dashboard-known values for fixed snapshots.

## Suggested next implementation increments

1. Add unit tests for SQL generation and whitelist enforcement.
2. Add `validate_metric_against_expected` tool for golden test cases.
3. Add query timeout/row-limit safeguards and audit logging.
4. Add per-user authorization checks for Slack identities.
5. Add caching for repeated aggregate queries.
6. Map `visualization.component` to Slack app blocks or a Canvas renderer for richer chart rendering.

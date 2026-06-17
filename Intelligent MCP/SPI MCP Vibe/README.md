# spi-mcp-vibe

SPI MCP server — gives Markus and the GSI leadership team natural-language access to
Snowflake sales data from Slack. Results match CRMA dashboard calculations exactly.

Compare with `spi-mcp` (Cursor-generated starter) to evaluate both approaches before
deciding which to deploy.

**Key differences from `spi-mcp`:**
| | spi-mcp | spi-mcp-vibe |
|---|---|---|
| Metric catalog | 1 example metric | 12 production metrics (SPM + QAP) |
| Auth modes | password / keypair | password / keypair / **SSO** |
| Keypair on Lambda | SNOWFLAKE_PRIVATE_KEY env var | **Secrets Manager ARN** (more secure) |
| Tools | 3 | **5** (+ list_tables, describe_table) |
| Bearer token auth | ❌ | ✅ |
| Filter validation error messages | generic | shows available metric IDs |

---

## Architecture

```
Slack (Markus asks a question)
  │  JSON-RPC  (Bearer token)
  ▼
AWS API Gateway (HTTP API)
  │
  ▼
AWS Lambda  [Node.js 20 / arm64]
  ├── src/lambda.ts     Bearer auth + JSON-RPC routing
  ├── src/server.ts     MCP protocol (initialize / tools / resources)
  ├── src/snowflake.ts  Snowflake SDK (keypair JWT / SSO / password)
  ├── src/sqlBuilder.ts Safe parameterised SQL from metric definitions
  ├── src/resources.ts  Loads JSON catalogs
  ├── src/config.ts     Env validation + Secrets Manager fetch
  └── resources/
      ├── metric_mappings.json    12 CRMA metrics (SPM + QAP)
      └── column_dictionary.json  CRMA field → Snowflake column map
```

---

## Quick start (local dev with SSO)

```bash
cd spi-mcp-vibe
npm install

cp .env.example .env
# Edit .env — set your SNOWFLAKE_ACCOUNT, SNOWFLAKE_USERNAME, etc.
# SPI_SNOWFLAKE_AUTH_MODE=sso  (default — opens browser for Salesforce SSO)

npm run dev
# Server starts; first Snowflake query opens your browser for SSO login
```

Test the MCP protocol:
```bash
# List tools
curl -s -X POST http://localhost:3000 \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' | jq .

# Run a metric query
curl -s -X POST http://localhost:3000 \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"run_metric_query","arguments":{"metric_id":"spm_acv_attainment_pct","filters":{"fiscal_quarter":"Q2FY27","region":"EMEA"}}}}' | jq .
```

---

## Deploying to AWS Lambda

### Step 1 — Create Snowflake service account

```sql
-- Run as ACCOUNTADMIN in Snowflake
CREATE ROLE SPI_MCP_ROLE;
CREATE USER SVC_SPI_MCP
  DEFAULT_ROLE     = SPI_MCP_ROLE
  DEFAULT_WAREHOUSE = SPI_WH
  RSA_PUBLIC_KEY   = '<public key without header/footer>';

GRANT USAGE  ON DATABASE SPI_DB TO ROLE SPI_MCP_ROLE;
GRANT USAGE  ON SCHEMA SPI_DB.SALES_PLANNING TO ROLE SPI_MCP_ROLE;
GRANT SELECT ON ALL TABLES IN SCHEMA SPI_DB.SALES_PLANNING TO ROLE SPI_MCP_ROLE;
GRANT SELECT ON ALL VIEWS  IN SCHEMA SPI_DB.SALES_PLANNING TO ROLE SPI_MCP_ROLE;
GRANT SELECT ON FUTURE TABLES IN SCHEMA SPI_DB.SALES_PLANNING TO ROLE SPI_MCP_ROLE;
GRANT SELECT ON FUTURE VIEWS  IN SCHEMA SPI_DB.SALES_PLANNING TO ROLE SPI_MCP_ROLE;
GRANT ROLE SPI_MCP_ROLE TO USER SVC_SPI_MCP;
```

Generate key pair:
```bash
openssl genrsa 2048 | openssl pkcs8 -topk8 -inform PEM -out snowflake_private.pem -nocrypt
openssl rsa -in snowflake_private.pem -pubout -out snowflake_public.pem
# Paste the public key (contents only, no header/footer) into RSA_PUBLIC_KEY above
```

### Step 2 — Store private key in Secrets Manager

```bash
aws secretsmanager create-secret \
  --name spi/snowflake-keypair \
  --secret-string "{\"private_key_pem\": \"$(cat snowflake_private.pem | tr -d '\n')\", \"passphrase\": \"\"}"
# Note the returned ARN
```

### Step 3 — Update metric catalog tables

Edit `resources/metric_mappings.json` — replace `sourceTable` values with your actual Snowflake view names:
```json
"sourceTable": "SALES_PLANNING.SPM_PERFORMANCE_V"
```

### Step 4 — Build and deploy

```bash
npm install && npm run build

# Install SAM CLI if not already: https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/install-sam-cli.html

sam build --template infra/template.yaml

sam deploy --guided \
  --stack-name spi-mcp-vibe-prod \
  --capabilities CAPABILITY_IAM CAPABILITY_NAMED_IAM

# Prompted parameters:
#   SnowflakeAccount    = your-account-identifier
#   SnowflakeUsername   = SVC_SPI_MCP
#   SnowflakeWarehouse  = SPI_WH
#   SnowflakeDatabase   = SPI_DB
#   SnowflakeSchema     = SALES_PLANNING
#   SnowflakeRole       = SPI_MCP_ROLE
#   SnowflakeSecretArn  = arn:aws:secretsmanager:... (from Step 2)
#   McpAuthToken        = $(openssl rand -hex 32)
```

Note the **McpEndpointUrl** in the deploy output.

### Step 5 — Configure Slack (Admin)

1. **Slack Admin → Integrations → AI & Agents → MCP Servers → Add MCP Server**
2. Name: `SPI Sales Intelligence`
3. URL: `<McpEndpointUrl>` from Step 4
4. Auth: Bearer token → your `McpAuthToken`
5. Save + Enable

### Step 6 — Register the Slack Skill

1. Open [slack-skill/spi-sales-data.md](slack-skill/spi-sales-data.md)
2. **Slack Admin → Skills → New Skill** → paste the content
3. Name: `SPI Sales Data`; enable for the relevant workspace

The skill enforces the four-step deterministic sequence (list metrics → run query →
format) so the agent never hallucinates or picks the wrong tool.

---

## Extending the metric catalog

1. Open `resources/metric_mappings.json`
2. Add a new object to the `metrics` array
3. Required fields:
   - `id` — unique camelCase key (e.g. `spm_my_new_metric`)
   - `sqlTemplate` — full `SELECT ... FROM <table>` (no WHERE/LIMIT)
   - `snowflakeColumns` — whitelisted filter keys → column names (safe injection)
4. `npm run check` to verify TypeScript, then redeploy

---

## Security

- Parameterised binds for all filter values — no string interpolation
- Identifier allowlist (`/^[A-Z_][A-Z0-9_]*$/`) for table/column references
- Bearer token on every request — unauth returns 401
- Lambda IAM role limited to `secretsmanager:GetSecretValue` on the specific ARN
- Private key lives only in Secrets Manager + Lambda memory, never logged

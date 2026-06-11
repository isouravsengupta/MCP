#!/usr/bin/env bash
set -euo pipefail

# End-to-end MCP smoke check for deployed endpoint.
#
# Required:
#   MCP_ENDPOINT=https://<api-id>.execute-api.<region>.amazonaws.com/prod/
#
# Optional:
#   MCP_AUTH_TOKEN=<token>  # only if auth is enabled

: "${MCP_ENDPOINT:?MCP_ENDPOINT is required}"

AUTH_HEADER=()
if [[ -n "${MCP_AUTH_TOKEN:-}" ]]; then
  AUTH_HEADER=(-H "authorization: Bearer ${MCP_AUTH_TOKEN}")
fi

call_mcp() {
  local payload="$1"
  curl -sS -X POST "${MCP_ENDPOINT}" \
    -H "content-type: application/json" \
    "${AUTH_HEADER[@]}" \
    --data "${payload}"
}

echo "1) initialize"
call_mcp '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}'
echo ""
echo "2) tools/list"
call_mcp '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}'
echo ""
echo "3) health_ping"
call_mcp '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"health_ping","arguments":{}}}'
echo ""
echo "4) snowflake_connectivity_probe"
call_mcp '{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"snowflake_connectivity_probe","arguments":{}}}'
echo ""
echo "5) validate_metric_regressions"
call_mcp '{"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"validate_metric_regressions","arguments":{}}}'
echo ""
echo "Smoke check complete."

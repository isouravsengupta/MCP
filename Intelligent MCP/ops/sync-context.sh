#!/usr/bin/env bash
set -euo pipefail

# Sync source repositories that provide lineage/business context for SPI MCP.
# Intended to run daily via cron/launchd.

BASE_DIR="${BASE_DIR:-/Users/sourav.sengupta/Documents/GitHub/Personal}"
SPI_MCP_DIR="${SPI_MCP_DIR:-${BASE_DIR}/spi-mcp}"
BUSINESS_LOGIC_DIR="${BUSINESS_LOGIC_DIR:-${BASE_DIR}/business_logic}"
AIRFLOW_DIR="${AIRFLOW_DIR:-${BASE_DIR}/airflow-dags-uip-gdso}"
STATUS_FILE="${STATUS_FILE:-${SPI_MCP_DIR}/ops/context-sync-status.json}"

sync_repo() {
  local repo_dir="$1"
  local label="$2"
  if [[ ! -d "${repo_dir}/.git" ]]; then
    echo "Skipping ${label}: ${repo_dir} is not a git repo."
    return 0
  fi

  echo "Syncing ${label} at ${repo_dir}"
  git -C "${repo_dir}" fetch --all --prune
  git -C "${repo_dir}" pull --ff-only
}

sync_repo "${BUSINESS_LOGIC_DIR}" "business_logic"
sync_repo "${AIRFLOW_DIR}" "airflow-dags-uip-gdso"

if [[ -f "${SPI_MCP_DIR}/ops/generate-context-index.mjs" ]]; then
  echo "Rebuilding context asset index..."
  node "${SPI_MCP_DIR}/ops/generate-context-index.mjs"
fi

mkdir -p "$(dirname "${STATUS_FILE}")"
printf '{\n  "synced_at_utc": "%s",\n  "business_logic": "%s",\n  "airflow_dags": "%s"\n}\n' \
  "$(date -u +"%Y-%m-%dT%H:%M:%SZ")" \
  "${BUSINESS_LOGIC_DIR}" \
  "${AIRFLOW_DIR}" > "${STATUS_FILE}"

echo "Context sync complete. Status: ${STATUS_FILE}"

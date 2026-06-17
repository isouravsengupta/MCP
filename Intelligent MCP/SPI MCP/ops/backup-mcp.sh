#!/usr/bin/env bash
set -euo pipefail

# Create a restorable archive of SPI MCP source and infrastructure files.

PROJECT_DIR="${PROJECT_DIR:-/Users/sourav.sengupta/Documents/GitHub/Personal/spi-mcp}"
BACKUP_DIR="${BACKUP_DIR:-${PROJECT_DIR}/ops/backups}"
STAMP="$(date -u +"%Y%m%dT%H%M%SZ")"
ARCHIVE="${BACKUP_DIR}/spi-mcp-${STAMP}.tar.gz"

mkdir -p "${BACKUP_DIR}"

tar -czf "${ARCHIVE}" \
  -C "${PROJECT_DIR}" \
  src \
  resources \
  infra \
  tests \
  package.json \
  tsconfig.json \
  README.md \
  ops

echo "Backup created: ${ARCHIVE}"

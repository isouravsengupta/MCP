#!/usr/bin/env bash
set -euo pipefail

# Usage:
#   export AWS_PROFILE=...
#   export AWS_REGION=us-east-1
#   export MCP_AUTH_TOKEN="$(openssl rand -hex 32)"
#   export SPI_SNOWFLAKE_AUTH_MODE=password   # password | keypair | sso
#   export SNOWFLAKE_PASSWORD='...'           # required only for password mode
#   export SNOWFLAKE_AUTHENTICATOR='externalbrowser' # required for sso mode
#   ./infra/deploy-prod.sh

: "${AWS_REGION:?AWS_REGION is required}"
: "${MCP_AUTH_TOKEN:?MCP_AUTH_TOKEN is required}"

STACK_NAME="spi-mcp-prod"
SECRET_NAME="spi-mcp/snowflake-password/prod"
FUNCTION_NAME="spi-mcp-prod"
AWS_PROFILE="${AWS_PROFILE:-}"
SPI_SNOWFLAKE_AUTH_MODE="${SPI_SNOWFLAKE_AUTH_MODE:-password}"
SNOWFLAKE_AUTHENTICATOR="${SNOWFLAKE_AUTHENTICATOR:-}"

awsc() {
  if [[ -n "$AWS_PROFILE" ]]; then
    aws --profile "$AWS_PROFILE" "$@"
  else
    aws "$@"
  fi
}

samc() {
  if [[ -n "$AWS_PROFILE" ]]; then
    sam --profile "$AWS_PROFILE" "$@"
  else
    sam "$@"
  fi
}

echo "Building TypeScript bundle..."
npm run build

if [[ "$SPI_SNOWFLAKE_AUTH_MODE" == "password" ]]; then
  : "${SNOWFLAKE_PASSWORD:?SNOWFLAKE_PASSWORD is required for password auth mode}"
  echo "Upserting Snowflake password secret in Secrets Manager..."
  if awsc secretsmanager describe-secret \
    --region "$AWS_REGION" \
    --secret-id "$SECRET_NAME" >/dev/null 2>&1; then
    awsc secretsmanager put-secret-value \
      --region "$AWS_REGION" \
      --secret-id "$SECRET_NAME" \
      --secret-string "{\"password\":\"${SNOWFLAKE_PASSWORD}\"}" >/dev/null
  else
    awsc secretsmanager create-secret \
      --region "$AWS_REGION" \
      --name "$SECRET_NAME" \
      --secret-string "{\"password\":\"${SNOWFLAKE_PASSWORD}\"}" >/dev/null
  fi
fi

if awsc secretsmanager describe-secret \
  --region "$AWS_REGION" \
  --secret-id "$SECRET_NAME" >/dev/null 2>&1; then
  SECRET_ARN="$(awsc secretsmanager describe-secret \
    --region "$AWS_REGION" \
    --secret-id "$SECRET_NAME" \
    --query 'ARN' \
    --output text)"
else
  echo "Snowflake password secret not found; creating placeholder so stack parameters remain stable..."
  awsc secretsmanager create-secret \
    --region "$AWS_REGION" \
    --name "$SECRET_NAME" \
    --secret-string '{"password":"placeholder"}' >/dev/null
  SECRET_ARN="$(awsc secretsmanager describe-secret \
    --region "$AWS_REGION" \
    --secret-id "$SECRET_NAME" \
    --query 'ARN' \
    --output text)"
fi

echo "Deploying SAM stack ${STACK_NAME}..."
PARAM_OVERRIDES=(
  Environment=prod
  SnowflakeAccount=sfdc_dp_prd
  SnowflakeUsername=SVC_SSE_GDSO_CT_AIRFLOW_WRITE
  SnowflakeWarehouse=WH_GDSO_CT_INGST
  SnowflakeDatabase=SSE_DM_GDSO_PRD
  SnowflakeSchema=AIO
  SnowflakeRole=DM_GDSO_CT_INGST_PRD
  SnowflakeAuthMode="$SPI_SNOWFLAKE_AUTH_MODE"
  SnowflakePasswordSecretArn="$SECRET_ARN"
  McpAuthToken="$MCP_AUTH_TOKEN"
  ExistingVpcId=vpc-09b280218d84d22db
  ExistingPrivateSubnetIds=subnet-00eacecd448dd2347
)

if [[ -n "$SNOWFLAKE_AUTHENTICATOR" ]]; then
  PARAM_OVERRIDES+=(SnowflakeAuthenticator="$SNOWFLAKE_AUTHENTICATOR")
fi

samc deploy \
  --region "$AWS_REGION" \
  --template-file infra/template.yaml \
  --stack-name "$STACK_NAME" \
  --capabilities CAPABILITY_NAMED_IAM \
  --resolve-s3 \
  --no-confirm-changeset \
  --parameter-overrides "${PARAM_OVERRIDES[@]}"

echo "Invoking Lambda connectivity check..."
PAYLOAD='{"version":"2.0","routeKey":"POST /","rawPath":"/","rawQueryString":"","headers":{"content-type":"application/json","authorization":"Bearer '"${MCP_AUTH_TOKEN}"'"},"requestContext":{"http":{"method":"POST","path":"/","sourceIp":"127.0.0.1"}},"body":"{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"initialize\",\"params\":{}}","isBase64Encoded":false}'
awsc lambda invoke \
  --region "$AWS_REGION" \
  --function-name "$FUNCTION_NAME" \
  --cli-binary-format raw-in-base64-out \
  --payload "$PAYLOAD" \
  /tmp/spi-mcp-invoke.json >/dev/null

echo "Lambda invoke output:"
cat /tmp/spi-mcp-invoke.json

ENDPOINT="$(awsc cloudformation describe-stacks \
  --region "$AWS_REGION" \
  --stack-name "$STACK_NAME" \
  --query "Stacks[0].Outputs[?OutputKey=='McpEndpointUrl'].OutputValue" \
  --output text)"

echo ""
echo "Deployment complete."
echo "MCP endpoint: ${ENDPOINT}"

/**
 * Loads and validates all configuration from environment variables.
 *
 * Auth modes:
 *   sso       — Salesforce/Okta SSO via externalbrowser (local dev only)
 *   keypair   — Private key JWT. In Lambda the PEM is fetched from Secrets Manager
 *               on cold start (SNOWFLAKE_SECRET_ARN). Locally, set SNOWFLAKE_PRIVATE_KEY.
 *   password  — Username + password (not recommended for production)
 */

import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";
import { z } from "zod";
import type { SnowflakeConfig } from "./types.js";

const envSchema = z.object({
  SNOWFLAKE_ACCOUNT: z.string().min(1),
  SNOWFLAKE_USERNAME: z.string().min(1),
  SNOWFLAKE_WAREHOUSE: z.string().min(1),
  SNOWFLAKE_DATABASE: z.string().min(1),
  SNOWFLAKE_SCHEMA: z.string().default("SALES_PLANNING"),
  SNOWFLAKE_ROLE: z.string().optional(),
  SPI_SNOWFLAKE_AUTH_MODE: z.enum(["password", "keypair", "sso"]).default("sso"),
  // keypair mode — local path
  SNOWFLAKE_PRIVATE_KEY: z.string().optional(),
  SNOWFLAKE_PRIVATE_KEY_PASSPHRASE: z.string().optional(),
  // keypair mode — Lambda (Secrets Manager)
  SNOWFLAKE_SECRET_ARN: z.string().optional(),
  // password mode
  SNOWFLAKE_PASSWORD: z.string().optional(),
  // MCP auth
  MCP_AUTH_TOKEN: z.string().optional(),
});

type Env = z.infer<typeof envSchema>;

let _config: SnowflakeConfig | null = null;

// Secrets Manager client (reused across warm Lambda invocations)
const sm = new SecretsManagerClient({});

async function fetchPrivateKeyFromSecretsManager(arn: string): Promise<{ pem: string; passphrase: string }> {
  const cmd = new GetSecretValueCommand({ SecretId: arn });
  const result = await sm.send(cmd);
  const secret = JSON.parse(result.SecretString ?? "{}") as { private_key_pem?: string; passphrase?: string };
  if (!secret.private_key_pem) {
    throw new Error(`Secret ${arn} must contain a 'private_key_pem' field.`);
  }
  return { pem: secret.private_key_pem, passphrase: secret.passphrase ?? "" };
}

export async function loadConfig(): Promise<SnowflakeConfig> {
  if (_config) return _config;

  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    throw new Error(`Invalid environment configuration:\n${parsed.error.message}`);
  }
  const env: Env = parsed.data;

  let privateKey: string | undefined;
  let privateKeyPassphrase: string | undefined;

  if (env.SPI_SNOWFLAKE_AUTH_MODE === "keypair") {
    if (env.SNOWFLAKE_PRIVATE_KEY) {
      // Local dev: PEM provided directly
      privateKey = env.SNOWFLAKE_PRIVATE_KEY;
      privateKeyPassphrase = env.SNOWFLAKE_PRIVATE_KEY_PASSPHRASE;
    } else if (env.SNOWFLAKE_SECRET_ARN) {
      // Lambda: fetch from Secrets Manager on cold start
      const { pem, passphrase } = await fetchPrivateKeyFromSecretsManager(env.SNOWFLAKE_SECRET_ARN);
      privateKey = pem;
      privateKeyPassphrase = passphrase;
    } else {
      throw new Error("keypair mode requires SNOWFLAKE_PRIVATE_KEY or SNOWFLAKE_SECRET_ARN.");
    }
  }

  if (env.SPI_SNOWFLAKE_AUTH_MODE === "password" && !env.SNOWFLAKE_PASSWORD) {
    throw new Error("password mode requires SNOWFLAKE_PASSWORD.");
  }

  _config = {
    account: env.SNOWFLAKE_ACCOUNT,
    username: env.SNOWFLAKE_USERNAME,
    warehouse: env.SNOWFLAKE_WAREHOUSE,
    database: env.SNOWFLAKE_DATABASE,
    schema: env.SNOWFLAKE_SCHEMA,
    role: env.SNOWFLAKE_ROLE,
    authMode: env.SPI_SNOWFLAKE_AUTH_MODE,
    password: env.SNOWFLAKE_PASSWORD,
    privateKey,
    privateKeyPassphrase,
  };

  return _config;
}

export function getMcpAuthToken(): string | undefined {
  return process.env.MCP_AUTH_TOKEN;
}

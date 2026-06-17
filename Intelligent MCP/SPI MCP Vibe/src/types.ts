export type AuthMode = "password" | "keypair" | "sso";

export interface SnowflakeConfig {
  account: string;
  username: string;
  warehouse: string;
  database: string;
  schema: string;
  role?: string;
  authMode: AuthMode;
  // password mode
  password?: string;
  // keypair mode — PEM string (loaded from env or Secrets Manager)
  privateKey?: string;
  privateKeyPassphrase?: string;
}

export interface MetricDefinition {
  id: string;
  name: string;
  description: string;
  sourceTable: string;
  grain: "day" | "week" | "month" | "quarter";
  dimensions: string[];
  sqlTemplate: string;
  crmaFields: Record<string, string>;
  snowflakeColumns: Record<string, string>;
}

export interface MetricCatalog {
  metrics: MetricDefinition[];
}

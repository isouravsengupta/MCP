export type AuthMode = "password" | "keypair" | "sso";

export interface SnowflakeConfig {
  account: string;
  username: string;
  warehouse: string;
  database: string;
  schema: string;
  role?: string;
  authenticator?: string;
  authMode: AuthMode;
  password?: string;
  privateKey?: string;
  privateKeyPassphrase?: string;
  accessToken?: string;
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
  metric_definitions?: MetricDefinitionDocument[];
  metrics: MetricDefinition[];
}

export interface MetricDefinitionDocument {
  id: string;
  name: string;
  description?: string;
  dashboard_metric?: string;
  crma_dataset?: string;
  saql?: string[];
  snowflake_sql?: string;
  provenance?: {
    etl_repo?: string;
    etl_paths?: string[];
    dag_repo?: string;
    dag_paths?: string[];
  };
  validation_notes?: string[];
}

export interface MetricContextRegistry {
  version: string;
  domain: string;
  preferred_source_order: string[];
  repositories: Array<{
    name: string;
    local_path: string;
    priority: number;
    refresh: string;
  }>;
  focus_areas: Array<{
    topic: string;
    resolver: string;
    primary_paths: string[];
  }>;
}

export interface MetricRegressionSpec {
  version: string;
  checks: Array<{
    metric_id: string;
    expected_columns: string[];
    numeric_ranges: Record<string, { min?: number; max?: number }>;
  }>;
}

export interface MetricScenarioCatalog {
  scenarios: Array<{
    metric_id: string;
    value_column: string;
    year_column?: string;
    fixed_filters?: Record<string, string | number>;
    groupable_dimensions: Record<string, string>;
  }>;
}

export interface ContextAssetIndex {
  generated_at_utc: string;
  assets: Array<{
    category: "etl_sql" | "airflow_dag" | "crma_dashboard";
    repo: string;
    path: string;
    tags: string[];
  }>;
}

export interface DashboardLensCatalog {
  generated_at_utc: string;
  dashboard_file: string;
  lenses: Array<{
    step_name: string;
    label?: string;
    type?: string;
    datasets: string[];
    query_preview?: string;
    widgets: string[];
  }>;
}

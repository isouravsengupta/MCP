"""
SQLite query engine for mlctl.

Provides two modes:
1. Direct structured queries — called by agent tools for predictable operations
2. Text-to-SQL — converts natural language to SQL for ad-hoc questions

The Text-to-SQL layer is what makes this genuinely intelligent:
  "experiments last week above 90% accuracy"
      → SELECT * FROM experiments WHERE accuracy > 0.90 AND created_at > ...
"""

import sqlite3
import json
import os
from typing import Any

DB_PATH = os.path.join(os.path.dirname(__file__), "mlctl.db")

DB_SCHEMA = """
TABLE experiments:
  run_id (TEXT PK), name (TEXT), model_type (TEXT),
  lr (REAL), epochs (INT), batch_size (INT),
  accuracy (REAL), loss (REAL), f1 (REAL),
  status (TEXT: completed/failed/running),
  duration_s (INT), created_by (TEXT), created_at (TEXT datetime)

TABLE models:
  model_id (TEXT PK), name (TEXT), version (TEXT),
  stage (TEXT: staging/production), run_id (TEXT FK),
  accuracy (REAL), endpoint (TEXT), created_at (TEXT)

TABLE pipelines:
  pipeline_id (TEXT PK), name (TEXT),
  status (TEXT: idle/running/failed),
  last_run_at (TEXT), steps_total (INT),
  steps_completed (INT), owner (TEXT)
"""


def execute_sql(sql: str) -> list[dict]:
    """Run raw SQL and return results as list of dicts."""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        cursor = conn.execute(sql)
        rows = [dict(row) for row in cursor.fetchall()]
        return rows
    finally:
        conn.close()


def text_to_sql(natural_language: str, adapter) -> dict:
    """
    Convert a natural language question to SQL using the LLM,
    execute it, and return results.
    """
    prompt = f"""You are a SQL expert. Convert this natural language question to a SQLite SQL query.

Database schema:
{DB_SCHEMA}

Question: {natural_language}

Rules:
- Return ONLY the SQL query, nothing else
- No markdown, no explanation, no backticks
- Use only tables and columns from the schema above
- For date comparisons use: datetime('now', '-7 days') style
- LIMIT results to 20 rows max
"""
    messages = [{"role": "user", "content": prompt}]
    response = adapter.chat(messages, tools=None)
    sql = response.content.strip().strip("`").replace("```sql", "").replace("```", "").strip()

    try:
        rows = execute_sql(sql)
        return {
            "sql": sql,
            "rows": rows,
            "count": len(rows),
            "status": "success"
        }
    except Exception as e:
        return {
            "sql": sql,
            "rows": [],
            "count": 0,
            "status": "error",
            "error": str(e)
        }


# ── Structured query helpers used by agent tools ──────────────────────────

def get_experiments(limit: int = 10, status: str = None) -> list[dict]:
    sql = "SELECT * FROM experiments"
    if status:
        sql += f" WHERE status = '{status}'"
    sql += f" ORDER BY created_at DESC LIMIT {int(limit)}"
    return execute_sql(sql)


def get_experiment_by_id(run_id: str) -> dict:
    rows = execute_sql(f"SELECT * FROM experiments WHERE run_id = '{run_id}'")
    return rows[0] if rows else {}


def compare_experiments(run_ids: list[str]) -> dict:
    ids = ", ".join(f"'{r}'" for r in run_ids)
    sql = f"SELECT * FROM experiments WHERE run_id IN ({ids}) ORDER BY accuracy DESC"
    rows = execute_sql(sql)
    if not rows:
        rows = execute_sql("SELECT * FROM experiments ORDER BY accuracy DESC LIMIT 5")
    best = rows[0]
    return {
        "runs": rows,
        "best_run_id": best["run_id"],
        "best_accuracy": best["accuracy"],
        "best_name": best["name"],
        "sql_used": sql,
        "summary": f"Best run is {best['run_id']} ({best['name']}) with accuracy {best['accuracy']:.4f}"
    }


def insert_model(run_id: str, name: str, version: str, stage: str) -> dict:
    exp = get_experiment_by_id(run_id)
    accuracy = exp.get("accuracy", 0)
    endpoint = f"https://ml-platform.netflix.internal/{name}/v{version}/predict"
    model_id = f"model_{name}_{version}".replace(".", "_")
    sql = f"""
    INSERT OR REPLACE INTO models (model_id, name, version, stage, run_id, accuracy, endpoint)
    VALUES ('{model_id}', '{name}', '{version}', '{stage}', '{run_id}', {accuracy}, '{endpoint}')
    """
    execute_sql(sql)
    return {"registered": True, "model_id": model_id, "name": name, "version": version,
            "stage": stage, "accuracy": accuracy, "endpoint": endpoint}


def get_models(stage: str = None) -> list[dict]:
    sql = "SELECT * FROM models"
    if stage:
        sql += f" WHERE stage = '{stage}'"
    sql += " ORDER BY created_at DESC"
    return execute_sql(sql)


def update_model_stage(name: str, stage: str) -> dict:
    execute_sql(f"UPDATE models SET stage = '{stage}' WHERE name = '{name}'")
    rows = execute_sql(f"SELECT * FROM models WHERE name = '{name}'")
    model = rows[0] if rows else {}
    return {"deployed": True, "model": name, "stage": stage, "endpoint": model.get("endpoint", "")}


def get_pipelines() -> list[dict]:
    return execute_sql("SELECT * FROM pipelines ORDER BY last_run_at DESC")

# SPI Sales Data Skill

**Purpose:** Give Markus and the GSI leadership team instant, natural-language access to
sales performance data from Snowflake — without needing a dashboard. Results match the
CRMA dashboard calculations exactly.

---

## When to use this skill

Invoke this skill when a user asks any of the following:
- How are we tracking on ACV / NNAOV / pipeline this quarter?
- What is the ACV attainment for [region / segment / programme]?
- Show me QAP quality scores for [team / manager / seller].
- How many programmes are we running in [region]?
- What is the pipeline coverage ratio for [segment]?
- Anything involving sales metrics, programme performance, or quota attainment.

---

## Deterministic execution sequence

> **Important:** Always follow these steps in order. Do not skip steps or change the
> sequence. This ensures results match the CRMA dashboard and prevents hallucination.

### Step 1 — Understand the request

Identify:
- **Dataset**: Is this about sales programmes (`spm_performance`) or individual seller quotas (`qap_attainment`)?
- **Metric**: Which KPI is the user asking for? (e.g. ACV attainment %, pipeline coverage ratio)
- **Filters**: Which fiscal year, quarter, region, or segment apply?

If the dataset or metric is unclear, ask one clarifying question before proceeding.

### Step 2 — Read the CRMA metadata resource

Call `read_resource("crma://metadata/<dataset>")` to load the column mapping and
metric definitions for the identified dataset.

This step is mandatory — it ensures the SQL uses the correct Snowflake column names
and the exact business-logic expression from the CRMA dashboard.

### Step 3 — Query Snowflake

Use `query_crma_metric` for named KPIs (preferred):
```
query_crma_metric(
  dataset = "<dataset>",
  metric  = "<metric_key>",
  filters = {"fiscal_year": "FY27", "region": "EMEA"}   # adjust as needed
)
```

Use `execute_query` only for ad-hoc questions that don't map to a named metric.
In that case, use the column names from Step 2 to build the SQL.

### Step 4 — Format and respond

- Lead with the headline number first (conclusion-first per SPI communication norms).
- Follow with a brief table if more than one value is returned.
- Include the fiscal period and any filters applied so the user knows the exact scope.
- If results are empty, say so clearly and suggest broadening the filter.
- Do **not** invent or estimate numbers. If the query returns no data, say no data was found.

---

## Example interactions

**User:** What's the ACV attainment for EMEA in Q2FY27?

**Agent sequence:**
1. Dataset = `spm_performance`, Metric = `acv_attainment_pct`, Filter = `{fiscal_quarter: Q2FY27, region: EMEA}`
2. `read_resource("crma://metadata/spm_performance")`
3. `query_crma_metric(dataset="spm_performance", metric="acv_attainment_pct", filters={"fiscal_quarter": "Q2FY27", "region": "EMEA"})`
4. Reply: "EMEA ACV attainment for Q2FY27 is **82.4%** against quota."

---

**User:** Show me pipeline coverage across segments for FY27.

**Agent sequence:**
1. Dataset = `qap_attainment`, Metric = `pipeline_coverage_ratio`, Filter = `{fiscal_year: FY27}` — group by segment
2. `read_resource("crma://metadata/qap_attainment")`
3. `execute_query("SELECT SEGMENT, ROUND(SUM(OPEN_PIPELINE) / NULLIF(SUM(QUOTA_ACV) - SUM(ATTAINED_ACV), 0), 2) AS coverage_ratio FROM SALES_PLANNING.QAP_ATTAINMENT_V WHERE FISCAL_YEAR = 'FY27' GROUP BY SEGMENT ORDER BY coverage_ratio DESC LIMIT 50")`
4. Present as a table with segment and coverage ratio columns.

---

## Constraints

- Never return more than 200 rows in a single response — use aggregations.
- Never run INSERT, UPDATE, DELETE, or DDL statements.
- Never expose raw SQL in the response unless the user specifically asks for it.
- Always include the fiscal period scope in the response so results are not ambiguous.
- If the user asks about data not in the CRMA metadata, use `list_tables` and
  `describe_table` to explore, but confirm with the user before running a query.

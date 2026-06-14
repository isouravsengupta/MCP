# mlctl — ML Control

> **Agentic ML Platform control plane — exposed as an MCP server, surfaced as a Netflix Slack bot**

![Python 3.11+](https://img.shields.io/badge/Python-3.11%2B-blue?style=flat-square&logo=python)
![FastAPI](https://img.shields.io/badge/FastAPI-0.111-green?style=flat-square&logo=fastapi)
![LiteLLM](https://img.shields.io/badge/LiteLLM-1.x-orange?style=flat-square)
![Chart.js](https://img.shields.io/badge/Chart.js-4.x-ff6384?style=flat-square)
![SQLite](https://img.shields.io/badge/SQLite-3-003B57?style=flat-square&logo=sqlite)
![MCP](https://img.shields.io/badge/MCP-Model%20Context%20Protocol-purple?style=flat-square)

---

## What is this?

Netflix ML engineers context-switch across five or more tools for a single ML task: an experiment tracker to review past runs, a training scheduler to kick off a new job, a model registry to capture the result, a deployment tool to push to staging, and a monitoring dashboard to confirm the endpoint is live. That's ten minutes of tab-switching before any real work happens.

**mlctl collapses the full ML lifecycle into a single natural language interface — surfaced inside Netflix's internal Slack.** Engineers send a plain-English message to the `@mlctl` bot and the agent works through each step autonomously: listing experiments, comparing metrics, registering the best run, deploying it, and posting back a rich summary with charts.

Under the hood, mlctl is built on the **Model Context Protocol (MCP)** — the open standard by Anthropic for connecting LLMs to external tools. Because it is MCP-native, the same agent that answers Slack DMs can be invoked from Claude Desktop, VS Code, a terminal, or any other MCP-compatible client. The platform team plugs in Netflix's internal LLM and real infrastructure APIs; the agent reasoning layer stays untouched.

---

## What is MCP?

The **Model Context Protocol** is an open standard — analogous to REST for web APIs — that defines how AI agents discover and call external tools. An MCP server exposes named tools (e.g. `list_experiments`, `deploy_model`, `natural_language_query`) with typed schemas. Any MCP-compatible client — Claude Desktop, VS Code Copilot, a custom Slack lambda — can connect, enumerate the tools, and let its LLM decide when and how to call them. This decoupling means the same mlctl server works across every AI interface without code changes. Think of it as a universal power adapter between LLMs and your internal platform APIs.

---

## Architecture

### Diagram A — Full AWS Production Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  Netflix Engineers                                                           │
│  (Slack DM → @mlctl)                                                         │
└───────────────────────────────┬─────────────────────────────────────────────┘
                                │  HTTPS POST (Slack Events API)
                                ▼
┌───────────────────────────────────────────────────────┐
│  AWS API Gateway                                       │
│  POST /slack/events                                    │
└───────────────────────────────┬───────────────────────┘
                                │  Invoke
                                ▼
┌───────────────────────────────────────────────────────┐
│  AWS Lambda — MCP Slackbot Handler                     │
│  · Validates Slack request signature                   │
│  · Extracts user identity from Slack JWT               │
│  · Calls mlctl MCP server /chat endpoint               │
└───────────────────────────────┬───────────────────────┘
                                │  VPC-internal HTTPS
                                ▼
┌───────────────────────────────────────────────────────────────────────────────┐
│  mlctl MCP Server  (ECS Fargate, private VPC, port 8000)                      │
│                                                                               │
│  ┌────────────────────────────────────────────────────────────────────────┐  │
│  │  MLOrchestrator — agentic reasoning loop                               │  │
│  │  LiteLLMAdapter (Netflix Internal LLM primary / OpenAI fallback)       │  │
│  └────────────────────────────────────────────────────────────────────────┘  │
│                                                                               │
│  Registered MCP Tools                                                         │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────────────┐   │
│  │ ExperimentTools  │  │   ModelTools      │  │    PipelineTools         │   │
│  │ list_experiments │  │ register_model    │  │  trigger_pipeline        │   │
│  │ compare_runs     │  │ deploy_model      │  │  list_pipelines          │   │
│  │ run_experiment   │  │ get_model_status  │  └──────────────────────────┘   │
│  └──────────────────┘  │ rollback_model    │                                 │
│                         └──────────────────┘  ┌──────────────────────────┐   │
│                                               │   QueryTools             │   │
│                                               │ natural_language_query   │   │
│                                               └──────────────────────────┘   │
└──────────┬───────────────────┬──────────────────────┬────────────────────────┘
           │                   │                      │
    ┌──────▼──────┐     ┌──────▼──────┐      ┌───────▼──────────────────────┐
    │  Metaflow   │     │  MLflow     │       │  Netflix Feast Feature Store  │
    │  (Expt DB)  │     │  Registry   │       │  DynamoDB + S3               │
    │  RDS Postgres│    │  RDS Postgres│      └──────────────────────────────┘
    └─────────────┘     └─────────────┘
           │                   │
    ┌──────▼──────┐     ┌──────▼──────────────────────────────────────────┐
    │  Titus /    │     │  AWS SageMaker Endpoints (staging + production)  │
    │  SageMaker  │     │  DescribeEndpoint · UpdateEndpoint · Rollback    │
    │  Training   │     └─────────────────────────────────────────────────┘
    └─────────────┘
           │
    ┌──────▼───────────────────────────────────────────────────────────┐
    │  Apache Airflow (pipeline orchestration)  — RDS-backed           │
    │  Prometheus + Grafana → CloudWatch metrics integration           │
    │  AWS Athena + S3 data lake (text-to-SQL raw queries)             │
    └──────────────────────────────────────────────────────────────────┘

Auth: Netflix SSO (Okta) → JWT extracted from Slack context → passed on every
      downstream API call. Prod deployments gate on EM approval via Slack workflow.
```

---

### Diagram B — How the Slackbot Calls MCP (Request Flow)

```
Engineer sends Slack DM to @mlctl
          │
          │  1. "Compare all experiments, register the best, deploy to staging."
          ▼
┌─────────────────────────┐
│  Slack Events API       │
│  POST to API Gateway    │
└────────────┬────────────┘
             │  2. Raw POST with Slack payload + signing secret
             ▼
┌─────────────────────────────────────────────┐
│  AWS Lambda                                  │
│  3. Verify X-Slack-Signature HMAC            │
│  4. Extract user email from Slack JWT        │
│  5. POST /chat  { message, user_jwt }        │
└────────────────────────┬────────────────────┘
                         │  6. VPC-internal HTTP
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│  MLOrchestrator.chat()                                           │
│                                                                  │
│  7. Build system prompt with user context + schema hints         │
│  8. Call LiteLLMAdapter.chat(messages, tools=TOOLS_LIST)         │
│                           │                                      │
│             ┌─────────────▼──────────────────┐                  │
│             │  LLM (Netflix Internal / OpenAI) │                 │
│             │  Returns: tool_calls JSON        │                 │
│             └─────────────┬──────────────────┘                  │
│                           │  9. Dispatch each tool_call          │
│          ┌────────────────┼──────────────────────┐              │
│          ▼                ▼                       ▼              │
│  list_experiments   compare_runs         register_model          │
│  → Metaflow DB      → Metaflow DB        → MLflow API            │
│          │                │                       │              │
│          └────────────────┴───────────────────────┘              │
│                           │  10. All results appended to history │
│                           │                                      │
│  11. Call LiteLLMAdapter.chat(messages, tools=None)  ← nudge    │
│             │                                                     │
│             ▼                                                     │
│     LLM synthesises final natural language summary                │
│                                                                  │
│  12. Return { response_text, tool_results, chart_data }          │
└─────────────────────────────────────────────────────────────────┘
                         │
                         │  13. Lambda formats rich Slack Block Kit message
                         ▼
              Slack DM — text summary + inline charts posted back to engineer
```

---

### Diagram C — Data Source Access Pattern

```
User message
     │
     ├── natural_language_query
     │        └── [NL → LLM → SQL] ──► SQLite (demo) / AWS Athena + S3 (prod)
     │
     ├── list_experiments
     │        └── ExperimentTools ──────► Metaflow Metadata API / RDS PostgreSQL
     │
     ├── compare_runs
     │        └── ExperimentTools ──────► Metaflow Metadata API / RDS PostgreSQL
     │
     ├── run_experiment
     │        └── ExperimentTools ──────► Titus Scheduler / SageMaker Training Jobs
     │
     ├── register_model
     │        └── ModelTools ────────────► MLflow Model Registry (RDS-backed)
     │
     ├── deploy_model
     │        └── ModelTools ────────────► SageMaker CreateEndpoint / UpdateEndpoint
     │
     ├── get_model_status
     │        └── ModelTools ────────────► SageMaker DescribeEndpoint + CloudWatch
     │
     ├── rollback_model
     │        └── ModelTools ────────────► SageMaker UpdateEndpoint (prev version)
     │
     ├── trigger_pipeline
     │        └── PipelineTools ─────────► Airflow REST API (POST /dags/{id}/dagRuns)
     │
     └── list_pipelines
              └── PipelineTools ─────────► Airflow REST API (GET /dags)
```

---

## Technical Deep-Dive

### Multi-Step Agentic Reasoning Loop

The `MLOrchestrator` runs a bounded reasoning loop — at most 10 iterations — to handle tasks that require chaining multiple tool calls before a coherent answer is possible.

**Loop logic:**

1. On the first call, `tools=TOOLS_LIST` is passed to the LLM so it can decide which tools to invoke.
2. The LLM returns a `tool_calls` array. Each tool is dispatched, results collected.
3. Tool results are appended to `conversation_history` as `role: tool` messages.
4. On the next LLM call, `tools=None` is passed — this prevents infinite tool-calling loops and signals the model to synthesise a final answer. A "nudge" system message (`"Summarise the findings and respond to the user."`) is appended to guide the final turn.
5. If the LLM continues to request tool calls on subsequent turns (rare), the loop continues up to the cap, then forces synthesis.

This pattern ensures the agent completes multi-step workflows (compare → register → deploy) in a single user turn while remaining deterministic and bounded.

---

### Model-Agnostic Adapter — `BaseModelAdapter` ABC

All LLM calls go through a swappable adapter interface. Swapping Netflix's internal LLM in for OpenAI requires no changes to the orchestrator or tools.

```python
# mlctl/adapters/model_adapter.py

from abc import ABC, abstractmethod

class BaseModelAdapter(ABC):
    """
    Abstract base for all LLM adapters.
    Implement `chat()` to return a normalised response dict.
    """

    @abstractmethod
    def chat(
        self,
        messages: list[dict],
        tools: list[dict] | None = None,
        tool_choice: str = "auto",
    ) -> dict:
        """
        Args:
            messages:    OpenAI-format message history.
            tools:       MCP tool schemas in OpenAI function-call format.
                         Pass None to suppress tool calls (synthesis turn).
            tool_choice: "auto" | "none" | {"type": "function", "function": {"name": ...}}
        Returns:
            {
              "content": str | None,
              "tool_calls": [{"name": str, "arguments": dict}] | None,
              "finish_reason": "stop" | "tool_calls" | "length"
            }
        """
        ...


class LiteLLMAdapter(BaseModelAdapter):
    """
    Unified adapter for OpenAI, Anthropic, Ollama, Azure OpenAI, AWS Bedrock.
    Switch provider by changing MODEL_NAME in .env — no code changes required.

    Examples:
        MODEL_NAME=gpt-4o                     → OpenAI
        MODEL_NAME=claude-opus-4-5            → Anthropic
        MODEL_NAME=ollama/llama3.2            → Ollama (local)
        MODEL_NAME=azure/gpt-4o               → Azure OpenAI
        MODEL_NAME=bedrock/anthropic.claude-3 → AWS Bedrock
    """

    def __init__(self, model: str, api_key: str | None = None):
        import litellm
        self._litellm = litellm
        self.model = model
        self.api_key = api_key

    def chat(self, messages, tools=None, tool_choice="auto"):
        kwargs = {"model": self.model, "messages": messages}
        if tools:
            kwargs["tools"] = tools
            kwargs["tool_choice"] = tool_choice
        response = self._litellm.completion(**kwargs)
        # normalise to internal format ...
        return self._normalise(response)


class NetflixModelAdapter(BaseModelAdapter):
    """
    Stub for Netflix's internal LLM inference service.
    Replace the NotImplementedError with the internal SDK call.

    Set MODEL_PROVIDER=netflix in .env to activate.
    """

    def __init__(self, endpoint: str, api_key: str):
        self.endpoint = endpoint
        self.api_key = api_key

    def chat(self, messages, tools=None, tool_choice="auto"):
        # TODO: inject Netflix's internal LLM client here
        raise NotImplementedError(
            "Wire up Netflix's internal inference endpoint."
        )
```

The factory reads `MODEL_PROVIDER` from the environment and returns the correct adapter. The orchestrator never imports a concrete adapter directly.

---

### Text-to-SQL

The `natural_language_query` tool lets engineers ask analytical questions in plain English. The flow:

1. User asks: *"What's the average accuracy for experiments run this week with dropout > 0.3?"*
2. The database schema (table names, columns, types) is injected into the LLM system prompt.
3. LLM generates a SQL query grounded in that schema.
4. Query executes against SQLite (demo) or AWS Athena (production, querying the S3 data lake).
5. Returns `{ sql, rows, count, status }` — the raw SQL is surfaced to the user for transparency.

**Prompt template (abbreviated):**

```
You are a SQL expert. The database contains these tables:

experiments(run_id, name, model_type, lr, epochs, accuracy, loss, f1, status, duration_s, created_at)
models(model_id, name, version, stage, run_id, registered_at)
pipelines(pipeline_id, name, dag_id, status, last_run, duration_s)

User question: {user_question}

Write a single, valid SQLite SQL query. Return ONLY the SQL — no explanation.
```

The generated SQL is executed in a sandboxed read-only connection. In production, Athena enforces row-level access controls based on the engineer's team membership extracted from their Okta JWT.

---

### Real SQLite DB (Demo)

The demo ships with a pre-seeded SQLite database at `db/mlctl.db`. Schema and seed data:

**`experiments` table** — 7 rows covering transformer, LSTM, and attention-based recommender runs, with varying learning rates, accuracy (0.82–0.93), loss, F1, and duration fields.

**`models` table** — 3 registered models: `netflix_recommender` (production), `content_ranker` (staging), `ad_predictor` (archived).

**`pipelines` table** — 4 DAGs: `feature_refresh_daily` (success), `model_retraining_weekly` (running), `data_validation` (success), `champion_challenger_eval` (failed).

Seed the database before first run:

```bash
python db/setup.py
```

---

### Chart.js Analytics (Slack-Clone UI)

The web UI (`web/`) is a Slack-clone dark-theme chat interface. After each tool response that returns tabular data, the frontend auto-renders interactive Chart.js visualisations without any extra user action.

**Auto-detection rules:**

| Data pattern | Chart rendered |
|---|---|
| Rows with `accuracy`, `loss`, `f1`, `duration_s` | Tabbed bar charts — one tab per metric |
| `models` data with `stage` field | Doughnut chart — production / staging / archived |
| `pipelines` data with `status` field | Horizontal bar chart — success / running / failed counts |
| `compare_runs` result | Grouped bar — side-by-side metric comparison |

All charts use Netflix's dark palette (near-black background, red accent `#E50914`, off-white labels) and are rendered inline in the message thread — no external dashboard link required.

---

## MCP Tools Reference

| Tool | Description | Data Source (prod) |
|---|---|---|
| `list_experiments` | List recent training runs with metrics | Metaflow Metadata API / RDS |
| `compare_runs` | Diff two or more runs; identify best by accuracy | Metaflow Metadata API / RDS |
| `run_experiment` | Kick off a new training job with given hyperparameters | Titus Scheduler / SageMaker Training |
| `register_model` | Add a run to the MLflow Model Registry | MLflow Registry (RDS-backed) |
| `deploy_model` | Deploy a registered model version to staging or production | SageMaker Endpoints |
| `get_model_status` | Check deployment health, current stage, and serving metrics | SageMaker + CloudWatch |
| `rollback_model` | Revert a model endpoint to its previous version | SageMaker UpdateEndpoint |
| `trigger_pipeline` | Start an Airflow DAG run | Airflow REST API |
| `list_pipelines` | List all DAGs with last run status and duration | Airflow REST API |
| `natural_language_query` | Convert a plain-English question to SQL and execute it | AWS Athena + S3 / SQLite (demo) |

---

## Local Quick Start

```bash
# Clone the repository
git clone https://github.com/isouravsengupta/MCP
cd MCP/mlctl

# Create and activate a virtual environment
python -m venv .venv && source .venv/bin/activate

# Install dependencies
pip install -r requirements.txt

# Seed the demo SQLite database
python db/setup.py

# Configure the LLM (choose one):
#   Option A — local model via Ollama (no API key needed)
ollama pull llama3.2

#   Option B — OpenAI
#   Create a .env file:  OPENAI_API_KEY=sk-...  MODEL_NAME=gpt-4o

# Start the server
uvicorn web.app:app --reload --port 8000
```

Open [http://localhost:8000](http://localhost:8000) — you'll see the Slack-clone UI. Send a message to `@mlctl` in the demo workspace.

**Try these prompts to explore the full lifecycle:**

```
"Show me all experiments and tell me which one has the best F1 score."

"Compare run_003 and run_007, register the winner as netflix_recommender v4, and deploy to staging."

"What's the average accuracy of experiments run with lr less than 0.005?"

"List all pipelines and tell me if anything failed."
```

### Use as an MCP Server (Claude Desktop)

Add to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "mlctl": {
      "command": "python",
      "args": ["/absolute/path/to/MCP/mlctl/server.py"],
      "env": {
        "OPENAI_API_KEY": "sk-...",
        "MODEL_NAME": "gpt-4o"
      }
    }
  }
}
```

Restart Claude Desktop, then ask it: *"Use mlctl to show recent experiments and deploy the best model to staging."*

---

## GitHub Codespaces (One-Click)

The repository includes a `devcontainer.json` that auto-installs dependencies, seeds the database, and starts the FastAPI server on port 8000 when the Codespace boots. No local setup required.

[![Open in GitHub Codespaces](https://github.com/codespaces/badge.svg)](https://codespaces.new/isouravsengupta/MCP)

---

## Project Structure

```
mlctl/
├── server.py                      # MCP stdio server entry point
├── requirements.txt
├── pyproject.toml
│
├── mlctl/
│   ├── agent/
│   │   └── orchestrator.py        # Multi-step agentic reasoning loop
│   ├── tools/
│   │   ├── experiments.py         # list_experiments, compare_runs, run_experiment
│   │   ├── models.py              # register_model, deploy_model, get_model_status, rollback_model
│   │   ├── pipelines.py           # trigger_pipeline, list_pipelines
│   │   └── query.py               # natural_language_query (text-to-SQL)
│   └── adapters/
│       └── model_adapter.py       # BaseModelAdapter ABC + LiteLLMAdapter + NetflixModelAdapter stub
│
├── db/
│   ├── setup.py                   # Seeds SQLite with demo experiments, models, pipelines
│   └── mlctl.db                   # Auto-generated on first setup.py run
│
├── mock/
│   └── platform_mock.py           # Simulated Metaflow, MLflow, Airflow, SageMaker responses
│
├── web/
│   ├── app.py                     # FastAPI app — /chat endpoint + static file serving
│   ├── static/
│   │   ├── app.js                 # Slack-clone UI, Chart.js auto-rendering
│   │   └── style.css              # Netflix dark theme
│   └── templates/
│       └── index.html
│
├── examples/
│   └── demo.py                    # Full lifecycle demo (CLI, no UI)
│
└── tests/
    └── test_orchestrator.py
```

---

## Roadmap

- [ ] Real-time streaming responses via SSE — token-by-token output for long-running tool calls
- [ ] Multi-agent parallel experiment runs — fan-out N training jobs, aggregate and rank results
- [ ] Anomaly detection — auto-flag metric regressions before a deploy is confirmed
- [ ] Slack slash commands — `/mlctl deploy`, `/mlctl status`, `/mlctl rollback`
- [ ] Eval harness — auto-generate regression test suites between model versions (champion/challenger)
- [ ] Cost tracking tool — estimate GPU-hours and dollar cost per experiment before submission
- [ ] A/B experiment designer — generate hyperparameter sweep configs from a target metric
- [ ] Netflix SSO integration — derive full user identity (team, role, permissions) from Slack JWT via Okta
- [ ] Multi-workspace support — single MCP server instance serving multiple internal Slack workspaces
- [ ] RBAC — production deployments require Engineering Manager approval via a Slack approval workflow

---

## Why Build This?

The ML lifecycle is fragmented. Every mature ML platform ends up with a sprawl of internal tools with separate UIs, separate auth, and no shared context. An engineer who wants to answer *"is my new model better, and can I safely promote it?"* has to manually stitch together answers from four systems.

MCP changes that calculus. By exposing each platform capability as a named, typed tool on a standard protocol, a single LLM agent can reason across all of them in a single conversational turn — with full context, no tab-switching, and a natural language audit trail. mlctl is a proof of concept for what that looks like in a Netflix-scale ML platform.

---

Built by **Sourav Sengupta** — Software Engineer 5, Model Development and Management, AI Platform.  
PoC demonstrating MCP-native ML platform tooling and agentic developer experience.

# mlctl — ML Platform Agent

> Natural language interface for the full ML lifecycle. Built as an MCP server so it plugs into any AI interface — Claude Desktop, VS Code, Slack bots, or a CLI.

---

## The Problem

ML researchers and data scientists at scale context-switch across 4-5 tools just to do one thing:

- Experiment tracker to check past runs
- Training scheduler to kick off a new run  
- Model registry to register the best result
- Deployment tool to push to staging
- Monitoring dashboard to confirm it's live

**mlctl collapses this into one natural language interface:**

```
"Run a new experiment with lr=0.001, compare it to my last 5 runs, 
register the best one, and deploy it to staging."
```

The agent does all of it — step by step, explaining its reasoning, flagging anomalies.

---

## Demo

```
╔══════════════════════════════════════════════════════════╗
║        mlctl — ML Platform Agent                         ║
╚══════════════════════════════════════════════════════════╝

USER: Compare all experiments, find the best one, register 
      it as netflix_recommender and deploy to staging.

🔧 Tool Call: list_experiments
   Result: [run_001 (acc: 0.882), run_002 (acc: 0.910), run_003 (acc: 0.925)]

🔧 Tool Call: compare_runs
   Result: Best run is run_003 with accuracy 0.9247

🔧 Tool Call: register_model
   Args: { run_id: run_003, model_name: netflix_recommender, stage: staging }
   Result: { registered: true, version: 3.0 }

🔧 Tool Call: deploy_model
   Args: { model_name: netflix_recommender, version: 3.0, environment: staging }
   Result: { deployed: true, endpoint: https://ml-platform.netflix.internal/... }

🤖 mlctl: Done. I compared all 3 experiments and identified run_003 
  (attention_recommender, accuracy: 92.47%) as the best performer. 
  It has been registered as netflix_recommender v3.0 and is now 
  live in staging at the endpoint above. Ready to promote to production 
  when you give the go-ahead.
```

---

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                  MCP Interface                       │
│   Claude Desktop · VS Code · Slack · CLI             │
└──────────────────────┬──────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────┐
│              MLOrchestrator (agent)                  │
│   Multi-step reasoning loop · Tool dispatch          │
│   Conversation history · Anomaly flagging            │
└──────┬──────────────────────────────────────────────┘
       │
       ├── ExperimentTools   → run, list, compare runs
       ├── ModelTools        → register, deploy, rollback
       └── PipelineTools     → trigger, monitor pipelines
                       │
┌──────────────────────▼──────────────────────────────┐
│              Model Adapter (swappable)               │
│   OpenAI (demo) · Netflix Internal Model (prod)      │
└──────────────────────┬──────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────┐
│              Platform Backend                        │
│   Mock (demo) → Netflix AI Platform APIs (prod)      │
└─────────────────────────────────────────────────────┘
```

**Key design decision:** The model adapter and platform backend are both swappable interfaces. Netflix plugs in their own LLM and real platform APIs without touching the agent logic.

---

## Quick Start

```bash
# 1. Clone
git clone https://github.com/ssengupta93/Agents
cd Agents/mlctl

# 2. Install dependencies
pip install -e ".[dev]"

# 3. Set your API key
export OPENAI_API_KEY=your-key-here

# 4. Run the demo
python examples/demo.py
```

---

## Use as MCP Server (Claude Desktop)

Add to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "mlctl": {
      "command": "python",
      "args": ["/path/to/mlctl/server.py"],
      "env": {
        "OPENAI_API_KEY": "your-key-here",
        "MODEL_PROVIDER": "openai"
      }
    }
  }
}
```

Then open Claude Desktop and say:
> "Use mlctl to show me recent experiments and deploy the best model to staging."

---

## Swapping in Netflix's Internal Model

```python
# mlctl/adapters/model_adapter.py

class NetflixModelAdapter(BaseModelAdapter):
    def __init__(self, endpoint: str, api_key: str):
        self.endpoint = endpoint
        self.api_key = api_key

    def chat(self, messages: list[dict], tools: list[dict] = None) -> dict:
        # Replace with Netflix's internal LLM SDK call
        raise NotImplementedError("Inject Netflix's internal model client here.")
```

Set `MODEL_PROVIDER=netflix` and the agent switches automatically.

---

## What The Agent Can Do

| Command (natural language) | What happens |
|---|---|
| "Show me recent experiments" | Lists last N runs with metrics |
| "Run a new experiment with lr=0.001" | Kicks off training, returns run ID + metrics |
| "Compare run_001 and run_003" | Diffs metrics, identifies best |
| "Register the best run as my_model" | Adds to model registry |
| "Deploy my_model to staging" | Deploys, returns endpoint |
| "What's the status of my_model?" | Returns current stage + accuracy |
| "Trigger the feature pipeline" | Starts pipeline, monitors status |
| "Rollback my_model to v1.0" | Rolls back deployment |
| "Do the whole thing end to end" | Chains all steps autonomously |

---

## Why MCP?

MCP (Model Context Protocol) is an open standard for connecting AI agents to tools. Building mlctl as an MCP server means:

- **Interface-agnostic** — the same agent works in Claude Desktop, VS Code, a Slack bot, or a terminal
- **Composable** — other MCP servers (feature store, monitoring, alerting) can be chained with mlctl
- **Netflix-ready** — Netflix can wrap their existing platform APIs as MCP tools without rebuilding the agent layer

---

## Project Structure

```
mlctl/
├── server.py                  # MCP server entry point
├── mlctl/
│   ├── agent/
│   │   └── orchestrator.py    # Multi-step reasoning loop
│   ├── tools/
│   │   ├── experiments.py     # Experiment management tools
│   │   ├── models.py          # Model registry + deployment tools
│   │   └── pipelines.py       # Pipeline orchestration tools
│   └── adapters/
│       └── model_adapter.py   # Swappable LLM interface
├── mock/
│   └── platform_mock.py       # Simulated Netflix platform APIs
└── examples/
    └── demo.py                # Full lifecycle demo
```

---

## Roadmap

- [ ] Eval harness — auto-generate regression tests between model versions
- [ ] Anomaly detection — flag when new model metrics drop below threshold
- [ ] Slack adapter — expose mlctl as a Slack slash command
- [ ] Streaming responses — real-time token streaming for long-running operations
- [ ] Multi-agent mode — parallel experiment runs with result aggregation

---

Built by [Sourav Sengupta](https://github.com/ssengupta93) as a PoC for ML platform developer experience.  
Inspired by the Netflix AI Platform team's work on [Metaflow](https://metaflow.org) and the Model Development and Management platform.

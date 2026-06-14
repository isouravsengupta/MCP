# MCP Projects — Sourav Sengupta

> Model Context Protocol experiments and production-grade agentic systems.

---

## mlctl — Agentic ML Platform Agent

> Natural language control plane for the full ML lifecycle, exposed as an MCP server and surfaced as a Netflix internal Slackbot.

### High-Level Architecture

![mlctl High-Level Architecture](https://raw.githubusercontent.com/isouravsengupta/MCP/main/mlctl/docs/architecture-high-level.svg)

### MCP Server — Low-Level Design

![mlctl MCP Low-Level Design](https://raw.githubusercontent.com/isouravsengupta/MCP/main/mlctl/docs/architecture-mcp-lowlevel.svg)

**What it does:** Netflix ML engineers message `@mlctl` in Slack with plain English — _"compare all experiments, register the best one, deploy to staging"_ — and the agent autonomously calls the right sequence of MCP tools, queries real data, and posts back a rich response with Chart.js analytics.

**Key technical highlights:**
- MCP-native: same server works in Slack, Claude Desktop, VS Code, or CLI
- Model-agnostic: `BaseModelAdapter` ABC swaps between Ollama, OpenAI, Anthropic, Azure, Bedrock, or Netflix's internal LLM
- Real SQLite DB with Text-to-SQL: natural language → generated SQL → live results
- 10 registered tools: experiments, model registry, deployments, pipelines, NL queries
- Agentic reasoning loop with conversational guard — no tools called on greetings
- Chart.js analytics auto-rendered from tool responses (accuracy, loss, F1, pipeline status)

→ **[Full documentation](mlctl/README.md)**

---

## Composite SKU MCP

Composite SKU management with LLM evaluator, feedback learning loop, and presentation rules.

→ **[View project](Composite%20SKU%20MCP/)**

---

## Intelligent MCP

→ **[View project](Intelligent%20MCP/)**

---

Built by [Sourav Sengupta](https://github.com/isouravsengupta) · Software Engineer 5, Model Development and Management, AI Platform

import "dotenv/config";
import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { evaluateCompositeScenario } from "./validator.js";
import { logCase, recordFeedback } from "./caseLogger.js";
import { addRule } from "./configLoader.js";
import type { CompositeScenarioInput } from "./types.js";

const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN;

async function postFeedbackButtons(slackUserId: string, caseId: string, verdict: string) {
  if (!SLACK_BOT_TOKEN) return;
  const emoji: Record<string, string> = { allowed: "✅", risky: "⚠️", blocked: "🚫" };
  await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${SLACK_BOT_TOKEN}` },
    body: JSON.stringify({
      channel: slackUserId,
      text: `Was this verdict correct?`,
      blocks: [
        {
          type: "section",
          text: { type: "mrkdwn", text: `${emoji[verdict] ?? "❓"} Verdict was *${verdict.toUpperCase()}* — was this correct?` }
        },
        {
          type: "actions",
          block_id: `feedback_${caseId}`,
          elements: [
            {
              type: "button",
              text: { type: "plain_text", text: "✅ Verdict is correct" },
              style: "primary",
              action_id: "feedback_correct",
              value: caseId
            },
            {
              type: "button",
              text: { type: "plain_text", text: "❌ Verdict is wrong" },
              style: "danger",
              action_id: "feedback_incorrect",
              value: JSON.stringify({ caseId, verdict, skuName: "" })
            }
          ]
        },
        { type: "context", elements: [{ type: "mrkdwn", text: `Case ID: \`${caseId}\`` }] }
      ]
    })
  });
}

const app = express();
app.use(express.json());

// ── MCP Server ────────────────────────────────────────────────────────────────
const mcp = new McpServer({
  name: "composite-sku-mcp",
  version: "1.0.0"
});

mcp.tool(
  "evaluate_composite_scenario",
  "Evaluate whether a composite SKU order scenario is valid, risky, or blocked based on triage rules. Call this when a user describes a customer order involving Force orgs, Anypoint orgs, and a composite SKU.",
  {
    compositeSkuName: z.string().describe("The name of the composite SKU being ordered, e.g. 'Automation Advanced'"),
    forceOrgIds: z.array(z.string()).describe("List of Salesforce Force org IDs or labels involved"),
    anypointOrgIds: z.array(z.string()).describe("List of MuleSoft Anypoint org IDs or labels involved"),
    orderPattern: z.enum(["single_order", "multi_order"]).describe("Whether this is a single order or multi order"),
    accountId: z.string().optional().describe("Optional account ID"),
    notes: z.string().optional().describe("Any additional context"),
    slackUserId: z.string().optional().describe("Slack user ID of the person who asked — used to send feedback buttons as a follow-up DM")
  },
  async ({ compositeSkuName, forceOrgIds, anypointOrgIds, orderPattern, accountId, notes, slackUserId }) => {
    const input: CompositeScenarioInput = {
      compositeSkuName,
      forceOrgIds,
      anypointOrgIds,
      orderPattern,
      accountId,
      notes
    };
    const result = await evaluateCompositeScenario(input);
    await logCase(input, result).catch(() => {});
    if (slackUserId) postFeedbackButtons(slackUserId, result.caseId, result.verdict).catch(() => {});

    const triggeredRules = result.evaluations.filter(e => e.triggered);
    const lines = [
      `**Composite Check: ${result.verdict.toUpperCase()}**`,
      ``,
      `**Summary:** ${result.summary}`,
      ``
    ];
    if (triggeredRules.length > 0) {
      lines.push("**Rules triggered:**");
      for (const e of triggeredRules) {
        lines.push(`• ${e.ruleId} — ${e.details}`);
        if (e.recommendedOwner) lines.push(`  → Owner: ${e.recommendedOwner}`);
      }
      lines.push("");
    }
    if (result.nextActions.length > 0) {
      lines.push("**Next actions:**");
      for (const a of result.nextActions) lines.push(`• ${a}`);
    }
    lines.push(``, `Case ID: ${result.caseId}`);

    return {
      content: [{ type: "text", text: lines.join("\n") }]
    };
  }
);

mcp.tool(
  "add_triage_rule",
  "Add a new composite SKU triage rule to the MCP rule set. The rule will be immediately active for future evaluations.",
  {
    ruleId: z.string().describe("Unique rule ID, e.g. TRUST-003"),
    title: z.string().describe("Short title for the rule"),
    description: z.string().describe("Full description of what the rule checks"),
    verdictIfTriggered: z.enum(["blocked", "risky", "allowed"]).describe("Verdict to return if rule is triggered"),
    recommendedOwner: z.string().optional().describe("Team or person who owns remediation")
  },
  async ({ ruleId, title, description, verdictIfTriggered, recommendedOwner }) => {
    await addRule({ ruleId, title, description, verdictIfTriggered, recommendedOwner: recommendedOwner ?? "TBD", enabled: true });
    return {
      content: [{ type: "text", text: `Rule ${ruleId} added successfully and is now live.` }]
    };
  }
);

// ── SSE transport for Slack MCP Servers ───────────────────────────────────────
const transports: Record<string, SSEServerTransport> = {};

app.get("/sse", async (req, res) => {
  const transport = new SSEServerTransport("/messages", res);
  transports[transport.sessionId] = transport;
  res.on("close", () => delete transports[transport.sessionId]);
  await mcp.connect(transport);
});

app.post("/messages", async (req, res) => {
  const sessionId = req.query.sessionId as string;
  const transport = transports[sessionId];
  if (!transport) return res.status(400).json({ error: "No session" });
  await transport.handlePostMessage(req, res);
});

// ── Streamable HTTP transport (works through Cloudflare — no persistent connection) ──
app.post("/mcp", async (req, res) => {
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined // stateless mode
  });
  const server = new McpServer({ name: "composite-sku-mcp", version: "1.0.0" });

  server.tool(
    "evaluate_composite_scenario",
    "Evaluate whether a composite SKU order scenario is valid, risky, or blocked based on triage rules. Call this when a user describes a customer order involving Force orgs, Anypoint orgs, and a composite SKU.",
    {
      compositeSkuName: z.string().describe("The name of the composite SKU being ordered, e.g. 'Automation Advanced'"),
      forceOrgIds: z.array(z.string()).describe("List of Salesforce Force org IDs or labels involved"),
      anypointOrgIds: z.array(z.string()).describe("List of MuleSoft Anypoint org IDs or labels involved"),
      orderPattern: z.enum(["single_order", "multi_order"]).describe("Whether this is a single order or multi order"),
      accountId: z.string().optional().describe("Optional account ID"),
      notes: z.string().optional().describe("Any additional context"),
      slackUserId: z.string().optional().describe("Slack user ID of the person who asked — used to send feedback buttons as a follow-up DM")
    },
    async ({ compositeSkuName, forceOrgIds, anypointOrgIds, orderPattern, accountId, notes, slackUserId }) => {
      const input: CompositeScenarioInput = { compositeSkuName, forceOrgIds, anypointOrgIds, orderPattern, accountId, notes };
      const result = await evaluateCompositeScenario(input);
      await logCase(input, result).catch(() => {});
      if (slackUserId) postFeedbackButtons(slackUserId, result.caseId, result.verdict).catch(() => {});
      const triggeredRules = result.evaluations.filter(e => e.triggered);
      const lines = [`**Composite Check: ${result.verdict.toUpperCase()}**`, ``, `**Summary:** ${result.summary}`, ``];
      if (triggeredRules.length > 0) {
        lines.push("**Rules triggered:**");
        for (const e of triggeredRules) {
          lines.push(`• ${e.ruleId} — ${e.details}`);
          if (e.recommendedOwner) lines.push(`  → Owner: ${e.recommendedOwner}`);
        }
        lines.push("");
      }
      if (result.nextActions.length > 0) {
        lines.push("**Next actions:**");
        for (const a of result.nextActions) lines.push(`• ${a}`);
      }
      lines.push(``, `Case ID: ${result.caseId}`);
      return { content: [{ type: "text", text: lines.join("\n") }] };
    }
  );

  server.tool(
    "add_triage_rule",
    "Add a new composite SKU triage rule to the MCP rule set. The rule will be immediately active for future evaluations.",
    {
      ruleId: z.string().describe("Unique rule ID, e.g. TRUST-003"),
      title: z.string().describe("Short title for the rule"),
      description: z.string().describe("Full description of what the rule checks"),
      verdictIfTriggered: z.enum(["blocked", "risky", "allowed"]).describe("Verdict to return if rule is triggered"),
      recommendedOwner: z.string().optional().describe("Team or person who owns remediation")
    },
    async ({ ruleId, title, description, verdictIfTriggered, recommendedOwner }) => {
      await addRule({ ruleId, title, description, verdictIfTriggered, recommendedOwner: recommendedOwner ?? "TBD", enabled: true });
      return { content: [{ type: "text", text: `Rule ${ruleId} added successfully and is now live.` }] };
    }
  );

  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
});

// ── REST endpoints (used by Slack bot internally) ─────────────────────────────
app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "composite-mcp-server" });
});

app.post("/tools/evaluate", async (req, res) => {
  try {
    const input: CompositeScenarioInput = {
      accountId: req.body.accountId,
      compositeSkuName: req.body.compositeSkuName ?? "",
      forceOrgIds: req.body.forceOrgIds ?? [],
      anypointOrgIds: req.body.anypointOrgIds ?? [],
      orderPattern: req.body.orderPattern ?? "single_order",
      notes: req.body.notes,
      submittedBy: req.body.submittedBy
    };
    const result = await evaluateCompositeScenario(input);
    await logCase(input, result).catch(() => {});
    res.json(result);
  } catch (err) {
    console.error("Evaluate error:", err);
    res.status(500).json({ error: "Evaluation failed" });
  }
});

app.post("/tools/feedback", async (req, res) => {
  try {
    const { caseId, feedback, correctedVerdict } = req.body;
    if (!caseId || !feedback) return res.status(400).json({ error: "caseId and feedback are required" });
    await recordFeedback(caseId, feedback, correctedVerdict);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: "Feedback recording failed" });
  }
});

app.post("/tools/add-rule", async (req, res) => {
  try {
    const { ruleId, title, description, verdictIfTriggered, recommendedOwner } = req.body;
    if (!ruleId || !title || !description || !verdictIfTriggered) {
      return res.status(400).json({ error: "ruleId, title, description, and verdictIfTriggered are required" });
    }
    await addRule({ ruleId, title, description, verdictIfTriggered, recommendedOwner: recommendedOwner ?? "TBD", enabled: true });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to add rule" });
  }
});

const PORT = Number(process.env.MCP_PORT ?? 3002);
app.listen(PORT, () => {
  console.log(`composite-mcp-server running on port ${PORT}`);
});

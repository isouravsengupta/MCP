import "dotenv/config";
import express from "express";
import { evaluateCompositeScenario } from "./validator.js";
import { logCase, recordFeedback } from "./caseLogger.js";
import { addRule } from "./configLoader.js";
import type { CompositeScenarioInput } from "./types.js";

const app = express();
app.use(express.json());

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
    await logCase(input, result).catch((err) =>
      console.error("Case log failed (non-fatal):", err)
    );
    res.json(result);
  } catch (err) {
    console.error("Evaluate error:", err);
    res.status(500).json({ error: "Evaluation failed" });
  }
});

app.post("/tools/feedback", async (req, res) => {
  try {
    const { caseId, feedback, correctedVerdict } = req.body;
    if (!caseId || !feedback) {
      return res.status(400).json({ error: "caseId and feedback are required" });
    }
    await recordFeedback(caseId, feedback, correctedVerdict);
    res.json({ ok: true });
  } catch (err) {
    console.error("Feedback error:", err);
    res.status(500).json({ error: "Feedback recording failed" });
  }
});

app.post("/tools/add-rule", async (req, res) => {
  try {
    const { ruleId, title, description, verdictIfTriggered, recommendedOwner } = req.body;
    if (!ruleId || !title || !description || !verdictIfTriggered) {
      return res.status(400).json({ error: "ruleId, title, description, and verdictIfTriggered are required" });
    }
    const rule = {
      ruleId,
      title,
      description,
      verdictIfTriggered,
      recommendedOwner: recommendedOwner ?? "TBD",
      enabled: true
    };
    await addRule(rule);
    res.json({ ok: true, rule });
  } catch (err) {
    console.error("Add-rule error:", err);
    res.status(500).json({ error: "Failed to add rule" });
  }
});

const PORT = Number(process.env.MCP_PORT ?? 3002);
app.listen(PORT, () => {
  console.log(`composite-mcp-server running on port ${PORT}`);
});

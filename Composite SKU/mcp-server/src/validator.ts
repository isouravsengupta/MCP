import Anthropic from "@anthropic-ai/sdk";
import { v4 as uuidv4 } from "uuid";
import { loadRules, loadSkus } from "./configLoader.js";
import type {
  CompositeScenarioInput,
  RiskLevel,
  RuleEvaluation,
  ScenarioEvaluationResult
} from "./types.js";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

function unique(values: string[]): string[] {
  return Array.from(new Set(values.map((v) => v.trim()).filter(Boolean)));
}

function escalateRisk(current: RiskLevel, next: RiskLevel): RiskLevel {
  const rank: Record<RiskLevel, number> = { allowed: 0, risky: 1, blocked: 2 };
  return rank[next] > rank[current] ? next : current;
}

async function evaluateRuleWithLLM(
  rule: { ruleId: string; title: string; description: string; verdictIfTriggered: RiskLevel },
  scenario: string
): Promise<{ triggered: boolean; details: string }> {
  const prompt = `You are a Salesforce composite SKU triage expert. Evaluate whether the following scenario violates the given rule.

RULE: ${rule.title}
RULE DESCRIPTION: ${rule.description}

SCENARIO: ${scenario}

Answer in this exact JSON format only, no other text:
{"triggered": true or false, "reasoning": "one sentence explanation"}

triggered = true means the scenario VIOLATES or matches the rule condition.
triggered = false means the rule does NOT apply to this scenario.`;

  const response = await anthropic.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 200,
    messages: [{ role: "user", content: prompt }]
  });

  const text = (response.content[0] as { text: string }).text.trim();
  try {
    const parsed = JSON.parse(text) as { triggered: boolean; reasoning: string };
    return { triggered: parsed.triggered, details: parsed.reasoning };
  } catch {
    return { triggered: false, details: "Could not evaluate rule." };
  }
}

export async function evaluateCompositeScenario(
  input: CompositeScenarioInput
): Promise<ScenarioEvaluationResult> {
  const forceOrgIds = unique(input.forceOrgIds);
  const anypointOrgIds = unique(input.anypointOrgIds);
  const evaluations: RuleEvaluation[] = [];
  const missingInformation: string[] = [];
  let verdict: RiskLevel = "allowed";
  const caseId = uuidv4();
  const submittedAt = new Date().toISOString();

  if (forceOrgIds.length === 0) missingInformation.push("At least one Force org ID is required.");
  if (anypointOrgIds.length === 0) missingInformation.push("At least one Anypoint org ID is required.");
  if (!input.compositeSkuName.trim()) missingInformation.push("Composite SKU name is required.");

  if (missingInformation.length > 0) {
    return {
      caseId,
      verdict: "risky",
      summary: "Scenario cannot be fully evaluated — key fields are missing.",
      evaluations,
      missingInformation,
      nextActions: ["Capture missing IDs and re-run the check."],
      submittedAt
    };
  }

  const [rules, skus] = await Promise.all([loadRules(), loadSkus()]);
  const sku = skus.find((s) => s.name.toLowerCase() === input.compositeSkuName.trim().toLowerCase());

  // Build a plain-English scenario description for Claude
  const scenario = [
    `Composite SKU: ${input.compositeSkuName}`,
    `Force org IDs: ${forceOrgIds.join(", ")} (count: ${forceOrgIds.length})`,
    `Anypoint org IDs: ${anypointOrgIds.join(", ")} (count: ${anypointOrgIds.length})`,
    `Order pattern: ${input.orderPattern}`,
    sku ? `SKU found in catalogue: yes` : `SKU found in catalogue: no`,
    input.notes ? `Additional context: ${input.notes}` : ""
  ].filter(Boolean).join(". ");

  // Evaluate all rules in parallel via Claude
  const results = await Promise.all(
    rules.map(async (rule) => {
      const { triggered, details } = await evaluateRuleWithLLM(rule, scenario);
      const riskLevel: RiskLevel = triggered ? rule.verdictIfTriggered : "allowed";
      return {
        ruleId: rule.ruleId,
        title: rule.title,
        riskLevel,
        triggered,
        details,
        recommendedOwner: triggered ? rule.recommendedOwner : undefined
      } as RuleEvaluation;
    })
  );

  for (const evaluation of results) {
    evaluations.push(evaluation);
    verdict = escalateRisk(verdict, evaluation.riskLevel);
  }

  return {
    caseId,
    verdict,
    summary:
      verdict === "allowed"
        ? "Scenario looks compatible with current known constraints."
        : verdict === "risky"
          ? "Scenario may work but needs owner review before committing to customer."
          : "Scenario conflicts with known trust constraints — do not proceed without escalation.",
    evaluations,
    missingInformation,
    nextActions: [
      "Validate with policy owner before customer commitment.",
      "If trust relinking is needed, pre-engage Global Identity integration support."
    ],
    submittedAt
  };
}

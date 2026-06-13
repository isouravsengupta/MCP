import { v4 as uuidv4 } from "uuid";
import { loadRules, loadSkus } from "./configLoader.js";
import type {
  CompositeScenarioInput,
  RiskLevel,
  RuleEvaluation,
  ScenarioEvaluationResult
} from "./types.js";

function unique(values: string[]): string[] {
  return Array.from(new Set(values.map((v) => v.trim()).filter(Boolean)));
}

function escalateRisk(current: RiskLevel, next: RiskLevel): RiskLevel {
  const rank: Record<RiskLevel, number> = { allowed: 0, risky: 1, blocked: 2 };
  return rank[next] > rank[current] ? next : current;
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

  for (const rule of rules) {
    let triggered = false;
    let details = "";

    if (rule.ruleId === "SKU-001") {
      triggered = !sku;
      details = sku
        ? `Matched catalogue SKU: ${sku.name}.`
        : "SKU not found in catalogue. Needs L&P review.";
    } else if (rule.ruleId === "TRUST-001") {
      triggered = forceOrgIds.length === 1 && anypointOrgIds.length > 1;
      details = triggered
        ? "One Force org linked to multiple Anypoint orgs — likely policy conflict."
        : "No one-Force-to-many-Anypoint conflict detected.";
    } else if (rule.ruleId === "OPS-001") {
      triggered = input.orderPattern === "multi_order" && anypointOrgIds.length > 1;
      details = triggered
        ? "Multi-order with multiple Anypoint orgs — needs sequencing and trust teardown validation."
        : "No extra sequencing risk detected.";
    }

    const riskLevel = triggered ? rule.verdictIfTriggered : "allowed";
    evaluations.push({
      ruleId: rule.ruleId,
      title: rule.title,
      riskLevel,
      triggered,
      details,
      recommendedOwner: triggered ? rule.recommendedOwner : undefined
    });
    verdict = escalateRisk(verdict, riskLevel);
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

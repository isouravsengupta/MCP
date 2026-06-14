import { KNOWN_COMPOSITE_SKUS } from "./referenceData.js";
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

function findSkuByName(name: string) {
  return KNOWN_COMPOSITE_SKUS.find(
    (sku) => sku.name.toLowerCase() === name.trim().toLowerCase()
  );
}

export function evaluateCompositeScenario(
  input: CompositeScenarioInput
): ScenarioEvaluationResult {
  const forceOrgIds = unique(input.forceOrgIds);
  const anypointOrgIds = unique(input.anypointOrgIds);

  const evaluations: RuleEvaluation[] = [];
  const missingInformation: string[] = [];
  let verdict: RiskLevel = "allowed";

  if (forceOrgIds.length === 0) missingInformation.push("At least one Force org ID is required.");
  if (anypointOrgIds.length === 0) missingInformation.push("At least one Anypoint org ID is required.");
  if (!input.compositeSkuName.trim()) missingInformation.push("Composite SKU name is required.");

  if (missingInformation.length > 0) {
    return {
      verdict: "risky",
      summary: "The scenario cannot be fully evaluated because key fields are missing.",
      evaluations,
      missingInformation,
      nextActions: ["Capture missing IDs and re-run the check."]
    };
  }

  const sku = findSkuByName(input.compositeSkuName);
  evaluations.push({
    ruleId: "SKU-001",
    title: "Composite SKU known in local reference",
    riskLevel: sku ? "allowed" : "risky",
    triggered: !sku,
    details: sku
      ? `Matched reference SKU: ${sku.name}.`
      : "SKU not found in local reference. Needs L&P review.",
    recommendedOwner: sku ? undefined : "L&P Product Operations"
  });
  verdict = escalateRisk(verdict, sku ? "allowed" : "risky");

  const oneForceManyAnypoint = forceOrgIds.length === 1 && anypointOrgIds.length > 1;
  evaluations.push({
    ruleId: "TRUST-001",
    title: "One Force org linked to many Anypoint orgs",
    riskLevel: oneForceManyAnypoint ? "blocked" : "allowed",
    triggered: oneForceManyAnypoint,
    details: oneForceManyAnypoint
      ? "Likely policy conflict with tenant trust constraints."
      : "No direct one-Force-to-many-Anypoint conflict detected.",
    recommendedOwner: "Global Identity / Quoting Guardrail"
  });
  verdict = escalateRisk(verdict, oneForceManyAnypoint ? "blocked" : "allowed");

  const multiOrderManyAnypoint =
    input.orderPattern === "multi_order" && anypointOrgIds.length > 1;
  evaluations.push({
    ruleId: "OPS-001",
    title: "Multi-order with multiple Anypoint orgs",
    riskLevel: multiOrderManyAnypoint ? "risky" : "allowed",
    triggered: multiOrderManyAnypoint,
    details: multiOrderManyAnypoint
      ? "Needs sequencing + trust teardown/relink validation."
      : "No extra sequencing risk detected.",
    recommendedOwner: "L&P Provisioning"
  });
  verdict = escalateRisk(verdict, multiOrderManyAnypoint ? "risky" : "allowed");

  return {
    verdict,
    summary:
      verdict === "allowed"
        ? "Scenario looks compatible with current known constraints."
        : verdict === "risky"
          ? "Scenario may work but needs owner review."
          : "Scenario conflicts with known trust constraints.",
    evaluations,
    missingInformation,
    nextActions: [
      "Validate with policy owner before customer commitment.",
      "If trust relinking is needed, pre-engage Global Identity integration support."
    ]
  };
}

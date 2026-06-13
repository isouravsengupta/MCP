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

  if (forceOrgIds.length === 0) {
    missingInformation.push("At least one Force org ID is required.");
  }

  if (anypointOrgIds.length === 0) {
    missingInformation.push("At least one Anypoint org ID is required.");
  }

  if (!input.compositeSkuName.trim()) {
    missingInformation.push("Composite SKU name is required.");
  }

  if (missingInformation.length > 0) {
    return {
      verdict: "risky",
      summary:
        "The scenario cannot be fully evaluated because key fields are missing.",
      evaluations,
      missingInformation,
      nextActions: [
        "Capture missing identifiers from quote/provisioning context.",
        "Re-run validation with complete input."
      ]
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
      : "SKU is not in the local reference list. Might still be valid, but needs review.",
    recommendedOwner: sku ? undefined : "L&P Product Operations"
  });
  verdict = escalateRisk(verdict, sku ? "allowed" : "risky");

  const forceToAnypointMany = forceOrgIds.length > anypointOrgIds.length;
  evaluations.push({
    ruleId: "TRUST-001",
    title: "Many Force orgs to one/few Anypoint orgs",
    riskLevel: "allowed",
    triggered: forceToAnypointMany,
    details: forceToAnypointMany
      ? "This pattern is usually expected: one Anypoint org can trust multiple Force orgs."
      : "Pattern does not exercise many-Force-to-single-Anypoint behavior.",
    recommendedOwner: "Global Identity / Tenant Trust"
  });

  const potentialForceToManyAnypoint = forceOrgIds.length === 1 && anypointOrgIds.length > 1;
  evaluations.push({
    ruleId: "TRUST-002",
    title: "One Force org linked to multiple Anypoint orgs",
    riskLevel: potentialForceToManyAnypoint ? "blocked" : "allowed",
    triggered: potentialForceToManyAnypoint,
    details: potentialForceToManyAnypoint
      ? "Potential policy conflict: one Force org generally should not trust multiple Anypoint orgs."
      : "No direct one-Force-to-many-Anypoint conflict detected.",
    recommendedOwner: "Global Identity / Quoting Guardrail"
  });
  verdict = escalateRisk(verdict, potentialForceToManyAnypoint ? "blocked" : "allowed");

  const multiOrderWithMultipleAnypoint =
    input.orderPattern === "multi_order" && anypointOrgIds.length > 1;
  evaluations.push({
    ruleId: "OPS-001",
    title: "Multi-order scenario with multiple Anypoint tenants",
    riskLevel: multiOrderWithMultipleAnypoint ? "risky" : "allowed",
    triggered: multiOrderWithMultipleAnypoint,
    details: multiOrderWithMultipleAnypoint
      ? "Requires careful sequencing and trust teardown/creation checks across orders."
      : "No special multi-order sequencing risk detected.",
    recommendedOwner: "L&P Provisioning + Support Routing"
  });
  verdict = escalateRisk(verdict, multiOrderWithMultipleAnypoint ? "risky" : "allowed");

  const nextActions = [
    "Validate verdict against latest business policy owner before customer-facing commitment.",
    "If trust relinking is required, pre-open escalation path with Global Identity integration team.",
    "Add this scenario to the regression list so future requests are answered faster."
  ];

  const summary =
    verdict === "allowed"
      ? "Scenario looks compatible with current known constraints."
      : verdict === "risky"
        ? "Scenario may work but has dependency/rule ambiguity that needs owner review."
        : "Scenario conflicts with known trust constraints and should be blocked or redesigned.";

  return {
    verdict,
    summary,
    evaluations,
    missingInformation,
    nextActions
  };
}

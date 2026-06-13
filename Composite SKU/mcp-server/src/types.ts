export type RiskLevel = "allowed" | "risky" | "blocked";
export type OrderPattern = "single_order" | "multi_order";

export interface CompositeScenarioInput {
  accountId?: string;
  compositeSkuName: string;
  forceOrgIds: string[];
  anypointOrgIds: string[];
  orderPattern: OrderPattern;
  notes?: string;
  submittedBy?: string;
}

export interface RuleConditions {
  forceOrgCount?: { op: "eq" | "gt" | "lt" | "gte" | "lte"; value: number };
  anypointOrgCount?: { op: "eq" | "gt" | "lt" | "gte" | "lte"; value: number };
  orderPattern?: "single_order" | "multi_order";
  skuNameContains?: string;
}

export interface RuleDefinition {
  ruleId: string;
  title: string;
  description: string;
  verdictIfTriggered: RiskLevel;
  recommendedOwner: string;
  enabled: boolean;
  conditions?: RuleConditions;
}

export interface SkuDefinition {
  name: string;
  relatedFulfillmentProviders: string[];
}

export interface RuleEvaluation {
  ruleId: string;
  title: string;
  riskLevel: RiskLevel;
  triggered: boolean;
  details: string;
  recommendedOwner?: string;
}

export interface ScenarioEvaluationResult {
  caseId: string;
  verdict: RiskLevel;
  summary: string;
  evaluations: RuleEvaluation[];
  missingInformation: string[];
  nextActions: string[];
  submittedAt: string;
}

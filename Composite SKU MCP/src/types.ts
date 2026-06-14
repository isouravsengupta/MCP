export type RiskLevel = "allowed" | "risky" | "blocked";
export type OrderPattern = "single_order" | "multi_order";

export interface CompositeScenarioInput {
  accountId?: string;
  compositeSkuName: string;
  forceOrgIds: string[];
  anypointOrgIds: string[];
  orderPattern: OrderPattern;
  notes?: string;
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
  verdict: RiskLevel;
  summary: string;
  evaluations: RuleEvaluation[];
  missingInformation: string[];
  nextActions: string[];
}

import type { CompositeScenarioInput, OrderPattern } from "./types.js";

export function parseCommaSeparated(value: string): string[] {
  return value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

export function parseOrderPattern(value: string): OrderPattern {
  return value === "multi_order" ? "multi_order" : "single_order";
}

export function parseScenarioPayload(payload: {
  sku: string;
  forceOrgs: string;
  anypointOrgs: string;
  orderPattern: string;
  accountId?: string;
  notes?: string;
}): CompositeScenarioInput {
  return {
    accountId: payload.accountId?.trim() || undefined,
    compositeSkuName: payload.sku.trim(),
    forceOrgIds: parseCommaSeparated(payload.forceOrgs),
    anypointOrgIds: parseCommaSeparated(payload.anypointOrgs),
    orderPattern: parseOrderPattern(payload.orderPattern),
    notes: payload.notes?.trim() || undefined
  };
}

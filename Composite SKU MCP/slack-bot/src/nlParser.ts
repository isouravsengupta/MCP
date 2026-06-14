export interface ParsedPayload {
  compositeSkuName: string;
  forceOrgIds: string[];
  anypointOrgIds: string[];
  orderPattern: "single_order" | "multi_order";
  notes?: string;
}

export function parseNaturalLanguage(text: string): ParsedPayload {
  const lower = text.toLowerCase();

  // Order pattern
  const orderPattern: "single_order" | "multi_order" =
    lower.includes("multi order") || lower.includes("multi-order") || lower.includes("multiple order")
      ? "multi_order"
      : "single_order";

  // SKU name — look for known SKU keywords
  const skuPatterns = [
    "automation advanced",
    "integration advanced",
    "platform",
    "anypoint",
    "mulesoft",
    "tableau",
    "slack",
    "sales cloud",
    "service cloud",
    "revenue cloud",
    "marketing cloud"
  ];
  let compositeSkuName = "";
  for (const sku of skuPatterns) {
    if (lower.includes(sku)) {
      compositeSkuName = sku.replace(/\b\w/g, (c) => c.toUpperCase());
      break;
    }
  }

  // Force org IDs — extract labels after "force org" or "salesforce org"
  const forceOrgIds: string[] = [];
  const forceMatches = text.matchAll(/(?:force|salesforce)\s+org[s]?\s+([A-Za-z0-9,\s]+?)(?:\s+and\s+anypoint|\s+new|\s+order|,|$)/gi);
  for (const m of forceMatches) {
    const ids = m[1].split(/[,\s]+and\s+|[,\s]+/).map((s) => s.trim()).filter(Boolean);
    forceOrgIds.push(...ids);
  }

  // Anypoint org IDs — extract labels after "anypoint org"
  const anypointOrgIds: string[] = [];
  const anypointMatches = text.matchAll(/anypoint\s+org[s]?\s+([A-Za-z0-9,\s]+?)(?:\s+new|\s+order|,|$)/gi);
  for (const m of anypointMatches) {
    const ids = m[1].split(/[,\s]+and\s+|[,\s]+/).map((s) => s.trim()).filter(Boolean);
    anypointOrgIds.push(...ids);
  }

  return { compositeSkuName, forceOrgIds, anypointOrgIds, orderPattern };
}

const MCP_URL = process.env.MCP_SERVER_URL ?? "http://localhost:3002";

export async function evaluate(payload: {
  compositeSkuName: string;
  forceOrgIds: string[];
  anypointOrgIds: string[];
  orderPattern: string;
  accountId?: string;
  notes?: string;
  submittedBy?: string;
}) {
  const res = await fetch(`${MCP_URL}/tools/evaluate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  if (!res.ok) throw new Error(`MCP server error: ${res.status}`);
  return res.json() as Promise<{
    caseId: string;
    verdict: string;
    summary: string;
    evaluations: Array<{
      ruleId: string;
      title: string;
      triggered: boolean;
      details: string;
      recommendedOwner?: string;
    }>;
    missingInformation: string[];
    nextActions: string[];
  }>;
}

export async function sendFeedback(caseId: string, feedback: "correct" | "incorrect") {
  await fetch(`${MCP_URL}/tools/feedback`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ caseId, feedback })
  });
}

export async function addRule(rule: {
  ruleId: string;
  title: string;
  description: string;
  verdictIfTriggered: string;
  recommendedOwner?: string;
}) {
  const res = await fetch(`${MCP_URL}/tools/add-rule`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(rule)
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(body.error ?? `MCP server error: ${res.status}`);
  }
  return res.json() as Promise<{ ok: boolean; rule: unknown }>;
}

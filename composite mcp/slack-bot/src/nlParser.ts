import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic();

export interface ParsedPayload {
  compositeSkuName: string;
  forceOrgIds: string[];
  anypointOrgIds: string[];
  orderPattern: "single_order" | "multi_order";
  notes?: string;
}

const SYSTEM_PROMPT = `You are a Salesforce composite SKU triage assistant. Extract structured order information from plain-English messages.

Rules:
- compositeSkuName: the SKU or product being ordered (e.g. "Automation Advanced", "Integration Advanced")
- forceOrgIds: Salesforce/Force org IDs or labels (e.g. "org A", "A", "salesforce org 1")
- anypointOrgIds: Anypoint/MuleSoft org IDs or labels (e.g. "org X", "X", "anypoint org 1")
- orderPattern: "multi_order" if the message says "multi order", "multi-order", or "multiple orders"; otherwise "single_order"
- If a field is not mentioned, use an empty array or empty string

Return ONLY valid JSON matching this exact schema, no explanation:
{
  "compositeSkuName": "string",
  "forceOrgIds": ["string"],
  "anypointOrgIds": ["string"],
  "orderPattern": "single_order" | "multi_order",
  "notes": "string or omit"
}`;

export async function parseNaturalLanguage(userText: string): Promise<ParsedPayload> {
  const response = await client.messages.create({
    model: "claude-opus-4-8",
    max_tokens: 512,
    thinking: { type: "adaptive" },
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: userText }]
  });

  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("No text response from Claude");
  }

  const json = textBlock.text.trim().replace(/^```json\s*/i, "").replace(/```$/, "").trim();
  return JSON.parse(json) as ParsedPayload;
}

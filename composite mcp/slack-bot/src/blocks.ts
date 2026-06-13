const EMOJI: Record<string, string> = {
  allowed: "✅",
  risky: "⚠️",
  blocked: "🚫"
};

export function buildResultBlocks(result: {
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
}) {
  const emoji = EMOJI[result.verdict] ?? "❓";
  const blocks: unknown[] = [
    {
      type: "header",
      text: { type: "plain_text", text: `${emoji} Composite Check: ${result.verdict.toUpperCase()}` }
    },
    {
      type: "section",
      text: { type: "mrkdwn", text: `*Summary:* ${result.summary}` }
    },
    { type: "divider" }
  ];

  const triggered = result.evaluations.filter((e) => e.triggered);
  if (triggered.length > 0) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*Rules triggered:*\n${triggered
          .map((e) => `• *${e.ruleId}* — ${e.details}${e.recommendedOwner ? `\n  → Owner: ${e.recommendedOwner}` : ""}`)
          .join("\n")}`
      }
    });
  }

  if (result.missingInformation.length > 0) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*Missing information:*\n${result.missingInformation.map((m) => `• ${m}`).join("\n")}`
      }
    });
  }

  blocks.push({
    type: "section",
    text: {
      type: "mrkdwn",
      text: `*Next actions:*\n${result.nextActions.map((a) => `• ${a}`).join("\n")}`
    }
  });

  blocks.push({ type: "divider" });
  blocks.push({
    type: "actions",
    block_id: `feedback_${result.caseId}`,
    elements: [
      {
        type: "button",
        text: { type: "plain_text", text: "✅ Verdict is correct" },
        style: "primary",
        action_id: "feedback_correct",
        value: result.caseId
      },
      {
        type: "button",
        text: { type: "plain_text", text: "❌ Verdict is wrong" },
        style: "danger",
        action_id: "feedback_incorrect",
        value: result.caseId
      }
    ]
  });

  blocks.push({
    type: "context",
    elements: [{ type: "mrkdwn", text: `Case ID: \`${result.caseId}\`` }]
  });

  return blocks;
}

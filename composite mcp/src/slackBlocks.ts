import type { KnownCompositeSku } from "./referenceData.js";
import type { ScenarioEvaluationResult } from "./types.js";

function verdictEmoji(verdict: ScenarioEvaluationResult["verdict"]): string {
  if (verdict === "allowed") return ":large_green_circle:";
  if (verdict === "risky") return ":large_yellow_circle:";
  return ":red_circle:";
}

export function buildEvaluationBlocks(
  result: ScenarioEvaluationResult,
  candidateSkus: KnownCompositeSku[]
) {
  const blocks: Array<Record<string, unknown>> = [
    {
      type: "header",
      text: { type: "plain_text", text: `${verdictEmoji(result.verdict)} Composite Check` }
    },
    {
      type: "section",
      text: { type: "mrkdwn", text: `*Verdict:* ${result.verdict}\n${result.summary}` }
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text:
          "*Rule checks*\n" +
          result.evaluations.map((e) => `• *${e.title}*: ${e.details}`).join("\n")
      }
    },
    {
      type: "section",
      text: { type: "mrkdwn", text: "*Known SKUs*\n" + candidateSkus.map((s) => `• ${s.name}`).join("\n") }
    }
  ];
  return blocks;
}

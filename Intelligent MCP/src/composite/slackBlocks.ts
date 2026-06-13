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
      text: {
        type: "plain_text",
        text: `${verdictEmoji(result.verdict)} Composite Scenario: ${result.verdict.toUpperCase()}`
      }
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*Summary*\n${result.summary}`
      }
    }
  ];

  if (result.missingInformation.length > 0) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text:
          "*Missing Information*\n" +
          result.missingInformation.map((item) => `• ${item}`).join("\n")
      }
    });
  }

  if (result.evaluations.length > 0) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text:
          "*Rule Checks*\n" +
          result.evaluations
            .map((rule) => {
              const marker =
                rule.riskLevel === "allowed"
                  ? ":white_check_mark:"
                  : rule.riskLevel === "risky"
                    ? ":warning:"
                    : ":x:";
              return `${marker} *${rule.title}* — ${rule.details}`;
            })
            .join("\n")
      }
    });
  }

  blocks.push({
    type: "section",
    text: {
      type: "mrkdwn",
      text:
        "*Next Actions*\n" + result.nextActions.map((item) => `• ${item}`).join("\n")
    }
  });

  if (candidateSkus.length > 0) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text:
          "*Known Composite SKUs in this POC*\n" +
          candidateSkus.map((sku) => `• ${sku.name}`).join("\n")
      }
    });
  }

  return blocks;
}

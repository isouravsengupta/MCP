import "dotenv/config";
import { App, LogLevel } from "@slack/bolt";
import { KNOWN_COMPOSITE_SKUS } from "./referenceData.js";
import { parseScenarioPayload } from "./parser.js";
import { evaluateCompositeScenario } from "./validator.js";
import { buildEvaluationBlocks } from "./slackBlocks.js";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

const app = new App({
  token: requireEnv("SLACK_BOT_TOKEN"),
  signingSecret: requireEnv("SLACK_SIGNING_SECRET"),
  appToken: process.env.SLACK_APP_TOKEN,
  socketMode: process.env.SLACK_SOCKET_MODE === "true",
  logLevel: LogLevel.INFO
});

app.command("/composite-check", async ({ ack, body, client }) => {
  await ack();
  await client.views.open({
    trigger_id: body.trigger_id,
    view: {
      type: "modal",
      callback_id: "composite_check_modal",
      title: { type: "plain_text", text: "Composite Check" },
      submit: { type: "plain_text", text: "Run" },
      close: { type: "plain_text", text: "Cancel" },
      blocks: [
        {
          type: "input",
          block_id: "sku_block",
          label: { type: "plain_text", text: "Composite SKU Name" },
          element: { type: "plain_text_input", action_id: "sku_input" }
        },
        {
          type: "input",
          block_id: "force_orgs_block",
          label: { type: "plain_text", text: "Force Org IDs (comma separated)" },
          element: { type: "plain_text_input", action_id: "force_orgs_input" }
        },
        {
          type: "input",
          block_id: "anypoint_orgs_block",
          label: { type: "plain_text", text: "Anypoint Org IDs (comma separated)" },
          element: { type: "plain_text_input", action_id: "anypoint_orgs_input" }
        },
        {
          type: "input",
          block_id: "order_pattern_block",
          label: { type: "plain_text", text: "Order Pattern" },
          element: {
            type: "static_select",
            action_id: "order_pattern_input",
            options: [
              { text: { type: "plain_text", text: "single_order" }, value: "single_order" },
              { text: { type: "plain_text", text: "multi_order" }, value: "multi_order" }
            ]
          }
        }
      ]
    }
  });
});

app.view("composite_check_modal", async ({ ack, body, view, client }) => {
  await ack();
  const values = view.state.values;
  const scenario = parseScenarioPayload({
    sku: values.sku_block.sku_input.value ?? "",
    forceOrgs: values.force_orgs_block.force_orgs_input.value ?? "",
    anypointOrgs: values.anypoint_orgs_block.anypoint_orgs_input.value ?? "",
    orderPattern: values.order_pattern_block.order_pattern_input.selected_option?.value ?? "single_order"
  });

  const result = evaluateCompositeScenario(scenario);
  const blocks = buildEvaluationBlocks(result, KNOWN_COMPOSITE_SKUS);
  await client.chat.postMessage({
    channel: body.user.id,
    text: `Composite validation: ${result.verdict}`,
    blocks: blocks as never
  });
});

const port = Number(process.env.PORT ?? 3001);
app.start(port).then(() => {
  console.log(`composite mcp Slack app running on port ${port}`);
});

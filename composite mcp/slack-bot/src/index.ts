import "dotenv/config";
import { App, LogLevel } from "@slack/bolt";
import { evaluate, sendFeedback, addRule } from "./mcpClient.js";
import { buildResultBlocks } from "./blocks.js";
import { parseNaturalLanguage } from "./nlParser.js";

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
          block_id: "account_block",
          optional: true,
          label: { type: "plain_text", text: "Account ID (optional)" },
          element: { type: "plain_text_input", action_id: "account_input" }
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
              { text: { type: "plain_text", text: "Single Order" }, value: "single_order" },
              { text: { type: "plain_text", text: "Multi Order" }, value: "multi_order" }
            ]
          }
        },
        {
          type: "input",
          block_id: "notes_block",
          optional: true,
          label: { type: "plain_text", text: "Notes (optional)" },
          element: { type: "plain_text_input", action_id: "notes_input", multiline: true }
        }
      ]
    }
  });
});

app.view("composite_check_modal", async ({ ack, body, view, client }) => {
  await ack();
  const v = view.state.values;

  const split = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);

  try {
    const result = await evaluate({
      compositeSkuName: v.sku_block.sku_input.value ?? "",
      accountId: v.account_block.account_input.value ?? undefined,
      forceOrgIds: split(v.force_orgs_block.force_orgs_input.value ?? ""),
      anypointOrgIds: split(v.anypoint_orgs_block.anypoint_orgs_input.value ?? ""),
      orderPattern: v.order_pattern_block.order_pattern_input.selected_option?.value ?? "single_order",
      notes: v.notes_block.notes_input.value ?? undefined,
      submittedBy: body.user.id
    });

    await client.chat.postMessage({
      channel: body.user.id,
      text: `Composite check result: ${result.verdict}`,
      blocks: buildResultBlocks(result) as never
    });
  } catch (err) {
    await client.chat.postMessage({
      channel: body.user.id,
      text: "⚠️ Could not reach the MCP server. Please try again or contact your admin."
    });
  }
});

app.command("/add-rule", async ({ ack, body, client }) => {
  await ack();
  await client.views.open({
    trigger_id: body.trigger_id,
    view: {
      type: "modal",
      callback_id: "add_rule_modal",
      title: { type: "plain_text", text: "Add Triage Rule" },
      submit: { type: "plain_text", text: "Add Rule" },
      close: { type: "plain_text", text: "Cancel" },
      blocks: [
        {
          type: "input",
          block_id: "rule_id_block",
          label: { type: "plain_text", text: "Rule ID (e.g. TRUST-003)" },
          element: { type: "plain_text_input", action_id: "rule_id_input" }
        },
        {
          type: "input",
          block_id: "rule_title_block",
          label: { type: "plain_text", text: "Rule Title" },
          element: { type: "plain_text_input", action_id: "rule_title_input" }
        },
        {
          type: "input",
          block_id: "rule_desc_block",
          label: { type: "plain_text", text: "Description" },
          element: { type: "plain_text_input", action_id: "rule_desc_input", multiline: true }
        },
        {
          type: "input",
          block_id: "rule_verdict_block",
          label: { type: "plain_text", text: "Verdict if Triggered" },
          element: {
            type: "static_select",
            action_id: "rule_verdict_input",
            options: [
              { text: { type: "plain_text", text: "Blocked" }, value: "blocked" },
              { text: { type: "plain_text", text: "Risky" }, value: "risky" },
              { text: { type: "plain_text", text: "Allowed" }, value: "allowed" }
            ]
          }
        },
        {
          type: "input",
          block_id: "rule_owner_block",
          optional: true,
          label: { type: "plain_text", text: "Recommended Owner (optional)" },
          element: { type: "plain_text_input", action_id: "rule_owner_input" }
        }
      ]
    }
  });
});

app.view("add_rule_modal", async ({ ack, body, view, client }) => {
  await ack();
  const v = view.state.values;
  try {
    await addRule({
      ruleId: v.rule_id_block.rule_id_input.value ?? "",
      title: v.rule_title_block.rule_title_input.value ?? "",
      description: v.rule_desc_block.rule_desc_input.value ?? "",
      verdictIfTriggered: v.rule_verdict_block.rule_verdict_input.selected_option?.value ?? "risky",
      recommendedOwner: v.rule_owner_block.rule_owner_input.value ?? undefined
    });
    await client.chat.postMessage({
      channel: body.user.id,
      text: `✅ Rule *${v.rule_id_block.rule_id_input.value}* added successfully and is now live in the MCP.`
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    await client.chat.postMessage({
      channel: body.user.id,
      text: `⚠️ Failed to add rule: ${msg}`
    });
  }
});

// Direct message handler — plain English to verdict
app.message(async ({ message, say }) => {
  // Only handle plain user messages (not bot messages, edits, etc.)
  if (message.subtype) return;
  const userText = (message as { text?: string }).text ?? "";
  if (!userText.trim()) return;

  try {
    await say("🔍 Analysing your request...");

    const parsed = await parseNaturalLanguage(userText);

    if (!parsed.compositeSkuName) {
      await say(
        "I couldn't identify a Composite SKU in your message. Try something like:\n" +
        "_\"Customer has Force org A and Anypoint org X, new order for Automation Advanced, multi order — is this valid?\"_"
      );
      return;
    }

    const result = await evaluate({
      compositeSkuName: parsed.compositeSkuName,
      forceOrgIds: parsed.forceOrgIds,
      anypointOrgIds: parsed.anypointOrgIds,
      orderPattern: parsed.orderPattern,
      notes: parsed.notes,
      submittedBy: (message as { user?: string }).user
    });

    await say({
      text: `Composite check result: ${result.verdict}`,
      blocks: buildResultBlocks(result) as never
    });
  } catch (err) {
    console.error("NL message handler error:", err);
    await say("⚠️ Something went wrong processing your request. Please try again or use `/composite-check`.");
  }
});

app.action("feedback_correct", async ({ ack, action, client, body }) => {
  await ack();
  const caseId = (action as { value: string }).value;
  await sendFeedback(caseId, "correct");
  await client.chat.postEphemeral({
    channel: body.channel?.id ?? body.user.id,
    user: body.user.id,
    text: "✅ Thanks — recorded as correct."
  });
});

app.action("feedback_incorrect", async ({ ack, action, client, body }) => {
  await ack();
  const caseId = (action as { value: string }).value;
  await sendFeedback(caseId, "incorrect");
  await client.chat.postEphemeral({
    channel: body.channel?.id ?? body.user.id,
    user: body.user.id,
    text: "❌ Thanks — recorded as incorrect. This will help improve future verdicts."
  });
});

const PORT = Number(process.env.PORT ?? 3001);
app.start(PORT).then(() => {
  console.log(`composite-slack-bot running on port ${PORT}`);
});

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
  logLevel: LogLevel.INFO,
  processBeforeResponse: true
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

    const parsed = parseNaturalLanguage(userText);

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
  const raw = (action as { value: string }).value;
  let caseId = raw;
  let currentVerdict = "unknown";
  try {
    const parsed = JSON.parse(raw) as { caseId: string; verdict: string; skuName: string };
    caseId = parsed.caseId;
    currentVerdict = parsed.verdict;
  } catch { /* plain caseId from old messages */ }

  await sendFeedback(caseId, "incorrect");

  const triggerId = (body as { trigger_id?: string }).trigger_id;
  if (!triggerId) return;

  await client.views.open({
    trigger_id: triggerId,
    view: {
      type: "modal",
      callback_id: "correction_modal",
      private_metadata: caseId,
      title: { type: "plain_text", text: "Correct this verdict" },
      submit: { type: "plain_text", text: "Add as rule" },
      close: { type: "plain_text", text: "Cancel" },
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `The current verdict was *${currentVerdict.toUpperCase()}*. Tell us what it should be and why — this will be added as a new triage rule so the MCP learns from it.`
          }
        },
        {
          type: "input",
          block_id: "rule_id_block",
          label: { type: "plain_text", text: "Rule ID (e.g. CUSTOM-001)" },
          element: { type: "plain_text_input", action_id: "rule_id_input", placeholder: { type: "plain_text", text: "CUSTOM-001" } }
        },
        {
          type: "input",
          block_id: "rule_title_block",
          label: { type: "plain_text", text: "Rule title (short summary)" },
          element: { type: "plain_text_input", action_id: "rule_title_input" }
        },
        {
          type: "input",
          block_id: "rule_desc_block",
          label: { type: "plain_text", text: "Why should this be a rule? (describe the condition)" },
          element: { type: "plain_text_input", action_id: "rule_desc_input", multiline: true }
        },
        {
          type: "input",
          block_id: "correct_verdict_block",
          label: { type: "plain_text", text: "Correct verdict for this scenario" },
          element: {
            type: "static_select",
            action_id: "correct_verdict_input",
            options: [
              { text: { type: "plain_text", text: "✅ Allowed" }, value: "allowed" },
              { text: { type: "plain_text", text: "⚠️ Risky" }, value: "risky" },
              { text: { type: "plain_text", text: "🚫 Blocked" }, value: "blocked" }
            ]
          }
        },
        {
          type: "input",
          block_id: "owner_block",
          optional: true,
          label: { type: "plain_text", text: "Rule owner (optional)" },
          element: { type: "plain_text_input", action_id: "owner_input" }
        },
        {
          type: "section",
          text: { type: "mrkdwn", text: "*Conditions (optional) — define when this rule fires:*" }
        },
        {
          type: "input",
          block_id: "force_org_count_block",
          optional: true,
          label: { type: "plain_text", text: "Force org count triggers when..." },
          element: {
            type: "static_select",
            action_id: "force_org_count_input",
            placeholder: { type: "plain_text", text: "Select condition" },
            options: [
              { text: { type: "plain_text", text: "exactly 1" }, value: "eq:1" },
              { text: { type: "plain_text", text: "more than 1" }, value: "gt:1" },
              { text: { type: "plain_text", text: "more than 2" }, value: "gt:2" }
            ]
          }
        },
        {
          type: "input",
          block_id: "anypoint_org_count_block",
          optional: true,
          label: { type: "plain_text", text: "Anypoint org count triggers when..." },
          element: {
            type: "static_select",
            action_id: "anypoint_org_count_input",
            placeholder: { type: "plain_text", text: "Select condition" },
            options: [
              { text: { type: "plain_text", text: "exactly 1" }, value: "eq:1" },
              { text: { type: "plain_text", text: "more than 1" }, value: "gt:1" },
              { text: { type: "plain_text", text: "more than 2" }, value: "gt:2" }
            ]
          }
        },
        {
          type: "input",
          block_id: "order_pattern_cond_block",
          optional: true,
          label: { type: "plain_text", text: "Order pattern triggers when..." },
          element: {
            type: "static_select",
            action_id: "order_pattern_cond_input",
            placeholder: { type: "plain_text", text: "Any pattern" },
            options: [
              { text: { type: "plain_text", text: "Single order" }, value: "single_order" },
              { text: { type: "plain_text", text: "Multi order" }, value: "multi_order" }
            ]
          }
        },
        {
          type: "input",
          block_id: "sku_contains_block",
          optional: true,
          label: { type: "plain_text", text: "SKU name contains (optional)" },
          element: { type: "plain_text_input", action_id: "sku_contains_input", placeholder: { type: "plain_text", text: "e.g. Automation Advanced" } }
        }
      ]
    }
  });
});

app.view("correction_modal", async ({ ack, body, view, client }) => {
  await ack();
  const v = view.state.values;
  const caseId = view.private_metadata;

  const ruleId = v.rule_id_block.rule_id_input.value ?? `FEEDBACK-${Date.now()}`;
  const title = v.rule_title_block.rule_title_input.value ?? "User correction rule";
  const description = v.rule_desc_block.rule_desc_input.value ?? "";
  const verdictIfTriggered = v.correct_verdict_block.correct_verdict_input.selected_option?.value ?? "risky";
  const recommendedOwner = v.owner_block.owner_input.value ?? undefined;

  // Build conditions from optional fields
  const conditions: Record<string, unknown> = {};
  const forceOrgCond = v.force_org_count_block?.force_org_count_input?.selected_option?.value;
  if (forceOrgCond) {
    const [op, val] = forceOrgCond.split(":");
    conditions.forceOrgCount = { op, value: Number(val) };
  }
  const anypointOrgCond = v.anypoint_org_count_block?.anypoint_org_count_input?.selected_option?.value;
  if (anypointOrgCond) {
    const [op, val] = anypointOrgCond.split(":");
    conditions.anypointOrgCount = { op, value: Number(val) };
  }
  const orderPatternCond = v.order_pattern_cond_block?.order_pattern_cond_input?.selected_option?.value;
  if (orderPatternCond) conditions.orderPattern = orderPatternCond;
  const skuContains = v.sku_contains_block?.sku_contains_input?.value;
  if (skuContains) conditions.skuNameContains = skuContains;

  try {
    await addRule({
      ruleId, title, description, verdictIfTriggered, recommendedOwner,
      conditions: Object.keys(conditions).length > 0 ? conditions as never : undefined
    });
    await client.chat.postMessage({
      channel: body.user.id,
      text: `✅ Thanks! Rule *${ruleId}* has been added to the MCP and is now live for future evaluations.\n_Case ID: \`${caseId}\`_`
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    await client.chat.postMessage({
      channel: body.user.id,
      text: `⚠️ Verdict was recorded but rule could not be saved: ${msg}`
    });
  }
});

const PORT = Number(process.env.PORT ?? 3001);
app.start(PORT).then(() => {
  console.log(`composite-slack-bot running on port ${PORT}`);
});

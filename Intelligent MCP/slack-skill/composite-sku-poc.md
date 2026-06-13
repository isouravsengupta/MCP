# Composite SKU Slack POC (Beginner Guide)

This POC helps GTM Tooling & Governance quickly validate Composite SKU scenarios:
- input Force orgs + Anypoint orgs + SKU + order pattern,
- get verdict (`allowed`, `risky`, `blocked`),
- see why the verdict was returned and what team should own next action.

## 1) What you are building

A Slack app command (`/composite-check`) that opens a form and runs a deterministic rules engine.

## 2) Local setup

From repo root:

```bash
npm install
cp .env.composite.example .env
```

Fill `.env` with your Slack app credentials.

Run:

```bash
npm run composite:dev
```

## 3) Create Slack app (Slack farm workspace)

1. Go to [api.slack.com/apps](https://api.slack.com/apps).
2. Create app from scratch.
3. Enable **Socket Mode** (for easiest local testing).
4. Add OAuth scopes:
   - `commands`
   - `chat:write`
5. Add slash command:
   - command: `/composite-check`
   - request URL: placeholder (not used in socket mode).
6. Install app to workspace.
7. Copy these values into `.env`:
   - Bot token (`xoxb-...`)
   - Signing secret
   - App token (`xapp-...`) with `connections:write` scope

## 4) Try first scenario

In Slack:

```text
/composite-check
```

Example:
- SKU: `MuleSoft - MuleSoft Integration SF - Starter`
- Force orgs: `00D111111111111,00D222222222222`
- Anypoint orgs: `US-263fcd88-eedc-4cde-b11f-45f33b8659c2`
- Order pattern: `multi_order`

The bot sends results to your DM.

## 5) Files to edit

- Rules logic: `src/composite/validator.ts`
- SKU seed list: `src/composite/referenceData.ts`
- Slack modal/command: `src/composite/slackApp.ts`
- Slack response blocks: `src/composite/slackBlocks.ts`

## 6) Why this POC is useful

This replaces repeated Slack-thread analysis with a reusable first-pass validator.
It can later be exposed as MCP tools and reused by agents, CLI, or other internal apps.

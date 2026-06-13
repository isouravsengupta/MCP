# composite mcp

Slack-first POC to validate Composite SKU scenarios for L&P workflows.

## What it does

- `/composite-check` opens a modal in Slack.
- You enter SKU + Force orgs + Anypoint orgs + order pattern.
- The validator returns `allowed`, `risky`, or `blocked` with rule reasoning.

## Setup

```bash
npm install
cp .env.example .env
npm run dev
```

Required `.env` keys:

```bash
SLACK_BOT_TOKEN=xoxb-...
SLACK_SIGNING_SECRET=...
SLACK_APP_TOKEN=xapp-...
SLACK_SOCKET_MODE=true
PORT=3001
```

## Scripts

- `npm run dev` - start Slack app
- `npm run check` - type-check
- `npm run sample` - run sample evaluation in CLI

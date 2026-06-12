import type { VisualizationPayload } from "./visualization.js";

// Slack Block Kit types (minimal subset we need)
export type SlackBlock =
  | { type: "header"; text: { type: "plain_text"; text: string } }
  | { type: "section"; text: { type: "mrkdwn"; text: string } }
  | { type: "image"; image_url: string; alt_text: string; title?: { type: "plain_text"; text: string } }
  | { type: "divider" }
  | { type: "context"; elements: Array<{ type: "mrkdwn"; text: string }> };

function formatVal(value: unknown): string {
  if (typeof value === "number") {
    if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
    if (Math.abs(value) >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
    if (Math.abs(value) < 1 && value !== 0) return `${(value * 100).toFixed(1)}%`;
    return value.toLocaleString();
  }
  return String(value ?? "—");
}

function kpiBlocks(viz: VisualizationPayload): SlackBlock[] {
  const row = viz.rowsPreview[0];
  if (!row) return [];
  const lines = Object.entries(row).map(([k, v]) => `*${k}:* ${formatVal(v)}`);
  return [
    { type: "header", text: { type: "plain_text", text: viz.title } },
    { type: "section", text: { type: "mrkdwn", text: lines.join("   |   ") } },
  ];
}

function tableBlocks(viz: VisualizationPayload): SlackBlock[] {
  const rows = viz.rowsPreview.slice(0, 15);
  if (rows.length === 0) return [];
  const cols = Object.keys(rows[0]);
  const header = cols.map((c) => `*${c}*`).join(" | ");
  const divider = cols.map(() => "---").join(" | ");
  const dataRows = rows.map((r) => cols.map((c) => formatVal(r[c])).join(" | "));
  const tableText = [header, divider, ...dataRows].join("\n");
  return [
    { type: "header", text: { type: "plain_text", text: viz.title } },
    { type: "section", text: { type: "mrkdwn", text: "```" + tableText + "```" } },
  ];
}

function barChartBlocks(viz: VisualizationPayload): SlackBlock[] {
  const rows = viz.rowsPreview.slice(0, 10);
  if (!viz.xKey || !viz.yKeys?.length || rows.length === 0) return tableBlocks(viz);

  const yKey = viz.yKeys[0];
  const maxVal = Math.max(...rows.map((r) => (typeof r[yKey] === "number" ? (r[yKey] as number) : 0)));
  const BAR_WIDTH = 20;

  const lines = rows.map((r) => {
    const label = String(r[viz.xKey!] ?? "").slice(0, 16).padEnd(16);
    const val = typeof r[yKey] === "number" ? (r[yKey] as number) : 0;
    const barLen = maxVal > 0 ? Math.round((val / maxVal) * BAR_WIDTH) : 0;
    const bar = "█".repeat(barLen) + "░".repeat(BAR_WIDTH - barLen);
    return `\`${label}\` ${bar} ${formatVal(val)}`;
  });

  const blocks: SlackBlock[] = [
    { type: "header", text: { type: "plain_text", text: viz.title } },
    { type: "section", text: { type: "mrkdwn", text: lines.join("\n") } },
  ];

  if (viz.yKeys.length > 1) {
    blocks.push({
      type: "context",
      elements: [{ type: "mrkdwn", text: `Also available: ${viz.yKeys.slice(1).join(", ")}` }],
    });
  }

  return blocks;
}

function yoyBlocks(viz: VisualizationPayload): SlackBlock[] {
  const rows = viz.rowsPreview.slice(0, 10);
  if (!viz.xKey || !viz.yKeys?.length || rows.length === 0) return tableBlocks(viz);

  const cyKey = viz.yKeys.find((k) => k.toUpperCase().startsWith("CY_") || k === "VALUE") ?? viz.yKeys[0];
  const pyKey = viz.yKeys.find((k) => k.toUpperCase().startsWith("PY_"));
  const yoyKey = viz.yKeys.find((k) => k.toUpperCase().includes("Y/Y"));

  const lines = rows.map((r) => {
    const label = String(r[viz.xKey!] ?? "").slice(0, 14).padEnd(14);
    const cy = formatVal(r[cyKey]);
    const py = pyKey ? ` vs ${formatVal(r[pyKey])}` : "";
    const yoy = yoyKey && typeof r[yoyKey] === "number"
      ? ` ${(r[yoyKey] as number) >= 0 ? "▲" : "▼"} ${Math.abs((r[yoyKey] as number) * 100).toFixed(1)}% YoY`
      : "";
    return `\`${label}\` *${cy}*${py}${yoy}`;
  });

  return [
    { type: "header", text: { type: "plain_text", text: viz.title } },
    { type: "section", text: { type: "mrkdwn", text: lines.join("\n") } },
  ];
}

export function buildSlackBlocks(viz: VisualizationPayload, chartImageUrl?: string | null): SlackBlock[] {
  let blocks: SlackBlock[];

  switch (viz.component) {
    case "kpi_with_yoy":
      blocks = kpiBlocks(viz);
      break;
    case "bar_chart":
      blocks = barChartBlocks(viz);
      break;
    case "line_chart":
      blocks = barChartBlocks(viz); // text sparkline fallback
      break;
    case "grouped_bar_yoy":
      blocks = yoyBlocks(viz);
      break;
    default:
      blocks = tableBlocks(viz);
  }

  // Option A: if a real chart PNG URL is available, insert it after the header
  if (chartImageUrl) {
    const imageBlock: SlackBlock = {
      type: "image",
      image_url: chartImageUrl,
      alt_text: viz.title,
      title: { type: "plain_text", text: viz.title },
    };
    // Insert after header (index 1) or at start if no header
    const headerIdx = blocks.findIndex((b) => b.type === "header");
    blocks.splice(headerIdx >= 0 ? headerIdx + 1 : 0, 0, imageBlock);
  }

  blocks.push({ type: "divider" });
  return blocks;
}

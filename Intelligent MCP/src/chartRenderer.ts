import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { VisualizationPayload } from "./visualization.js";

// @napi-rs/canvas needs native binaries compiled for the target OS/arch.
// Loaded lazily so Lambda stays functional when the binding is absent (macOS build deployed to Linux).
type CanvasType = import("@napi-rs/canvas").Canvas;
type Ctx2D = CanvasType extends { getContext(c: "2d"): infer C } ? C : never;

async function tryLoadCanvas(): Promise<typeof import("@napi-rs/canvas").createCanvas | null> {
  try {
    return (await import("@napi-rs/canvas")).createCanvas;
  } catch {
    console.warn("chartRenderer: @napi-rs/canvas native binding unavailable — chart rendering disabled.");
    return null;
  }
}

const CHART_COLORS = [
  "#0070D2",
  "#1FAECE",
  "#54698D",
  "#FFB75D",
  "#4BC076",
  "#E07BAB",
];

const CANVAS_W = 800;
const CANVAS_H = 400;
const PADDING = { top: 50, right: 30, bottom: 70, left: 70 };

function formatLabel(value: number): string {
  if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (Math.abs(value) >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return value.toFixed(1);
}

function truncate(str: string, max = 14): string {
  return str.length > max ? str.slice(0, max - 1) + "…" : str;
}

function renderTable(ctx: Ctx2D, viz: VisualizationPayload): void {
  const rows = viz.rowsPreview.slice(0, 10);
  if (rows.length === 0) return;
  const cols = Object.keys(rows[0]);
  const colW = Math.min((CANVAS_W - 40) / cols.length, 160);
  const rowH = 28;
  const startY = 55;

  ctx.font = "bold 12px sans-serif";
  ctx.fillStyle = "#0070D2";
  cols.forEach((col, i) => {
    ctx.textAlign = "left";
    ctx.fillText(truncate(col, 18), 20 + i * colW, startY);
  });

  ctx.font = "12px sans-serif";
  rows.forEach((row, ri) => {
    if (ri % 2 === 0) {
      ctx.fillStyle = "#f4f6f9";
      ctx.fillRect(20, startY + 6 + ri * rowH, CANVAS_W - 40, rowH);
    }
    ctx.fillStyle = "#16325C";
    cols.forEach((col, ci) => {
      const val = row[col];
      const text = typeof val === "number" ? formatLabel(val) : truncate(String(val ?? ""), 18);
      ctx.textAlign = "left";
      ctx.fillText(text, 24 + ci * colW, startY + 22 + ri * rowH);
    });
  });
}

export async function renderChartToPng(viz: VisualizationPayload): Promise<Buffer | null> {
  const createCanvas = await tryLoadCanvas();
  if (!createCanvas) return null;

  const canvas = createCanvas(CANVAS_W, CANVAS_H);
  const ctx = canvas.getContext("2d") as Ctx2D;

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

  ctx.fillStyle = "#16325C";
  ctx.font = "bold 16px sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(viz.title, CANVAS_W / 2, 28);

  const plotW = CANVAS_W - PADDING.left - PADDING.right;
  const plotH = CANVAS_H - PADDING.top - PADDING.bottom;
  const rows = viz.rowsPreview;

  if (viz.component === "table" || !viz.xKey || !viz.yKeys?.length || rows.length === 0) {
    renderTable(ctx, viz);
    return canvas.toBuffer("image/png") as unknown as Buffer;
  }

  const labels = rows.map((r) => truncate(String(r[viz.xKey!] ?? "")));
  const datasets = (viz.yKeys ?? []).map((key, i) => ({
    key,
    color: CHART_COLORS[i % CHART_COLORS.length],
    values: rows.map((r) => (typeof r[key] === "number" ? (r[key] as number) : 0)),
  }));

  const allValues = datasets.flatMap((d) => d.values);
  const maxVal = Math.max(...allValues, 0);
  const minVal = Math.min(...allValues, 0);
  const range = maxVal - minVal || 1;

  const yTicks = 5;
  ctx.strokeStyle = "#e0e5ee";
  ctx.lineWidth = 1;
  ctx.fillStyle = "#54698D";
  ctx.font = "11px sans-serif";
  ctx.textAlign = "right";
  for (let i = 0; i <= yTicks; i++) {
    const val = minVal + (range * i) / yTicks;
    const y = PADDING.top + plotH - (plotH * i) / yTicks;
    ctx.beginPath();
    ctx.moveTo(PADDING.left, y);
    ctx.lineTo(PADDING.left + plotW, y);
    ctx.stroke();
    ctx.fillText(formatLabel(val), PADDING.left - 6, y + 4);
  }

  if (viz.component === "line_chart") {
    for (const ds of datasets) {
      ctx.beginPath();
      ctx.strokeStyle = ds.color;
      ctx.lineWidth = 2.5;
      ds.values.forEach((v, i) => {
        const x = PADDING.left + (i / (labels.length - 1 || 1)) * plotW;
        const y = PADDING.top + plotH - ((v - minVal) / range) * plotH;
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      });
      ctx.stroke();
    }
  } else {
    const groupCount = labels.length;
    const seriesCount = datasets.length;
    const groupW = plotW / groupCount;
    const barW = Math.min((groupW / seriesCount) * 0.8, 50);
    for (let gi = 0; gi < groupCount; gi++) {
      for (let si = 0; si < seriesCount; si++) {
        const v = datasets[si].values[gi];
        const barH = Math.abs(((v - (minVal < 0 ? minVal : 0)) / range) * plotH);
        const x = PADDING.left + gi * groupW + (groupW - seriesCount * barW) / 2 + si * barW;
        const baseY = PADDING.top + plotH - ((0 - (minVal < 0 ? minVal : 0)) / range) * plotH;
        const y = v >= 0 ? baseY - barH : baseY;
        ctx.fillStyle = datasets[si].color;
        ctx.fillRect(x, y, barW - 2, barH);
      }
    }
  }

  ctx.fillStyle = "#54698D";
  ctx.font = "11px sans-serif";
  ctx.textAlign = "center";
  labels.forEach((label, i) => {
    const x =
      viz.component === "line_chart"
        ? PADDING.left + (i / (labels.length - 1 || 1)) * plotW
        : PADDING.left + i * (plotW / labels.length) + plotW / labels.length / 2;
    ctx.fillText(label, x, CANVAS_H - PADDING.bottom + 18);
  });

  if (datasets.length > 1) {
    const legendY = CANVAS_H - 18;
    const totalW = datasets.reduce((sum, d) => sum + d.key.length * 7 + 24, 0);
    let lx = (CANVAS_W - totalW) / 2;
    for (const ds of datasets) {
      ctx.fillStyle = ds.color;
      ctx.fillRect(lx, legendY - 10, 14, 10);
      ctx.fillStyle = "#54698D";
      ctx.font = "11px sans-serif";
      ctx.textAlign = "left";
      ctx.fillText(ds.key, lx + 18, legendY);
      lx += ds.key.length * 7 + 30;
    }
  }

  return canvas.toBuffer("image/png") as unknown as Buffer;
}

let s3: S3Client | null = null;
function getS3(): S3Client {
  if (!s3) s3 = new S3Client({ region: process.env.AWS_REGION ?? "us-west-2" });
  return s3;
}

export async function renderAndUploadChart(
  viz: VisualizationPayload,
  key: string
): Promise<string | null> {
  const bucket = process.env.SPI_CHART_BUCKET;
  if (!bucket) return null;

  try {
    const png = await renderChartToPng(viz);
    if (!png) return null;

    const s3Key = `charts/${key}.png`;
    await getS3().send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: s3Key,
        Body: png,
        ContentType: "image/png",
        CacheControl: "max-age=300",
      })
    );

    return await getSignedUrl(
      getS3(),
      new GetObjectCommand({ Bucket: bucket, Key: s3Key }),
      { expiresIn: 3600 }
    );
  } catch (err) {
    console.error("Chart render/upload failed:", err);
    return null;
  }
}

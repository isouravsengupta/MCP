#!/usr/bin/env node
import { promises as fs } from "node:fs";
import path from "node:path";

const baseDir = process.env.BASE_DIR ?? "/Users/sourav.sengupta/Documents/GitHub/Personal";
const businessLogicDir = process.env.BUSINESS_LOGIC_DIR ?? path.join(baseDir, "business_logic");
const airflowDir = process.env.AIRFLOW_DIR ?? path.join(baseDir, "airflow-dags-uip-gdso");
const outputPath =
  process.env.CONTEXT_INDEX_PATH ?? path.join(baseDir, "spi-mcp", "resources", "context_assets_index.json");

const rootSpecs = [
  {
    repo: "business_logic",
    category: "etl_sql",
    root: path.join(businessLogicDir, "gsp_analytics"),
    extensions: [".sql"]
  },
  {
    repo: "business_logic",
    category: "crma_dashboard",
    root: path.join(businessLogicDir, "gsp_analytics"),
    extensions: [".json"]
  },
  {
    repo: "airflow-dags-uip-gdso",
    category: "airflow_dag",
    root: path.join(airflowDir, "dags"),
    extensions: [".py"]
  }
];

function inferTags(relPath) {
  const tokenized = relPath
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter(Boolean);
  const allow = new Set([
    "spm",
    "qap",
    "gdso",
    "analytics",
    "forecast",
    "pipegen",
    "quota",
    "attainment",
    "acv",
    "aov",
    "program",
    "planning",
    "performance",
    "metrics",
    "dashboard",
    "global",
    "load",
    "extract",
    "tableau",
    "crma"
  ]);
  const tags = [...new Set(tokenized.filter((t) => allow.has(t)))];
  return tags.length > 0 ? tags : ["spm"];
}

async function walk(dir, extensions, acc = []) {
  let entries = [];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return acc;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await walk(full, extensions, acc);
      continue;
    }
    if (extensions.includes(path.extname(entry.name))) {
      acc.push(full);
    }
  }
  return acc;
}

async function main() {
  const assets = [];
  for (const spec of rootSpecs) {
    const files = await walk(spec.root, spec.extensions);
    for (const filePath of files) {
      const rel = path.relative(baseDir, filePath).split(path.sep).join("/");
      assets.push({
        category: spec.category,
        repo: spec.repo,
        path: rel.startsWith(spec.repo) ? rel.slice(spec.repo.length + 1) : rel,
        tags: inferTags(rel)
      });
    }
  }

  const payload = {
    generated_at_utc: new Date().toISOString(),
    roots: rootSpecs.map((spec) => ({
      repo: spec.repo,
      category: spec.category,
      root: spec.root,
      extensions: spec.extensions
    })),
    assets
  };
  await fs.writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  process.stdout.write(`Wrote ${assets.length} assets to ${outputPath}\n`);
}

await main();

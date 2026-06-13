import { S3Client, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import type { RuleDefinition, SkuDefinition } from "./types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const S3_BUCKET = process.env.S3_CONFIG_BUCKET;
const s3 = new S3Client({ region: process.env.AWS_REGION ?? "us-west-2" });

async function loadFromS3(key: string): Promise<unknown> {
  const cmd = new GetObjectCommand({ Bucket: S3_BUCKET!, Key: key });
  const res = await s3.send(cmd);
  const body = await res.Body!.transformToString();
  return JSON.parse(body);
}

function loadFromDisk(filename: string): unknown {
  const p = join(__dirname, "../../config", filename);
  return JSON.parse(readFileSync(p, "utf-8"));
}

async function loadConfig(filename: string): Promise<unknown> {
  if (S3_BUCKET) {
    try {
      return await loadFromS3(`config/${filename}`);
    } catch {
      // fall through to disk
    }
  }
  return loadFromDisk(filename);
}

export async function loadRules(): Promise<RuleDefinition[]> {
  const data = (await loadConfig("rules.json")) as { rules: RuleDefinition[] };
  return data.rules.filter((r) => r.enabled);
}

export async function loadSkus(): Promise<SkuDefinition[]> {
  const data = (await loadConfig("skus.json")) as { skus: SkuDefinition[] };
  return data.skus;
}

export async function addRule(rule: RuleDefinition): Promise<void> {
  const data = (await loadConfig("rules.json")) as { rules: RuleDefinition[] };
  const existing = data.rules.find((r) => r.ruleId === rule.ruleId);
  if (existing) throw new Error(`Rule ${rule.ruleId} already exists`);
  data.rules.push(rule);
  const json = JSON.stringify(data, null, 2);

  if (S3_BUCKET) {
    const cmd = new PutObjectCommand({
      Bucket: S3_BUCKET,
      Key: "config/rules.json",
      Body: json,
      ContentType: "application/json"
    });
    await s3.send(cmd);
  } else {
    const p = join(__dirname, "../../config/rules.json");
    writeFileSync(p, json, "utf-8");
  }
}

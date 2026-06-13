import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import type { CompositeScenarioInput, ScenarioEvaluationResult } from "./types.js";

const client = new DynamoDBClient({ region: process.env.AWS_REGION ?? "us-west-2" });
const ddb = DynamoDBDocumentClient.from(client);
const TABLE = process.env.DYNAMODB_TABLE ?? "composite-mcp-cases";

export async function logCase(
  input: CompositeScenarioInput,
  result: ScenarioEvaluationResult
): Promise<void> {
  await ddb.send(new PutCommand({
    TableName: TABLE,
    Item: {
      caseId: result.caseId,
      submittedAt: result.submittedAt,
      submittedBy: input.submittedBy ?? "unknown",
      accountId: input.accountId ?? "unknown",
      compositeSkuName: input.compositeSkuName,
      forceOrgIds: input.forceOrgIds,
      anypointOrgIds: input.anypointOrgIds,
      orderPattern: input.orderPattern,
      notes: input.notes ?? "",
      verdict: result.verdict,
      summary: result.summary,
      evaluations: result.evaluations,
      humanFeedback: null
    }
  }));
}

export async function recordFeedback(
  caseId: string,
  feedback: "correct" | "incorrect",
  correctedVerdict?: string
): Promise<void> {
  await ddb.send(new UpdateCommand({
    TableName: TABLE,
    Key: { caseId },
    UpdateExpression: "SET humanFeedback = :f, correctedVerdict = :c, feedbackAt = :t",
    ExpressionAttributeValues: {
      ":f": feedback,
      ":c": correctedVerdict ?? null,
      ":t": new Date().toISOString()
    }
  }));
}

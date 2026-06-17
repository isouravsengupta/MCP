/**
 * AWS Lambda entry point.
 *
 * Accepts JSON-RPC 2.0 requests from API Gateway (HTTP API) and routes them
 * to the MCP protocol handler. Validates the Bearer token on every request.
 */

import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import { getMcpAuthToken } from "./config.js";
import { handleMcpRequest } from "./server.js";

export async function handler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyStructuredResultV2> {
  // ── Auth ──────────────────────────────────────────────────────────────────
  const expectedToken = getMcpAuthToken();
  if (expectedToken) {
    const authHeader =
      event.headers?.authorization ?? event.headers?.Authorization ?? "";
    const providedToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
    if (providedToken !== expectedToken) {
      return jsonResponse(401, { error: "Unauthorized" });
    }
  }

  // ── Routing ───────────────────────────────────────────────────────────────
  try {
    if (!event.body) {
      return jsonResponse(400, { error: "Missing request body" });
    }

    const payload = JSON.parse(event.body) as {
      jsonrpc: "2.0";
      id: string | number | null;
      method: string;
      params?: Record<string, unknown>;
    };

    const result = await handleMcpRequest(payload);
    return jsonResponse(200, result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return jsonResponse(500, {
      jsonrpc: "2.0",
      id: null,
      error: { code: -32000, message },
    });
  }
}

function jsonResponse(statusCode: number, body: unknown): APIGatewayProxyStructuredResultV2 {
  return {
    statusCode,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  };
}

import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import { handleMcpRequest } from "./server.js";

export async function handler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyStructuredResultV2> {
  try {
    const authError = authorize(event);
    if (authError) {
      return authError;
    }

    if (!event.body) {
      return response(400, { error: "Missing body" });
    }

    const payload = JSON.parse(event.body) as {
      jsonrpc: "2.0";
      id: string | number | null;
      method: string;
      params?: Record<string, unknown>;
    };

    const result = await handleMcpRequest(payload);
    return response(200, result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return response(500, {
      jsonrpc: "2.0",
      id: null,
      error: { code: -32000, message }
    });
  }
}

function authorize(event: APIGatewayProxyEventV2): APIGatewayProxyStructuredResultV2 | null {
  if (process.env.SPI_DISABLE_AUTH === "true") {
    return null;
  }

  const expectedToken = process.env.MCP_AUTH_TOKEN;
  if (!expectedToken) {
    return response(500, { error: "MCP_AUTH_TOKEN is not configured." });
  }

  const authHeader = event.headers.authorization ?? event.headers.Authorization;
  if (!authHeader) {
    return response(401, { error: "Missing Authorization header." });
  }

  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : authHeader;
  if (token !== expectedToken) {
    return response(403, { error: "Invalid Authorization token." });
  }

  return null;
}

function response(statusCode: number, body: unknown): APIGatewayProxyStructuredResultV2 {
  return {
    statusCode,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  };
}

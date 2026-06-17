import { handleMcpRequest } from "./server.js";
import { handleAuthRequest } from "./authHandler.js";
export async function handler(event) {
    try {
        // Auth routes — no bearer token required
        const authResponse = await handleAuthRequest(event);
        if (authResponse)
            return authResponse;
        const authError = authorize(event);
        if (authError) {
            return authError;
        }
        if (!event.body) {
            return response(400, { error: "Missing body" });
        }
        const payload = JSON.parse(event.body);
        // Extract slack_user_id from header or top-level payload field
        const slackUserId = event.headers["x-slack-user-id"] ??
            event.headers["X-Slack-User-Id"] ??
            (typeof payload.slack_user_id === "string"
                ? String(payload.slack_user_id)
                : undefined);
        const result = await handleMcpRequest(payload, slackUserId);
        return response(200, result);
    }
    catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error";
        return response(500, {
            jsonrpc: "2.0",
            id: null,
            error: { code: -32000, message }
        });
    }
}
function authorize(event) {
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
function response(statusCode, body) {
    return {
        statusCode,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body)
    };
}

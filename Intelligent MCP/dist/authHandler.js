import { buildAuthUrl, exchangeCodeForToken } from "./snowflakeOAuth.js";
export async function handleAuthRequest(event) {
    const path = event.rawPath ?? "";
    if (path === "/auth/start" || path.endsWith("/auth/start")) {
        return handleAuthStart(event);
    }
    if (path === "/auth/callback" || path.endsWith("/auth/callback")) {
        return handleAuthCallback(event);
    }
    return null;
}
function handleAuthStart(event) {
    const slackUserId = event.queryStringParameters?.slack_user_id ?? "";
    if (!slackUserId) {
        return json(400, { error: "Missing slack_user_id query parameter." });
    }
    const authUrl = buildAuthUrl(slackUserId);
    return {
        statusCode: 302,
        headers: { Location: authUrl },
        body: ""
    };
}
async function handleAuthCallback(event) {
    const code = event.queryStringParameters?.code ?? "";
    const state = event.queryStringParameters?.state ?? "";
    const error = event.queryStringParameters?.error ?? "";
    if (error) {
        return html(400, `<h2>Authentication failed</h2><p>${error}</p>`);
    }
    if (!code || !state) {
        return html(400, "<h2>Missing code or state parameter.</h2>");
    }
    let slackUserId;
    try {
        const decoded = JSON.parse(Buffer.from(state, "base64url").toString("utf-8"));
        slackUserId = decoded.slackUserId;
    }
    catch {
        return html(400, "<h2>Invalid state parameter.</h2>");
    }
    try {
        await exchangeCodeForToken(code, slackUserId);
    }
    catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        return html(500, `<h2>Token exchange failed</h2><p>${message}</p>`);
    }
    return html(200, `<h2>✅ Authorised successfully!</h2>
     <p>You can close this window and return to Slack. Re-ask your question and the SPI bot will now run it against Snowflake using your identity.</p>`);
}
function json(statusCode, body) {
    return { statusCode, headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}
function html(statusCode, body) {
    return { statusCode, headers: { "content-type": "text/html" }, body };
}

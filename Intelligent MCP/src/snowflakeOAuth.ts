import { saveToken } from "./tokenStore.js";

interface OktaTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  token_type: string;
  username?: string;
}

function config() {
  return {
    oktaTenantUrl: process.env.OKTA_TENANT_URL ?? "",
    clientId: process.env.SNOWFLAKE_OAUTH_CLIENT_ID ?? "",
    clientSecret: process.env.SNOWFLAKE_OAUTH_CLIENT_SECRET ?? "",
    redirectUri: process.env.SNOWFLAKE_OAUTH_REDIRECT_URI ?? "",
    // Snowflake OAuth scope — must match the security integration in Snowflake
    scope: process.env.SNOWFLAKE_OAUTH_SCOPE ?? "session:role:DM_GDSO_CT_INGST_PRD"
  };
}

export function buildAuthUrl(slackUserId: string): string {
  const { oktaTenantUrl, clientId, redirectUri, scope } = config();
  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    scope,
    state: Buffer.from(JSON.stringify({ slackUserId })).toString("base64url")
  });
  return `${oktaTenantUrl}/oauth2/v1/authorize?${params.toString()}`;
}

export async function exchangeCodeForToken(code: string, slackUserId: string): Promise<void> {
  const { oktaTenantUrl, clientId, clientSecret, redirectUri, scope } = config();

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
    scope
  });

  const response = await fetch(`${oktaTenantUrl}/oauth2/v1/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`
    },
    body: body.toString()
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Token exchange failed: ${response.status} ${text}`);
  }

  const data = (await response.json()) as OktaTokenResponse;

  await saveToken({
    slackUserId,
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + data.expires_in * 1000,
    snowflakeUser: data.username
  });
}

export async function refreshAccessToken(slackUserId: string, refreshToken: string): Promise<string> {
  const { oktaTenantUrl, clientId, clientSecret, scope } = config();

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    scope
  });

  const response = await fetch(`${oktaTenantUrl}/oauth2/v1/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`
    },
    body: body.toString()
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Token refresh failed: ${response.status} ${text}`);
  }

  const data = (await response.json()) as OktaTokenResponse;

  await saveToken({
    slackUserId,
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? refreshToken,
    expiresAt: Date.now() + data.expires_in * 1000,
    snowflakeUser: data.username
  });

  return data.access_token;
}

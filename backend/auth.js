const AUTH_BASE = "https://auth.openai.com";
const DEVICE_USER_CODE_URL = `${AUTH_BASE}/api/accounts/deviceauth/usercode`;
const DEVICE_TOKEN_URL = `${AUTH_BASE}/api/accounts/deviceauth/token`;
const DEVICE_VERIFICATION_URI = `${AUTH_BASE}/codex/device`;
const DEVICE_REDIRECT_URI = `${AUTH_BASE}/deviceauth/callback`;
const TOKEN_URL = `${AUTH_BASE}/oauth/token`;
const JWT_CLAIM_PATH = "https://api.openai.com/auth";
const DEVICE_TIMEOUT_MS = 15 * 60 * 1000;

function clientId() {
  return process.env.CODEX_CLIENT_ID ?? "app_EMoamEEZ73f0CkXaXp7hrann";
}

function mockMode() {
  return process.env.MOCK_MODE === "1";
}

function debug() {
  return process.env.DEBUG === "1";
}

function log(...args) {
  if (debug()) {
    console.log("[auth]", ...args);
  }
}

function parseInterval(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value.trim());
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return 5;
}

export function decodeJwtPayload(token) {
  const parts = token.split(".");
  if (parts.length < 2) {
    return null;
  }
  const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  try {
    return JSON.parse(Buffer.from(padded, "base64").toString("utf8"));
  } catch {
    return null;
  }
}

export function getUserInfoFromToken(accessToken) {
  const payload = decodeJwtPayload(accessToken);
  const auth = payload?.[JWT_CLAIM_PATH];
  if (!auth) {
    return null;
  }
  return {
    email: auth.email ?? payload?.email ?? null,
    accountId: auth.chatgpt_account_id ?? null,
    planType: auth.chatgpt_plan_type ?? null,
  };
}

export async function startDeviceAuth() {
  if (mockMode()) {
    log("mock mode: returning fake device code");
    return {
      mock: true,
      user_code: "MOCK-1234",
      verification_uri: DEVICE_VERIFICATION_URI,
      interval: 3,
      device_auth_id: "mock-device-auth-id",
      started_at: Date.now(),
    };
  }

  const response = await fetch(DEVICE_USER_CODE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: clientId() }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    if (response.status === 404) {
      throw new Error(
        "Device code login is not enabled. Set MOCK_MODE=1 to test UI without OpenAI.",
      );
    }
    throw new Error(
      `Device code request failed (${response.status})${body ? `: ${body}` : ""}`,
    );
  }

  const json = await response.json();
  const interval = parseInterval(json.interval);
  if (!json.device_auth_id || !json.user_code) {
    throw new Error(`Invalid device code response: ${JSON.stringify(json)}`);
  }

  log("device code issued, interval", interval);

  return {
    mock: false,
    user_code: json.user_code,
    verification_uri: DEVICE_VERIFICATION_URI,
    interval,
    device_auth_id: json.device_auth_id,
    started_at: Date.now(),
  };
}

async function exchangeAuthorizationCode(authorizationCode, codeVerifier) {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: clientId(),
    code: authorizationCode,
    code_verifier: codeVerifier,
    redirect_uri: DEVICE_REDIRECT_URI,
  });

  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(
      `Token exchange failed (${response.status})${text ? `: ${text}` : ""}`,
    );
  }

  const json = await response.json();
  if (!json.access_token || !json.refresh_token) {
    throw new Error(
      `Token exchange missing fields: ${JSON.stringify(json)}`,
    );
  }

  const expiresAt =
    Date.now() + (typeof json.expires_in === "number" ? json.expires_in : 3600) * 1000;

  return {
    access_token: json.access_token,
    refresh_token: json.refresh_token,
    id_token: json.id_token ?? null,
    expires_at: expiresAt,
  };
}

export async function refreshAccessToken(refreshToken) {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: clientId(),
    refresh_token: refreshToken,
  });

  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(
      `Token refresh failed (${response.status})${text ? `: ${text}` : ""}`,
    );
  }

  const json = await response.json();
  if (!json.access_token || !json.refresh_token) {
    throw new Error(`Refresh response missing fields: ${JSON.stringify(json)}`);
  }

  const expiresAt =
    Date.now() + (typeof json.expires_in === "number" ? json.expires_in : 3600) * 1000;

  return {
    access_token: json.access_token,
    refresh_token: json.refresh_token,
    id_token: json.id_token ?? null,
    expires_at: expiresAt,
  };
}

export async function pollDeviceAuth(deviceAuth) {
  if (!deviceAuth) {
    return { status: "error", message: "No active device auth session." };
  }

  if (Date.now() - deviceAuth.started_at > DEVICE_TIMEOUT_MS) {
    return { status: "error", message: "Device code expired (15 minutes)." };
  }

  if (deviceAuth.mock) {
    const elapsed = Date.now() - deviceAuth.started_at;
    if (elapsed < 3000) {
      log("mock poll pending");
      return { status: "pending" };
    }
    log("mock poll complete");
    return {
      status: "complete",
      tokens: {
        access_token: "mock-access-token",
        refresh_token: "mock-refresh-token",
        id_token: null,
        expires_at: Date.now() + 3600 * 1000,
        mock: true,
      },
    };
  }

  const response = await fetch(DEVICE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      device_auth_id: deviceAuth.device_auth_id,
      user_code: deviceAuth.user_code,
    }),
  });

  log("poll status", response.status);

  if (response.status === 403 || response.status === 404) {
    return { status: "pending" };
  }

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    let errorCode;
    try {
      const json = JSON.parse(body);
      const err = json?.error;
      errorCode = typeof err === "object" ? err?.code : err;
    } catch {
      // ignore parse errors
    }
    if (
      errorCode === "deviceauth_authorization_pending" ||
      errorCode === "slow_down"
    ) {
      return { status: "pending" };
    }
    return {
      status: "error",
      message: `Device auth failed (${response.status})${body ? `: ${body}` : ""}`,
    };
  }

  const json = await response.json();
  if (!json.authorization_code || !json.code_verifier) {
    return {
      status: "error",
      message: `Invalid token poll response: ${JSON.stringify(json)}`,
    };
  }

  try {
    const tokens = await exchangeAuthorizationCode(
      json.authorization_code,
      json.code_verifier,
    );
    log("token exchange complete");
    return { status: "complete", tokens };
  } catch (err) {
    return {
      status: "error",
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function ensureFreshTokens(tokens) {
  if (!tokens) {
    return null;
  }
  if (tokens.mock) {
    return tokens;
  }
  const bufferMs = 60 * 1000;
  if (tokens.expires_at - Date.now() > bufferMs) {
    return tokens;
  }
  log("refreshing access token");
  return refreshAccessToken(tokens.refresh_token);
}

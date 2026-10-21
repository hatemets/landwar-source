// Auth settings. Read from the environment on each call so tests can stub it.

const DEV_SESSION_SECRET =
  "WARNING_DEV_SESSION_SECRET_DO_NOT_USE_IN_PRODUCTION_0123456789";

function isDeployedEnvironment(): boolean {
  return process.env.GAME_ENV === "staging" || process.env.GAME_ENV === "prod";
}

export const SESSION_COOKIE = "landwar_session";
export const OAUTH_STATE_COOKIE = "landwar_oauth_state";
export const OAUTH_VERIFIER_COOKIE = "landwar_oauth_verifier";
export const OAUTH_RETURN_COOKIE = "landwar_oauth_return";

export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const OAUTH_COOKIE_TTL_MS = 10 * 60 * 1000;
export const JOIN_TOKEN_TTL_S = 15 * 60;

export function databaseUrl(): string {
  const v = process.env.DATABASE_URL;
  if (!v) {
    throw new Error("DATABASE_URL is not set. See example.env.");
  }
  return v;
}

export function publicOrigin(): string {
  const origin = process.env.PUBLIC_ORIGIN;
  if (!origin && isDeployedEnvironment()) {
    throw new Error("PUBLIC_ORIGIN must be set in staging and production");
  }
  if (origin && isDeployedEnvironment() && !origin.startsWith("https://")) {
    throw new Error("PUBLIC_ORIGIN must use HTTPS in staging and production");
  }
  return origin ?? "http://localhost:8888";
}

export function isSecureOrigin(): boolean {
  return publicOrigin().startsWith("https://");
}

export function sessionSecret(): Uint8Array {
  const configuredSecret = process.env.SESSION_SECRET;
  if (!configuredSecret && isDeployedEnvironment()) {
    throw new Error("SESSION_SECRET must be set in staging and production");
  }
  const v = configuredSecret ?? DEV_SESSION_SECRET;
  if (isDeployedEnvironment() && v === DEV_SESSION_SECRET) {
    throw new Error(
      "The development session secret cannot be used in deployment",
    );
  }
  if (v.length < 32) {
    throw new Error("SESSION_SECRET must be at least 32 characters");
  }
  return new TextEncoder().encode(v);
}

export function googleClientId(): string {
  const v = process.env.GOOGLE_CLIENT_ID;
  if (!v) throw new Error("GOOGLE_CLIENT_ID is not set. See example.env.");
  return v;
}

export function googleClientSecret(): string {
  const v = process.env.GOOGLE_CLIENT_SECRET;
  if (!v) throw new Error("GOOGLE_CLIENT_SECRET is not set. See example.env.");
  return v;
}

export function googleRedirectUri(): string {
  return `${publicOrigin()}/api/auth/google/callback`;
}

export interface GoogleEndpoints {
  authorization: string;
  token: string;
  userinfo: string;
}

// Google's own endpoints. A development run may point GOOGLE_OAUTH_BASE_URL at
// a stand-in server that serves /auth, /token and /userinfo, so the sign-in
// flow can run without real credentials. Staging and production refuse it.
export function googleEndpoints(): GoogleEndpoints {
  const base = process.env.GOOGLE_OAUTH_BASE_URL;
  if (!base) {
    return {
      authorization: "https://accounts.google.com/o/oauth2/v2/auth",
      token: "https://oauth2.googleapis.com/token",
      userinfo: "https://openidconnect.googleapis.com/v1/userinfo",
    };
  }
  if (isDeployedEnvironment()) {
    throw new Error("GOOGLE_OAUTH_BASE_URL is not allowed in deployment");
  }
  const root = base.replace(/\/+$/, "");
  return {
    authorization: `${root}/auth`,
    token: `${root}/token`,
    userinfo: `${root}/userinfo`,
  };
}

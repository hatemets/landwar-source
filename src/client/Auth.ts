import { generateCryptoRandomUUID } from "./Utils";

// LandWar sign-in. The server sets a session cookie after Google sign-in. A
// join token is issued by /api/auth/token. The server signs it and names the
// account, or a guest id for a guest. The token is kept in memory only and is
// renewed before it expires.

export type UserAuth =
  | {
      jwt: string;
      claims: { sub: string; kind: "user"; role: string | null };
    }
  | false;

interface JoinToken {
  token: string;
  expiresAt: number;
  kind: "user" | "guest";
  id: string;
}

// Renew this many seconds before the token expires.
const RENEW_MARGIN_S = 60;

// Kept from the earlier build so a returning guest keeps the same id.
const GUEST_ID_KEY = "player_persistent_id";

let current: JoinToken | null = null;
let pending: Promise<JoinToken | null> | null = null;

function guestId(): string {
  try {
    const stored = localStorage.getItem(GUEST_ID_KEY);
    if (stored) return stored;
    const fresh = generateCryptoRandomUUID();
    localStorage.setItem(GUEST_ID_KEY, fresh);
    return fresh;
  } catch {
    // Storage can be blocked. The id then lasts only for this page.
    return generateCryptoRandomUUID();
  }
}

function isFresh(token: JoinToken | null): token is JoinToken {
  return token !== null && token.expiresAt - Date.now() / 1000 > RENEW_MARGIN_S;
}

function isJoinToken(value: unknown): value is JoinToken {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.token === "string" &&
    typeof v.expiresAt === "number" &&
    typeof v.id === "string" &&
    (v.kind === "user" || v.kind === "guest")
  );
}

async function requestJoinToken(): Promise<JoinToken | null> {
  try {
    const response = await fetch("/api/auth/token", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ guestId: guestId() }),
    });
    if (!response.ok) return null;
    const body: unknown = await response.json();
    return isJoinToken(body) ? body : null;
  } catch (error) {
    console.warn("Could not reach the sign-in service:", error);
    return null;
  }
}

// One request at a time. Callers that arrive while it runs share the result.
function refreshJoinToken(): Promise<JoinToken | null> {
  pending ??= requestJoinToken().then((token) => {
    current = token;
    pending = null;
    return token;
  });
  return pending;
}

async function currentJoinToken(): Promise<JoinToken | null> {
  if (isFresh(current)) return current;
  return refreshJoinToken();
}

// Sign-in with Google is the only method. It is a full-page redirect. The
// server returns the player to the page they came from.
export function googleLogin(): void {
  const here = window.location.pathname + window.location.search;
  window.location.href = `/api/auth/google?return=${encodeURIComponent(here)}`;
}

export async function linkGoogle(): Promise<boolean> {
  googleLogin();
  return true;
}

export async function getAuthHeader(): Promise<string> {
  const token = await currentJoinToken();
  return token ? `Bearer ${token.token}` : "";
}

export async function logOut(_allSessions: boolean = false): Promise<boolean> {
  const hadSession = current?.kind === "user";
  try {
    await fetch("/api/auth/logout", {
      method: "POST",
      credentials: "same-origin",
    });
  } catch (error) {
    console.warn("Sign-out request failed:", error);
  }
  clearLocalSession();
  if (hadSession) window.location.reload();
  return true;
}

export function clearLocalSession(): void {
  current = null;
  pending = null;
  document.dispatchEvent(new CustomEvent("session-cleared"));
}

export async function isLoggedIn(): Promise<boolean> {
  const token = await currentJoinToken();
  return token?.kind === "user";
}

export function isSessionActive(sub: string): boolean {
  return current?.kind === "user" && current.id === sub;
}

// The signed-in account, or false. A guest is not signed in.
export async function userAuth(
  shouldRefresh: boolean = true,
): Promise<UserAuth> {
  const token = shouldRefresh
    ? await currentJoinToken()
    : isFresh(current)
      ? current
      : null;
  if (token === null || token.kind !== "user") return false;
  return {
    jwt: token.token,
    claims: { sub: token.id, kind: "user", role: null },
  };
}

// The token a join message carries. A guest gets a guest token.
export async function getPlayToken(): Promise<string> {
  const token = await currentJoinToken();
  if (token !== null) return token.token;
  return guestId();
}

// The id the server knows this player by: the account id, or the guest id.
export function getPersistentID(): string {
  if (isFresh(current)) return current.id;
  return guestId();
}

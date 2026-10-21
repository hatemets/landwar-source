import {
  CodeChallengeMethod,
  generateCodeVerifier,
  generateState,
  OAuth2Client,
} from "arctic";
import { z } from "zod";
import {
  googleClientId,
  googleClientSecret,
  googleEndpoints,
  googleRedirectUri,
} from "./config";

const UserInfoSchema = z.object({
  sub: z.string().min(1),
  email: z.email(),
  email_verified: z.boolean().optional(),
  name: z.string().optional(),
  picture: z.url().optional(),
});

export interface GoogleProfile {
  sub: string;
  email: string;
  name: string;
  picture: string | null;
}

export interface GoogleLoginStart {
  url: URL;
  state: string;
  codeVerifier: string;
}

function client(): OAuth2Client {
  return new OAuth2Client(
    googleClientId(),
    googleClientSecret(),
    googleRedirectUri(),
  );
}

// Starts Authorization Code + PKCE. The caller stores state and verifier in
// short-lived cookies and checks them on the callback.
export function startGoogleLogin(): GoogleLoginStart {
  const state = generateState();
  const codeVerifier = generateCodeVerifier();
  const url = client().createAuthorizationURLWithPKCE(
    googleEndpoints().authorization,
    state,
    CodeChallengeMethod.S256,
    codeVerifier,
    ["openid", "email", "profile"],
  );
  return { url, state, codeVerifier };
}

// Exchanges the code and reads the profile. fetchFn is injectable for tests.
export async function finishGoogleLogin(
  code: string,
  codeVerifier: string,
  fetchFn: typeof fetch = fetch,
): Promise<GoogleProfile> {
  const tokens = await client().validateAuthorizationCode(
    googleEndpoints().token,
    code,
    codeVerifier,
  );
  return readGoogleProfile(tokens.accessToken(), fetchFn);
}

// Reads the OpenID profile for an access token issued by Google.
export async function readGoogleProfile(
  accessToken: string,
  fetchFn: typeof fetch = fetch,
): Promise<GoogleProfile> {
  const response = await fetchFn(googleEndpoints().userinfo, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) {
    throw new Error(`Google userinfo failed: HTTP ${response.status}`);
  }
  const parsed = UserInfoSchema.safeParse(await response.json());
  if (!parsed.success) {
    throw new Error("Google userinfo has an unexpected shape");
  }
  const info = parsed.data;
  if (info.email_verified === false) {
    throw new Error("Google email is not verified");
  }
  return {
    sub: info.sub,
    email: info.email,
    name: info.name ?? info.email.split("@")[0] ?? "player",
    picture: info.picture ?? null,
  };
}

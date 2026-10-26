import {
  CodeChallengeMethod,
  generateCodeVerifier,
  generateState,
  OAuth2Client,
} from "arctic";
import { z } from "zod";
import {
  discordClientId,
  discordClientSecret,
  discordEndpoints,
  discordRedirectUri,
} from "./config";
import type { OAuthLoginStart, ProviderProfile } from "./google";

const DiscordUserSchema = z.object({
  id: z.string().regex(/^\d+$/),
  username: z.string().min(1),
  global_name: z.string().nullish(),
  avatar: z.string().nullish(),
  email: z.email().nullish(),
  verified: z.boolean().optional(),
});

function client(): OAuth2Client {
  return new OAuth2Client(
    discordClientId(),
    discordClientSecret(),
    discordRedirectUri(),
  );
}

// Starts Authorization Code + PKCE, as for Google. "email" is needed because
// an account is matched across providers by its verified email.
export function startDiscordLogin(): OAuthLoginStart {
  const state = generateState();
  const codeVerifier = generateCodeVerifier();
  const url = client().createAuthorizationURLWithPKCE(
    discordEndpoints().authorization,
    state,
    CodeChallengeMethod.S256,
    codeVerifier,
    ["identify", "email"],
  );
  return { url, state, codeVerifier };
}

// Exchanges the code and reads the profile. fetchFn is injectable for tests.
export async function finishDiscordLogin(
  code: string,
  codeVerifier: string,
  fetchFn: typeof fetch = fetch,
): Promise<ProviderProfile> {
  const tokens = await client().validateAuthorizationCode(
    discordEndpoints().token,
    code,
    codeVerifier,
  );
  return readDiscordProfile(tokens.accessToken(), fetchFn);
}

// Reads the user for an access token issued by Discord.
export async function readDiscordProfile(
  accessToken: string,
  fetchFn: typeof fetch = fetch,
): Promise<ProviderProfile> {
  const response = await fetchFn(discordEndpoints().userinfo, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) {
    throw new Error(`Discord user lookup failed: HTTP ${response.status}`);
  }
  const parsed = DiscordUserSchema.safeParse(await response.json());
  if (!parsed.success) {
    throw new Error("Discord user has an unexpected shape");
  }
  const info = parsed.data;
  if (!info.email || info.verified !== true) {
    throw new Error("Discord email is missing or not verified");
  }
  return {
    sub: info.id,
    email: info.email,
    name: info.global_name ?? info.username,
    picture: avatarUrl(info.id, info.avatar ?? null),
  };
}

function avatarUrl(id: string, hash: string | null): string | null {
  if (hash === null || !/^(a_)?[a-f0-9]+$/.test(hash)) return null;
  const ext = hash.startsWith("a_") ? "gif" : "png";
  return `https://cdn.discordapp.com/avatars/${id}/${hash}.${ext}?size=128`;
}

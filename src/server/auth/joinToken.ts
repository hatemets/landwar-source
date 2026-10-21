import { jwtVerify, SignJWT } from "jose";
import { z } from "zod";
import { JOIN_TOKEN_TTL_S, sessionSecret } from "./config";

// Short-lived token the client sends when it joins a game. The game worker
// checks it with the same secret. It carries no profile data.
export const JOIN_TOKEN_ISSUER = "landwar";
export const JOIN_TOKEN_AUDIENCE = "landwar-game";

const PayloadSchema = z.object({
  sub: z.uuid(),
  kind: z.enum(["user", "guest"]),
});

export type JoinTokenKind = "user" | "guest";

export interface JoinTokenClaims {
  // persistentId: the user id for accounts, a client-minted UUID for guests.
  sub: string;
  kind: JoinTokenKind;
}

export async function signJoinToken(claims: JoinTokenClaims): Promise<{
  token: string;
  expiresAt: number;
}> {
  const expiresAt = Math.floor(Date.now() / 1000) + JOIN_TOKEN_TTL_S;
  const token = await new SignJWT({ kind: claims.kind })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(claims.sub)
    .setIssuer(JOIN_TOKEN_ISSUER)
    .setAudience(JOIN_TOKEN_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(expiresAt)
    .sign(sessionSecret());
  return { token, expiresAt };
}

export type JoinTokenResult =
  | { type: "success"; claims: JoinTokenClaims }
  | { type: "error"; message: string };

export async function verifyJoinToken(token: string): Promise<JoinTokenResult> {
  try {
    const { payload } = await jwtVerify(token, sessionSecret(), {
      algorithms: ["HS256"],
      issuer: JOIN_TOKEN_ISSUER,
      audience: JOIN_TOKEN_AUDIENCE,
    });
    const parsed = PayloadSchema.safeParse({
      sub: payload.sub,
      kind: payload.kind,
    });
    if (!parsed.success) {
      return { type: "error", message: "malformed join token" };
    }
    return { type: "success", claims: parsed.data };
  } catch (e) {
    const message = e instanceof Error ? e.message : "invalid join token";
    return { type: "error", message };
  }
}

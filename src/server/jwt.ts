import { verifyJoinToken } from "./auth/joinToken";

// Result of checking a join token. `kind` is "user" for an account and
// "guest" for a guest. `persistentId` is the user id or the guest id.
export type TokenVerificationResult =
  | {
      type: "success";
      persistentId: string;
      kind: "user" | "guest";
    }
  | { type: "error"; message: string };

export async function verifyClientToken(
  token: string,
): Promise<TokenVerificationResult> {
  const result = await verifyJoinToken(token);
  if (result.type === "error") return result;
  return {
    type: "success",
    persistentId: result.claims.sub,
    kind: result.claims.kind,
  };
}

import type { Db } from "@kleopolis/db/client";
import type { ProviderProfile } from "../../src/server/auth/google";
import type { UserRow } from "../../src/server/auth/sessions";
import { upsertProviderUser } from "../../src/server/auth/users";

// Signs a test account in with Google and returns its row.
export async function googleUser(
  db: Db,
  profile: ProviderProfile,
): Promise<UserRow> {
  const result = await upsertProviderUser(db, "google", profile);
  if (result.type !== "ok") throw new Error("Google account already linked");
  return result.user;
}

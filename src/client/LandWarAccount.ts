import { UserMeResponseSchema } from "@openfront/shared/ApiSchemas";
import { z } from "zod";

// The signed-in account as /api/me returns it. Null when no session exists.
const AccountSchema = z.object({
  id: z.uuid(),
  publicId: z.string().min(1),
  displayName: z.string(),
  email: z.string(),
  avatarUrl: z.string().nullable(),
});

const RatingSchema = z.object({ elo: z.number() });

const MeSchema = z.object({
  user: AccountSchema.nullable(),
  // Soft currency, and what the account owns ("flag:name", "pattern:name:colour").
  currency: z.object({ soft: z.number(), hard: z.number() }).optional(),
  flares: z.string().array().default([]),
  // Elo per ladder. A ladder the player has not played is absent.
  ratings: z
    .object({
      oneVone: RatingSchema.optional(),
      ffa: RatingSchema.optional(),
    })
    .default({}),
});

type MyClans = Pick<
  z.infer<typeof MeSchema>,
  "ratings" | "currency" | "flares"
>;

export type Account = z.infer<typeof AccountSchema>;

// Maps the LandWar account onto the profile shape the game UI reads. Fields
// LandWar does not have yet take their empty value: no subscription, no
// cosmetics, no rewards.
// Left unparsed on purpose: fetchAccountProfile validates it with the schema.
export function toUserMeCandidate(
  account: Account,
  mine: MyClans = { ratings: {}, flares: [] },
): unknown {
  return {
    user: {
      email: account.email,
      google: { email: account.email },
    },
    player: {
      publicId: account.publicId,
      adfree: false,
      canCreatePublicLobbies: false,
      username: account.displayName,
      usernameBase: account.displayName,
      usernameStatus: "unclaimed",
      trustTier: "untrusted",
      subscription: null,
      achievements: { singleplayerMap: [], player: [] },
      leaderboard: mine.ratings,
      flares: mine.flares,
      ...(mine.currency ? { currency: mine.currency } : {}),
      friends: [],
      rewards: [],
    },
  };
}

// Reads /api/me. Returns the profile for a signed-in account, or false.
export async function fetchAccountProfile(
  signal: AbortSignal,
): Promise<z.infer<typeof UserMeResponseSchema> | false> {
  const response = await fetch("/api/me", {
    credentials: "same-origin",
    headers: { accept: "application/json" },
    signal,
  });
  if (response.status !== 200) return false;
  const parsed = MeSchema.safeParse(await response.json());
  if (!parsed.success || parsed.data.user === null) return false;
  const checked = UserMeResponseSchema.safeParse(
    toUserMeCandidate(parsed.data.user, parsed.data),
  );
  return checked.success ? checked.data : false;
}

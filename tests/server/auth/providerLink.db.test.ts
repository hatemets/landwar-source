import { createDb, type DbHandle } from "@kleopolis/db/client";
import { runMigrations } from "@kleopolis/db/migrate";
import { users } from "@kleopolis/db/schema";
import { randomUUID } from "crypto";
import { like } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { upsertProviderUser } from "../../../src/server/auth/users";

// Runs only when TEST_DATABASE_URL is set. Google and Discord sign-ins meet on
// one account through its verified email, or through an explicit link.
const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)("Google and Discord accounts (database)", () => {
  let handle: DbHandle;
  const run = randomUUID().slice(0, 8);
  const email = (name: string) => `link-${run}-${name}@example.com`;
  const profile = (sub: string, mail: string) => ({
    sub: `${run}-${sub}`,
    email: mail,
    name: "Linker",
    picture: null,
  });

  beforeAll(async () => {
    await runMigrations(url!);
    handle = createDb(url!);
  });

  afterAll(async () => {
    await handle.db.delete(users).where(like(users.email, `link-${run}-%`));
    await handle.pool.end();
  });

  it("makes a Discord-only account", async () => {
    const result = await upsertProviderUser(
      handle.db,
      "discord",
      profile("d1", email("solo")),
    );
    if (result.type !== "ok") throw new Error("expected an account");
    expect(result.user.discordId).toBe(`${run}-d1`);
    expect(result.user.googleSub).toBeNull();
  });

  it("joins a Discord sign-in to the Google account with the same email", async () => {
    const google = await upsertProviderUser(
      handle.db,
      "google",
      profile("g2", email("Both")),
    );
    const discord = await upsertProviderUser(
      handle.db,
      "discord",
      profile("d2", email("both")),
    );
    if (google.type !== "ok" || discord.type !== "ok") throw new Error();
    expect(discord.user.id).toBe(google.user.id);
    expect(discord.user.googleSub).toBe(`${run}-g2`);
    expect(discord.user.discordId).toBe(`${run}-d2`);
  });

  it("does not join an account that already has that provider", async () => {
    const first = await upsertProviderUser(
      handle.db,
      "discord",
      profile("d3", email("taken")),
    );
    const second = await upsertProviderUser(
      handle.db,
      "discord",
      profile("d4", email("taken")),
    );
    if (first.type !== "ok" || second.type !== "ok") throw new Error();
    expect(second.user.id).not.toBe(first.user.id);
  });

  it("links to the signed-in account, never across accounts", async () => {
    const mine = await upsertProviderUser(
      handle.db,
      "google",
      profile("g5", email("mine")),
    );
    const other = await upsertProviderUser(
      handle.db,
      "discord",
      profile("d6", email("other")),
    );
    if (mine.type !== "ok" || other.type !== "ok") throw new Error();

    const linked = await upsertProviderUser(
      handle.db,
      "discord",
      profile("d5", email("different")),
      mine.user.id,
    );
    if (linked.type !== "ok") throw new Error("expected a link");
    expect(linked.user.id).toBe(mine.user.id);
    expect(linked.user.discordId).toBe(`${run}-d5`);

    const stolen = await upsertProviderUser(
      handle.db,
      "discord",
      profile("d6", email("other")),
      mine.user.id,
    );
    expect(stolen.type).toBe("already_linked");
  });
});

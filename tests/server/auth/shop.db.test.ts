import { createDb, type DbHandle } from "@kleopolis/db/client";
import { runMigrations } from "@kleopolis/db/migrate";
import { games, users } from "@kleopolis/db/schema";
import { randomUUID } from "crypto";
import { inArray } from "drizzle-orm";
import express from "express";
import type { Server } from "http";
import type { AddressInfo } from "net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSession } from "../../../src/server/auth/sessions";
import { googleUser } from "../../util/TestUsers";
import { saveGameRecord } from "../../../src/server/GameStore";
import { FLAGS, PALETTES, PATTERNS } from "../../../src/server/shop/catalog";
import { sampleRecord } from "../GameStore.fixture";

// Runs only when TEST_DATABASE_URL is set. It drives the real shop routes.
const url = process.env.TEST_DATABASE_URL;

interface Player {
  id: string;
  cookie: string;
}

describe.skipIf(!url)("shop (database)", () => {
  let handle: DbHandle;
  let server: Server;
  let base: string;
  const userIds: string[] = [];
  const gameIds: string[] = [];

  async function account(name: string): Promise<Player> {
    const u = await googleUser(handle.db, {
      sub: `shop-${randomUUID()}`,
      email: `${name}@example.com`,
      name,
      picture: null,
    });
    userIds.push(u.id);
    const s = await createSession(handle.db, u.id);
    return { id: u.id, cookie: `landwar_session=${s.token}` };
  }

  const buy = (who: Player | null, body: unknown, origin = true) =>
    fetch(`${base}/api/shop/purchase`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(who ? { cookie: who.cookie } : {}),
        ...(origin ? { origin: "http://localhost:8888" } : {}),
      },
      body: JSON.stringify(body),
    });

  const flagBody = (name: string) => ({
    cosmeticType: "flag",
    cosmeticName: name,
    currencyType: "soft",
  });

  async function wallet(who: Player) {
    const { balanceOf, ownedFlares } =
      await import("../../../src/server/shop/wallet");
    const { db } = await import("../../../src/server/db");
    return {
      soft: await balanceOf(db().db, who.id),
      flares: await ownedFlares(db().db, who.id),
    };
  }

  beforeAll(async () => {
    await runMigrations(url!);
    handle = createDb(url!);
    process.env.DATABASE_URL = url;
    process.env.PUBLIC_ORIGIN = "http://localhost:8888";
    const { registerShopRoutes } =
      await import("../../../src/server/shop/routes");
    const app = express();
    app.use(express.json());
    registerShopRoutes(app);
    server = app.listen(0);
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    server.close();
    await handle.db.delete(games).where(inArray(games.id, gameIds));
    await handle.db.delete(users).where(inArray(users.id, userIds));
    const { db } = await import("../../../src/server/db");
    await db().pool.end();
    await handle.pool.end();
  });

  it("serves the catalog without a session", async () => {
    const res = await fetch(`${base}/api/cosmetics.json`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      flags: object;
      patterns: object;
      colorPalettes: object;
    };
    expect(Object.keys(body.flags)).toHaveLength(FLAGS.length);
    expect(Object.keys(body.patterns)).toHaveLength(PATTERNS.length);
    expect(Object.keys(body.colorPalettes)).toHaveLength(PALETTES.length);
  });

  it("starts a new account with a grant and nothing owned", async () => {
    const p = await account("Newbie");
    expect(await wallet(p)).toEqual({ soft: 1000, flares: [] });
  });

  it("sells a flag, takes the price, and grants it", async () => {
    const p = await account("Buyer");
    const cheap = FLAGS.find((f) => f.priceSoft === 300)!;
    const res = await buy(p, flagBody(cheap.name));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      currency: { soft: 700, hard: 0 },
    });
    expect(await wallet(p)).toEqual({
      soft: 700,
      flares: [`flag:${cheap.name}`],
    });
  });

  it("sells a pattern in a colour, and refuses it without one", async () => {
    const p = await account("Patterner");
    const pattern = PATTERNS[0]!;
    const body = {
      cosmeticType: "pattern",
      cosmeticName: pattern.name,
      currencyType: "soft",
      colorPaletteName: PALETTES[1]!.name,
    };
    expect((await buy(p, body)).status).toBe(200);
    expect((await wallet(p)).flares).toEqual([
      `pattern:${pattern.name}:${PALETTES[1]!.name}`,
    ]);
    const bare = await buy(p, { ...body, colorPaletteName: undefined });
    expect(bare.status).toBe(400);
    // The other colour is a different item.
    const other = await buy(p, {
      ...body,
      colorPaletteName: PALETTES[2]!.name,
    });
    expect(other.status).toBe(200);
  });

  it("refuses the same item twice, and charges once", async () => {
    const p = await account("Twice");
    const flag = FLAGS[0]!;
    expect((await buy(p, flagBody(flag.name))).status).toBe(200);
    expect((await buy(p, flagBody(flag.name))).status).toBe(409);
    expect((await wallet(p)).soft).toBe(1000 - flag.priceSoft);
  });

  it("refuses a purchase the balance cannot cover, and charges nothing", async () => {
    const p = await account("Broke");
    const dear = FLAGS.find((f) => f.priceSoft > 1000)!;
    const res = await buy(p, flagBody(dear.name));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ reason: "Insufficient balance" });
    expect(await wallet(p)).toEqual({ soft: 1000, flares: [] });
  });

  it("never spends the same coins twice when two purchases race", async () => {
    const p = await account("Racer");
    // 1000 coins buy three 300-coin flags, not four.
    const cheap = FLAGS.filter((f) => f.priceSoft === 300).slice(0, 4);
    const results = await Promise.all(
      cheap.map((f) => buy(p, flagBody(f.name))),
    );
    const ok = results.filter((r) => r.status === 200).length;
    expect(ok).toBe(3);
    const state = await wallet(p);
    expect(state.soft).toBe(100);
    expect(state.flares).toHaveLength(3);
  });

  it("buys the same item once even when asked twice at once", async () => {
    const p = await account("Double");
    const flag = FLAGS[1]!;
    const [a, b] = await Promise.all([
      buy(p, flagBody(flag.name)),
      buy(p, flagBody(flag.name)),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect((await wallet(p)).soft).toBe(1000 - flag.priceSoft);
  });

  it("refuses what the shop does not sell", async () => {
    const p = await account("Picky");
    expect((await buy(p, flagBody("not_a_flag"))).status).toBe(400);
    expect(
      (await buy(p, { ...flagBody(FLAGS[0]!.name), currencyType: "hard" }))
        .status,
    ).toBe(400);
    expect(
      (
        await buy(p, {
          cosmeticType: "crown",
          cosmeticName: "x",
          currencyType: "soft",
        })
      ).status,
    ).toBe(400);
    expect((await buy(p, { nonsense: true })).status).toBe(400);
    expect((await wallet(p)).soft).toBe(1000);
  });

  it("needs a session and a same-site request", async () => {
    const p = await account("Guarded");
    expect((await buy(null, flagBody(FLAGS[0]!.name))).status).toBe(401);
    expect((await buy(p, flagBody(FLAGS[0]!.name), false)).status).toBe(403);
    expect((await wallet(p)).soft).toBe(1000);
  });

  it("pays coins for a finished game: more to the winner", async () => {
    const winner = await account("Champion");
    const loser = await account("Runner");
    const id = randomUUID().replace(/-/g, "").slice(0, 8);
    gameIds.push(id);
    await saveGameRecord(
      handle.db,
      sampleRecord(id, { winner: winner.id, loser: loser.id }),
    );
    expect((await wallet(winner)).soft).toBe(1000 + 50 + 100);
    expect((await wallet(loser)).soft).toBe(1000 + 50);
    // Storing the same game again pays nothing more.
    await saveGameRecord(
      handle.db,
      sampleRecord(id, { winner: winner.id, loser: loser.id }),
    );
    expect((await wallet(winner)).soft).toBe(1150);
  });

  it("lets a new account earn before it ever opened the shop", async () => {
    // No wallet row exists yet: the award makes it, with the grant.
    const a = await account("Fresh1");
    const b = await account("Fresh2");
    const id = randomUUID().replace(/-/g, "").slice(0, 8);
    gameIds.push(id);
    await saveGameRecord(
      handle.db,
      sampleRecord(id, { winner: a.id, loser: b.id }),
    );
    expect((await wallet(a)).soft).toBe(1150);
  });

  describe("wearing what you own", () => {
    async function resolve(refs: object | undefined, who: Player | null) {
      const { resolveJoinCosmetics } =
        await import("../../../src/server/shop/joinCosmetics");
      return resolveJoinCosmetics(refs as never, who?.id ?? null);
    }

    it("lets anyone wear a country flag, and nothing at all", async () => {
      expect(await resolve(undefined, null)).toEqual({
        ok: true,
        cosmetics: undefined,
      });
      expect(await resolve({}, null)).toEqual({
        ok: true,
        cosmetics: undefined,
      });
      expect(await resolve({ flag: "country:ee" }, null)).toEqual({
        ok: true,
        cosmetics: { flag: "country:ee" },
      });
    });

    it("refuses a flag the player does not own, and a guest's flag", async () => {
      const p = await account("Wearer");
      const flag = FLAGS[2]!;
      expect(await resolve({ flag: `flag:${flag.name}` }, p)).toEqual({
        ok: false,
      });
      expect(await resolve({ flag: `flag:${flag.name}` }, null)).toEqual({
        ok: false,
      });
      expect(await resolve({ flag: "flag:not_a_flag" }, p)).toEqual({
        ok: false,
      });
    });

    it("lets the owner wear the flag and a pattern in the bought colour", async () => {
      const p = await account("Owner");
      const flag = FLAGS.find((f) => f.priceSoft === 300)!;
      const pattern = PATTERNS[0]!;
      const palette = PALETTES[0]!;
      await buy(p, flagBody(flag.name));
      await buy(p, {
        cosmeticType: "pattern",
        cosmeticName: pattern.name,
        currencyType: "soft",
        colorPaletteName: palette.name,
      });
      const result = await resolve(
        {
          flag: `flag:${flag.name}`,
          patternName: pattern.name,
          patternColorPaletteName: palette.name,
        },
        p,
      );
      expect(result).toEqual({
        ok: true,
        cosmetics: {
          flag: `flag:${flag.name}`,
          pattern: {
            name: pattern.name,
            patternData: pattern.data,
            colorPalette: palette,
          },
        },
      });
      // The same pattern in a colour they did not buy is refused.
      expect(
        await resolve(
          {
            patternName: pattern.name,
            patternColorPaletteName: PALETTES[3]!.name,
          },
          p,
        ),
      ).toEqual({ ok: false });
    });

    it("drops cosmetics Kleopolis does not sell", async () => {
      const p = await account("Dropper");
      expect(
        await resolve(
          { skinName: "x", crownName: "y", effects: { a: "b" } },
          p,
        ),
      ).toEqual({ ok: true, cosmetics: undefined });
    });
  });
});

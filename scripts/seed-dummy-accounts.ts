// Fills the local dev database with dummy accounts and finished games, so the
// leaderboard, ratings and profiles have something to show.
//
//   pnpm exec tsx scripts/seed-dummy-accounts.ts            # add the data
//   pnpm exec tsx scripts/seed-dummy-accounts.ts --clean    # remove it again
//
// Every dummy account has a google_sub that starts with "dummy-", and every
// dummy game has an id that starts with "dm". The totals and Elo follow the
// same rules as saveGameRecord in src/server/GameStore.ts.
import { randomUUID } from "node:crypto";
import pg from "pg";
import { coinsEarned } from "../src/server/shop/wallet";
import { eloDeltas, START_ELO } from "../src/server/stats/elo";

const ACCOUNTS = 100;
const NEWCOMERS = 8; // accounts with no games yet
const FFA_GAMES = 420;
const DUEL_GAMES = 220;
const DAYS = 30;

const url =
  process.env.DATABASE_URL ?? "postgres://landwar@localhost:5433/landwar_dev";
if (!/localhost|127\.0\.0\.1/.test(url)) {
  throw new Error(`Refusing to seed a non-local database: ${url}`);
}

// Mulberry32, so a run is repeatable.
function rng(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = rng(20261026);
const int = (lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1));
const pick = <T>(xs: readonly T[]): T => xs[int(0, xs.length - 1)]!;
const normal = () =>
  Math.sqrt(-2 * Math.log(1 - rand())) * Math.cos(2 * Math.PI * rand());

const ADJ = [
  "Iron",
  "Silent",
  "Crimson",
  "Rapid",
  "Frozen",
  "Hollow",
  "Solar",
  "Grim",
  "Lucky",
  "Rogue",
  "Steel",
  "Wild",
  "Dusty",
  "Neon",
  "Pale",
  "Brave",
  "Cold",
  "Swift",
  "Mad",
  "Royal",
  "Savage",
  "Quiet",
  "Blazing",
  "Lone",
  "Ancient",
];
const NOUN = [
  "Wolf",
  "Falcon",
  "Legion",
  "Baron",
  "Raven",
  "Tiger",
  "Pike",
  "Marshal",
  "Viper",
  "Comet",
  "Rook",
  "Fox",
  "Bishop",
  "Hawk",
  "Titan",
  "Ghost",
  "Lancer",
  "Cobra",
  "Knight",
  "Drifter",
  "Warden",
  "Bear",
  "Cannon",
  "Sentry",
  "Jackal",
];

function makeNames(n: number): string[] {
  const names = new Set<string>();
  while (names.size < n) {
    const base = `${pick(ADJ)}${pick(NOUN)}`;
    const style = int(0, 3);
    names.add(
      style === 0
        ? base
        : style === 1
          ? `${base}${int(1, 99)}`
          : style === 2
            ? `${base}_${int(2005, 2012)}`
            : `xX${base}Xx`,
    );
  }
  return [...names];
}

const MAPS = [
  "Balkans",
  "Giant World Map",
  "Antarctica",
  "Titan",
  "World Inverted",
  "Japan",
  "Europe",
  "Asia",
  "Africa",
  "Iceland",
  "Black Sea",
  "Mena",
];
const DUEL_MAPS = ["Balkans", "Japan", "Iceland", "Black Sea"];
const ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";
const code = (len: number) =>
  Array.from({ length: len }, () => ALPHABET[int(0, 35)]).join("");

interface Account {
  id: string;
  name: string;
  publicId: string;
  createdAt: Date;
  skill: number;
  activity: number;
  stats: Record<string, number>;
  ratings: Record<
    string,
    { elo: number; peak: number; games: number; wins: number; losses: number }
  >;
  coins: number;
}

interface Slot {
  acct: Account | null;
  name: string;
  placement: number;
  won: boolean;
  m: Record<string, number>;
}

const STAT_KEYS = [
  "gamesPlayed",
  "wins",
  "buildingsBuilt",
  "goldCollected",
  "troopsSent",
  "attacks",
  "kills",
  "losses",
  "unitsBuilt",
  "unitsDestroyed",
  "nukesBuilt",
  "nukesDestroyed",
  "bestTerritoryPeak",
];

async function clean(client: pg.Client) {
  await client.query("begin");
  await client.query("delete from games where id like 'dm%'");
  const r = await client.query(
    "delete from users where google_sub like 'dummy-%'",
  );
  await client.query("commit");
  console.log(`Removed ${r.rowCount} dummy accounts and their games.`);
}

async function main() {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  if (process.argv.includes("--clean")) {
    await clean(client);
    await client.end();
    return;
  }
  const existing = await client.query(
    "select count(*)::int as n from users where google_sub like 'dummy-%'",
  );
  if (existing.rows[0].n > 0) {
    throw new Error("Dummy accounts exist already. Run with --clean first.");
  }

  const now = Date.now();
  const names = makeNames(ACCOUNTS);
  const accounts: Account[] = names.map((name, i) => {
    const newcomer = i >= ACCOUNTS - NEWCOMERS;
    return {
      id: randomUUID(),
      name,
      publicId: code(10),
      createdAt: new Date(now - int(DAYS, DAYS + 60) * 864e5 + int(0, 864e5)),
      skill: normal(),
      // A few heavy players and a long tail.
      activity: newcomer ? 0 : Math.pow(rand(), 2.2) * 9 + 0.4,
      stats: Object.fromEntries(STAT_KEYS.map((k) => [k, 0])),
      ratings: {},
      coins: 0,
    };
  });
  const active = accounts.filter((a) => a.activity > 0);
  const weightedPick = (pool: Account[]): Account => {
    const total = pool.reduce((s, a) => s + a.activity, 0);
    let x = rand() * total;
    for (const a of pool) if ((x -= a.activity) <= 0) return a;
    return pool[pool.length - 1]!;
  };

  type Plan = { at: number; duel: boolean };
  const plans: Plan[] = [
    ...Array.from({ length: FFA_GAMES }, () => ({ at: 0, duel: false })),
    ...Array.from({ length: DUEL_GAMES }, () => ({ at: 0, duel: true })),
  ].map((p) => ({ ...p, at: now - rand() * DAYS * 864e5 }));
  plans.sort((a, b) => a.at - b.at);

  const gameRows: unknown[][] = [];
  const playerRows: unknown[][] = [];
  let guestCount = 0;

  for (const plan of plans) {
    const size = plan.duel ? 2 : int(3, 10);
    const chosen = new Set<Account>();
    while (chosen.size < size) chosen.add(weightedPick(active));
    const slots: Slot[] = [...chosen].map((acct) => ({
      acct,
      name: acct.name,
      placement: 0,
      won: false,
      m: {},
    }));
    // Public free-for-all lobbies also hold guests.
    if (!plan.duel && rand() < 0.35) {
      for (let g = int(1, 3); g > 0; g--) {
        slots.push({
          acct: null,
          name: `Anon${int(100, 9999)}`,
          placement: 0,
          won: false,
          m: {},
        });
        guestCount++;
      }
    }
    const strength = (s: Slot) => (s.acct?.skill ?? -0.3) + normal() * 0.9;
    slots
      .map((s) => ({ s, v: strength(s) }))
      .sort((a, b) => b.v - a.v)
      .forEach(({ s }, i) => {
        s.placement = i + 1;
        s.won = i === 0;
      });
    slots.sort((a, b) => a.placement - b.placement);

    const durationMs = plan.duel
      ? int(240, 1500) * 1000
      : int(420, 2400) * 1000;
    const endedAt = new Date(plan.at);
    const startedAt = new Date(plan.at - durationMs);
    const gameId = `dm${code(8)}`;
    const mapName = plan.duel ? pick(DUEL_MAPS) : pick(MAPS);

    for (const s of slots) {
      const rankFactor = 1 - (s.placement - 1) / Math.max(1, slots.length);
      const scale = (0.4 + rankFactor) * (durationMs / 900_000);
      const jit = () => 0.7 + rand() * 0.6;
      s.m = {
        buildingsBuilt: Math.round(30 * scale * jit()),
        goldCollected: Math.round(600_000 * scale * jit()),
        territoryPeak: Math.round(9000 * (0.2 + rankFactor) * jit()),
        troopsSent: Math.round(2_500_000 * scale * jit()),
        attacks: Math.round(60 * scale * jit()),
        kills: Math.round(slots.length * rankFactor * 2 * jit()),
        losses: Math.round(40 * (1.3 - rankFactor) * jit()),
        unitsBuilt: Math.round(45 * scale * jit()),
        unitsDestroyed: Math.round(22 * scale * jit()),
        nukesBuilt: rand() < 0.25 ? int(1, 4) : 0,
        nukesDestroyed: rand() < 0.15 ? int(1, 3) : 0,
      };
      s.m.territoryFinal = s.won
        ? s.m.territoryPeak!
        : Math.round(s.m.territoryPeak! * rand() * 0.4);
    }

    const accountsInGame = slots.filter((s) => s.acct).length;
    for (const s of slots) {
      const a = s.acct;
      if (!a) continue;
      const m = s.m;
      const t = a.stats;
      t.gamesPlayed! += 1;
      t.wins! += s.won ? 1 : 0;
      for (const k of [
        "buildingsBuilt",
        "goldCollected",
        "troopsSent",
        "attacks",
        "kills",
        "losses",
        "unitsBuilt",
        "unitsDestroyed",
        "nukesBuilt",
        "nukesDestroyed",
      ]) {
        t[k]! += m[k]!;
      }
      t.bestTerritoryPeak = Math.max(t.bestTerritoryPeak!, m.territoryPeak!);
      a.coins += coinsEarned(s.won, accountsInGame, durationMs);
    }

    // Same rating rules as rateGame in GameStore.ts.
    const ladder = plan.duel ? "1v1" : "ffa";
    const rated = slots.filter((s) => s.acct);
    if (rated.length >= 2) {
      const eloOf = (a: Account) => a.ratings[ladder]?.elo ?? START_ELO;
      const deltas = eloDeltas(
        rated.map((s) => ({
          id: s.acct!.id,
          placement: s.placement,
          elo: eloOf(s.acct!),
        })),
      );
      for (const s of rated) {
        const a = s.acct!;
        const prev = a.ratings[ladder];
        const elo = Math.max(0, eloOf(a) + (deltas.get(a.id) ?? 0));
        a.ratings[ladder] = {
          elo,
          peak: Math.max(elo, prev?.peak ?? START_ELO),
          games: (prev?.games ?? 0) + 1,
          wins: (prev?.wins ?? 0) + (s.won ? 1 : 0),
          losses: (prev?.losses ?? 0) + (s.won ? 0 : 1),
        };
      }
    }

    gameRows.push([
      gameId,
      mapName,
      "Free For All",
      slots.length,
      startedAt,
      endedAt,
      durationMs,
      slots[0]!.acct?.id ?? null,
      "Public",
      "Medium",
      plan.duel ? "1v1" : null,
    ]);
    slots.forEach((s, i) => {
      playerRows.push([
        gameId,
        i,
        s.acct?.id ?? null,
        s.name,
        s.placement,
        s.won,
        s.m.buildingsBuilt,
        s.m.goldCollected,
        s.m.territoryPeak,
        s.m.territoryFinal,
        s.m.troopsSent,
        s.m.attacks,
        s.m.kills,
        s.m.losses,
        s.m.unitsBuilt,
        s.m.unitsDestroyed,
        s.m.nukesBuilt,
        s.m.nukesDestroyed,
      ]);
    });
  }

  await client.query("begin");
  try {
    for (const [i, a] of accounts.entries()) {
      await client.query(
        `insert into users (id, google_sub, email, display_name, public_id, created_at)
         values ($1,$2,$3,$4,$5,$6)`,
        [
          a.id,
          `dummy-${i + 1}`,
          `dummy${i + 1}@dummy.landwar.test`,
          a.name,
          a.publicId,
          a.createdAt,
        ],
      );
    }
    for (const g of gameRows) {
      await client.query(
        `insert into games (id, map, mode, player_count, started_at, ended_at,
           duration_ms, winner_user_id, game_type, difficulty, ranked_type)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        g,
      );
    }
    for (const p of playerRows) {
      await client.query(
        `insert into game_players (game_id, slot, user_id, display_name,
           placement, won, buildings_built, gold_collected, territory_peak,
           territory_final, troops_sent, attacks, kills, losses, units_built,
           units_destroyed, nukes_built, nukes_destroyed)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
        p,
      );
    }
    for (const a of accounts) {
      if (a.stats.gamesPlayed! > 0) {
        const s = a.stats;
        await client.query(
          `insert into user_stats (user_id, games_played, wins, buildings_built,
             gold_collected, troops_sent, attacks, kills, losses, units_built,
             units_destroyed, nukes_built, nukes_destroyed, best_territory_peak)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
          [
            a.id,
            s.gamesPlayed,
            s.wins,
            s.buildingsBuilt,
            s.goldCollected,
            s.troopsSent,
            s.attacks,
            s.kills,
            s.losses,
            s.unitsBuilt,
            s.unitsDestroyed,
            s.nukesBuilt,
            s.nukesDestroyed,
            s.bestTerritoryPeak,
          ],
        );
      }
      for (const [ladder, r] of Object.entries(a.ratings)) {
        await client.query(
          `insert into player_ratings (user_id, ladder, elo, peak_elo, games, wins, losses)
           values ($1,$2,$3,$4,$5,$6,$7)`,
          [a.id, ladder, r.elo, r.peak, r.games, r.wins, r.losses],
        );
      }
      if (a.stats.gamesPlayed! > 0) {
        await client.query(
          "insert into wallets (user_id, soft) values ($1, 1000 + $2)",
          [a.id, a.coins],
        );
      }
    }
    await client.query("commit");
  } catch (e) {
    await client.query("rollback");
    throw e;
  }
  console.log(
    `Added ${accounts.length} accounts, ${gameRows.length} games, ${playerRows.length} player rows (${guestCount} guests).`,
  );
  await client.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

import type { Db } from "@kleopolis/db/client";
import {
  gamePlayers,
  gameRecords,
  games,
  playerRatings,
  users,
  userStats,
} from "@kleopolis/db/schema";
import {
  ATTACK_INDEX_SENT,
  BOAT_INDEX_DESTROY,
  BOAT_INDEX_SENT,
  BOMB_INDEX_INTERCEPT,
  BOMB_INDEX_LAUNCH,
  OTHER_INDEX_BUILT,
  OTHER_INDEX_DESTROY,
  TILE_INDEX_PEAK,
} from "@openfront/engine-api/StatsSchemas";
import { replacer } from "@openfront/shared/SharedUtil";
import { GameRecord, GameRecordSchema } from "@openfront/shared/WireSchemas";
import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { award, coinsEarned } from "./shop/wallet";
import { eloDeltas, START_ELO } from "./stats/elo";

// Stores finished games in Postgres: one row per game, one per player, the
// running totals per account, and the full record for replays.

export interface PlayerSummary {
  slot: number;
  userId: string | null;
  displayName: string;
  placement: number;
  won: boolean;
  buildingsBuilt: number;
  goldCollected: number;
  territoryPeak: number;
  territoryFinal: number;
  troopsSent: number;
  attacks: number;
  kills: number;
  losses: number;
  unitsBuilt: number;
  unitsDestroyed: number;
  nukesBuilt: number;
  nukesDestroyed: number;
}

export interface GameSummary {
  id: string;
  map: string;
  mode: string;
  gameType: string;
  difficulty: string;
  rankedType: string | null;
  playerCount: number;
  startedAt: Date;
  endedAt: Date;
  durationMs: number;
  winnerUserId: string | null;
  players: PlayerSummary[];
}

const UuidSchema = z.uuid();

// Stats ride the record as bigint or decimal string. Counters beyond 2^53 are
// not meaningful for a leaderboard, so they clamp.
function num(value: bigint | undefined): number {
  if (value === undefined) return 0;
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) return Number.MAX_SAFE_INTEGER;
  if (value < 0n) return 0;
  return Number(value);
}

function sum(values: bigint[] | undefined, index?: number): number {
  if (values === undefined) return 0;
  if (index !== undefined) return num(values[index]);
  return num(values.reduce((a, b) => a + b, 0n));
}

function sumGroup(
  group: Partial<Record<string, bigint[]>> | undefined,
  index: number,
  keys?: readonly string[],
): number {
  if (group === undefined) return 0;
  let total = 0;
  for (const [key, values] of Object.entries(group)) {
    if (keys !== undefined && !keys.includes(key)) continue;
    total += sum(values, index);
  }
  return total;
}

const STRUCTURES = ["city", "defp", "port", "silo", "saml", "fact"] as const;

function winnerClientIds(winner: GameRecord["info"]["winner"]): Set<string> {
  if (winner === undefined) return new Set();
  const [kind, first, ...rest] = winner;
  // ["player", clientID, ...], ["team", teamName, ...clientIDs]
  return new Set(kind === "player" ? [first, ...rest] : rest);
}

// Pure mapping from an archived record to the rows stored for it.
// `accountIds` is the set of persistent ids that belong to an account.
export function summarizeRecord(
  record: GameRecord,
  accountIds: ReadonlySet<string>,
): GameSummary {
  const { info } = record;
  const winners = winnerClientIds(info.winner);

  const attackCounts = new Map<string, number>();
  for (const turn of record.turns) {
    for (const intent of turn.intents) {
      if (intent.type !== "attack") continue;
      attackCounts.set(
        intent.clientID,
        (attackCounts.get(intent.clientID) ?? 0) + 1,
      );
    }
  }

  const players = info.players.map((p, slot) => {
    const stats = p.stats;
    const userId =
      p.persistentID !== null && accountIds.has(p.persistentID)
        ? p.persistentID
        : null;
    return {
      slot,
      clientID: p.clientID,
      won: winners.has(p.clientID),
      alive: stats?.killedAt === undefined,
      killedAt: num(stats?.killedAt),
      summary: {
        slot,
        userId,
        displayName: p.username,
        placement: 0,
        won: winners.has(p.clientID),
        buildingsBuilt: sumGroup(stats?.units, OTHER_INDEX_BUILT, STRUCTURES),
        goldCollected: sum(stats?.gold),
        territoryPeak: sum(stats?.tiles, TILE_INDEX_PEAK),
        territoryFinal: num(stats?.finalTiles),
        troopsSent: sum(stats?.attacks, ATTACK_INDEX_SENT),
        attacks: attackCounts.get(p.clientID) ?? 0,
        kills: stats?.kills?.length ?? 0,
        losses: stats?.killedAt === undefined ? 0 : 1,
        unitsBuilt:
          sumGroup(stats?.units, OTHER_INDEX_BUILT, ["wshp"]) +
          sumGroup(stats?.boats, BOAT_INDEX_SENT),
        unitsDestroyed:
          sumGroup(stats?.units, OTHER_INDEX_DESTROY) +
          sumGroup(stats?.boats, BOAT_INDEX_DESTROY),
        nukesBuilt: sumGroup(stats?.bombs, BOMB_INDEX_LAUNCH),
        nukesDestroyed: sumGroup(stats?.bombs, BOMB_INDEX_INTERCEPT),
      } satisfies PlayerSummary,
    };
  });

  // Winners first, then survivors by final territory, then the eliminated by
  // how late they fell.
  const ranked = [...players].sort((a, b) => {
    if (a.won !== b.won) return a.won ? -1 : 1;
    if (a.alive !== b.alive) return a.alive ? -1 : 1;
    if (a.alive) return b.summary.territoryFinal - a.summary.territoryFinal;
    return b.killedAt - a.killedAt;
  });
  ranked.forEach((p, i) => (p.summary.placement = i + 1));

  const winnerSlot = players.find((p) => p.won && p.summary.userId !== null);
  return {
    id: info.gameID,
    map: String(info.config.gameMap),
    mode: String(info.config.gameMode),
    gameType: String(info.config.gameType),
    difficulty: String(info.config.difficulty),
    rankedType: info.config.rankedType ?? null,
    playerCount: players.length,
    startedAt: new Date(info.start),
    endedAt: new Date(info.end),
    durationMs: Math.max(0, Math.round(info.end - info.start)),
    winnerUserId: winnerSlot?.summary.userId ?? null,
    players: players.map((p) => p.summary),
  };
}

// The ladder that rates public free-for-all games between accounts. Matchmade
// games have their own ladders, named for their queue.
export const FFA_LADDER = "ffa";

type RatingKind = "ffa" | "duel";

function ratingKind(summary: GameSummary): RatingKind | null {
  if (summary.rankedType === "1v1") return "duel";
  if (summary.rankedType === null) {
    return summary.gameType === "Public" && summary.mode === "Free For All"
      ? "ffa"
      : null;
  }
  return null;
}

// Stores one finished game. Returns false when the game was stored before, so
// a retry never counts a game twice.
export async function saveGameRecord(
  db: Db,
  record: GameRecord,
): Promise<boolean> {
  const candidateIds = record.info.players
    .map((p) => p.persistentID)
    .filter(
      (id): id is string => id !== null && UuidSchema.safeParse(id).success,
    );
  const known =
    candidateIds.length === 0
      ? []
      : await db
          .select({ id: users.id })
          .from(users)
          .where(inArray(users.id, candidateIds));
  const summary = summarizeRecord(record, new Set(known.map((u) => u.id)));

  return db.transaction(async (tx) => {
    const inserted = await tx
      .insert(games)
      .values({
        id: summary.id,
        map: summary.map,
        mode: summary.mode,
        gameType: summary.gameType,
        difficulty: summary.difficulty,
        rankedType: summary.rankedType,
        playerCount: summary.playerCount,
        startedAt: summary.startedAt,
        endedAt: summary.endedAt,
        durationMs: summary.durationMs,
        winnerUserId: summary.winnerUserId,
      })
      .onConflictDoNothing()
      .returning({ id: games.id });
    if (inserted.length === 0) return false;

    await tx.insert(gameRecords).values({
      gameId: summary.id,
      record: JSON.stringify(record, replacer),
    });
    if (summary.players.length > 0) {
      await tx.insert(gamePlayers).values(
        summary.players.map((p) => ({
          gameId: summary.id,
          slot: p.slot,
          userId: p.userId,
          displayName: p.displayName,
          placement: p.placement,
          won: p.won,
          buildingsBuilt: p.buildingsBuilt,
          goldCollected: p.goldCollected,
          territoryPeak: p.territoryPeak,
          territoryFinal: p.territoryFinal,
          troopsSent: p.troopsSent,
          attacks: p.attacks,
          kills: p.kills,
          losses: p.losses,
          unitsBuilt: p.unitsBuilt,
          unitsDestroyed: p.unitsDestroyed,
          nukesBuilt: p.nukesBuilt,
          nukesDestroyed: p.nukesDestroyed,
        })),
      );
    }

    // One account can hold two slots in a game only through a bug, but fold
    // the rows by user so the upsert never touches one row twice.
    const perUser = new Map<string, PlayerSummary[]>();
    for (const p of summary.players) {
      if (p.userId === null) continue;
      perUser.set(p.userId, [...(perUser.get(p.userId) ?? []), p]);
    }
    for (const [userId, rows] of perUser) {
      const total = (pick: (p: PlayerSummary) => number) =>
        rows.reduce((a, p) => a + pick(p), 0);
      const delta = {
        gamesPlayed: 1,
        wins: rows.some((p) => p.won) ? 1 : 0,
        buildingsBuilt: total((p) => p.buildingsBuilt),
        goldCollected: total((p) => p.goldCollected),
        troopsSent: total((p) => p.troopsSent),
        attacks: total((p) => p.attacks),
        kills: total((p) => p.kills),
        losses: total((p) => p.losses),
        unitsBuilt: total((p) => p.unitsBuilt),
        unitsDestroyed: total((p) => p.unitsDestroyed),
        nukesBuilt: total((p) => p.nukesBuilt),
        nukesDestroyed: total((p) => p.nukesDestroyed),
        bestTerritoryPeak: Math.max(...rows.map((p) => p.territoryPeak)),
      };
      await tx
        .insert(userStats)
        .values({ userId, ...delta })
        .onConflictDoUpdate({
          target: userStats.userId,
          set: {
            gamesPlayed: sql`${userStats.gamesPlayed} + ${delta.gamesPlayed}`,
            wins: sql`${userStats.wins} + ${delta.wins}`,
            buildingsBuilt: sql`${userStats.buildingsBuilt} + ${delta.buildingsBuilt}`,
            goldCollected: sql`${userStats.goldCollected} + ${delta.goldCollected}`,
            troopsSent: sql`${userStats.troopsSent} + ${delta.troopsSent}`,
            attacks: sql`${userStats.attacks} + ${delta.attacks}`,
            kills: sql`${userStats.kills} + ${delta.kills}`,
            losses: sql`${userStats.losses} + ${delta.losses}`,
            unitsBuilt: sql`${userStats.unitsBuilt} + ${delta.unitsBuilt}`,
            unitsDestroyed: sql`${userStats.unitsDestroyed} + ${delta.unitsDestroyed}`,
            nukesBuilt: sql`${userStats.nukesBuilt} + ${delta.nukesBuilt}`,
            nukesDestroyed: sql`${userStats.nukesDestroyed} + ${delta.nukesDestroyed}`,
            bestTerritoryPeak: sql`GREATEST(${userStats.bestTerritoryPeak}, ${delta.bestTerritoryPeak})`,
            updatedAt: sql`now()`,
          },
        });
    }
    // Coins for the accounts that played.
    const accounts = summary.players.filter((p) => p.userId !== null);
    for (const p of accounts) {
      await award(
        tx,
        p.userId!,
        coinsEarned(p.won, accounts.length, summary.durationMs),
      );
    }
    const kind = ratingKind(summary);
    if (kind !== null) await rateGame(tx, summary, kind);
    return true;
  });
}

// Moves the Elo of every account in a rated game. A guest has no rating, so a
// free-for-all needs two accounts to count. A matchmade game needs its full
// roster of accounts and a decided winner.
async function rateGame(
  tx: Pick<Db, "select" | "insert">,
  summary: GameSummary,
  kind: RatingKind,
): Promise<void> {
  const best = new Map<string, PlayerSummary>();
  for (const p of summary.players) {
    if (p.userId === null) continue;
    const seen = best.get(p.userId);
    if (!seen || p.placement < seen.placement) best.set(p.userId, p);
  }
  const ladder = kind === "ffa" ? FFA_LADDER : summary.rankedType!;
  const ids = [...best.keys()];
  if (ids.length < 2) return;
  if (kind !== "ffa" && summary.players.length !== 2) return;
  if (kind !== "ffa" && !summary.players.some((p) => p.won)) return;

  const current = await tx
    .select()
    .from(playerRatings)
    .where(
      and(eq(playerRatings.ladder, ladder), inArray(playerRatings.userId, ids)),
    )
    .for("update");
  const before = new Map(current.map((r) => [r.userId, r]));
  const eloOf = (id: string) => before.get(id)?.elo ?? START_ELO;

  const deltas = eloDeltas(
    ids.map((id) => ({
      id,
      placement: best.get(id)!.placement,
      elo: eloOf(id),
    })),
  );

  for (const id of ids) {
    const row = before.get(id);
    const elo = Math.max(0, eloOf(id) + (deltas.get(id) ?? 0));
    const won = best.get(id)!.won;
    const values = {
      elo,
      peakElo: Math.max(elo, row?.peakElo ?? START_ELO),
      games: (row?.games ?? 0) + 1,
      wins: (row?.wins ?? 0) + (won ? 1 : 0),
      losses: (row?.losses ?? 0) + (won ? 0 : 1),
    };
    await tx
      .insert(playerRatings)
      .values({ userId: id, ladder, ...values })
      .onConflictDoUpdate({
        target: [playerRatings.userId, playerRatings.ladder],
        set: { ...values, updatedAt: sql`now()` },
      });
  }
}

// Reads a stored record back. Returns null when the game is unknown.
export async function loadGameRecord(
  db: Db,
  gameId: string,
): Promise<GameRecord | null> {
  const rows = await db
    .select({ record: gameRecords.record })
    .from(gameRecords)
    .where(eq(gameRecords.gameId, gameId))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  return GameRecordSchema.parse(JSON.parse(row.record));
}

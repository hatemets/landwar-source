import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

// Accounts. A user signs in with Google only. `publicId` is the short id shown
// in profile URLs and lobby rosters. It never changes.
export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  googleSub: text("google_sub").notNull().unique(),
  email: text("email").notNull(),
  displayName: text("display_name").notNull(),
  avatarUrl: text("avatar_url"),
  publicId: text("public_id").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// Browser sessions. `id` is the SHA-256 hex of the cookie value. The cookie
// value itself is never stored.
export const sessions = pgTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("sessions_user_id_idx").on(t.userId)],
);

// Lobbies. The master keeps the live state in memory. A row is written for
// audit and for stats.
export const lobbies = pgTable(
  "lobbies",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    code: text("code").notNull().unique(),
    hostUserId: uuid("host_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    visibility: text("visibility", { enum: ["public", "private"] }).notNull(),
    map: text("map").notNull(),
    settings: jsonb("settings").$type<Record<string, unknown>>().notNull(),
    status: text("status", {
      enum: ["open", "started", "closed"],
    }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("lobbies_host_user_id_idx").on(t.hostUserId)],
);

// One row per finished game.
export const games = pgTable(
  "games",
  {
    id: text("id").primaryKey(),
    lobbyId: uuid("lobby_id").references(() => lobbies.id, {
      onDelete: "set null",
    }),
    map: text("map").notNull(),
    mode: text("mode").notNull(),
    gameType: text("game_type").notNull().default("Public"),
    // "1v1" or "2v2" for a matchmade game. Null for every other game.
    rankedType: text("ranked_type"),
    difficulty: text("difficulty").notNull().default("Medium"),
    playerCount: integer("player_count").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    endedAt: timestamp("ended_at", { withTimezone: true }).notNull(),
    durationMs: integer("duration_ms").notNull(),
    winnerUserId: uuid("winner_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
  },
  (t) => [index("games_ended_at_idx").on(t.endedAt)],
);

// One row per player in a finished game. Guests have `userId` null. Their
// row stays so the game history is complete.
export const gamePlayers = pgTable(
  "game_players",
  {
    gameId: text("game_id")
      .notNull()
      .references(() => games.id, { onDelete: "cascade" }),
    slot: integer("slot").notNull(),
    userId: uuid("user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    displayName: text("display_name").notNull(),
    placement: integer("placement").notNull(),
    won: boolean("won").notNull(),
    buildingsBuilt: integer("buildings_built").notNull().default(0),
    goldCollected: bigint("gold_collected", { mode: "number" })
      .notNull()
      .default(0),
    territoryPeak: integer("territory_peak").notNull().default(0),
    territoryFinal: integer("territory_final").notNull().default(0),
    troopsSent: bigint("troops_sent", { mode: "number" }).notNull().default(0),
    attacks: integer("attacks").notNull().default(0),
    kills: integer("kills").notNull().default(0),
    losses: integer("losses").notNull().default(0),
    unitsBuilt: integer("units_built").notNull().default(0),
    unitsDestroyed: integer("units_destroyed").notNull().default(0),
    nukesBuilt: integer("nukes_built").notNull().default(0),
    nukesDestroyed: integer("nukes_destroyed").notNull().default(0),
  },
  (t) => [
    index("game_players_user_id_idx").on(t.userId),
    index("game_players_game_id_idx").on(t.gameId),
  ],
);

// Running totals per user. Updated in the same transaction as game_players.
export const userStats = pgTable("user_stats", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  gamesPlayed: integer("games_played").notNull().default(0),
  wins: integer("wins").notNull().default(0),
  buildingsBuilt: integer("buildings_built").notNull().default(0),
  goldCollected: bigint("gold_collected", { mode: "number" })
    .notNull()
    .default(0),
  troopsSent: bigint("troops_sent", { mode: "number" }).notNull().default(0),
  attacks: integer("attacks").notNull().default(0),
  kills: integer("kills").notNull().default(0),
  losses: integer("losses").notNull().default(0),
  unitsBuilt: integer("units_built").notNull().default(0),
  unitsDestroyed: integer("units_destroyed").notNull().default(0),
  nukesBuilt: integer("nukes_built").notNull().default(0),
  nukesDestroyed: integer("nukes_destroyed").notNull().default(0),
  bestTerritoryPeak: integer("best_territory_peak").notNull().default(0),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// The full archived record of a finished game, for replays and history. `record`
// is the JSON text of a GameRecord, with stats written as decimal strings.
export const gameRecords = pgTable("game_records", {
  gameId: text("game_id")
    .primaryKey()
    .references(() => games.id, { onDelete: "cascade" }),
  record: text("record").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// Friend links. One row per pair, in the direction the request was sent.
// `pending` becomes `accepted` when the addressee accepts. Either side may
// delete the row.
export const friendships = pgTable(
  "friendships",
  {
    requesterId: uuid("requester_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    addresseeId: uuid("addressee_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    status: text("status", { enum: ["pending", "accepted"] }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.requesterId, t.addresseeId] }),
    index("friendships_addressee_idx").on(t.addresseeId),
    // One link per pair, whichever side asked first.
    uniqueIndex("friendships_pair_idx").on(
      sql`least(${t.requesterId}::text, ${t.addresseeId}::text)`,
      sql`greatest(${t.requesterId}::text, ${t.addresseeId}::text)`,
    ),
  ],
);

// Elo per ladder. LandWar rates public free-for-all games between accounts.
// Guests have no row.
export const playerRatings = pgTable(
  "player_ratings",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    ladder: text("ladder").notNull(),
    elo: integer("elo").notNull().default(1000),
    peakElo: integer("peak_elo").notNull().default(1000),
    games: integer("games").notNull().default(0),
    wins: integer("wins").notNull().default(0),
    losses: integer("losses").notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.ladder] }),
    index("player_ratings_ladder_elo_idx").on(t.ladder, t.elo),
  ],
);

// Soft currency, earned by playing and spent in the shop. A row is made the
// first time an account's balance is read, with the starting grant.
export const wallets = pgTable("wallets", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  soft: bigint("soft", { mode: "number" }).notNull().default(0),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// What an account owns. `flare` is the ownership key the client reads:
// "flag:<name>" or "pattern:<name>:<palette>".
export const ownedCosmetics = pgTable(
  "owned_cosmetics",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    flare: text("flare").notNull(),
    pricePaid: integer("price_paid").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.flare] })],
);

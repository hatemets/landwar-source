import type { GameRecord } from "@openfront/shared/WireSchemas";

// A finished three-player game. Slot 0 is an account that wins, slot 1 is a
// guest that survives, slot 2 is an account eliminated early.
export function sampleRecord(
  gameID: string,
  accounts: { winner: string; loser: string },
): GameRecord {
  return {
    version: "v0.0.2",
    gitCommit: "DEV",
    info: {
      gameID,
      lobbyCreatedAt: 1700000000000,
      lobbyFillTime: 5000,
      start: 1700000001000,
      end: 1700000061000,
      duration: 60,
      num_turns: 2,
      winner: ["player", "clientAA"],
      config: {
        gameMap: "Africa",
        difficulty: "Medium",
        donateGold: true,
        donateTroops: true,
        gameType: "Public",
        gameMode: "Free For All",
        gameMapSize: "Normal",
        nations: "default",
        bots: 0,
        infiniteGold: false,
        infiniteTroops: false,
        instantBuild: false,
        randomSpawn: false,
      },
      players: [
        {
          clientID: "clientAA",
          username: "Alpha",
          clanTag: null,
          persistentID: accounts.winner,
          stats: {
            attacks: [500n, 0n],
            gold: [100n, 50n],
            tiles: [900n],
            finalTiles: 800n,
            units: { city: [3n, 1n], wshp: [2n, 0n] },
            boats: { trans: [4n, 0n, 0n, 1n] },
            bombs: { abomb: [2n, 1n, 1n] },
            kills: [{ victim: "clientCC", tick: 50n }],
          },
        },
        {
          clientID: "clientBB",
          username: "Bravo",
          clanTag: null,
          persistentID: "6f1d6c0e-52c7-4a52-9a53-0d0f43c8d8aa",
          stats: { finalTiles: 100n, tiles: [150n] },
        },
        {
          clientID: "clientCC",
          username: "Charlie",
          clanTag: null,
          persistentID: accounts.loser,
          stats: { killedAt: 50n, finalTiles: 0n, tiles: [40n] },
        },
      ],
    },
    turns: [
      {
        turnNumber: 1,
        intents: [
          {
            type: "attack",
            clientID: "clientAA",
            targetID: null,
            troops: 10,
          },
          {
            type: "attack",
            clientID: "clientAA",
            targetID: null,
            troops: 10,
          },
        ],
      },
    ],
  } as unknown as GameRecord;
}

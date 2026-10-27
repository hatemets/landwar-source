import {
  maps,
  Duos,
  GameMapType,
  GameMode,
  HumansVsNations,
  Quads,
  Trios,
  UnitType,
} from "@openfront/engine-api/game/GameTypes";
import { GameConfigSchema } from "@openfront/engine-api/Schemas";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ECONOMY_ROTATION,
  MapPlaylist,
  PRIME_TIME_MAPS,
  SPECIAL_GOLD_MULTIPLIER,
} from "../../src/server/MapPlaylist";

vi.mock("../../src/server/MapLandTiles", () => ({
  getMapLandTiles: async () => 1_000_000,
}));

afterEach(() => {
  vi.restoreAllMocks();
});

// The ffa and team queues are mostly fast games (x5 or x10 gold, a 10M or
// 30M start), and half of them have no missiles.
describe("MapPlaylist economy rotation", () => {
  it("is mostly fast, and often without missiles", () => {
    const fast = ECONOMY_ROTATION.filter(
      (p) =>
        [5, 10].includes(p.goldMultiplier ?? 0) &&
        [10_000_000, 30_000_000].includes(p.startingGold ?? 0),
    );
    const noMissiles = ECONOMY_ROTATION.filter((p) => p.noMissiles);
    expect(fast.length / ECONOMY_ROTATION.length).toBeGreaterThan(0.5);
    expect(noMissiles.length / ECONOMY_ROTATION.length).toBeGreaterThanOrEqual(
      0.5,
    );
  });

  it("mostly plays real-world maps in the ffa queue", async () => {
    const playlist = new MapPlaylist();
    let realWorld = 0;
    const n = 300;
    for (let i = 0; i < n; i++) {
      const { gameMap } = await playlist.gameConfig("ffa");
      if (PRIME_TIME_MAPS.includes(gameMap)) realWorld++;
    }
    expect(realWorld / n).toBeGreaterThan(0.5);
  });

  it("doubles the default gold rate in the gold multiplier modifier", () => {
    expect(SPECIAL_GOLD_MULTIPLIER).toBe(6);
  });

  it("gives ffa lobbies each preset in turn", async () => {
    const playlist = new MapPlaylist();
    for (const preset of ECONOMY_ROTATION) {
      const config = await playlist.gameConfig("ffa");
      expect(GameConfigSchema.safeParse(config).success).toBe(true);
      expect(config.startingGold).toBe(preset.startingGold);
      expect(config.goldMultiplier).toBe(preset.goldMultiplier);
      expect(config.publicGameModifiers?.startingGold).toBe(
        preset.startingGold,
      );
      expect(config.publicGameModifiers?.goldMultiplier).toBe(
        preset.goldMultiplier,
      );
      expect(config.publicGameModifiers?.isNukesDisabled).toBe(
        preset.noMissiles ? true : undefined,
      );
      if (preset.noMissiles) {
        expect(config.disabledUnits).toEqual(
          expect.arrayContaining([
            UnitType.MissileSilo,
            UnitType.AtomBomb,
            UnitType.HydrogenBomb,
            UnitType.MIRV,
            UnitType.SAMLauncher,
          ]),
        );
      } else {
        expect(config.disabledUnits).toEqual([]);
      }
    }
  });

  it("gives the first two lobbies of a queue one game with missiles and one without", async () => {
    const playlist = new MapPlaylist();
    const first = await playlist.gameConfig("ffa");
    const second = await playlist.gameConfig("ffa");
    expect(first.publicGameModifiers?.isNukesDisabled).toBe(true);
    expect(second.publicGameModifiers?.isNukesDisabled).toBeUndefined();
  });

  it("gives a rich start the longer spawn immunity", async () => {
    const playlist = new MapPlaylist();
    const configs = [];
    for (let i = 0; i < ECONOMY_ROTATION.length; i++) {
      configs.push(await playlist.gameConfig("ffa"));
    }
    const plain = configs.find((c) => c.startingGold === undefined)!;
    for (const rich of configs.filter((c) => c.startingGold !== undefined)) {
      expect(rich.spawnImmunityDuration).toBeGreaterThan(
        plain.spawnImmunityDuration!,
      );
    }
  });

  it("keeps the ffa and team queues on their own turns", async () => {
    const playlist = new MapPlaylist();
    await playlist.gameConfig("ffa");
    const team = await playlist.gameConfig("team");
    expect(team.gameMode).toBe(GameMode.Team);
    expect(team.startingGold).toBe(ECONOMY_ROTATION[0]!.startingGold);
  });
});

describe("MapPlaylist team and special mix", () => {
  it("rolls mostly small squads, rarely two sides", async () => {
    const playlist = new MapPlaylist();
    const counts = new Map<unknown, number>();
    const n = 400;
    for (let i = 0; i < n; i++) {
      const { playerTeams } = await playlist.gameConfig("team");
      counts.set(playerTeams, (counts.get(playerTeams) ?? 0) + 1);
    }
    const squads =
      (counts.get(Duos) ?? 0) +
      (counts.get(Trios) ?? 0) +
      (counts.get(Quads) ?? 0);
    const twoSides = (counts.get(2) ?? 0) + (counts.get(HumansVsNations) ?? 0);
    expect(squads / n).toBeGreaterThan(0.5);
    expect(twoSides / n).toBeLessThan(0.2);
  });

  it("makes most special games free for all", async () => {
    const playlist = new MapPlaylist();
    let ffa = 0;
    const n = 300;
    for (let i = 0; i < n; i++) {
      if ((await playlist.gameConfig("special")).gameMode === GameMode.FFA) {
        ffa++;
      }
    }
    expect(ffa / n).toBeGreaterThan(0.7);
  });

  // A team queue that only holds the given map.
  function teamQueueOf(map: GameMapType): MapPlaylist {
    const playlist = new MapPlaylist();
    playlist.setWeightOverrides(
      Object.fromEntries(
        maps.map((m) => [m.type, { teamFrequency: m.type === map ? 1 : 0 }]),
      ),
    );
    return playlist;
  }

  it("keeps missiles in team games on two-side maps", async () => {
    const twoSide = maps.find((m) => m.specialTeamCount === 2)!.type;
    const playlist = teamQueueOf(twoSide);
    for (let i = 0; i < ECONOMY_ROTATION.length; i++) {
      const config = await playlist.gameConfig("team");
      expect(config.gameMap).toBe(twoSide);
      expect(config.publicGameModifiers?.isNukesDisabled).toBeUndefined();
      expect(config.disabledUnits).toEqual([]);
    }
  });
});

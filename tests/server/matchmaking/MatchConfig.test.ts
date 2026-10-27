import { GameMode, RankedType } from "@openfront/engine-api/game/GameTypes";
import { GameConfigSchema } from "@openfront/engine-api/Schemas";
import {
  RANKED_1V1_MAPS,
  RANKED_3V3_MAPS,
  RANKED_5V5_MAPS,
} from "@openfront/shared/RankedMaps";
import { describe, expect, it } from "vitest";
import {
  matchGameConfig,
  matchTeams,
} from "../../../src/server/matchmaking/matchConfig";
import {
  findMatches,
  type Ticket,
} from "../../../src/server/matchmaking/matcher";
import { parseMode } from "../../../src/server/matchmaking/service";

const group = (n: number): Ticket[] =>
  Array.from({ length: n }, (_, i) => ({
    userId: `u${i}`,
    publicId: `pub${i}`,
    elo: 1000 + i * 10,
    joinedAt: i,
  }));

describe("matchGameConfig", () => {
  it("makes a 1v1 a free-for-all of two", () => {
    const [match] = findMatches(group(2), "1v1", 0);
    const config = matchGameConfig("1v1", match!, () => 0);
    expect(config.gameMode).toBe(GameMode.FFA);
    expect(config.rankedType).toBe(RankedType.OneVOne);
    expect(config.playerTeams).toBeUndefined();
    expect(config.maxPlayers).toBe(2);
    expect(config.nations).toBe("default");
    expect(config.bots).toBe(100);
    expect(RANKED_1V1_MAPS).toContain(config.gameMap);
    expect(matchTeams(match!)).toBeUndefined();
  });

  it.each([
    ["3v3", 6, RankedType.ThreeVThree, RANKED_3V3_MAPS],
    ["5v5", 10, RankedType.FiveVFive, RANKED_5V5_MAPS],
  ] as const)(
    "makes a %s a two-team game on its own maps",
    (mode, size, rankedType, maps) => {
      const [match] = findMatches(group(size), mode, 0);
      const config = matchGameConfig(mode, match!, () => 0.99);
      expect(GameConfigSchema.safeParse(config).success).toBe(true);
      expect(config.gameMode).toBe(GameMode.Team);
      expect(config.playerTeams).toBe(2);
      expect(config.rankedType).toBe(rankedType);
      expect(config.maxPlayers).toBe(size);
      expect(config.nations).toBe("default");
      expect(config.bots).toBe(100);
      expect(maps).toContain(config.gameMap);
      expect(config.allowedPublicIds?.sort()).toEqual(
        match!.players.map((p) => p.publicId).sort(),
      );
      // The pins seat every matched player on one of two equal sides.
      const teams = matchTeams(match!)!;
      expect(teams.map((t) => t.length)).toEqual([size / 2, size / 2]);
      expect(teams.flat().sort()).toEqual(config.allowedPublicIds?.sort());
    },
  );
});

describe("parseMode", () => {
  it("reads each queue from the URL and defaults to 1v1", () => {
    expect(parseMode("/matchmaking/join")).toBe("1v1");
    expect(parseMode("/matchmaking/join?mode=1v1")).toBe("1v1");
    expect(parseMode("/matchmaking/join?mode=3v3")).toBe("3v3");
    expect(parseMode("/matchmaking/join?mode=5v5")).toBe("5v5");
  });

  it("refuses an unknown queue", () => {
    expect(parseMode("/matchmaking/join?mode=2v2")).toBeNull();
    expect(parseMode("/matchmaking/join?mode=ffa")).toBeNull();
  });
});

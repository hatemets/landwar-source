import {
  Difficulty,
  GameMapSize,
  GameMode,
  UnitType,
} from "@openfront/engine-api/game/GameTypes";
import { GameConfigSchema } from "@openfront/engine-api/Schemas";
import {
  RANKED_1V1_MAPS,
  RANKED_TIME_LIMIT_MINUTES,
} from "@openfront/shared/RankedMaps";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../src/client/Cosmetics", () => ({
  getPlayerCosmetics: vi.fn(async () => ({})),
}));

vi.mock("../../src/client/TerrainMapFileLoader", () => ({
  terrainMapFileLoader: { getMapData: vi.fn() },
}));

// Side-effect import so the custom element registers (a type-only import
// would be elided and createElement would return an inert element).
import "../../src/client/SinglePlayerModal";

function createModal(): any {
  return document.createElement("single-player-modal") as any;
}

describe("SinglePlayerModal start", () => {
  it("carries the selected team count and validated disabled units into the join-lobby config", async () => {
    const modal = createModal();
    const events: any[] = [];
    modal.addEventListener("join-lobby", (e: Event) =>
      events.push((e as CustomEvent).detail),
    );

    // Selection arrives via the game-config-settings child event.
    modal.handleConfigTeamCountSelected(
      new CustomEvent("team-count-selected", { detail: { count: 4 } }),
    );
    // One real unit and one junk entry: the start path must keep only
    // values that are actual UnitTypes.
    modal.disabledUnits = [UnitType.Warship, "Bogus"];

    await modal.startGame();

    expect(events).toHaveLength(1);
    expect(events[0].source).toBe("singleplayer");
    const config = events[0].gameStartInfo.config;
    expect(config.playerTeams).toBe(4);
    expect(config.disabledUnits).toEqual([UnitType.Warship]);
  });

  it("starts a practice 1v1 against one hard nation on a ranked map", async () => {
    const modal = createModal();
    const events: any[] = [];
    modal.addEventListener("join-lobby", (e: Event) =>
      events.push((e as CustomEvent).detail),
    );

    // The ranked queue calls this with the modal shut.
    await modal.startPractice();

    expect(events).toHaveLength(1);
    const config = events[0].gameStartInfo.config;
    expect(GameConfigSchema.safeParse(config).success).toBe(true);
    expect(RANKED_1V1_MAPS).toContain(config.gameMap);
    expect(config.gameMapSize).toBe(GameMapSize.Compact);
    expect(config.gameMode).toBe(GameMode.FFA);
    expect(config.nations).toBe(1);
    expect(config.bots).toBe(0);
    expect(config.difficulty).toBe(Difficulty.Hard);
    expect(config.maxTimerValue).toBe(RANKED_TIME_LIMIT_MINUTES);
    // Unranked: a practice match never touches the ladder.
    expect(config.rankedType).toBeUndefined();
  });
});

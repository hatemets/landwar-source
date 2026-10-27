import {
  PlayerInfo,
  PlayerType,
  UnitType,
} from "@openfront/engine-api/game/GameTypes";
import { GameConfig } from "@openfront/engine-api/Schemas";
import { Config } from "@openfront/engine-lib/configuration/Config";
import { EngineConfig } from "@openfront/engine/configuration/EngineConfig";
import { describe, expect, it } from "vitest";

describe("EngineConfig.unitInfo", () => {
  for (const instantBuild of [false, true]) {
    const gameConfig = { instantBuild } as unknown as GameConfig;
    const shared = new Config(gameConfig, false);
    const engine = new EngineConfig(gameConfig, false);

    it(`adds a cost to the shared unit stats (instantBuild=${instantBuild})`, () => {
      for (const type of Object.values(UnitType)) {
        const { cost, ...stats } = engine.unitInfo(type);
        expect(stats).toEqual(shared.unitInfo(type));
        expect(typeof cost).toBe("function");
      }
    });
  }

  it("caches per unit type", () => {
    const engine = new EngineConfig({} as unknown as GameConfig, false);
    expect(engine.unitInfo(UnitType.City)).toBe(engine.unitInfo(UnitType.City));
  });
});

describe("Kleopolis defaults", () => {
  it("uses 3x gold and preserves an explicit multiplier", () => {
    expect(new EngineConfig({} as GameConfig, false).goldMultiplier()).toBe(3);
    expect(
      new EngineConfig(
        { goldMultiplier: 1 } as GameConfig,
        false,
      ).goldMultiplier(),
    ).toBe(1);
  });
  it("starts humans with 1M gold and preserves an explicit amount", () => {
    const human = new PlayerInfo("a", PlayerType.Human, "c1", "p1");
    const bot = new PlayerInfo("b", PlayerType.Bot, null, "p2");
    const defaults = new EngineConfig({} as GameConfig, false);
    expect(defaults.startingGold(human)).toBe(1_000_000n);
    expect(defaults.startingGold(bot)).toBe(0n);
    expect(
      new EngineConfig({ startingGold: 0 } as GameConfig, false).startingGold(
        human,
      ),
    ).toBe(0n);
  });
  it("runs ticks 1.25x faster than the original 100 ms interval", () => {
    expect(new Config({} as GameConfig, false).msPerTick()).toBe(80);
  });
});

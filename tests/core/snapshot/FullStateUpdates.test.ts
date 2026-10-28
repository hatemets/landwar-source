import {
  GameUpdates,
  PlayerInfo,
  PlayerType,
  UnitType,
} from "@openfront/engine-api/game/GameTypes";
import { GameUpdateType } from "@openfront/engine-api/game/GameUpdates";
import { unpackMotionPlans } from "@openfront/engine-lib/game/MotionPlans";
import { FactoryExecution } from "@openfront/engine/execution/FactoryExecution";
import { Game, Player } from "@openfront/engine/game/Game";
import { setup } from "../../util/Setup";
import { loadTestMaps, roundTrip } from "../../util/Snapshot";

const MAP = "plains";

/** What a host learns from the updates: the railroads and motion plans. */
class ViewState {
  railroads = new Set<number>();
  /** Plan id by plan-driven unit (trains by their engine). */
  plans = new Map<number, number>();

  apply(updates: GameUpdates, packedPlans: Uint32Array | null) {
    for (const u of updates[GameUpdateType.RailroadConstructionEvent]) {
      this.railroads.add(u.id);
    }
    for (const u of updates[GameUpdateType.RailroadSnapEvent]) {
      this.railroads.delete(u.originalId);
      this.railroads.add(u.newId1);
      this.railroads.add(u.newId2);
    }
    for (const u of updates[GameUpdateType.RailroadDestructionEvent]) {
      this.railroads.delete(u.id);
    }
    for (const p of packedPlans ? unpackMotionPlans(packedPlans) : []) {
      this.plans.set(p.kind === "grid" ? p.unitId : p.engineUnitId, p.planId);
    }
  }
}

function tick(game: Game, view: ViewState) {
  const updates = game.executeNextTick();
  game.drainPackedTileUpdates();
  view.apply(updates, game.drainPackedMotionPlans());
}

function conquerRect(game: Game, p: Player) {
  for (let x = 5; x < 95; x++) {
    for (let y = 30; y < 70; y++) {
      const t = game.ref(x, y);
      if (game.isLand(t)) p.conquer(t);
    }
  }
}

describe("full-state updates after a restore", () => {
  test("rebuild tiles, units, railroads and motion plans", async () => {
    const game = await setup(MAP, { instantBuild: true }, [
      new PlayerInfo("a", PlayerType.Human, null, "a"),
    ]);
    const a = game.player("a");
    a.addGold(100_000_000n);
    conquerRect(game, a);
    for (const [x, y] of [
      [20, 50],
      [80, 50],
      [50, 35],
    ]) {
      a.buildUnit(UnitType.City, game.ref(x, y), {});
    }
    const factory = a.buildUnit(UnitType.Factory, game.ref(50, 50), {});
    game.addExecution(new FactoryExecution(factory));
    game.setFallout(game.ref(10, 80), true);

    const live = new ViewState();
    for (let i = 0; i < 3000 && game.units(UnitType.Train).length === 0; i++) {
      tick(game, live);
    }
    for (let i = 0; i < 20; i++) tick(game, live);
    expect(game.units(UnitType.Train).length).toBeGreaterThan(0);
    expect(live.railroads.size).toBeGreaterThan(0);

    const { restored } = await roundTrip(game, MAP);
    tick(game, live);
    const updates = restored.executeNextTick();
    restored.addFullStateUpdates();
    const tiles = restored.drainPackedTileUpdates();
    const resumed = new ViewState();
    resumed.apply(updates, restored.drainPackedMotionPlans());

    // Tiles: the map file plus the full-state tile updates is the game's map.
    const { gameMap: pristine } = await loadTestMaps(MAP);
    const sent = new Map<number, number>();
    for (let i = 0; i + 1 < tiles.length; i += 2)
      sent.set(tiles[i], tiles[i + 1]);
    for (let t = 0; t < restored.width() * restored.height(); t++) {
      const expected =
        (restored.map().tileState(t) & 0xffff) |
        (restored.map().terrainByte(t) << 16);
      expect(sent.get(t) ?? pristine.terrainByte(t) << 16).toBe(expected);
    }

    // Units: every live unit, plan-driven ones included.
    const unitIds = new Set(updates[GameUpdateType.Unit].map((u) => u.id));
    for (const u of restored.units()) expect(unitIds.has(u.id())).toBe(true);

    // Railroads and the latest motion plan of every moving unit.
    expect(resumed.railroads).toEqual(live.railroads);
    const liveIds = new Set(restored.units().map((u) => u.id()));
    const livePlans = new Map(
      [...live.plans].filter(([id]) => liveIds.has(id)),
    );
    expect(resumed.plans).toEqual(livePlans);
    expect(resumed.plans.size).toBeGreaterThan(0);

    expect(updates[GameUpdateType.SpawnPhaseEnd]).toHaveLength(
      restored.inSpawnPhase() ? 0 : 1,
    );
  }, 60_000);
});

import {
  bulkCost,
  PlayerInfo,
  PlayerType,
  UnitType,
} from "@openfront/engine-api/game/GameTypes";
import { ConstructionExecution } from "@openfront/engine/execution/ConstructionExecution";
import { Game, Player } from "@openfront/engine/game/Game";
import { setup } from "./util/Setup";
import { executeTicks } from "./util/utils";

const coastX = 7;
let game: Game;
let player: Player;

function setGold(gold: bigint) {
  player.removeGold(player.gold());
  player.addGold(gold);
}

describe("Building warships in bulk", () => {
  beforeEach(async () => {
    game = await setup("half_land_half_ocean", { instantBuild: true }, [
      new PlayerInfo("p1", PlayerType.Human, null, "p1"),
    ]);
    player = game.player("p1");
    for (let x = 0; x <= coastX; x++) {
      for (let y = 0; y < game.height(); y++) player.conquer(game.ref(x, y));
    }
    player.buildUnit(UnitType.Port, game.ref(coastX, 8), {});
    while (game.inSpawnPhase()) game.executeNextTick();
  });

  test("prices each warship at its own escalating cost", () => {
    setGold(10_000_000n);
    const warship = player
      .buildableUnits(game.ref(coastX + 1, 8))
      .find((bu) => bu.type === UnitType.Warship)!;
    expect(warship.canBuild).not.toBe(false);
    // 250k, 500k, 750k, then the 1M cap.
    expect(bulkCost(warship, 1)).toBe(250_000n);
    expect(bulkCost(warship, 3)).toBe(1_500_000n);
    expect(bulkCost(warship, 5)).toBe(3_500_000n);
  });

  test("builds as many warships as the amount, until the gold runs out", () => {
    setGold(1_600_000n);
    game.addExecution(
      new ConstructionExecution(
        player,
        UnitType.Warship,
        game.ref(coastX + 1, 8),
        undefined,
        50,
      ),
    );
    executeTicks(game, 3);
    expect(player.units(UnitType.Warship)).toHaveLength(3);
    expect(player.gold()).toBeLessThan(250_000n + 1n);
  });

  test("builds one warship without an amount", () => {
    setGold(10_000_000n);
    game.addExecution(
      new ConstructionExecution(
        player,
        UnitType.Warship,
        game.ref(coastX + 1, 8),
      ),
    );
    executeTicks(game, 3);
    expect(player.units(UnitType.Warship)).toHaveLength(1);
  });
});

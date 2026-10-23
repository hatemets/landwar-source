import {
  PlayerInfo,
  PlayerType,
  UnitType,
} from "@openfront/engine-api/game/GameTypes";
import { WarshipExecution } from "@openfront/engine/execution/WarshipExecution";
import { Game, Unit } from "@openfront/engine/game/Game";
import { setup } from "./util/Setup";
import { executeTicks } from "./util/utils";

const coastX = 7;

describe("Warship shell retargeting", () => {
  let game: Game;

  beforeEach(async () => {
    game = await setup(
      "half_land_half_ocean",
      { infiniteGold: true, instantBuild: true },
      [
        new PlayerInfo("boat dude", PlayerType.Human, null, "player_1_id"),
        new PlayerInfo("boat dude", PlayerType.Human, null, "player_2_id"),
      ],
    );
    executeTicks(game, 50);
  });

  function shells(): Unit[] {
    return game.units(UnitType.Shell);
  }

  test("Warship fires again at a transport ship when its first shell is removed", () => {
    game.config().warshipShellAttackRate = () => 0;
    game.config().warshipTargettingRange = () => 15;
    const player1 = game.player("player_1_id");
    const player2 = game.player("player_2_id");

    const warship = player1.buildUnit(
      UnitType.Warship,
      game.ref(coastX + 1, 1),
      { patrolTile: game.ref(coastX + 1, 1) },
    );
    const transport = player2.buildUnit(
      UnitType.TransportShip,
      game.ref(coastX + 1, 14),
      { targetTile: game.ref(coastX + 1, 14) },
    );
    game.addExecution(new WarshipExecution(warship));

    // Run until the first shell is in flight.
    let firstShell: Unit | undefined;
    for (let i = 0; i < 10 && firstShell === undefined; i++) {
      game.executeNextTick();
      firstShell = shells()[0];
    }
    expect(firstShell).toBeDefined();
    expect(transport.isActive()).toBe(true);

    // Remove the shell before it lands.
    firstShell!.delete(false);

    let secondShell: Unit | undefined;
    for (let i = 0; i < 10 && secondShell === undefined; i++) {
      game.executeNextTick();
      secondShell = shells().find((s) => s !== firstShell);
    }
    expect(secondShell).toBeDefined();
  });

  test("Warship does not fire a second shell while the first is still in flight", () => {
    game.config().warshipShellAttackRate = () => 0;
    game.config().warshipTargettingRange = () => 15;
    const player1 = game.player("player_1_id");
    const player2 = game.player("player_2_id");

    const warship = player1.buildUnit(
      UnitType.Warship,
      game.ref(coastX + 1, 1),
      { patrolTile: game.ref(coastX + 1, 1) },
    );
    player2.buildUnit(UnitType.TransportShip, game.ref(coastX + 1, 14), {
      targetTile: game.ref(coastX + 1, 14),
    });
    game.addExecution(new WarshipExecution(warship));

    let maxShells = 0;
    for (let i = 0; i < 4; i++) {
      game.executeNextTick();
      maxShells = Math.max(maxShells, shells().length);
    }
    expect(maxShells).toBe(1);
  });
});

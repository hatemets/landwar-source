import { TileRef } from "@openfront/engine-api/game/GameMap";
import {
  PlayerInfo,
  PlayerType,
  UnitType,
} from "@openfront/engine-api/game/GameTypes";
import { ConstructionExecution } from "@openfront/engine/execution/ConstructionExecution";
import { DeleteUnitExecution } from "@openfront/engine/execution/DeleteUnitExecution";
import { meltDown } from "@openfront/engine/execution/NukeBlast";
import { NukeExecution } from "@openfront/engine/execution/NukeExecution";
import { PlayerExecution } from "@openfront/engine/execution/PlayerExecution";
import { EngineConfig } from "@openfront/engine/configuration/EngineConfig";
import { Game, Player, Unit } from "@openfront/engine/game/Game";
import { setup } from "./util/Setup";

const ownerInfo = new PlayerInfo("owner", PlayerType.Human, "c1", "owner_id");
const enemyInfo = new PlayerInfo("enemy", PlayerType.Human, "c2", "enemy_id");

// big_plains is 200x200 land. The owner holds the west half, the enemy the
// east half. EngineConfig, not TestConfig: TestConfig shrinks every blast to
// one tile.
async function twoPlayers(
  instantBuild = true,
): Promise<{ game: Game; owner: Player; enemy: Player }> {
  const game = await setup(
    "big_plains",
    { instantBuild, spawnImmunityDuration: 0 },
    [ownerInfo, enemyInfo],
    undefined,
    EngineConfig,
  );
  const owner = game.player(ownerInfo.id);
  const enemy = game.player(enemyInfo.id);
  game.map().forEachTile((tile) => {
    (game.x(tile) < 100 ? owner : enemy).conquer(tile);
  });
  game.addExecution(new PlayerExecution(owner), new PlayerExecution(enemy));
  game.executeNextTick();
  return { game, owner, enemy };
}

function buildReactor(game: Game, player: Player, x: number, y: number): Unit {
  player.addGold(
    game.unitInfo(UnitType.Reactor).cost(game, player) + 10_000_000n,
  );
  game.addExecution(
    new ConstructionExecution(player, UnitType.Reactor, game.ref(x, y)),
  );
  game.executeNextTick();
  game.executeNextTick();
  const reactor = player
    .units(UnitType.Reactor)
    .find((u) => u.tile() === game.ref(x, y));
  if (reactor === undefined) throw new Error(`no reactor at ${x},${y}`);
  return reactor;
}

function ticks(game: Game, n: number) {
  for (let i = 0; i < n; i++) game.executeNextTick();
}

function ownedBy(game: Game, tile: TileRef, player: Player): boolean {
  const owner = game.owner(tile);
  return owner.isPlayer() && owner.id() === player.id();
}

describe("Reactor", () => {
  test("pays its owner the reactor rate each tick once built", async () => {
    const { game, owner } = await twoPlayers();
    buildReactor(game, owner, 40, 100);
    const before = owner.gold();
    game.executeNextTick();
    const paid = owner.gold() - before;
    const config = game.config();
    expect(paid).toBe(
      config.goldAdditionRate(owner) + config.reactorGoldRate(owner),
    );
  });

  test("pays nothing while under construction", async () => {
    const { game, owner } = await twoPlayers(false);
    owner.addGold(game.unitInfo(UnitType.Reactor).cost(game, owner));
    game.addExecution(
      new ConstructionExecution(owner, UnitType.Reactor, game.ref(40, 100)),
    );
    ticks(game, 3);
    expect(owner.units(UnitType.Reactor)[0]!.isUnderConstruction()).toBe(true);
    const before = owner.gold();
    game.executeNextTick();
    expect(owner.gold() - before).toBe(game.config().goldAdditionRate(owner));
  });

  test("melts down when an enemy takes its tile", async () => {
    const { game, owner, enemy } = await twoPlayers();
    buildReactor(game, owner, 90, 100);
    const tile = game.ref(90, 100);
    const near = game.ref(85, 100);

    enemy.conquer(tile);
    ticks(game, 3);

    expect(owner.units(UnitType.Reactor)).toHaveLength(0);
    expect(enemy.units(UnitType.Reactor)).toHaveLength(0);
    // The inner radius is always destroyed; the enemy gains nothing there.
    expect(game.owner(tile).isPlayer()).toBe(false);
    expect(game.owner(near).isPlayer()).toBe(false);
  });

  test("an atom bomb on it sets off a chain through nearby reactors only", async () => {
    const { game, owner, enemy } = await twoPlayers();
    buildReactor(game, owner, 40, 60);
    // Inside the first blast (outer radius 30), so it melts down too.
    buildReactor(game, owner, 40, 85);
    // Well outside both blasts.
    buildReactor(game, owner, 40, 180);

    enemy.buildUnit(UnitType.MissileSilo, game.ref(150, 60), {});
    enemy.addGold(game.unitInfo(UnitType.AtomBomb).cost(game, enemy));
    game.addExecution(
      new NukeExecution(
        UnitType.AtomBomb,
        enemy,
        game.ref(40, 60),
        game.ref(150, 60),
      ),
    );
    ticks(game, 200);

    const left = owner.units(UnitType.Reactor).map((u) => game.y(u.tile()));
    expect(left).toEqual([180]);
    // The second reactor's own blast cleared its tile and the land below it,
    // which the bomb did not reach.
    expect(game.owner(game.ref(40, 85)).isPlayer()).toBe(false);
    expect(game.owner(game.ref(40, 110)).isPlayer()).toBe(false);
    expect(ownedBy(game, game.ref(40, 150), owner)).toBe(true);
  });

  test("a meltdown kills troops on its blast", async () => {
    const { game, owner, enemy } = await twoPlayers();
    const reactor = buildReactor(game, owner, 50, 100);
    owner.addTroops(1_000_000);
    const troopsBefore = owner.troops();
    const tilesBefore = owner.numTilesOwned();
    meltDown(game, reactor, enemy);
    // The meltdown starts on the next tick and blows up on the one after.
    ticks(game, 2);
    expect(owner.troops()).toBeLessThan(troopsBefore);
    expect(owner.numTilesOwned()).toBeLessThan(tilesBefore);
  });

  test("a reactor its owner deletes makes no blast", async () => {
    const { game, owner } = await twoPlayers();
    const reactor = buildReactor(game, owner, 50, 100);
    // Past the delete cooldown, then past the deletion mark.
    ticks(game, game.config().deleteUnitCooldown());
    game.addExecution(new DeleteUnitExecution(owner, reactor.id()));
    ticks(game, game.config().deletionMarkDuration() + 5);
    expect(reactor.isActive()).toBe(false);
    expect(ownedBy(game, game.ref(50, 100), owner)).toBe(true);
    expect(ownedBy(game, game.ref(55, 100), owner)).toBe(true);
  });

  test("an enemy that takes a reactor under construction gets no blast", async () => {
    const { game, owner, enemy } = await twoPlayers(false);
    owner.addGold(game.unitInfo(UnitType.Reactor).cost(game, owner));
    game.addExecution(
      new ConstructionExecution(owner, UnitType.Reactor, game.ref(90, 100)),
    );
    ticks(game, 3);
    expect(owner.units(UnitType.Reactor)).toHaveLength(1);

    enemy.conquer(game.ref(90, 100));
    ticks(game, 3);

    expect(owner.units(UnitType.Reactor)).toHaveLength(0);
    expect(enemy.units(UnitType.Reactor)).toHaveLength(0);
    expect(ownedBy(game, game.ref(90, 100), enemy)).toBe(true);
    expect(ownedBy(game, game.ref(85, 100), owner)).toBe(true);
  });
});

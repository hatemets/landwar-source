import type { TileRef } from "@openfront/engine-api/game/GameMap";
import {
  GameType,
  MAX_UPGRADE_AMOUNT,
  PlayerInfo,
  PlayerType,
  UnitType,
} from "@openfront/engine-api/game/GameTypes";
import { MaxUpgradeIntentSchema } from "@openfront/engine-api/Schemas";
import { MaxUpgradeExecution } from "@openfront/engine/execution/MaxUpgradeExecution";
import type { Game, Player, Unit } from "@openfront/engine/game/Game";
import { describe, expect, it } from "vitest";
import { setup } from "../../util/Setup";

const LAYOUT = [
  UnitType.City,
  UnitType.City,
  UnitType.City,
  UnitType.Port,
  UnitType.Factory,
  UnitType.SAMLauncher,
  UnitType.MissileSilo,
];

async function world(gold: bigint) {
  const game = await setup(
    "ocean_and_land",
    { gameType: GameType.Singleplayer, instantBuild: true },
    [],
    undefined,
    undefined,
    false,
  );
  game.addPlayer(
    new PlayerInfo("player1", PlayerType.Human, null, "player1_id"),
  );
  const player = game.player("player1_id")!;
  const land: TileRef[] = [];
  for (let y = 0; y < game.map().height() && land.length < LAYOUT.length; y++) {
    for (let x = 0; x < game.map().width(); x += 5) {
      const t = game.ref(x, y);
      if (game.isLand(t)) land.push(t);
      if (land.length === LAYOUT.length) break;
    }
  }
  const units = LAYOUT.map((type, i) => {
    player.conquer(land[i]);
    return player.buildUnit(type, land[i], {});
  });
  game.endSpawnPhase();
  player.removeGold(player.gold());
  player.addGold(gold);
  return { game, player, units };
}

// The reference: one level at a time with the plain upgrade path, in the
// order max_upgrade promises (round-robin, lowest level first).
function upgradeOneByOne(player: Player, units: Unit[], types: UnitType[]) {
  const list = units
    .filter((u) => types.includes(u.type()))
    .sort((a, b) => a.level() - b.level() || a.id() - b.id());
  const tooDear = new Set<UnitType>();
  for (let progress = true; progress; ) {
    progress = false;
    for (const u of list) {
      if (tooDear.has(u.type())) continue;
      if (!player.canUpgradeUnit(u)) {
        tooDear.add(u.type());
        continue;
      }
      player.upgradeUnit(u);
      progress = true;
    }
  }
}

function run(game: Game, player: Player, types: UnitType[]) {
  game.addExecution(new MaxUpgradeExecution(player, types));
  game.executeNextTick();
}

describe("MaxUpgradeExecution", () => {
  it("buys past the 50-level intent cap in one intent", async () => {
    const { game, player, units } = await world(200_000_000n);
    run(game, player, [UnitType.City]);
    const cities = units.filter((u) => u.type() === UnitType.City);
    const added = cities.reduce((a, u) => a + u.level() - 1, 0);
    expect(added).toBeGreaterThan(MAX_UPGRADE_AMOUNT);
    // Spread equally: levels differ by at most one.
    const lv = cities.map((u) => u.level());
    expect(Math.max(...lv) - Math.min(...lv)).toBeLessThanOrEqual(1);
    // Spent down to less than the next level costs.
    const next = game.unitInfo(UnitType.City).cost(game, player);
    expect(player.gold()).toBeLessThan(next);
  });

  it("matches one-level-at-a-time upgrades in levels and gold", async () => {
    const all = [
      UnitType.City,
      UnitType.Port,
      UnitType.Factory,
      UnitType.SAMLauncher,
      UnitType.MissileSilo,
    ];
    for (const types of [[UnitType.Port], [UnitType.Factory], all]) {
      const a = await world(37_654_321n);
      const b = await world(37_654_321n);
      run(a.game, a.player, types);
      upgradeOneByOne(b.player, b.units, types);
      expect(a.units.map((u) => u.level())).toEqual(
        b.units.map((u) => u.level()),
      );
      expect(a.player.gold()).toBe(b.player.gold());
      expect(a.player.unitsConstructed(UnitType.Port)).toBe(
        b.player.unitsConstructed(UnitType.Port),
      );
    }
  });

  it("spreads Max all over every owned type", async () => {
    const { game, player, units } = await world(60_000_000n);
    run(game, player, [
      UnitType.City,
      UnitType.Port,
      UnitType.Factory,
      UnitType.SAMLauncher,
      UnitType.MissileSilo,
    ]);
    for (const u of units) expect(u.level()).toBeGreaterThan(1);
  });

  it("does nothing without enough gold", async () => {
    const { game, player, units } = await world(1_000n);
    run(game, player, [UnitType.City]);
    expect(units.map((u) => u.level())).toEqual(LAYOUT.map(() => 1));
    expect(player.gold()).toBe(1_000n);
  });

  it("schema accepts unit lists and rejects empty ones", () => {
    const ok = { type: "max_upgrade", units: [UnitType.City] };
    expect(MaxUpgradeIntentSchema.safeParse(ok).success).toBe(true);
    const bad = { type: "max_upgrade", units: [] };
    expect(MaxUpgradeIntentSchema.safeParse(bad).success).toBe(false);
  });
});

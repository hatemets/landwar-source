import {
  PlayerInfo,
  PlayerType,
  UnitType,
} from "@openfront/engine-api/game/GameTypes";
import { NukeExecution } from "@openfront/engine/execution/NukeExecution";
import { SpawnExecution } from "@openfront/engine/execution/SpawnExecution";
import { Game, Player } from "@openfront/engine/game/Game";
import { setup } from "./util/Setup";
import { constructionExecution } from "./util/utils";

let game: Game;
let attacker: Player;

async function setupSilo(level: number) {
  game = await setup("plains", { infiniteGold: true, instantBuild: true });
  const info = new PlayerInfo("attacker_id", PlayerType.Human, null, "a_id");
  game.addPlayer(info);
  game.addExecution(
    new SpawnExecution("game_id", game.player(info.id).info(), game.ref(1, 1)),
  );
  attacker = game.player("a_id");
  constructionExecution(game, attacker, 1, 1, UnitType.MissileSilo);
  const silo = attacker.units(UnitType.MissileSilo)[0];
  silo.increaseLevel(level - 1);
  // Start fully reloaded with an empty cooldown queue.
  silo.missileTimerQueue().splice(0);
  expect(silo.level()).toBe(level);
  expect(silo.isInCooldown()).toBe(false);
}

function queueNukes(count: number) {
  for (let i = 0; i < count; i++) {
    game.addExecution(
      new NukeExecution(UnitType.AtomBomb, attacker, game.ref(50, 50), null),
    );
  }
}

const startTiles = new Map<number, number>();
const departures = new Map<number, number>();

/** Steps the game and records the first tick on which each nuke moved. */
function step(ticks: number) {
  for (let i = 0; i < ticks; i++) {
    game.executeNextTick();
    for (const u of attacker.units(UnitType.AtomBomb)) {
      if (!startTiles.has(u.id())) startTiles.set(u.id(), u.tile());
      else if (u.tile() !== startTiles.get(u.id()) && !departures.has(u.id())) {
        departures.set(u.id(), game.ticks());
      }
    }
  }
}

describe("MissileSilo departure stagger", () => {
  // Reserve `level` nukes at once, then one more while the earlier ones still
  // wait to depart. The silo drops matured cooldown entries meanwhile, so the
  // stagger must not be rebuilt from that queue.
  test.each([90, 91])(
    "level %i silo never departs two nukes on the same tick",
    async (level) => {
      await setupSilo(level);
      startTiles.clear();
      departures.clear();
      queueNukes(level);
      step(90);
      queueNukes(1);
      step(level + 20);
      const ticks = [...departures.values()];
      expect(ticks).toHaveLength(level + 1);
      expect(new Set(ticks).size).toBe(ticks.length);
    },
  );
});

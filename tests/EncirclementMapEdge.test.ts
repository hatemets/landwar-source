import { TileRef } from "@openfront/engine-api/game/GameMap";
import { PlayerInfo, PlayerType } from "@openfront/engine-api/game/GameTypes";
import { PlayerExecution } from "@openfront/engine/execution/PlayerExecution";
import { Game, Player } from "@openfront/engine/game/Game";
import { setup } from "./util/Setup";
import { executeTicks } from "./util/utils";

// plains is a 100x100 all-land map without water, so the map edge is the
// only boundary. The map edge counts as a wall when judging encirclement.
let game: Game;
let p: Player;
let o: Player;

beforeEach(async () => {
  game = await setup("plains", {}, [
    new PlayerInfo("p", PlayerType.Human, "c1", "p_id"),
    new PlayerInfo("o", PlayerType.Human, "c2", "o_id"),
  ]);
  p = game.player("p_id");
  o = game.player("o_id");
  game.addExecution(new PlayerExecution(p));
  game.addExecution(new PlayerExecution(o));
});

function rect(x0: number, y0: number, x1: number, y1: number): TileRef[] {
  const out: TileRef[] = [];
  for (let x = x0; x <= x1; x++) {
    for (let y = y0; y <= y1; y++) out.push(game.ref(x, y));
  }
  return out;
}

// p has a large main body plus a small pocket; o fills the ring around the
// pocket. Cluster calc runs, then a tile change wakes it up again.
function run(pocket: TileRef[], ring: TileRef[]) {
  for (const t of rect(40, 40, 59, 59)) p.conquer(t);
  for (const t of pocket) p.conquer(t);
  for (const t of ring) {
    if (game.ownerID(t) === 0) o.conquer(t);
  }
  executeTicks(game, 20);
  o.conquer(game.ref(90, 90));
  p.conquer(game.ref(60, 40));
  executeTicks(game, 50);
}

describe("encirclement at the map edge", () => {
  test("pocket on the top edge is captured", () => {
    const pocket = rect(10, 0, 12, 2);
    run(pocket, rect(8, 0, 14, 4));
    for (const t of pocket) expect(game.ownerID(t)).toBe(o.smallID());
  });

  test("pocket in a corner is captured", () => {
    const pocket = rect(0, 0, 2, 2);
    run(pocket, rect(0, 0, 4, 4));
    for (const t of pocket) expect(game.ownerID(t)).toBe(o.smallID());
  });

  test("pocket on the right edge is captured", () => {
    const pocket = rect(97, 20, 99, 22);
    run(pocket, rect(95, 18, 99, 24));
    for (const t of pocket) expect(game.ownerID(t)).toBe(o.smallID());
  });

  test("the only cluster, in a corner, is captured", () => {
    const land = rect(0, 0, 4, 4);
    for (const t of land) p.conquer(t);
    for (const t of rect(0, 0, 6, 6)) {
      if (game.ownerID(t) === 0) o.conquer(t);
    }
    executeTicks(game, 20);
    o.conquer(game.ref(90, 90));
    p.conquer(game.ref(90, 91));
    executeTicks(game, 50);
    for (const t of land) expect(game.ownerID(t)).toBe(o.smallID());
  });

  test("pocket on the edge next to unclaimed edge land is kept", () => {
    const pocket = rect(10, 0, 12, 2);
    // (13, 0) is unclaimed land on the edge: a way out.
    const ring = rect(8, 0, 14, 4).filter((t) => t !== game.ref(13, 0));
    run(pocket, ring);
    for (const t of pocket) expect(game.ownerID(t)).toBe(p.smallID());
  });

  test("pocket away from the edge is still captured", () => {
    const pocket = rect(10, 10, 12, 12);
    run(pocket, rect(8, 8, 14, 14));
    for (const t of pocket) expect(game.ownerID(t)).toBe(o.smallID());
  });
});

// half_land_half_ocean is 16x16 with land on x 0..7, so x = 7 is shore.
describe("encirclement on a coast", () => {
  beforeEach(async () => {
    game = await setup("half_land_half_ocean", {}, [
      new PlayerInfo("p", PlayerType.Human, "c1", "p_id"),
      new PlayerInfo("o", PlayerType.Human, "c2", "o_id"),
    ]);
    p = game.player("p_id");
    o = game.player("o_id");
    game.addExecution(new PlayerExecution(p));
    game.addExecution(new PlayerExecution(o));
  });

  function runSmall(pocket: TileRef[], ring: TileRef[]) {
    for (const t of rect(2, 10, 5, 15)) p.conquer(t);
    for (const t of pocket) p.conquer(t);
    for (const t of ring) {
      if (game.ownerID(t) === 0) o.conquer(t);
    }
    executeTicks(game, 20);
    o.conquer(game.ref(4, 8));
    p.conquer(game.ref(6, 10));
    executeTicks(game, 50);
  }

  test("pocket on the left edge is captured", () => {
    const pocket = rect(0, 3, 1, 5);
    runSmall(pocket, rect(0, 2, 3, 6));
    for (const t of pocket) expect(game.ownerID(t)).toBe(o.smallID());
  });

  test("pocket on the shore is kept", () => {
    const pocket = rect(6, 3, 7, 5);
    runSmall(pocket, rect(4, 2, 7, 6));
    for (const t of pocket) expect(game.ownerID(t)).toBe(p.smallID());
  });
});

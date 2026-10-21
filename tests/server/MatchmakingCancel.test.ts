import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GameType, RankedType } from "@openfront/engine-api/game/GameTypes";
import { Client } from "../../src/server/Client";
import { GamePhase } from "../../src/server/GameServer";
import {
  makeClient as harnessClient,
  makeGame,
} from "../util/GameServerHarness";

function makeClient(clientID: string, persistentID: string): Client {
  return harnessClient({
    clientID,
    persistentID,
    username: "TestUser",
    publicId: `pub-${persistentID}`,
  });
}

describe("GameServer - short-handed matchmade game cancellation", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  function makeRankedGame(rankedType: RankedType, maxPlayers: number) {
    return makeGame({
      config: { gameType: GameType.Public, rankedType, maxPlayers },
      startsAt: Date.now() + 15000,
    });
  }

  it("cancels a 1v1 game where the opponent never connected", () => {
    const game = makeRankedGame(RankedType.OneVOne, 2);
    expect(game.joinClient(makeClient("c1", "p1"))).toBe("joined");

    expect(game.cancelShortHandedMatch()).toBe(true);
    expect(game.phase()).toBe(GamePhase.Finished);
  });

  it("does not cancel a ranked game with full attendance", () => {
    const game = makeRankedGame(RankedType.OneVOne, 2);
    expect(game.joinClient(makeClient("c1", "p1"))).toBe("joined");
    expect(game.joinClient(makeClient("c2", "p2"))).toBe("joined");

    expect(game.cancelShortHandedMatch()).toBe(false);
    expect(game.phase()).not.toBe(GamePhase.Finished);
  });

  it("does not cancel unknown ranked types — new modes must opt in", () => {
    const game = makeRankedGame(RankedType.OneVOne, 4);
    expect(game.joinClient(makeClient("c1", "p1"))).toBe("joined");
    // Swapped in after the join: an unknown ranked type can never reach a real
    // server (CreateGameInput validates it, and the binary wire only encodes
    // declared enum members), so this pokes the guard directly.
    (game.gameConfig as any).rankedType = "3v3";

    expect(game.cancelShortHandedMatch()).toBe(false);
  });

  it("does not cancel non-ranked games, even short-handed", () => {
    const game = makeGame({
      config: { gameType: GameType.Public, maxPlayers: 4 },
      startsAt: Date.now() + 15000,
    });
    expect(game.joinClient(makeClient("c1", "p1"))).toBe("joined");

    expect(game.cancelShortHandedMatch()).toBe(false);
  });
});

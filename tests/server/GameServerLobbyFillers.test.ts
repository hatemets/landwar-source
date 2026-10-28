import { GameType } from "@openfront/engine-api/game/GameTypes";
import { GamePhase } from "../../src/server/GameServer";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FILLER_CHURN_MAX_MS } from "../../src/server/LobbyFillers";
import { makeClient, makeGame, startGame } from "../util/GameServerHarness";

function publicGame(maxPlayers = 15) {
  return makeGame({
    config: { gameType: GameType.Public, maxPlayers },
    publicGameType: "ffa",
  });
}

describe("GameServer lobby fillers", () => {
  it("lists 4 or 5 filled seats in an empty scheduled lobby", () => {
    const game = publicGame();
    const seats = game.gameInfo().clients ?? [];
    expect(seats.length).toBeGreaterThanOrEqual(4);
    expect(seats.length).toBeLessThanOrEqual(5);
    expect(game.numSeatedFillers()).toBe(seats.length);
    expect(game.numClients()).toBe(0);
  });

  it("lists real players beside the fillers", () => {
    const game = publicGame();
    const fillers = game.numSeatedFillers();
    const client = makeClient();
    expect(game.joinClient(client)).toBe("joined");
    const seats = game.gameInfo().clients ?? [];
    expect(seats).toHaveLength(fillers + 1);
    expect(seats[0]!.clientID).toBe(client.clientID);
  });

  it("gives a filler's seat to a real player when the lobby is full", () => {
    const game = publicGame(6);
    const fillers = game.numSeatedFillers();
    for (let i = 0; i < 6; i++) {
      expect(game.joinClient(makeClient())).toBe("joined");
      expect(game.numSeatedFillers()).toBe(Math.min(fillers, 6 - (i + 1)));
      expect(game.gameInfo().clients!.length).toBe(
        i + 1 + game.numSeatedFillers(),
      );
    }
    expect(game.numSeatedFillers()).toBe(0);
  });

  it("puts the seated fillers in the start info", () => {
    const game = publicGame();
    const names = game
      .gameInfo()
      .clients!.map((c) => c.username)
      .sort();
    game.joinClient(makeClient());
    startGame(game);
    const start = (game as any).gameStartInfo;
    expect(
      start.fillers.map((f: { username: string }) => f.username).sort(),
    ).toEqual(names);
  });

  describe("churn", () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    const names = (game: ReturnType<typeof publicGame>) =>
      game.gameInfo().clients!.map((c) => c.username);

    it("has a filler leave or join two or three times a minute", () => {
      vi.useFakeTimers({ now: 1_000_000 });
      const game = publicGame(50);
      const before = names(game);
      // Nothing changes before the first wait is over.
      game.churnFillers(Date.now() + 1000);
      expect(names(game)).toEqual(before);

      let now = Date.now();
      let changes = 0;
      let last = before;
      // One call a second, as GameManager ticks, for ten minutes.
      for (let s = 0; s < 600; s++) {
        now += 1000;
        game.churnFillers(now);
        const current = names(game);
        if (current.join() !== last.join()) {
          changes++;
          expect(Math.abs(current.length - last.length)).toBe(1);
        }
        last = current;
      }
      expect(changes).toBeGreaterThanOrEqual(20);
      expect(changes).toBeLessThanOrEqual(34);
    });

    it("stops once the game starts", () => {
      const game = publicGame();
      game.joinClient(makeClient());
      startGame(game);
      const start = (game as any).gameStartInfo.fillers;
      const seats = game.numSeatedFillers();
      game.churnFillers(Date.now() + 10 * FILLER_CHURN_MAX_MS);
      expect(game.numSeatedFillers()).toBe(seats);
      expect((game as any).gameStartInfo.fillers).toEqual(start);
    });

    it("never adds fillers to a private lobby", () => {
      const game = makeGame();
      game.churnFillers(Date.now() + 10 * FILLER_CHURN_MAX_MS);
      expect(game.numSeatedFillers()).toBe(0);
    });
  });

  it("starts once real players and seated fillers fill every seat", () => {
    const game = publicGame(5);
    expect(game.numSeatedFillers()).toBe(4);
    expect(game.phase()).toBe(GamePhase.Lobby);
    game.joinClient(makeClient());
    expect(game.gameInfo().clients).toHaveLength(5);
    expect(game.phase()).toBe(GamePhase.Active);
  });

  it("does not start while a seat is still free", () => {
    const game = publicGame(15);
    game.joinClient(makeClient());
    expect(game.phase()).toBe(GamePhase.Lobby);
  });

  it("fills an open lobby over time, also one that starts empty", () => {
    vi.useFakeTimers({ now: 1_000_000 });
    try {
      for (let i = 0; i < 10; i++) {
        const game = makeGame({
          config: { gameType: GameType.Public, maxPlayers: 15 },
          publicGameType: "hosted",
        });
        expect(game.numSeatedFillers()).toBeLessThanOrEqual(5);
        game.churnFillers(Date.now() + FILLER_CHURN_MAX_MS);
        game.churnFillers(Date.now() + 2 * FILLER_CHURN_MAX_MS + 1000);
        expect(game.numSeatedFillers()).toBeGreaterThan(0);
      }
    } finally {
      vi.useRealTimers();
    }
  });

  it("never fills a player-hosted lobby", () => {
    const game = makeGame({ publicGameType: "hosted" });
    game.churnFillers(Date.now() + 10 * FILLER_CHURN_MAX_MS);
    expect(game.numSeatedFillers()).toBe(0);
  });

  it("never fills a private lobby", () => {
    const game = makeGame();
    expect(game.numSeatedFillers()).toBe(0);
    expect(game.gameInfo().clients).toEqual([]);
  });
});

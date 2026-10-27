import { GameType } from "@openfront/engine-api/game/GameTypes";
import { describe, expect, it } from "vitest";
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

  it("never fills a private lobby", () => {
    const game = makeGame();
    expect(game.numSeatedFillers()).toBe(0);
    expect(game.gameInfo().clients).toEqual([]);
  });
});

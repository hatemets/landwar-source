import type { GameStartInfo } from "@openfront/engine-api/Schemas";
import { EventBus } from "@openfront/shared/EventBus";
import type { ClientMessage } from "@openfront/shared/WireSchemas";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("src/client/ClientEnv", () => ({
  ClientEnv: {
    turnIntervalMs: vi.fn(() => 100),
    gitCommit: vi.fn(() => "DEV"),
  },
}));

import { LocalServer } from "../../src/client/LocalServer";

const CLIENT_ID = "abCD1234";

function makeGameStartInfo(): GameStartInfo {
  return {
    gameID: "gameID12",
    lobbyCreatedAt: 1000,
    config: {
      gameMap: "Africa",
      difficulty: "Medium",
      donateGold: false,
      donateTroops: false,
      gameType: "Singleplayer",
      gameMode: "Free For All",
      gameMapSize: "Normal",
      nations: "default",
      bots: 400,
      infiniteGold: false,
      infiniteTroops: false,
      instantBuild: false,
      randomSpawn: false,
    },
    players: [
      {
        clientID: CLIENT_ID,
        username: "TestUser",
        clanTag: null,
      },
    ],
  } as GameStartInfo;
}

function makeServer(isReplay: boolean): LocalServer {
  const server = new LocalServer(
    {
      gameStartInfo: makeGameStartInfo(),
      playerName: "TestUser",
      playerClanTag: null,
    } as any,
    isReplay,
    new EventBus(),
  );
  server.updateCallback(
    () => {},
    () => {},
  );
  return server;
}

const winnerMsg: ClientMessage = {
  type: "winner",
  winner: ["player", CLIENT_ID],
  allPlayersStats: { [CLIENT_ID]: { attacks: [100n] } },
};

// Kleopolis has no singleplayer archive endpoint, so a finished singleplayer
// game must not be uploaded anywhere.
describe("LocalServer archiving", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn(async () => new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uploads nothing at win time or at endGame", async () => {
    const server = makeServer(false);
    server.start();
    server.onMessage(winnerMsg);
    server.endGame();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const uploads = fetchMock.mock.calls.filter(([url]) =>
      String(url).includes("archive"),
    );
    expect(uploads).toEqual([]);
  });
});

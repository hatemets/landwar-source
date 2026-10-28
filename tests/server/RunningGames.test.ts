import { describe, expect, it } from "vitest";
import { GameManager } from "../../src/server/GameManager";
import { zeroCounters } from "../../src/server/telemetry/MatchTelemetry";
import {
  cid,
  makeClient,
  mockLogger,
  mockWsOf,
  startGame,
} from "../util/GameServerHarness";

const telemetry = {
  emit: () => "enqueued" as const,
  counters: zeroCounters,
  stop: () => {},
};

// infra/vm/deploy.sh waits for this count to reach 0 before it restarts the
// server, so it counts only started games that a player is still in.
describe("GameManager.runningGames", () => {
  it("counts started games with a connected player, not lobbies or empty games", () => {
    const manager = new GameManager(mockLogger(), telemetry);
    const lobby = manager.createGame(cid("lobby"), undefined)!;
    lobby.joinClient(makeClient());

    const running = manager.createGame(cid("run"), undefined)!;
    running.joinClient(makeClient());
    startGame(running);

    const abandoned = manager.createGame(cid("gone"), undefined)!;
    const left = makeClient();
    abandoned.joinClient(left);
    startGame(abandoned);
    expect(manager.runningGames()).toBe(2);

    mockWsOf(left).trigger("close");
    expect(manager.runningGames()).toBe(1);
  });
});

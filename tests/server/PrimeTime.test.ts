import { maps } from "@openfront/engine-api/game/GameTypes";
import { GameConfigSchema } from "@openfront/engine-api/Schemas";
import { nextPrimeTime, PRIME_TIME_LEAD_MS } from "@openfront/shared/PrimeTime";
import { SCHEDULED_PUBLIC_GAME_TYPES } from "@openfront/shared/WireSchemas";
import EventEmitter from "events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MapPlaylist, PRIME_TIME_MAPS } from "../../src/server/MapPlaylist";
import { MasterLobbyService } from "../../src/server/MasterLobbyService";
import { startPolling } from "../../src/server/PollingLoop";
import { ServerEnv } from "../../src/server/ServerEnv";

vi.mock("../../src/server/MapLandTiles", () => ({
  getMapLandTiles: async () => 2_000_000,
}));

vi.mock("../../src/server/Logger", () => ({
  logger: { child: () => ({ error: vi.fn(), info: vi.fn(), warn: vi.fn() }) },
}));

vi.mock("../../src/server/PollingLoop", () => ({
  startPolling: vi.fn(),
}));

const utc = (iso: string) => Date.parse(iso);

describe("nextPrimeTime", () => {
  it("picks 19:00 Paris (CET, UTC+1) in winter", () => {
    const slot = nextPrimeTime(utc("2026-01-15T12:00:00Z"));
    expect(slot.startsAt).toBe(utc("2026-01-15T18:00:00Z"));
    expect(slot.window.zoneLabel).toBe("CET");
  });

  it("follows Paris summer time (CEST, UTC+2)", () => {
    const slot = nextPrimeTime(utc("2026-07-15T12:00:00Z"));
    expect(slot.startsAt).toBe(utc("2026-07-15T17:00:00Z"));
  });

  it("picks 19:00 New York after the Paris match has started", () => {
    // 19:00 EST is 00:00 UTC the next day.
    const slot = nextPrimeTime(utc("2026-01-15T18:00:00Z"));
    expect(slot.startsAt).toBe(utc("2026-01-16T00:00:00Z"));
    expect(slot.window.zoneLabel).toBe("ET");
  });

  it("rolls over to the next day's Paris match", () => {
    const slot = nextPrimeTime(utc("2026-01-16T00:00:00Z"));
    expect(slot.startsAt).toBe(utc("2026-01-16T18:00:00Z"));
  });

  it("handles the day the US clocks change but Europe's have not", () => {
    // 8 March 2026: New York is on EDT (UTC-4), Paris still on CET.
    const slot = nextPrimeTime(utc("2026-03-08T19:00:00Z"));
    expect(slot.startsAt).toBe(utc("2026-03-08T23:00:00Z"));
  });
});

describe("MapPlaylist prime time", () => {
  it("is not a queue the master tops up", () => {
    expect(SCHEDULED_PUBLIC_GAME_TYPES).not.toContain("primetime");
  });

  it("only uses real-world maps", () => {
    const fake = ["fictional", "cosmic", "arcade", "tournament"];
    for (const map of PRIME_TIME_MAPS) {
      const info = maps.find((m) => m.type === map);
      expect(info, map).toBeDefined();
      expect(
        info!.categories.some((c) => fake.includes(c)),
        map,
      ).toBe(false);
    }
  });

  it("is a plain FFA at the map's full size, every map once per cycle", async () => {
    const playlist = new MapPlaylist();
    const seen = new Set();
    for (let i = 0; i < PRIME_TIME_MAPS.length; i++) {
      const config = await playlist.primeTimeConfig();
      expect(GameConfigSchema.safeParse(config).success).toBe(true);
      expect(config.gameMode).toBe("Free For All");
      expect(config.maxPlayers).toBe(100);
      expect(config.nations).toBe("default");
      expect(config.bots).toBeGreaterThan(0);
      seen.add(config.gameMap);
    }
    expect(seen.size).toBe(PRIME_TIME_MAPS.length);
  });
});

describe("MasterLobbyService prime time", () => {
  let worker: EventEmitter & { send: ReturnType<typeof vi.fn> };
  let service: MasterLobbyService;

  const scheduler = () =>
    vi.mocked(startPolling).mock.calls.find(([, ms]) => ms === 1000)![0];
  const primeTimeCreates = () =>
    worker.send.mock.calls
      .map(([msg]) => msg)
      .filter(
        (msg) =>
          msg.type === "createGame" && msg.publicGameType === "primetime",
      );

  beforeEach(() => {
    vi.stubEnv("DOMAIN", "localhost");
    vi.spyOn(ServerEnv, "numWorkers").mockReturnValue(1);
    const playlist = {
      gameConfig: vi.fn(async () => ({})),
      primeTimeConfig: vi.fn(async () => ({})),
      openLobbyConfig: vi.fn(async () => ({})),
    };
    service = new MasterLobbyService(
      playlist as any,
      {
        info: vi.fn(),
        error: vi.fn(),
      } as any,
    );
    worker = new EventEmitter() as typeof worker;
    worker.send = vi.fn();
    service.registerWorker(0, worker as any);
    worker.emit("message", { type: "workerReady", workerId: 0 });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.mocked(startPolling).mockClear();
  });

  it("creates nothing while the next start is more than the lead away", async () => {
    vi.useFakeTimers({ now: utc("2026-01-15T12:00:00Z") });
    await scheduler()();
    expect(primeTimeCreates()).toHaveLength(0);
  });

  it("opens one lobby with the fixed start inside the lead window", async () => {
    const start = utc("2026-01-15T18:00:00Z");
    vi.useFakeTimers({ now: start - PRIME_TIME_LEAD_MS + 1000 });
    await scheduler()();
    await scheduler()();
    const creates = primeTimeCreates();
    expect(creates).toHaveLength(1);
    expect(creates[0].startsAt).toBe(start);
  });

  it("does not open a second lobby when a worker already has one", async () => {
    const start = utc("2026-01-15T18:00:00Z");
    vi.useFakeTimers({ now: start - 60_000 });
    worker.emit("message", {
      type: "lobbyList",
      lobbies: [
        {
          gameID: "PRIME001",
          publicGameType: "primetime",
          numClients: 3,
          startsAt: start,
          createdAt: 1,
        },
      ],
    });
    await scheduler()();
    expect(primeTimeCreates()).toHaveLength(0);
  });

  it("opens nothing on an inactive deployment", async () => {
    vi.useFakeTimers({ now: utc("2026-01-15T17:50:00Z") });
    service.setActive(false);
    await scheduler()();
    expect(primeTimeCreates()).toHaveLength(0);
  });
});

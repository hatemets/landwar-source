import { RankedType } from "@openfront/engine-api/game/GameTypes";
import type { UserMeResponse } from "@openfront/shared/ApiSchemas";
import type { Mock } from "vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const apiMocks = vi.hoisted(() => ({
  getUserMe: vi.fn(),
  invalidateUserMe: vi.fn(),
}));

const alertMocks = vi.hoisted(() => ({
  construct: vi.fn(),
  play: vi.fn(),
}));

vi.mock("howler", () => ({
  Howl: class {
    constructor(options: unknown) {
      alertMocks.construct(options);
    }

    play() {
      return alertMocks.play();
    }
  },
}));

// The two ClientEnv reads the version check below depends on: this bundle's
// commit, and the commit the matched game's server runs (the API's list).
const envMocks = vi.hoisted(() => ({
  siteHost: vi.fn((): string | undefined => "openfront.test"),
  gitCommit: vi.fn(() => "bfd5563a11111111111111111111111111111111"),
  gameVersion: vi.fn((_gameID: string): string | undefined => undefined),
}));

// Deliberately NOT mocking the identity predicate. The previous version of
// this file stubbed it to `() => true`, which is precisely why these tests
// stayed green while Steam-only players were being hard-rejected from ranked
// (OPE-260). The gate is exercised for real below.
vi.mock("../../src/client/Api", () => ({
  getUserMe: apiMocks.getUserMe,
  invalidateUserMe: apiMocks.invalidateUserMe,
}));

vi.mock("../../src/client/Auth", () => ({
  getPlayToken: vi.fn(async () => "play-token"),
}));

vi.mock("../../src/client/ClientEnv", () => ({
  ClientEnv: {
    instanceId: vi.fn(() => "test-instance"),
    jwtIssuer: vi.fn(() => "ws://matchmaking.test"),
    workerPath: vi.fn(() => "w0"),
    gitCommit: envMocks.gitCommit,
    gameVersion: envMocks.gameVersion,
    siteHost: envMocks.siteHost,
    gamePath: vi.fn((gameID: string) => `/w0/game/${gameID}`),
    gameHttpBase: vi.fn(() => "https://falk2-a.openfront.io"),
    gameWorkerPath: vi.fn(() => "w0"),
  },
}));

// Only the network half is stubbed. redirectToGameVersion is the real
// decision -- it is the thing under test below, and stubbing it would prove
// nothing about which games actually navigate.
vi.mock("../../src/client/ServerList", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/client/ServerList")>()),
  ensureServerList: vi.fn(async () => "api" as const),
}));

vi.mock("../../src/client/Utils", () => ({
  translateText: vi.fn((key: string) => key),
}));

import { MatchmakingModal } from "../../src/client/Matchmaking";
import {
  type MatchmakingMode,
  matchmakingModeFor,
} from "../../src/client/MatchmakingModes";
import { UserSettings } from "../../src/client/UserSettings";

class FakeWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 3;

  readonly url: string;
  readyState = FakeWebSocket.CONNECTING;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onclose: ((event: { code: number; reason: string }) => void) | null = null;

  constructor(url: string | URL) {
    this.url = String(url);
    sockets.push(this);
  }

  open() {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.();
  }

  send(data: string) {
    this.sent.push(data);
  }

  close() {
    this.readyState = FakeWebSocket.CLOSED;
  }

  serverClose(code: number, reason: string) {
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.({ code, reason });
  }
}

const sockets: FakeWebSocket[] = [];

function userMe(
  user: UserMeResponse["user"] = {
    email: "player@example.com",
  } as UserMeResponse["user"],
): UserMeResponse {
  return {
    user,
    steamLicence: false,
    steamLicenceSince: null,
    noticesSeen: [],
    player: {
      publicId: "player-id",
      adfree: false,
      unlimitedRanked: false,
      canCreatePublicLobbies: false,
      achievements: { singleplayerMap: [], player: [] },
      friends: [],
      subscription: null,
    },
  };
}

function installClanSelection(tag: string | null) {
  const input = document.createElement("div") as HTMLDivElement & {
    getClanTag: () => string | null;
    clearClanTag: ReturnType<typeof vi.fn>;
  };
  input.setAttribute("data-test-username-input", "");
  input.getClanTag = () => tag;
  input.clearClanTag = vi.fn();
  vi.spyOn(document, "querySelector").mockImplementation((selector) =>
    selector === "username-input" ? input : null,
  );
  return input;
}

async function openAndJoin(mode: MatchmakingMode) {
  const modal = new MatchmakingModal();
  modal.mode = mode;
  modal.open();
  await vi.waitFor(() => expect(sockets).toHaveLength(1));

  sockets[0].open();
  await vi.advanceTimersByTimeAsync(2000);
  expect(sockets[0].sent).toHaveLength(1);
  return {
    modal,
    socket: sockets[0],
    message: JSON.parse(sockets[0].sent[0]) as Record<string, unknown>,
  };
}

// The ranked lockout (OPE-260). A Steam-only account is a real, authenticated
// session, but the retired `hasLinkedAccount` predicate had no steam term, so
// this gate rejected it: must_login toast, modal closed, redirect to the
// account page — with no way through. Steam-only is the default state for
// anyone who buys on Steam and never links another provider.
describe("MatchmakingModal identity gate", () => {
  let showPage: Mock<(page: string) => void>;
  let showMessage: Mock<(event: Event) => void>;

  beforeEach(() => {
    vi.useFakeTimers();
    sockets.length = 0;
    apiMocks.getUserMe.mockReset();
    apiMocks.invalidateUserMe.mockReset();
    vi.stubGlobal("WebSocket", FakeWebSocket);
    showPage = vi.fn<(page: string) => void>();
    (window as unknown as { showPage: unknown }).showPage = showPage;
    showMessage = vi.fn<(event: Event) => void>();
    window.addEventListener("show-message", showMessage);
    installClanSelection(null);
  });

  afterEach(() => {
    window.removeEventListener("show-message", showMessage);
    delete (window as unknown as { showPage?: unknown }).showPage;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  async function openWith(response: UserMeResponse | false) {
    apiMocks.getUserMe.mockResolvedValue(response);
    const modal = new MatchmakingModal();
    modal.mode = "1v1";
    modal.open();
    await vi.waitFor(() => expect(apiMocks.getUserMe).toHaveBeenCalled());
    await vi.advanceTimersByTimeAsync(0);
    return modal;
  }

  it("admits an email account to ranked matchmaking", async () => {
    await openWith(userMe());

    await vi.waitFor(() => expect(sockets).toHaveLength(1));
    expect(showPage).not.toHaveBeenCalled();
  });

  it("still rejects a genuinely absent session", async () => {
    const modal = await openWith(false);

    await vi.waitFor(() =>
      expect(showPage).toHaveBeenCalledWith("page-account"),
    );
    expect(sockets).toHaveLength(0);
    expect(modal.isOpen()).toBe(false);
    expect(showMessage).toHaveBeenCalledOnce();
  });

  it("still rejects a session with no linked identity at all", async () => {
    const modal = await openWith(userMe({} as UserMeResponse["user"]));

    await vi.waitFor(() =>
      expect(showPage).toHaveBeenCalledWith("page-account"),
    );
    expect(sockets).toHaveLength(0);
    expect(modal.isOpen()).toBe(false);
  });
});

/**
 * What close() actually does, as opposed to who calls it.
 *
 * Main.blockedJoin calls this modal's close() when it refuses a matchmade
 * join -- on desktop, over a pending update or a lapsed session; backend
 * reachability is not a funnel input (OPE-439) -- and the tests for that spy
 * on close() because their claim is which joins reach it. That spy is only worth anything if the real close()
 * genuinely takes the player out of the queue -- so that half is pinned here,
 * against a real modal and its real socket, where it belongs.
 *
 * The queue is in-memory on the server and keyed to the socket, so "left the
 * queue" IS "the socket is shut". The timers matter just as much: the
 * watchdog exists to reconnect through a dropped connection, and a watchdog
 * left running after a close would put the player straight back in the queue
 * they just left.
 */
describe("MatchmakingModal.close() teardown", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    sockets.length = 0;
    apiMocks.getUserMe.mockReset();
    apiMocks.invalidateUserMe.mockReset();
    vi.stubGlobal("WebSocket", FakeWebSocket);
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("shuts the queue socket and cancels the watchdog", async () => {
    apiMocks.getUserMe.mockResolvedValue(userMe());
    const { modal, socket } = await openAndJoin("1v1");
    expect(socket.readyState).toBe(FakeWebSocket.OPEN);

    modal.close();

    expect(socket.readyState).toBe(FakeWebSocket.CLOSED);
    // The watchdog fires after 15s of server silence and reconnects, which
    // would open a second socket and re-queue the player. Well past that and
    // past every reconnect backoff, there is still only the one.
    await vi.advanceTimersByTimeAsync(60_000);
    expect(sockets).toHaveLength(1);
  });

  it("does not reconnect when the server's close frame lands afterwards", async () => {
    // Shutting a socket produces a close frame, and the ordinary handling of
    // one is "the service restarted, rejoin". After a deliberate close that
    // would silently put the player back in the queue they were just taken
    // out of, which is the failure mode intentionalClose exists to prevent.
    apiMocks.getUserMe.mockResolvedValue(userMe());
    const { modal, socket } = await openAndJoin("1v1");

    modal.close();
    socket.serverClose(1011, "");

    await vi.advanceTimersByTimeAsync(60_000);
    expect(sockets).toHaveLength(1);
  });
});

// A match can land on a server running another build, and being bounced at
// join time costs a ranked game its start deadline (OPE-471). The question
// is asked exactly once: /exists has said there is a game, nothing has been
// joined yet.
describe("MatchmakingModal opens the match at its server's version", () => {
  const OWN = "bfd5563a11111111111111111111111111111111";
  const OLD = "5ccc50a722222222222222222222222222222222";
  // What `/v/<commit>/` carries: the bucket layout and the static Worker
  // both key on the first 7 characters.
  const SHORT_OLD = "5ccc50a";
  const GAME_ID = "cAbCd12345";

  const realLocation = window.location;
  let fetchMock: ReturnType<typeof vi.fn>;

  function stubLocation(host: string, pathname = "/") {
    const loc = {
      protocol: "https:",
      host,
      hostname: host,
      pathname,
      search: "",
      href: `https://${host}${pathname}`,
    };
    Object.defineProperty(window, "location", {
      value: loc,
      writable: true,
      configurable: true,
    });
    return loc;
  }

  // Drives a modal from an empty queue to just after checkGame has seen the
  // match's game exist.
  async function matchAndCheck() {
    const joined = vi.fn();
    const { modal, socket } = await openAndJoin("1v1");
    modal.addEventListener("join-lobby", joined);

    socket.onmessage!({
      data: JSON.stringify({ type: "match-assignment", gameId: GAME_ID }),
    });
    await vi.advanceTimersByTimeAsync(1000);

    return { modal, joined };
  }

  beforeEach(() => {
    vi.useFakeTimers();
    sockets.length = 0;
    apiMocks.getUserMe.mockReset();
    apiMocks.getUserMe.mockResolvedValue(userMe());
    apiMocks.invalidateUserMe.mockReset();
    envMocks.gitCommit.mockReturnValue(OWN);
    envMocks.gameVersion.mockReturnValue(undefined);
    vi.stubGlobal("WebSocket", FakeWebSocket);
    fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ exists: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "info").mockImplementation(() => {});
    delete (window as unknown as { openfrontDesktop?: unknown })
      .openfrontDesktop;
    stubLocation("openfront.io");
  });

  afterEach(() => {
    Object.defineProperty(window, "location", {
      value: realLocation,
      writable: true,
      configurable: true,
    });
    delete (window as unknown as { openfrontDesktop?: unknown })
      .openfrontDesktop;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("joins directly when the match landed on this build", async () => {
    envMocks.gameVersion.mockReturnValue(OWN);
    const loc = stubLocation("openfront.io");

    const { joined } = await matchAndCheck();

    expect(joined).toHaveBeenCalledOnce();
    expect((joined.mock.calls[0][0] as CustomEvent).detail).toMatchObject({
      gameID: GAME_ID,
      source: "matchmaking",
    });
    expect(loc.href).toBe("https://openfront.io/");
  });

  it("goes to the game's version instead of joining on another build", async () => {
    envMocks.gameVersion.mockReturnValue(OLD);
    const loc = stubLocation("openfront.io");

    const { joined } = await matchAndCheck();

    expect(loc.href).toBe(`/v/${SHORT_OLD}/game/${GAME_ID}`);
    expect(joined).not.toHaveBeenCalled();
  });

  // Another beat would fire a second /exists, and a second navigation, at a
  // page already on its way out.
  it("stops polling once it has navigated", async () => {
    envMocks.gameVersion.mockReturnValue(OLD);

    await matchAndCheck();
    expect(fetchMock).toHaveBeenCalledOnce();

    await vi.advanceTimersByTimeAsync(5000);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("joins when no version is known for the game", async () => {
    // Navigating on a guess is worse than joining and finding out.
    envMocks.gameVersion.mockReturnValue(undefined);
    const loc = stubLocation("openfront.io");

    const { joined } = await matchAndCheck();

    expect(joined).toHaveBeenCalledOnce();
    expect(loc.href).toBe("https://openfront.io/");
  });

  // replay.<domain> has no /v/<commit>/ routes, so that would 404.
  it("never navigates a replay shell", async () => {
    envMocks.gameVersion.mockReturnValue(OLD);
    const loc = stubLocation("replay.openfront.io");

    const { joined } = await matchAndCheck();

    expect(joined).toHaveBeenCalledOnce();
    expect(loc.href).toBe("https://replay.openfront.io/");
  });
});

// The shared queue is partitioned by build (OPE-470), so the join has to
// say which one this page is. A value that names no commit is left off: the
// API rejects a malformed version with a 400.
describe("MatchmakingModal queue join carries the page's build", () => {
  const OWN = "bfd5563a11111111111111111111111111111111";

  beforeEach(() => {
    vi.useFakeTimers();
    sockets.length = 0;
    apiMocks.getUserMe.mockReset();
    apiMocks.getUserMe.mockResolvedValue(userMe());
    envMocks.gitCommit.mockReturnValue(OWN);
    vi.stubGlobal("WebSocket", FakeWebSocket);
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    envMocks.gitCommit.mockReturnValue(OWN);
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("sends the commit this page was built from", async () => {
    const { socket } = await openAndJoin("1v1");

    expect(socket.url).toBe(
      `ws://${window.location.host}/matchmaking/join?instance_id=test-instance&mode=1v1&version=${OWN}&site=openfront.test`,
    );
  });

  it("omits the version for a build that names no commit", async () => {
    envMocks.gitCommit.mockReturnValue("DEV");

    const { socket } = await openAndJoin("1v1");

    expect(socket.url).toBe(
      `ws://${window.location.host}/matchmaking/join?instance_id=test-instance&mode=1v1&site=openfront.test`,
    );
  });
});

// infra #738: the API keeps one ranked queue per SITE, so a match can only
// land on a server this page's list resolves. The site is the one the list
// is read for (serverListSite), not the document host.
describe("MatchmakingModal queue join carries the page's site", () => {
  const OWN = "bfd5563a11111111111111111111111111111111";

  beforeEach(() => {
    vi.useFakeTimers();
    sockets.length = 0;
    apiMocks.getUserMe.mockReset();
    apiMocks.getUserMe.mockResolvedValue(userMe());
    envMocks.gitCommit.mockReturnValue(OWN);
    vi.stubGlobal("WebSocket", FakeWebSocket);
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    envMocks.siteHost.mockReturnValue("openfront.test");
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("sends the site whose server list this page reads", async () => {
    envMocks.siteHost.mockReturnValue("beta.openfront.test");

    const { socket } = await openAndJoin("1v1");

    expect(socket.url).toContain("&site=beta.openfront.test");
  });

  it("omits the site when it is not a name the API accepts", async () => {
    // The API refuses a malformed site rather than ignoring it, so a dev
    // page's host:port must not reach the join URL.
    envMocks.siteHost.mockReturnValue("localhost:9000");

    const { socket } = await openAndJoin("1v1");

    expect(socket.url).not.toContain("site=");
  });
});

describe("MatchmakingModal game-start alert", () => {
  const notificationTitles: string[] = [];
  const closeNotification = vi.fn();

  class FakeNotification {
    static permission: NotificationPermission = "default";
    static requestPermission = vi.fn(async () => "granted" as const);

    onclick: ((event: Event) => void) | null = null;
    close = closeNotification;

    constructor(title: string) {
      notificationTitles.push(title);
    }
  }

  let modal: MatchmakingModal | null = null;

  beforeEach(() => {
    vi.useFakeTimers();
    sockets.length = 0;
    apiMocks.getUserMe.mockReset().mockResolvedValue(userMe());
    apiMocks.invalidateUserMe.mockReset();
    alertMocks.construct.mockReset();
    alertMocks.play.mockReset();
    notificationTitles.length = 0;
    closeNotification.mockReset();
    FakeNotification.permission = "default";
    FakeNotification.requestPermission.mockClear();
    localStorage.clear();
    const statics = UserSettings as unknown as {
      cache: Map<string, string | null>;
      playerId: string | null;
    };
    statics.cache.clear();
    statics.playerId = null;
    vi.stubGlobal("WebSocket", FakeWebSocket);
    vi.stubGlobal("Notification", FakeNotification);
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    modal?.close();
    modal?.remove();
    modal = null;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("uses the lobby bell and alerts only after a ranked match is assigned", async () => {
    const joined = await openAndJoin("1v1");
    modal = joined.modal;
    document.body.append(modal);
    await modal.updateComplete;

    const bell = modal.querySelector<HTMLButtonElement>(
      '[aria-label="public_lobby.notify_off"]',
    );
    expect(bell).not.toBeNull();
    expect(bell?.getAttribute("aria-pressed")).toBe("false");

    bell?.click();
    await modal.updateComplete;

    expect(FakeNotification.requestPermission).toHaveBeenCalledOnce();
    expect(alertMocks.construct).toHaveBeenCalledWith({
      src: ["/sounds/effects/game-start.mp3"],
    });
    expect(
      modal.querySelector('[aria-label="public_lobby.notify_on"]'),
    ).not.toBeNull();

    // Queueing alone is not a game start. The shared event is ignored until
    // matchmaking has actually assigned this modal a game.
    document.dispatchEvent(new CustomEvent("game-starting"));
    expect(alertMocks.play).not.toHaveBeenCalled();

    joined.socket.onmessage?.({
      data: JSON.stringify({
        type: "match-assignment",
        gameId: "cAbCd12345",
      }),
    });
    FakeNotification.permission = "granted";
    document.dispatchEvent(new CustomEvent("game-starting"));

    expect(alertMocks.play).toHaveBeenCalledOnce();
    expect(notificationTitles).toEqual(["public_lobby.notify_started"]);
  });

  it("stays armed across a cancellation requeue but resets when leaving", async () => {
    const joined = await openAndJoin("1v1");
    modal = joined.modal;
    document.body.append(modal);
    await modal.updateComplete;

    modal
      .querySelector<HTMLButtonElement>(
        '[aria-label="public_lobby.notify_off"]',
      )
      ?.click();
    await modal.updateComplete;

    joined.socket.onmessage?.({
      data: JSON.stringify({
        type: "match-assignment",
        gameId: "cAbCd12345",
      }),
    });
    expect(modal.requeue()).toBe(true);
    await modal.updateComplete;
    expect(
      modal.querySelector('[aria-label="public_lobby.notify_on"]'),
    ).not.toBeNull();

    modal.close();
    await modal.updateComplete;
    expect(
      modal.querySelector('[aria-label="public_lobby.notify_off"]'),
    ).not.toBeNull();
  });

  it("arms from the saved default without a toast or permission prompt", async () => {
    new UserSettings().setLobbyStartAlerts(true);
    const dispatchSpy = vi.spyOn(window, "dispatchEvent");
    const joined = await openAndJoin("1v1");
    modal = joined.modal;
    document.body.append(modal);
    await modal.updateComplete;

    expect(
      modal.querySelector('[aria-label="public_lobby.notify_on"]'),
    ).not.toBeNull();
    expect(alertMocks.construct).toHaveBeenCalledOnce();
    expect(FakeNotification.requestPermission).not.toHaveBeenCalled();
    expect(
      dispatchSpy.mock.calls.filter(
        ([event]) => (event as Event).type === "show-message",
      ),
    ).toHaveLength(0);

    joined.socket.onmessage?.({
      data: JSON.stringify({
        type: "match-assignment",
        gameId: "cAbCd12345",
      }),
    });
    document.dispatchEvent(new CustomEvent("game-starting"));

    expect(alertMocks.play).toHaveBeenCalledOnce();
    // The setting is a default, not a lock: the bell still turns it off.
    modal
      .querySelector<HTMLButtonElement>('[aria-label="public_lobby.notify_on"]')
      ?.click();
    await modal.updateComplete;
    expect(
      modal.querySelector('[aria-label="public_lobby.notify_off"]'),
    ).not.toBeNull();
    expect(new UserSettings().lobbyStartAlerts()).toBe(true);
  });
});

// Each queue is its own ladder: the socket's URL picks the queue, and the
// Elo shown is the one for that queue.
describe("MatchmakingModal queue modes", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    sockets.length = 0;
    apiMocks.getUserMe.mockReset();
    const me = userMe();
    me.player.leaderboard = {
      oneVone: { elo: 1100 },
      threeVthree: { elo: 1250 },
    };
    apiMocks.getUserMe.mockResolvedValue(me);
    vi.stubGlobal("WebSocket", FakeWebSocket);
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  const eloOf = (modal: MatchmakingModal) =>
    (modal as unknown as { elo: number | string }).elo;
  const switchMode = (modal: MatchmakingModal, mode: MatchmakingMode) =>
    (
      modal as unknown as { switchMode: (m: MatchmakingMode) => void }
    ).switchMode(mode);

  it.each(["3v3", "5v5"] as const)("joins the %s queue", async (mode) => {
    const { socket } = await openAndJoin(mode);
    expect(new URL(socket.url).searchParams.get("mode")).toBe(mode);
  });

  it("shows the Elo of the open queue's ladder", async () => {
    const { modal } = await openAndJoin("3v3");
    expect(eloOf(modal)).toBe(1250);
    switchMode(modal, "1v1");
    expect(eloOf(modal)).toBe(1100);
    switchMode(modal, "5v5");
    expect(eloOf(modal)).toBe("matchmaking_modal.no_elo");
  });

  it("leaves the old queue and joins the new one on a switch", async () => {
    const { modal, socket } = await openAndJoin("1v1");
    switchMode(modal, "5v5");
    expect(socket.readyState).toBe(FakeWebSocket.CLOSED);
    await vi.waitFor(() => expect(sockets).toHaveLength(2));
    expect(new URL(sockets[1]!.url).searchParams.get("mode")).toBe("5v5");
    sockets[1]!.open();
    await vi.advanceTimersByTimeAsync(2000);
    expect(sockets[1]!.sent).toHaveLength(1);
    // The old socket's handlers are gone: no reconnect into the old queue.
    await vi.advanceTimersByTimeAsync(60_000);
    expect(
      sockets.every(
        (s, i) => i === 0 || new URL(s.url).searchParams.get("mode") === "5v5",
      ),
    ).toBe(true);
  });

  it("keeps the queue once a match is assigned", async () => {
    const { modal, socket } = await openAndJoin("3v3");
    socket.onmessage?.({
      data: JSON.stringify({ type: "match-assignment", gameId: "abcd1234" }),
    });
    switchMode(modal, "1v1");
    expect(modal.mode).toBe("3v3");
    expect(sockets).toHaveLength(1);
    modal.close();
  });
});

describe("matchmakingModeFor", () => {
  it("maps each matchmade ranked type to its queue", () => {
    expect(matchmakingModeFor(RankedType.OneVOne)).toBe("1v1");
    expect(matchmakingModeFor(RankedType.ThreeVThree)).toBe("3v3");
    expect(matchmakingModeFor(RankedType.FiveVFive)).toBe("5v5");
    expect(matchmakingModeFor(RankedType.FreeForAll)).toBeNull();
    expect(matchmakingModeFor(undefined)).toBeNull();
  });
});

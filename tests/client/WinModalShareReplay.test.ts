import { GameType } from "@openfront/engine-api/game/GameTypes";
import { GameUpdateType } from "@openfront/engine-api/game/GameUpdates";
import { EventBus } from "@openfront/shared/EventBus";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "../../src/client/hud/layers/WinModal";
import type { WinModal } from "../../src/client/hud/layers/WinModal";
import type { GameView } from "../../src/client/view";

vi.mock("../../src/client/Utils", () => ({
  translateText: vi.fn((key: string) => key),
  getTranslatedPlayerTeamLabel: vi.fn((team: string | null) => team ?? ""),
  homeHref: vi.fn(() => "/"),
  copyToClipboard: vi.fn(async () => {}),
  showToast: vi.fn(),
}));

vi.mock("../../src/client/Analytics", () => ({ track: vi.fn() }));

import { track } from "../../src/client/Analytics";
import { ClientEnv } from "../../src/client/ClientEnv";
import { copyToClipboard, showToast } from "../../src/client/Utils";

type Winner = ["team", string] | ["player", string] | undefined;

function makeGame(opts: {
  winner: Winner;
  gameType?: GameType;
  alive?: boolean;
}): GameView {
  const winUpdate = { winner: opts.winner, allPlayersStats: {} };
  return {
    myPlayer: () => ({
      isAlive: () => opts.alive ?? true,
      hasSpawned: () => true,
      team: () => "Blue",
      clientID: () => "me",
    }),
    gameID: () => "AbCd1234",
    inSpawnPhase: () => false,
    updatesSinceLastTick: () => ({ [GameUpdateType.Win]: [winUpdate] }),
    playerByClientID: () => undefined,
    config: () => ({
      gameConfig: () => ({
        rankedType: undefined,
        gameType: opts.gameType ?? GameType.Public,
      }),
    }),
  } as unknown as GameView;
}

describe("WinModal share replay", () => {
  let modal: WinModal | undefined;

  async function setup(game: GameView): Promise<WinModal> {
    modal = document.createElement("win-modal") as WinModal;
    modal.game = game;
    modal.eventBus = new EventBus();
    document.body.appendChild(modal);
    modal.tick();
    await modal.updateComplete;
    return modal;
  }

  const shareButton = () =>
    modal!.querySelector<HTMLButtonElement>("[data-win-action='share-replay']");

  const expectedUrl = () =>
    `${ClientEnv.shareOrigin()}${ClientEnv.gamePath("AbCd1234")}`;

  beforeEach(() => {
    (window as { BOOTSTRAP_CONFIG?: unknown }).BOOTSTRAP_CONFIG = {
      gameEnv: "prod",
      numWorkers: 1,
      turnstileSiteKey: "x",
      jwtAudience: "kleopolis.com",
      instanceId: "d",
      gitCommit: "t",
    };
    ClientEnv.reset();
  });

  afterEach(() => {
    delete (window as { BOOTSTRAP_CONFIG?: unknown }).BOOTSTRAP_CONFIG;
    ClientEnv.reset();
    modal?.remove();
    modal = undefined;
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it("shows after a win and copies the /game/<id> link", async () => {
    await setup(makeGame({ winner: ["team", "Blue"] }));
    const button = shareButton();
    expect(button).not.toBeNull();
    expect(button!.textContent!.trim()).toBe("win_modal.share_replay");
    expect(expectedUrl()).toBe(`${window.location.origin}/w0/game/AbCd1234`);

    button!.click();

    await vi.waitFor(() =>
      expect(track).toHaveBeenCalledWith("replay_shared", { method: "copy" }),
    );
    expect(copyToClipboard).toHaveBeenCalledWith(expectedUrl());
    expect(showToast).toHaveBeenCalledWith(
      "win_modal.replay_link_copied",
      "green",
    );
  });

  it("keeps match_ended tracking alongside the share event", async () => {
    await setup(makeGame({ winner: ["team", "Blue"] }));
    expect(track).toHaveBeenCalledWith(
      "match_ended",
      expect.objectContaining({ result: "win" }),
    );
  });

  it("uses the native share sheet on a touch device", async () => {
    const share = vi.fn(async () => {});
    vi.stubGlobal("navigator", { ...navigator, share });
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({ matches: true })),
    );
    await setup(makeGame({ winner: ["team", "Blue"] }));

    shareButton()!.click();

    await vi.waitFor(() =>
      expect(track).toHaveBeenCalledWith("replay_shared", {
        method: "native",
      }),
    );
    expect(share).toHaveBeenCalledWith(
      expect.objectContaining({ url: expectedUrl() }),
    );
    expect(copyToClipboard).not.toHaveBeenCalled();
  });

  it("is hidden for a cancelled match", async () => {
    await setup(makeGame({ winner: undefined }));
    expect(modal!.isVisible).toBe(true);
    expect(shareButton()).toBeNull();
  });

  it("is hidden for a singleplayer game, which has no record", async () => {
    await setup(
      makeGame({ winner: ["team", "Blue"], gameType: GameType.Singleplayer }),
    );
    expect(modal!.isVisible).toBe(true);
    expect(shareButton()).toBeNull();
  });

  it("is hidden on the death screen before the game is decided", async () => {
    modal = document.createElement("win-modal") as WinModal;
    const game = makeGame({ winner: undefined, alive: false });
    (game as { updatesSinceLastTick: () => object }).updatesSinceLastTick =
      () => ({});
    modal.game = game;
    modal.eventBus = new EventBus();
    document.body.appendChild(modal);
    modal.tick();
    await modal.updateComplete;
    expect(modal.isVisible).toBe(true);
    expect(shareButton()).toBeNull();
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@lit-labs/virtualizer/virtualize.js", async () => {
  const { html } = await import("lit");
  return {
    virtualize: vi.fn(() => html``),
  };
});

vi.mock("../../src/client/Utils", () => ({
  translateText: vi.fn((key: string) => {
    const translations: Record<string, string> = {
      "leaderboard_modal.win_score_tooltip":
        "Weighted wins based on clan participation and match difficulty",
      "leaderboard_modal.loss_score_tooltip":
        "Weighted losses based on clan participation and match difficulty",
      "leaderboard_modal.title": "Leaderboard",
      "leaderboard_modal.ranked_tab": "Ranked",
      "leaderboard_modal.ranked_2v2_tab": "2v2 Ranked",
      "leaderboard_modal.ranked_no_stats": "No ranked games on this ladder",
      "leaderboard_modal.clans_tab": "Clans",
      "leaderboard_modal.refresh_time": "Refreshed every 1 hour",
      "leaderboard_modal.error": "Something went wrong",
      "leaderboard_modal.rank": "Rank",
      "leaderboard_modal.clan": "Clan",
      "leaderboard_modal.games": "Games",
      "leaderboard_modal.win_score": "Win Score",
      "leaderboard_modal.loss_score": "Loss Score",
      "leaderboard_modal.win_loss_ratio": "W/L",
      "leaderboard_modal.ratio": "Ratio",
      "leaderboard_modal.elo": "Elo",
      "leaderboard_modal.player": "Player",
      "common.loading": "Loading",
      "leaderboard_modal.try_again": "Try Again",
      "leaderboard_modal.no_data_yet": "No data yet",
      "leaderboard_modal.no_stats": "No stats",
      "leaderboard_modal.your_ranking": "Your ranking",
      "common.close": "Close",
    };
    return translations[key] || key;
  }),
}));

vi.mock("../../src/client/Api", async () => {
  // Share the real end-of-list matcher so this mock cannot drift from it.
  const { isPageBoundsMessage } = await vi.importActual<
    typeof import("../../src/client/Api")
  >("../../src/client/Api");
  const getApiBase = () => "http://localhost:3000";
  return {
    getApiBase: vi.fn(getApiBase),
    getUserMe: vi.fn(async () => false),
    isPageBoundsMessage,
    // Mirrors the control flow of the real fetchPlayerLeaderboard.
    fetchPlayerLeaderboard: vi.fn(async (page: number) => {
      const url = new URL(`${getApiBase()}/leaderboard/ranked`);
      url.searchParams.set("page", String(page));
      const res = await fetch(url.toString(), {
        headers: { Accept: "application/json" },
      });
      if (!res.ok) {
        if (res.status === 400) {
          const body = await res.json().catch(() => null);
          if (isPageBoundsMessage(body)) return "reached_limit";
        }
        return false;
      }
      return res.json();
    }),
    // Mirrors the real fetchTribeLeaderboard: page 1, plus page 2 only when
    // page 1 came back exactly full.
    fetchTribeLeaderboard: vi.fn(async () => {
      const load = async (page: number) => {
        const url = new URL(`${getApiBase()}/leaderboard/tribes`);
        url.searchParams.set("page", String(page));
        const res = await fetch(url.toString(), {
          headers: { Accept: "application/json" },
        });
        return res.ok ? res.json() : false;
      };
      const first = await load(1);
      if (first === false || first.tribes.length < 50) return first;
      const second = await load(2);
      if (second === false) return first;
      return { ...first, tribes: [...first.tribes, ...second.tribes] };
    }),
  };
});

const jsonRes = (data: any, ok = true, status = 200) => ({
  ok,
  status,
  json: async () => data,
});

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: any) => {
      const url =
        typeof input === "string" ? input : (input?.url ?? String(input));

      if (url.includes("/public/clans/leaderboard")) {
        return jsonRes({ start: "...", end: "...", clans: [] });
      }
      if (url.includes("/leaderboard/ranked")) {
        return jsonRes({ "1v1": [], ffa: [] });
      }
      if (url.includes("/leaderboard/tribes")) {
        return jsonRes({
          windowDays: 30,
          start: "2026-06-27",
          end: "2026-07-27",
          tribes: [],
        });
      }
      return jsonRes({}, false, 404);
    }),
  );
});

import { RankedType } from "@openfront/engine-api/game/GameTypes";
import "../../src/client/components/baseComponents/Modal";
import { LeaderboardModal } from "../../src/client/LeaderboardModal";

describe("LeaderboardModal", () => {
  let modal: LeaderboardModal;
  const getPlayerList = () =>
    modal.querySelector("leaderboard-player-list") as {
      loadPlayerLeaderboard: (reset?: boolean) => Promise<void>;
      updateComplete: Promise<unknown>;
      rankedType: RankedType;
      playerData: Array<Record<string, unknown>>;
      currentUserEntry?: { playerId: string } | null;
      showStickyUser: boolean;
    } | null;
  // The list element is shared by both ladder tabs; the modal drives which
  // ladder it shows off the active tab.
  const showLadder = async (tab: string) => {
    (modal as unknown as { activeTab: string }).activeTab = tab;
    await modal.updateComplete;
    const playerList = getPlayerList()!;
    await playerList.updateComplete;
    return playerList;
  };

  beforeEach(async () => {
    vi.stubGlobal("fetch", vi.fn());
    if (!customElements.get("leaderboard-modal")) {
      customElements.define("leaderboard-modal", LeaderboardModal);
    }
    modal = document.createElement("leaderboard-modal") as LeaderboardModal;
    document.body.appendChild(modal);
    await modal.updateComplete;
  });

  afterEach(() => {
    document.body.removeChild(modal);
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  describe("Tooltip Implementation - Issue #2508", () => {
    it("should use translateText for tooltip internationalization", async () => {
      // Verify translation keys are correct
      const { translateText } = await import("../../src/client/Utils");

      expect(translateText("leaderboard_modal.win_score_tooltip")).toBe(
        "Weighted wins based on clan participation and match difficulty",
      );
      expect(translateText("leaderboard_modal.loss_score_tooltip")).toBe(
        "Weighted losses based on clan participation and match difficulty",
      );
    });
  });

  describe("Player Data Mapping", () => {
    it("should map ranked leaderboard data and set current user entry", async () => {
      const { getUserMe } = await import("../../src/client/Api");
      (getUserMe as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        player: { publicId: "player-2" },
      });

      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          "1v1": [
            {
              rank: 1,
              elo: 1200,
              peakElo: 1300,
              wins: 6,
              losses: 4,
              total: 10,
              public_id: "player-1",
              accountUsername: "alpha.4821",
            },
            {
              rank: 2,
              elo: 1100,
              peakElo: 1250,
              wins: 4,
              losses: 6,
              total: 10,
              public_id: "player-2",
              accountUsername: null,
            },
          ],
        }),
      });

      const playerList = getPlayerList();
      expect(playerList).toBeTruthy();
      await playerList!.loadPlayerLeaderboard(true);
      await playerList!.updateComplete;

      const playerData = playerList!.playerData;

      expect(playerData).toHaveLength(2);
      expect(playerData[0]).toEqual(
        expect.objectContaining({
          playerId: "player-1",
          accountUsername: "alpha.4821",
          elo: 1200,
          games: 10,
          wins: 6,
          losses: 4,
          winRate: 0.6,
        }),
      );
      // No account username: the player-name component displays public_id.
      expect(playerData[1]).toEqual(
        expect.objectContaining({
          playerId: "player-2",
          accountUsername: null,
          winRate: 0.4,
        }),
      );
      expect(playerList!.currentUserEntry?.playerId).toBe("player-2");
      expect(modal.textContent).toContain("player-2");
    });

    // The pinned "your ranking" row has to stay inside the table — its column
    // widths come from the table's own colgroup, so anything rendered outside
    // it goes out of alignment the moment the modal is resized. The cell count
    // is what breaks if a column is added to the header and not the footer.
    it("pins the user row as a tfoot inside the table", async () => {
      const { getUserMe } = await import("../../src/client/Api");
      (getUserMe as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        player: { publicId: "player-1" },
      });

      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        jsonRes({
          "1v1": [
            {
              rank: 1,
              elo: 1200,
              peakElo: 1300,
              wins: 6,
              losses: 4,
              total: 10,
              public_id: "player-1",
              accountUsername: "alpha.4821",
            },
          ],
        }),
      );

      const playerList = getPlayerList()!;
      await playerList.loadPlayerLeaderboard(true);
      // jsdom has no layout, so the scroll-position check that normally drives
      // this always concludes the user's own row is on screen. Force it on.
      playerList.showStickyUser = true;
      await playerList.updateComplete;

      const table = modal.querySelector("leaderboard-player-list table")!;
      const tfoot = table.querySelector(":scope > tfoot");
      expect(tfoot).toBeTruthy();
      expect(tfoot!.querySelectorAll("td")).toHaveLength(
        table.querySelectorAll("thead th").length,
      );
    });

    // opacity leaves the row in flow: hiding it that way reserved a row of
    // blank space at the end of the table.
    it("removes the pinned row from the table when it is not showing", async () => {
      const { getUserMe } = await import("../../src/client/Api");
      (getUserMe as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        player: { publicId: "player-1" },
      });

      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        jsonRes({
          "1v1": [
            {
              rank: 1,
              elo: 1200,
              peakElo: 1300,
              wins: 6,
              losses: 4,
              total: 10,
              public_id: "player-1",
              accountUsername: "alpha.4821",
            },
          ],
        }),
      );

      const playerList = getPlayerList()!;
      await playerList.loadPlayerLeaderboard(true);
      playerList.showStickyUser = false;
      await playerList.updateComplete;

      expect(playerList.currentUserEntry?.playerId).toBe("player-1");
      expect(
        modal.querySelector("leaderboard-player-list table tfoot"),
      ).toBeNull();
    });
  });

  describe("Player Pagination", () => {
    const rankedPage = (count: number, startRank: number) => ({
      "1v1": Array.from({ length: count }, (_, i) => ({
        rank: startRank + i,
        elo: 2000 - (startRank + i),
        peakElo: 2000,
        wins: 5,
        losses: 5,
        total: 10,
        public_id: `player-${startRank + i}`,
        accountUsername: null,
      })),
      ffa: [],
    });

    // The body the API actually sends for a page past the end.
    const pastEnd = jsonRes(
      { error: "Bad request", message: "Page must be between 1 and 2" },
      false,
      400,
    );

    it("stops paging past the last page without showing an error", async () => {
      const fetchMock = global.fetch as ReturnType<typeof vi.fn>;
      fetchMock
        .mockResolvedValueOnce(jsonRes(rankedPage(50, 1)))
        .mockResolvedValueOnce(pastEnd);

      const playerList = getPlayerList()!;
      await playerList.loadPlayerLeaderboard(true);
      await playerList.updateComplete;
      expect(playerList.playerData).toHaveLength(50);

      await playerList.loadPlayerLeaderboard();
      await playerList.updateComplete;

      expect(playerList.playerData).toHaveLength(50);
      expect(modal.textContent).not.toContain("Try Again");

      // The end of the list is sticky: no further requests are made.
      const callCount = fetchMock.mock.calls.length;
      await playerList.loadPlayerLeaderboard();
      expect(fetchMock.mock.calls.length).toBe(callCount);
    });

    it("stops paging on a short page", async () => {
      const fetchMock = global.fetch as ReturnType<typeof vi.fn>;
      fetchMock.mockResolvedValueOnce(jsonRes(rankedPage(20, 1)));

      const playerList = getPlayerList()!;
      await playerList.loadPlayerLeaderboard(true);
      await playerList.updateComplete;

      const callCount = fetchMock.mock.calls.length;
      await playerList.loadPlayerLeaderboard();
      expect(fetchMock.mock.calls.length).toBe(callCount);
      expect(modal.textContent).not.toContain("Try Again");
    });

    // Only the page-bounds 400 means "end of data".
    it.each([
      ["500", jsonRes({}, false, 500)],
      ["unrelated 400", jsonRes({ error: "Bad request" }, false, 400)],
      [
        "400 mentioning a page",
        jsonRes(
          { error: "Bad request", message: "Invalid page parameter" },
          false,
          400,
        ),
      ],
    ])("shows Try Again when a page genuinely fails (%s)", async (_, bad) => {
      const fetchMock = global.fetch as ReturnType<typeof vi.fn>;
      fetchMock
        .mockResolvedValueOnce(jsonRes(rankedPage(50, 1)))
        .mockResolvedValueOnce(bad);

      const playerList = getPlayerList()!;
      await playerList.loadPlayerLeaderboard(true);
      await playerList.updateComplete;

      await playerList.loadPlayerLeaderboard();
      await playerList.updateComplete;

      expect(modal.textContent).toContain("Try Again");
    });
  });

  // 1v1 and FFA are independent ladders returned by one request: same player,
  // own rank and elo on each, own end of list.
  describe("Ranked ladders", () => {
    const entry = (rank: number, publicId: string, elo: number) => ({
      rank,
      elo,
      peakElo: elo,
      wins: 1,
      losses: 1,
      total: 2,
      public_id: publicId,
      accountUsername: publicId,
    });

    it("ranks a player separately on each ladder", async () => {
      const { getUserMe } = await import("../../src/client/Api");
      (getUserMe as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        player: { publicId: "player-2" },
      });

      const fetchMock = global.fetch as ReturnType<typeof vi.fn>;
      fetchMock.mockResolvedValueOnce(
        jsonRes({
          "1v1": [entry(1, "player-1", 1200), entry(2, "player-2", 1100)],
          ffa: [entry(1, "player-2", 1500), entry(2, "player-3", 1400)],
        }),
      );

      const playerList = getPlayerList()!;
      await playerList.loadPlayerLeaderboard(true);
      await playerList.updateComplete;

      expect(playerList.rankedType).toBe(RankedType.OneVOne);
      expect(playerList.playerData.map((p) => p.playerId)).toEqual([
        "player-1",
        "player-2",
      ]);
      expect(playerList.playerData[1].elo).toBe(1100);
      expect(playerList.currentUserEntry?.playerId).toBe("player-2");

      // One request filled both ladders, so switching tabs must not refetch.
      const callCount = fetchMock.mock.calls.length;
      const ffaLadder = await showLadder("playersFfa");

      expect(ffaLadder.rankedType).toBe(RankedType.FreeForAll);
      expect(ffaLadder.playerData.map((p) => p.playerId)).toEqual([
        "player-2",
        "player-3",
      ]);
      // Same player, other ladder: rank 1 at 1500 rather than rank 2 at 1100.
      expect(ffaLadder.playerData[0].rank).toBe(1);
      expect(ffaLadder.playerData[0].elo).toBe(1500);
      expect(ffaLadder.currentUserEntry?.playerId).toBe("player-2");
      expect(fetchMock.mock.calls.length).toBe(callCount);
    });

    it("shows the FFA ladder from the same request", async () => {
      const fetchMock = global.fetch as ReturnType<typeof vi.fn>;
      fetchMock.mockResolvedValueOnce(
        jsonRes({
          "1v1": [entry(1, "player-1", 1200)],
          ffa: [entry(1, "player-4", 1300), entry(2, "player-1", 1250)],
        }),
      );

      const playerList = getPlayerList()!;
      await playerList.loadPlayerLeaderboard(true);
      const callCount = fetchMock.mock.calls.length;
      const ffa = await showLadder("playersFfa");

      expect(ffa.rankedType).toBe(RankedType.FreeForAll);
      expect(ffa.playerData.map((p) => p.playerId)).toEqual([
        "player-4",
        "player-1",
      ]);
      expect(fetchMock.mock.calls.length).toBe(callCount);
    });

    it.each([
      ["players3v3", "3v3", RankedType.ThreeVThree],
      ["players5v5", "5v5", RankedType.FiveVFive],
    ] as const)(
      "shows the %s team ladder from the same request",
      async (tab, key, rankedType) => {
        const fetchMock = global.fetch as ReturnType<typeof vi.fn>;
        fetchMock.mockResolvedValueOnce(
          jsonRes({
            "1v1": [entry(1, "player-1", 1200)],
            ffa: [],
            [key]: [entry(1, "player-5", 1400), entry(2, "player-1", 1010)],
          }),
        );

        const playerList = getPlayerList()!;
        await playerList.loadPlayerLeaderboard(true);
        const callCount = fetchMock.mock.calls.length;
        const ladder = await showLadder(tab);

        expect(ladder.rankedType).toBe(rankedType);
        expect(ladder.playerData.map((p) => p.playerId)).toEqual([
          "player-5",
          "player-1",
        ]);
        expect(ladder.playerData[1].elo).toBe(1010);
        expect(fetchMock.mock.calls.length).toBe(callCount);
      },
    );

    it("shows empty team ladders when the API has none", async () => {
      // An API deployed before the team queues omits their keys.
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        jsonRes({ "1v1": [entry(1, "player-1", 1200)], ffa: [] }),
      );

      const playerList = getPlayerList()!;
      await playerList.loadPlayerLeaderboard(true);
      const trios = await showLadder("players3v3");

      expect(trios.playerData).toEqual([]);
      expect(modal.textContent).toContain("No ranked games on this ladder");
    });

    it("shows an empty FFA ladder when the API has none", async () => {
      // An API deployed before ranked FFA omits the key.
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        jsonRes({ "1v1": [entry(1, "player-1", 1200)], ffa: [] }),
      );

      const playerList = getPlayerList()!;
      await playerList.loadPlayerLeaderboard(true);
      const ffa = await showLadder("playersFfa");

      expect(ffa.playerData).toEqual([]);
      expect(modal.textContent).toContain("No ranked games on this ladder");
    });

    // The FFA board starts empty and has no backfill, so an empty ladder is a
    // normal state rather than a failure.
    it("shows a no data state for an empty ladder", async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        jsonRes({ "1v1": [entry(1, "player-1", 1200)], ffa: [] }),
      );

      const playerList = getPlayerList()!;
      await playerList.loadPlayerLeaderboard(true);
      await showLadder("playersFfa");

      expect(modal.textContent).toContain("No data yet");
      expect(modal.textContent).toContain("No ranked games on this ladder");
      expect(modal.querySelector("leaderboard-player-list table")).toBeNull();
    });

    it("pages the ladders independently", async () => {
      const fetchMock = global.fetch as ReturnType<typeof vi.fn>;
      fetchMock.mockResolvedValueOnce(
        jsonRes({
          "1v1": Array.from({ length: 50 }, (_, i) =>
            entry(i + 1, `solo-${i + 1}`, 2000 - i),
          ),
          // Short page: the younger ladder ends first.
          ffa: [entry(1, "duo-1", 1500)],
        }),
      );

      const playerList = getPlayerList()!;
      await playerList.loadPlayerLeaderboard(true);
      await playerList.updateComplete;
      expect(playerList.playerData).toHaveLength(50);

      fetchMock.mockResolvedValueOnce(
        jsonRes({ "1v1": [entry(51, "solo-51", 1900)], ffa: [] }),
      );
      await playerList.loadPlayerLeaderboard();
      await playerList.updateComplete;

      expect(playerList.playerData).toHaveLength(51);
      expect(fetchMock.mock.calls[1][0]).toContain("page=2");

      // The exhausted ladder keeps its row and stops asking for pages.
      const ffaLadder = await showLadder("playersFfa");
      expect(ffaLadder.playerData.map((p) => p.playerId)).toEqual(["duo-1"]);

      const callCount = fetchMock.mock.calls.length;
      await ffaLadder.loadPlayerLeaderboard();
      expect(fetchMock.mock.calls.length).toBe(callCount);
    });
  });

  describe("Modal Functionality", () => {
    it("should initialize with default state", () => {
      expect(modal).toBeTruthy();
      expect((modal as unknown as { activeTab: string }).activeTab).toBe(
        "players",
      );
    });

    it("should be a custom element", () => {
      expect(modal).toBeInstanceOf(LeaderboardModal);
      expect(modal.tagName.toLowerCase()).toBe("leaderboard-modal");
    });

    it("should close on Escape when open", async () => {
      const mockModalEl = { open: vi.fn(), close: vi.fn() };
      Object.defineProperty(modal, "modalEl", {
        get: () => mockModalEl,
        configurable: true,
      });
      (modal as unknown as { onOpen: () => void }).onOpen = vi.fn();

      modal.open();
      expect((modal as unknown as { isModalOpen: boolean }).isModalOpen).toBe(
        true,
      );

      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
      // handleKeyDown awaits confirmBeforeClose() before closing, so the close
      // is deferred to a later microtask — flush it before asserting.
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect((modal as unknown as { isModalOpen: boolean }).isModalOpen).toBe(
        false,
      );
      expect(mockModalEl.close).toHaveBeenCalled();
    });
  });
});

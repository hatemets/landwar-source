import { RankedType } from "@openfront/engine-api/game/GameTypes";
import {
  PlayerLeaderboardEntry,
  RankedLeaderboardEntry,
} from "@openfront/shared/ApiSchemas";
import { html, LitElement, nothing, PropertyValues } from "lit";
import { customElement, property, query, state } from "lit/decorators.js";
import { fetchPlayerLeaderboard, getUserMe } from "../../Api";
import { loadModal } from "../../LazyModals";
import { translateText } from "../../Utils";
import "../PlayerName";

/** One ranked ladder's loaded rows. */
interface LadderState {
  entries: PlayerLeaderboardEntry[];
  userEntry: PlayerLeaderboardEntry | null;
  hasMore: boolean;
}

// The ranked types with a player ladder.
export type PlayerLadder = RankedType.OneVOne | RankedType.FreeForAll;

const RANKED_TYPES: PlayerLadder[] = [
  RankedType.OneVOne,
  RankedType.FreeForAll,
];

/** How old the loaded ladders may get before reopening reloads them. */
const REFRESH_MS = 5 * 60_000;

const emptyLadders = (): Record<PlayerLadder, LadderState> => ({
  [RankedType.OneVOne]: { entries: [], userEntry: null, hasMore: true },
  [RankedType.FreeForAll]: { entries: [], userEntry: null, hasMore: true },
});

const toPlayerEntry = (
  entry: RankedLeaderboardEntry,
): PlayerLeaderboardEntry => ({
  rank: entry.rank,
  playerId: entry.public_id,
  accountUsername: entry.accountUsername,
  elo: entry.elo,
  games: entry.total,
  wins: entry.wins,
  losses: entry.losses,
  winRate: entry.total > 0 ? entry.wins / entry.total : 0,
  level: entry.level,
  prestige: entry.prestige,
  legend: entry.legend,
});

@customElement("leaderboard-player-list")
export class LeaderboardPlayerList extends LitElement {
  /**
   * Which ladder to display. Each ranked type is ranked independently — the
   * same player can hold a different elo and rank on each — but one request
   * returns all of them, so the other ladders ride along and are kept for
   * their own tabs.
   */
  @property({ attribute: false }) rankedType: PlayerLadder = RankedType.OneVOne;

  @state() private ladders: Record<PlayerLadder, LadderState> = emptyLadders();
  @state() private showStickyUser = false;
  @state() private isLoading = false;
  @state() private error: string | null = null;
  @state() private isLoadingMore = false;
  @state() private loadMoreError: string | null = null;

  private hasLoadedPlayers = false;
  // When the first page last arrived; reopening after REFRESH_MS reloads it.
  private loadedAt = 0;
  private readonly playerPageSize = 50;
  private currentPage = 1;
  private currentUserId: string | null = null;
  private currentUserIdLoaded = false;

  @query(".scroll-container") private scrollContainer?: HTMLElement;

  private get playerData(): PlayerLeaderboardEntry[] {
    return this.ladders[this.rankedType].entries;
  }

  private get currentUserEntry(): PlayerLeaderboardEntry | null {
    return this.ladders[this.rankedType].userEntry;
  }

  private get playerHasMore(): boolean {
    return this.ladders[this.rankedType].hasMore;
  }

  private mapLadders(
    fn: (ladder: LadderState) => LadderState,
  ): Record<PlayerLadder, LadderState> {
    const next = { ...this.ladders };
    for (const rankedType of RANKED_TYPES) {
      next[rankedType] = fn(this.ladders[rankedType]);
    }
    return next;
  }

  createRenderRoot() {
    return this;
  }

  protected updated(changed: PropertyValues) {
    if (changed.has("rankedType")) {
      // The ladders are separate lists sharing one scroll container: show the
      // newly selected one from its top rather than the other one's offset.
      if (this.scrollContainer) this.scrollContainer.scrollTop = 0;
      this.scheduleStickyVisibilityCheck();
      this.schedulePlayerFillCheck();
    }
  }

  public async ensureLoaded() {
    if (this.isLoading) return;
    if (this.hasLoadedPlayers && Date.now() - this.loadedAt < REFRESH_MS) {
      return;
    }
    await this.loadPlayerLeaderboard(true);
  }

  public async loadPlayerLeaderboard(reset = false) {
    if (reset) {
      this.currentPage = 1;
      this.loadMoreError = null;
      this.ladders = emptyLadders();
      this.showStickyUser = false;
    } else if (!this.playerHasMore) {
      return;
    }

    if (this.isLoading || this.isLoadingMore) return;

    if (reset) {
      this.isLoading = true;
      this.error = null;
    } else {
      this.isLoadingMore = true;
      this.loadMoreError = null;
    }

    try {
      const result = await fetchPlayerLeaderboard(this.currentPage);

      if (result === false) {
        throw new Error("Failed to load player leaderboard");
      }

      // Past the last page. Not an error: stop paging, leave the footer clear.
      if (result === "reached_limit") {
        this.ladders = this.mapLadders((ladder) => ({
          ...ladder,
          hasMore: false,
        }));
        this.hasLoadedPlayers = true;
        return;
      }

      if (reset && !this.currentUserIdLoaded) {
        this.currentUserIdLoaded = true;
        const userMe = await getUserMe();
        this.currentUserId = userMe ? userMe.player.publicId : null;
      }

      // One page carries a slice of every ladder, so fold them all in — even
      // the ones whose tab isn't showing.
      let receivedAny = false;
      const nextLadders = { ...this.ladders };
      for (const rankedType of RANKED_TYPES) {
        const ladder = this.ladders[rankedType];
        const nextPlayers = (result[rankedType] ?? []).map(toPlayerEntry);
        if (nextPlayers.length > 0) receivedAny = true;

        const existingIds = new Set(
          ladder.entries.map((player) => player.playerId),
        );
        nextLadders[rankedType] = {
          entries: [
            ...ladder.entries,
            ...nextPlayers.filter(
              (player) => !existingIds.has(player.playerId),
            ),
          ],
          // Ranks differ per ladder, so the pinned "your ranking" row is
          // whichever row this ladder gave the signed-in player.
          userEntry:
            ladder.userEntry ??
            nextPlayers.find(
              (player) => player.playerId === this.currentUserId,
            ) ??
            null,
          // A short page ends that ladder. The ladders run out at different
          // pages — the 2v2 board is younger and has no backfill — so this is
          // tracked per ladder rather than off the 1v1 page size.
          hasMore: ladder.hasMore && nextPlayers.length >= this.playerPageSize,
        };
      }
      this.ladders = nextLadders;
      if (reset) this.loadedAt = Date.now();

      if (receivedAny) {
        this.currentPage++;
      }

      this.hasLoadedPlayers = true;
      this.scheduleStickyVisibilityCheck();
      this.schedulePlayerFillCheck();
    } catch (err) {
      console.warn("loadPlayerLeaderboard: request failed", err);
      if (reset) {
        this.error = translateText("leaderboard_modal.error");
      } else {
        this.loadMoreError = translateText("leaderboard_modal.error");
      }
    } finally {
      if (reset) {
        this.isLoading = false;
      } else {
        this.isLoadingMore = false;
      }
    }
  }

  public handleTabActivated() {
    this.scheduleStickyVisibilityCheck();
    this.schedulePlayerFillCheck();
  }

  // Same handoff as the clan views: the profile modal's back button reopens
  // the leaderboard (its loaded pages survive the close).
  private openProfile(publicId: string) {
    loadModal("player-profile-modal").then(
      () =>
        document
          .querySelector<
            HTMLElement & { openFromLeaderboard(publicId: string): void }
          >("player-profile-modal")
          ?.openFromLeaderboard(publicId),
      (err) => console.error("player-profile-modal failed to load:", err),
    );
  }

  // TODO: consider IntersectionObserver for better visibility detection?
  private isVisible() {
    return this.isConnected && this.getClientRects().length > 0;
  }

  private updateStickyVisibility() {
    if (!this.currentUserEntry) {
      this.showStickyUser = false;
      return;
    }

    if (!this.scrollContainer || !this.isVisible()) {
      this.showStickyUser = false;
      return;
    }

    const currentRow = this.scrollContainer.querySelector(
      '[data-current-user="true"]',
    ) as HTMLElement | null;

    if (!currentRow) {
      this.showStickyUser = true;
      return;
    }

    const containerRect = this.scrollContainer.getBoundingClientRect();
    const rowRect = currentRow.getBoundingClientRect();
    const isVisible =
      rowRect.top >= containerRect.top &&
      rowRect.bottom <= containerRect.bottom;
    this.showStickyUser = !isVisible;
  }

  private scheduleStickyVisibilityCheck() {
    void this.updateComplete.then(() => {
      requestAnimationFrame(() => this.updateStickyVisibility());
    });
  }

  private handleScroll() {
    this.updateStickyVisibility();
    this.maybeLoadMorePlayers();
  }

  private maybeLoadMorePlayers() {
    if (this.isLoading || this.isLoadingMore) return;
    if (!this.playerHasMore || this.error || this.loadMoreError) return;
    if (!this.scrollContainer || !this.isVisible()) return;

    const threshold = 64 * 3;
    const scrollTop = this.scrollContainer.scrollTop;
    const containerHeight = this.scrollContainer.clientHeight;
    const scrollHeight = this.scrollContainer.scrollHeight;
    const nearBottom = scrollTop + containerHeight >= scrollHeight - threshold;

    if (containerHeight === 0 || scrollHeight === 0) return; // guard

    if (nearBottom) {
      void this.loadPlayerLeaderboard();
    }
  }

  private schedulePlayerFillCheck() {
    if (!this.playerHasMore || this.error || this.loadMoreError) return;
    void this.updateComplete.then(() => this.maybeLoadMorePlayers());
  }

  // The pinned "your ranking" row lives in the table's own <tfoot> rather than
  // in an overlay. `table-fixed w-full` stretches the colgroup widths to fill
  // the container, so the resolved widths depend on the modal size and cannot
  // be reproduced by a separate element; and below 34rem the table scrolls
  // horizontally, which an overlay outside .scroll-container would not follow.
  private renderStickyUserRow() {
    if (!this.currentUserEntry || !this.showStickyUser) return nothing;
    const entry = this.currentUserEntry;

    return html`
      <tfoot class="sticky bottom-0 z-20">
        <tr class="bg-blue-600 border-t border-blue-400/30 shadow-2xl">
          <td class="py-3 px-4 text-center">
            <div
              class="w-10 h-10 mx-auto flex items-center justify-center rounded-lg font-mono text-lg bg-white/20 text-white"
            >
              ${entry.rank}
            </div>
          </td>
          <td class="py-3 px-4">
            <div class="flex flex-col">
              <span
                class="text-[10px] uppercase font-bold text-blue-200/80 leading-tight"
                >${translateText("leaderboard_modal.your_ranking")}</span
              >
              <div class="flex items-center gap-2 min-w-0">
                <player-name
                  class="min-w-0"
                  .username=${entry.accountUsername}
                  .publicId=${entry.playerId}
                  .nameClass=${"text-white truncate text-base hover:underline"}
                  .onNameClick=${() => this.openProfile(entry.playerId)}
                ></player-name>
              </div>
            </div>
          </td>
          <td class="py-3 px-4 text-right">
            <span class="font-mono text-white font-medium">${entry.elo}</span>
          </td>
          <td class="py-3 px-4 text-right">
            <span class="font-mono text-white font-medium">${entry.games}</span>
          </td>
          <td class="py-3 px-4 text-right pr-6">
            <div class="inline-flex flex-col items-end">
              <span class="font-mono text-white"
                >${(entry.winRate * 100).toFixed(1)}%</span
              >
              <span
                class="text-[10px] uppercase text-blue-200/80 font-bold tracking-wider"
                >${translateText("leaderboard_modal.ratio")}</span
              >
            </div>
          </td>
        </tr>
      </tfoot>
    `;
  }

  private renderPlayerRow(player: PlayerLeaderboardEntry) {
    const isCurrentUser = this.currentUserEntry?.playerId === player.playerId;
    const displayRank = player.rank;

    const rankColor =
      {
        1: "text-yellow-400 bg-yellow-400/10 ring-1 ring-yellow-400/20",
        2: "text-slate-300 bg-slate-400/10 ring-1 ring-slate-400/20",
        3: "text-amber-600 bg-amber-600/10 ring-1 ring-amber-600/20",
      }?.[displayRank] ?? "text-white/40 bg-white/5";

    const crown = html`<svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="currentColor"
      class="w-5 h-5"
      aria-hidden="true"
    >
      <path d="M3 7l4.5 4L12 4l4.5 7L21 7l-2 11H5L3 7zm2.2 13h13.6v2H5.2v-2z" />
    </svg>`;
    const medal = html`<svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="currentColor"
      class="w-5 h-5"
      aria-hidden="true"
    >
      <path d="M7 2h4l1 5-2.5 1.5L7 2zm6 0h4l-3.5 6.5L11 7l2-5z" />
      <circle cx="12" cy="15" r="6" />
    </svg>`;
    const rankIcon =
      { 1: crown, 2: medal, 3: medal }?.[displayRank] ?? String(displayRank);

    return html`
      <tr
        data-current-user=${isCurrentUser ? "true" : "false"}
        class="border-b border-white/5 hover:bg-white/[0.07] transition-colors group ${isCurrentUser
          ? "bg-blue-500/15"
          : ""}"
      >
        <td class="py-3 px-4 text-center">
          <div
            class="w-10 h-10 mx-auto flex items-center justify-center rounded-lg font-mono text-lg ${rankColor}"
          >
            ${rankIcon}
          </div>
        </td>
        <td class="py-3 px-4">
          <div class="flex items-center gap-2">
            <player-name
              class="min-w-0"
              .username=${player.accountUsername}
              .publicId=${player.playerId}
              .nameClass=${"text-blue-300 truncate text-base hover:underline"}
              .onNameClick=${() => this.openProfile(player.playerId)}
            ></player-name>
          </div>
        </td>
        <td class="py-3 px-4 text-right">
          <span class="font-mono text-white font-medium">${player.elo}</span>
        </td>
        <td class="py-3 px-4 text-right">
          <span class="font-mono text-white font-medium">${player.games}</span>
        </td>
        <td class="py-3 px-4 text-right pr-6">
          <div class="inline-flex flex-col items-end">
            <span
              class="font-mono ${player.winRate >= 0.5
                ? "text-green-400"
                : "text-red-400"}"
              >${(player.winRate * 100).toFixed(1)}%</span
            >
            <span
              class="text-[10px] uppercase text-white/30 font-bold tracking-wider"
              >${translateText("leaderboard_modal.ratio")}</span
            >
          </div>
        </td>
      </tr>
    `;
  }

  private renderPlayerFooter() {
    if (this.isLoadingMore) {
      return html`
        <div class="flex items-center justify-center py-4 text-white/50">
          <div
            class="w-4 h-4 border-2 border-blue-500/30 border-t-blue-500 rounded-full animate-spin mr-2"
          ></div>
          <span class="text-xs"> ${translateText("common.loading")} </span>
        </div>
      `;
    }

    if (this.loadMoreError) {
      return html`
        <div class="flex items-center justify-center py-4">
          <button
            class="px-4 py-2 bg-white/[0.06] hover:bg-white/[0.1] rounded-lg text-sm font-medium transition-colors"
            @click=${() => this.loadPlayerLeaderboard()}
          >
            ${translateText("leaderboard_modal.try_again")}
          </button>
        </div>
      `;
    }

    return "";
  }

  private renderLoading() {
    return html`
      <div
        class="flex flex-col items-center justify-center p-12 text-white h-full"
      >
        <div
          class="w-6 h-6 border-2 border-white/15 border-t-[var(--field-accent)] rounded-full animate-spin mb-3"
        ></div>
        <p class="text-white/50 text-sm">${translateText("common.loading")}</p>
      </div>
    `;
  }

  private renderError() {
    return html`
      <div
        class="flex flex-col items-center justify-center p-12 text-white h-full"
      >
        <div class="mb-4">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            class="h-8 w-8 text-white/40"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="1.5"
              d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
            />
          </svg>
        </div>
        <p class="mb-5 text-center text-white/70 text-sm">
          ${this.error ?? translateText("leaderboard_modal.error")}
        </p>
        <button
          class="px-4 py-2 bg-white/[0.06] hover:bg-white/[0.1] rounded-lg text-sm font-medium transition-colors"
          @click=${() => this.loadPlayerLeaderboard(true)}
        >
          ${translateText("leaderboard_modal.try_again")}
        </button>
      </div>
    `;
  }

  // An empty ladder is a normal state, not an error: a ranked type that has
  // just launched starts with no rows and fills as games are played.
  private renderNoData() {
    return html`
      <div
        class="flex flex-col items-center justify-center p-12 text-white/40 h-full"
      >
        <div class="bg-white/5 p-6 rounded-full mb-6 border border-white/5">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            class="h-16 w-16 text-white/20"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="1"
              d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
            />
          </svg>
        </div>
        <h3 class="text-xl font-bold text-white/60 mb-2">
          ${translateText("leaderboard_modal.no_data_yet")}
        </h3>
        <p class="text-white/30 text-sm">
          ${translateText("leaderboard_modal.ranked_no_stats")}
        </p>
      </div>
    `;
  }

  render() {
    if (this.isLoading && this.playerData.length === 0)
      return this.renderLoading();
    if (this.error) return this.renderError();
    if (this.hasLoadedPlayers && this.playerData.length === 0)
      return this.renderNoData();

    // Level badges mark prestiged players and Legends only (see
    // isPrestigedOrLegend for why). Rows without one keep an empty slot so
    // names line up — but only once some loaded row in this ladder has a
    // badge, so the board is unchanged until then.

    return html`
      <div class="h-full">
        <!--
          No bottom border: the pinned "your ranking" row sits flush against
          this edge, and a dark hairline under a saturated blue row reads as a
          stray outline. The rows above it end on their own border-b.
        -->
        <div
          class="h-full border-x border-t border-white/5 bg-black/20 relative"
        >
          <div
            class="scroll-container h-full overflow-y-auto overflow-x-auto scrollbar-thin scrollbar-thumb-white/20"
            @scroll=${() => this.handleScroll()}
          >
            <table class="w-full text-sm border-collapse table-fixed">
              <colgroup>
                <col style="width: 4rem" />
                <col style="width: 12rem" />
                <col style="width: 6rem" />
                <col style="width: 6rem" />
                <col style="width: 6rem" />
              </colgroup>
              <thead class="sticky top-0 z-10">
                <tr
                  class="text-white/40 text-[10px] uppercase tracking-wider border-b border-white/5 bg-gray-800"
                >
                  <th class="py-4 px-4 text-center font-bold">
                    ${translateText("leaderboard_modal.rank")}
                  </th>
                  <th class="py-4 px-4 text-left font-bold">
                    ${translateText("leaderboard_modal.player")}
                  </th>
                  <th class="py-4 px-4 text-right font-bold">
                    ${translateText("leaderboard_modal.elo")}
                  </th>
                  <th class="py-4 px-4 text-right font-bold">
                    ${translateText("leaderboard_modal.games")}
                  </th>
                  <th class="py-4 px-4 text-right font-bold pr-6">
                    ${translateText("leaderboard_modal.win_loss_ratio")}
                  </th>
                </tr>
              </thead>
              <tbody>
                ${this.playerData.map((player) => this.renderPlayerRow(player))}
              </tbody>
              ${this.renderStickyUserRow()}
            </table>
            ${this.renderPlayerFooter()}
          </div>
        </div>
      </div>
    `;
  }
}

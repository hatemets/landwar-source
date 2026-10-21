import { RankedType } from "@openfront/engine-api/game/GameTypes";
import { html } from "lit";
import { customElement, query } from "lit/decorators.js";
import { BaseModal } from "./components/BaseModal";
import "./components/leaderboard/LeaderboardPlayerList";
import type {
  LeaderboardPlayerList,
  PlayerLadder,
} from "./components/leaderboard/LeaderboardPlayerList";
import { modalHeader } from "./components/ui/ModalHeader";
import { translateText } from "./Utils";

// Tab key -> ladder. "players" stays the 1v1 tab so existing
// `#modal=leaderboard&tab=players` links keep working. The ladder tabs share
// one <leaderboard-player-list>: a page fetch returns every ladder.
const PLAYER_TABS: Record<string, PlayerLadder> = {
  players: RankedType.OneVOne,
  playersFfa: RankedType.FreeForAll,
};

@customElement("leaderboard-modal")
export class LeaderboardModal extends BaseModal {
  protected routerName = "leaderboard";

  @query("leaderboard-player-list")
  private playerList?: LeaderboardPlayerList;

  private loadToken = 0;
  private lastRankedType: PlayerLadder = RankedType.OneVOne;

  protected modalConfig() {
    return {
      tabs: [
        {
          key: "players",
          label: translateText("leaderboard_modal.ranked_tab"),
        },
        {
          key: "playersFfa",
          label: translateText("leaderboard_modal.ranked_ffa_tab"),
        },
      ],
    };
  }

  private rankedTypeFor(tab: string): PlayerLadder | null {
    return PLAYER_TABS[tab] ?? null;
  }

  protected onOpen(): void {
    this.loadActiveTabData();
  }

  protected onTabEnter(): void {
    // The player list is one element shared by the ladder tabs: keep showing
    // the last ranked type.
    this.lastRankedType =
      this.rankedTypeFor(this.activeTab) ?? this.lastRankedType;
    this.loadActiveTabData();
  }

  private loadActiveTabData() {
    const token = ++this.loadToken;

    void (async () => {
      if (!this.playerList) {
        await this.updateComplete;
      }
      if (token !== this.loadToken) return;
      await this.playerList?.ensureLoaded();
      if (token !== this.loadToken) return;
      this.playerList?.handleTabActivated();
    })();
  }

  protected renderHeaderSlot() {
    const refreshTime = html`<span
      class="text-sm font-normal text-white/40 ml-2 wrap-break-words italic"
      >(${translateText("leaderboard_modal.refresh_time")})</span
    >`;

    return modalHeader({
      titleContent: html`
        <div class="flex flex-wrap items-center gap-2">
          <span
            class="text-white text-xl sm:text-2xl font-bold uppercase tracking-widest"
          >
            ${translateText("leaderboard_modal.title")}
          </span>
          ${refreshTime}
        </div>
      `,
      onBack: () => this.close(),
      ariaLabel: translateText("common.close"),
    });
  }

  protected renderBody() {
    return html`
      <div class="flex-1 min-h-0 h-full">
        <leaderboard-player-list
          class="h-full"
          .rankedType=${this.rankedTypeFor(this.activeTab) ??
          this.lastRankedType}
        ></leaderboard-player-list>
      </div>
    `;
  }
}

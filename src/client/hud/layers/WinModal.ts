import { GameType } from "@openfront/engine-api/game/GameTypes";
import { GameUpdateType } from "@openfront/engine-api/game/GameUpdates";
import { assetUrl } from "@openfront/shared/AssetUrls";
import { EventBus } from "@openfront/shared/EventBus";
import { html, LitElement, TemplateResult } from "lit";
import { customElement, state } from "lit/decorators.js";
import {
  copyToClipboard,
  getTranslatedPlayerTeamLabel,
  homeHref,
  showToast,
  translateText,
} from "../../../client/Utils";
import { track } from "../../Analytics";
import { ClientEnv } from "../../ClientEnv";
import { useNativeShare } from "../../components/ProfileShare";
import { matchmakingModeFor } from "../../MatchmakingModes";
import { Controller } from "../../Controller";
import { PlaySoundEffectEvent } from "../../sound/Sounds";
import { SendWinnerEvent } from "../../Transport";
import { GameView } from "../../view";

@customElement("win-modal")
export class WinModal extends LitElement implements Controller {
  public game: GameView;
  public eventBus: EventBus;

  private hasShownDeathModal = false;
  // Death and then the win screen both show this modal; count one end.
  private endTracked = false;

  @state()
  isVisible = false;

  @state()
  private isWin = false;

  @state()
  private isRankedGame = false;

  // Trophy for a win, broken shield for a player's own defeat. Spectators,
  // replays and cancelled matches get none.
  @state()
  private art: "win" | "defeat" | null = null;

  // Set once the game has a winner and the server will archive its record,
  // so `/game/<id>` opens its replay. See canShareReplay.
  @state()
  private replayShareable = false;

  private _title: string;

  // Override to prevent shadow DOM creation
  createRenderRoot() {
    return this;
  }

  constructor() {
    super();
  }

  render() {
    return html`
      <div
        class="${this.isVisible
          ? "fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-gray-900 p-6 shrink-0 rounded-lg z-[10010] text-white w-[min(90vw,700px)] max-w-[90%] max-h-[90dvh] overflow-hidden flex flex-col"
          : "hidden"}"
      >
        ${this.art
          ? html`<img
              class="mx-auto mb-2 size-36 shrink-0 select-none"
              src=${assetUrl(
                this.art === "win"
                  ? "images/illustrations/Trophy.webp"
                  : "images/illustrations/Defeat.webp",
              )}
              alt=""
              aria-hidden="true"
              draggable="false"
            />`
          : null}
        <h2
          class="m-0 mb-4 text-xl font-semibold text-center text-white shrink-0"
        >
          ${this._title || ""}
        </h2>
        ${this.replayShareable
          ? html`<button
              type="button"
              data-win-action="share-replay"
              class="win-share mx-auto shrink-0"
              @click=${() => void this.shareReplay()}
            >
              ${translateText("win_modal.share_replay")}
            </button>`
          : null}
        <!-- Leaving is the quieter action, on the left; staying in the game
             is the main one, on the right. -->
        <div class="mt-4 flex flex-wrap justify-between gap-3 shrink-0">
          ${this.actionButton(
            "quiet",
            translateText("win_modal.exit"),
            () => this._handleExit(),
            "exit",
          )}
          ${this.isRankedGame
            ? this.actionButton(
                "main",
                translateText("win_modal.requeue"),
                () => this._handleRequeue(),
                "requeue",
              )
            : null}
          ${this.actionButton(
            "main",
            this.game?.myPlayer()?.isAlive()
              ? translateText("win_modal.keep")
              : translateText("win_modal.spectate"),
            () => this.hide(),
            "keep",
          )}
        </div>
        ${this.renderActionStyles()}
      </div>
    `;
  }

  // The modal's own buttons: flat fills, no border or glow. "main" is the
  // accent action (keep playing, play again); "quiet" is leaving.
  private actionButton(
    tone: "main" | "quiet",
    label: string,
    onClick: () => void,
    action: string,
  ): TemplateResult {
    return html`<button
      type="button"
      data-win-action=${action}
      class="win-action win-action-${tone} flex-1"
      @click=${onClick}
    >
      <span>${label}</span>
    </button>`;
  }

  private renderActionStyles(): TemplateResult {
    return html`<style>
      .win-action {
        display: flex;
        align-items: center;
        justify-content: center;
        height: 2.25rem;
        padding: 0 1rem;
        border-radius: 8px;
        border: none;
        color: #fff;
        font-weight: 500;
        font-size: 0.875rem;
        cursor: pointer;
        transition: background-color 150ms ease-out;
      }
      .win-action:focus-visible {
        outline: 2px solid var(--color-malibu-blue);
        outline-offset: 2px;
      }
      .win-action-main {
        background: var(--color-malibu-blue);
      }
      .win-action-main:hover {
        background: var(--color-aquarius);
      }
      .win-action-quiet {
        background: var(--color-gray-800);
      }
      .win-action-quiet:hover {
        background: var(--color-gray-700);
      }
      /* Share replay: a small text button, below the main actions' weight. */
      .win-share {
        padding: 0.25rem 0.75rem;
        border: none;
        border-radius: 6px;
        background: transparent;
        color: rgb(255 255 255 / 0.7);
        font-size: 0.8125rem;
        cursor: pointer;
        transition: color 150ms ease-out;
      }
      .win-share:hover {
        color: #fff;
      }
      .win-share:focus-visible {
        outline: 2px solid var(--color-malibu-blue);
        outline-offset: 2px;
      }
    </style>`;
  }

  show() {
    this.isRankedGame =
      this.game.config().gameConfig().rankedType !== undefined;
    if (!this.endTracked) {
      this.endTracked = true;
      track("match_ended", {
        result: this.art ?? (this.isWin ? "win" : "none"),
        ranked: this.isRankedGame,
        game_type: this.game.config().gameConfig().gameType,
      });
    }
    this.isVisible = true;
    this.requestUpdate();
  }

  hide() {
    this.isVisible = false;
    this.requestUpdate();
  }

  private _handleExit() {
    this.hide();
    window.location.href = homeHref();
  }

  // A decided game the server archives: multiplayer only, since singleplayer
  // games run on LocalServer and leave no record. A cancelled match is
  // archived too, but has nothing worth watching, so it gets no button.
  private canShareReplay(): boolean {
    return this.game.config().gameConfig().gameType !== GameType.Singleplayer;
  }

  // `/game/<id>` on the share origin: the page that opens the finished
  // game's replay and unfurls into its preview card (GamePreviewRoute).
  private replayUrl(): string {
    return `${ClientEnv.shareOrigin()}${ClientEnv.gamePath(this.game.gameID())}`;
  }

  private async shareReplay(): Promise<void> {
    const url = this.replayUrl();
    if (useNativeShare()) {
      try {
        await navigator.share({
          title: translateText("win_modal.share_replay_title"),
          url,
        });
        track("replay_shared", { method: "native" });
        return;
      } catch (err) {
        // Dismissing the sheet rejects with AbortError: nothing to do. Any
        // other failure falls back to copying the link.
        if (err instanceof DOMException && err.name === "AbortError") return;
      }
    }
    try {
      await copyToClipboard(url);
      showToast(translateText("win_modal.replay_link_copied"), "green");
      track("replay_shared", { method: "copy" });
    } catch {
      showToast(translateText("common.failed_copy"), "red");
    }
  }

  private _handleRequeue() {
    this.hide();
    track("rematch_started", { ranked: true });
    // Requeue for the same mode; Main owns the mechanism (currently a
    // reload with the requeue param, which reopens the queue after the
    // page teardown).
    const mode =
      matchmakingModeFor(this.game.config().gameConfig().rankedType) ?? "1v1";
    document.dispatchEvent(
      new CustomEvent("matchmaking-requeue", { detail: { mode } }),
    );
  }

  tick() {
    const myPlayer = this.game.myPlayer();
    if (
      !this.hasShownDeathModal &&
      myPlayer &&
      !myPlayer.isAlive() &&
      !this.game.inSpawnPhase() &&
      myPlayer.hasSpawned()
    ) {
      this.hasShownDeathModal = true;
      this._title = translateText("win_modal.died");
      this.art = "defeat";
      this.eventBus.emit(new PlaySoundEffectEvent("defeat"));
      this.show();
    }
    const updates = this.game.updatesSinceLastTick();
    const winUpdates = updates?.[GameUpdateType.Win] ?? [];
    winUpdates.forEach((wu) => {
      if (wu.winner === undefined) {
        // Match cancelled (e.g. a ranked match that didn't fill or fully
        // spawn): the game ends with no winner. Still vote the result to the
        // server so the record is archived winnerless (never ranked).
        this.eventBus.emit(new SendWinnerEvent(undefined, wu.allPlayersStats));
        this._title = translateText("win_modal.match_cancelled");
        this.isWin = false;
        this.art = null;
        this.replayShareable = false;
        history.replaceState(null, "", `${window.location.pathname}?replay`);
        this.show();
      } else if (wu.winner[0] === "team") {
        this.eventBus.emit(new SendWinnerEvent(wu.winner, wu.allPlayersStats));
        if (wu.winner[1] === this.game.myPlayer()?.team()) {
          this._title = translateText("win_modal.your_team");
          this.isWin = true;
        } else {
          this._title = translateText("win_modal.other_team", {
            team: getTranslatedPlayerTeamLabel(wu.winner[1]),
          });
          this.isWin = false;
        }
        this.art = this.outcomeArt();
        this.replayShareable = this.canShareReplay();
        this.playEndOfGameSound();
        history.replaceState(null, "", `${window.location.pathname}?replay`);
        this.show();
      } else if (wu.winner[0] === "nation") {
        this.eventBus.emit(new SendWinnerEvent(wu.winner, wu.allPlayersStats));
        this._title = translateText("win_modal.nation_won", {
          nation: wu.winner[1],
        });
        this.isWin = false;
        this.art = this.outcomeArt();
        this.replayShareable = this.canShareReplay();
        this.playEndOfGameSound();
        this.show();
      } else {
        const winner = this.game.playerByClientID(wu.winner[1]);
        if (!winner?.isPlayer()) return;
        const winnerClient = winner.clientID();
        if (winnerClient !== null) {
          this.eventBus.emit(
            new SendWinnerEvent(["player", winnerClient], wu.allPlayersStats),
          );
        }
        if (
          winnerClient !== null &&
          winnerClient === this.game.myPlayer()?.clientID()
        ) {
          this._title = translateText("win_modal.you_won");
          this.isWin = true;
        } else {
          this._title = translateText("win_modal.other_won", {
            player: winner.displayName(),
          });
          this.isWin = false;
        }
        this.art = this.outcomeArt();
        this.replayShareable = this.canShareReplay();
        this.playEndOfGameSound();
        history.replaceState(null, "", `${window.location.pathname}?replay`);
        this.show();
      }
    });
  }

  private outcomeArt(): "win" | "defeat" | null {
    if (this.isWin) return "win";
    return this.game.myPlayer()?.hasSpawned() ? "defeat" : null;
  }

  private playEndOfGameSound(): void {
    if (this.isWin) {
      this.eventBus.emit(new PlaySoundEffectEvent("victory"));
    } else if (!this.hasShownDeathModal && this.game.myPlayer()?.hasSpawned()) {
      // Spawned check: spectators and replay viewers shouldn't get a
      // personal defeat sting. The cue also already played if the player
      // died earlier (hasShownDeathModal).
      this.eventBus.emit(new PlaySoundEffectEvent("defeat"));
    }
  }
}

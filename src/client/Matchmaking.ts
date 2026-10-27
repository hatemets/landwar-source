import { CloseCode, isTerminalClose } from "@openfront/shared/CloseCodes";
import { isCommitLike } from "@openfront/shared/ServerList";
import type { UserMeResponse } from "@openfront/shared/ApiSchemas";
import { html } from "lit";
import { customElement, state } from "lit/decorators.js";
import { ClientEnv } from "src/client/ClientEnv";
import { responseHasLinkedIdentity } from "./AccountIdentity";
import { getUserMe } from "./Api";
import { track } from "./Analytics";
import { getPlayToken } from "./Auth";
import "./components/baseComponents/Button";
import { BaseModal } from "./components/BaseModal";
import { renderGlobeLoader } from "./components/ConquestGlobe";
import "./components/Difficulties";
import { GameStartAlertController } from "./components/GameStartAlertController";
import { DEFAULT_TITLE_CLASS, modalHeader } from "./components/ui/ModalHeader";
import { whenModalLoaded } from "./LazyModals";
import { MATCHMAKING_MODES, type MatchmakingMode } from "./MatchmakingModes";
import type { JoinLobbyEvent } from "./Main";
import {
  ensureServerList,
  matchmakingSite,
  redirectToGameVersion,
} from "./ServerList";
import type { SinglePlayerModal } from "./SinglePlayerModal";
import { describeSocketClose } from "./SocketClose";
import { translateText } from "./Utils";

// Where /api/me reports the Elo of each queue's ladder.
type Ladders = NonNullable<UserMeResponse["player"]["leaderboard"]>;
const LADDER_KEYS: Record<MatchmakingMode, keyof Ladders> = {
  "1v1": "oneVone",
  "3v3": "threeVthree",
  "5v5": "fiveVfive",
};

// How long a player waits alone before the queue offers a practice match
// against a bot.
export const PRACTICE_OFFER_SECONDS = 30;

type MatchmakingJoin = {
  type: "join";
  jwt: string;
};

@customElement("matchmaking-modal")
export class MatchmakingModal extends BaseModal {
  private gameCheckInterval: ReturnType<typeof setInterval> | null = null;
  private connectTimeout: ReturnType<typeof setTimeout> | null = null;
  private reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
  private watchdogTimeout: ReturnType<typeof setTimeout> | null = null;
  private practiceTimeout: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;
  private intentionalClose = false;
  // Which queue to join; set by Main from the open-matchmaking event
  // before the modal opens.
  public mode: MatchmakingMode = "1v1";
  @state() private connected = false;
  @state() private socket: WebSocket | null = null;
  @state() private gameID: string | null = null;
  // The lobby's latest queue-size broadcast.
  @state() private queueSize: { count: number } | null = null;
  @state() private offerPractice = false;
  private ladders: Ladders | null = null;
  private readonly gameStartAlert = new GameStartAlertController(
    this,
    () => this.isModalOpen && this.gameID !== null,
  );

  constructor() {
    super();
    this.id = "page-matchmaking";
  }

  createRenderRoot() {
    return this;
  }

  protected renderHeaderSlot() {
    const title = translateText("matchmaking_modal.title_mode", {
      mode: this.mode,
    });
    return modalHeader({
      titleContent: html`<span class="${DEFAULT_TITLE_CLASS}">${title}</span>
        ${this.gameStartAlert.renderBell()}`,
      onBack: () => this.close(),
      ariaLabel: translateText("common.back"),
    });
  }

  private get elo(): number | string {
    if (this.ladders === null) return "...";
    return (
      this.ladders[LADDER_KEYS[this.mode]]?.elo ??
      translateText("matchmaking_modal.no_elo")
    );
  }

  protected renderBody() {
    const eloDisplay = html`
      <p class="text-center mt-2 mb-4 text-white/60">
        ${translateText("matchmaking_modal.elo", { elo: this.elo })}
      </p>
    `;
    return html`
      <div class="flex flex-col items-center justify-center gap-6 p-6">
        <div class="flex flex-wrap items-center justify-center gap-4">
          ${this.renderModeSwitch()} ${this.renderQueueSize()}
        </div>
        ${eloDisplay} ${this.renderInner()}
      </div>
    `;
  }

  // One queue at a time. Switching leaves the old queue and joins the new
  // one. A matched player keeps the queue they were matched in.
  private renderModeSwitch() {
    const locked = this.gameID !== null;
    return html`
      <div
        role="tablist"
        aria-label=${translateText("matchmaking_modal.mode")}
        class="flex w-72 max-w-full gap-1 p-1 bg-white/5 border border-white/10 rounded-xl"
      >
        ${MATCHMAKING_MODES.map((mode) => {
          const active = mode === this.mode;
          return html`
            <button
              type="button"
              role="tab"
              aria-selected=${active}
              ?disabled=${locked && !active}
              @click=${() => this.switchMode(mode)}
              class="grow px-3 py-1.5 text-xs font-bold uppercase tracking-wider rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${active
                ? "bg-malibu-blue/20 text-aquarius border border-malibu-blue/30"
                : "text-white/50 hover:text-white hover:bg-white/5 border border-transparent"}"
            >
              ${mode}
            </button>
          `;
        })}
      </div>
    `;
  }

  private switchMode(mode: MatchmakingMode) {
    if (mode === this.mode || this.gameID !== null) return;
    track("play_clicked", { mode: `ranked_${mode}` });
    this.mode = mode;
    this.requestUpdate();
    // The server's queue is picked by the socket's URL, so reconnect.
    this.connected = false;
    this.intentionalClose = false;
    this.queueSize = null;
    this.reconnectAttempts = 0;
    this.startPracticeTimer();
    void this.connect();
  }

  private renderQueueSize() {
    if (!this.connected || this.gameID !== null || this.queueSize === null) {
      return "";
    }
    return html`
      <p class="text-sm text-white/60 whitespace-nowrap">
        ${translateText("matchmaking_modal.queue_size", {
          count: this.queueSize.count,
        })}
      </p>
    `;
  }

  private renderInner() {
    if (!this.connected) {
      return renderGlobeLoader(translateText("matchmaking_modal.connecting"));
    }
    if (this.gameID === null) {
      return html` ${this.renderSearching()} ${this.renderPracticeOffer()} `;
    } else {
      return renderGlobeLoader(
        translateText("matchmaking_modal.waiting_for_game"),
      );
    }
  }

  private renderSearching() {
    return renderGlobeLoader(translateText("matchmaking_modal.searching"));
  }

  // Few players are online at launch, so a lone player gets a way to play now
  // instead of watching the globe. The match is local and unranked.
  private renderPracticeOffer() {
    if (!this.offerPractice) return "";
    return html`
      <div class="flex flex-col items-center gap-3 text-center">
        <p class="text-sm text-white/60">
          ${translateText("matchmaking_modal.no_opponent")}
        </p>
        <o-button
          title=${translateText("matchmaking_modal.practice")}
          @click=${this.startPractice}
        ></o-button>
      </div>
    `;
  }

  private startPractice = () => {
    track("play_clicked", { mode: "practice" });
    // Leaves the queue: a player in a practice match cannot accept a match.
    this.close();
    whenModalLoaded("single-player-modal", () => {
      void (
        document.querySelector("single-player-modal") as SinglePlayerModal
      )?.startPractice();
    });
  };

  private startPracticeTimer() {
    this.clearPracticeTimer();
    this.practiceTimeout = setTimeout(() => {
      this.practiceTimeout = null;
      this.offerPractice = true;
    }, PRACTICE_OFFER_SECONDS * 1000);
  }

  private clearPracticeTimer() {
    if (this.practiceTimeout) {
      clearTimeout(this.practiceTimeout);
      this.practiceTimeout = null;
    }
    this.offerPractice = false;
  }

  // Re-enter the queue after a pre-start match cancellation (a matched
  // player never connected to the game server). The modal is normally still
  // open on "waiting for game" at that point — reset back to searching and
  // reconnect. Returns false when the modal was closed in the meantime, so
  // the caller knows nothing was rejoined.
  public requeue(): boolean {
    if (!this.isModalOpen) {
      return false;
    }
    if (this.gameCheckInterval) {
      clearInterval(this.gameCheckInterval);
      this.gameCheckInterval = null;
    }
    this.connected = false;
    this.gameID = null;
    this.intentionalClose = false;
    this.queueSize = null;
    this.reconnectAttempts = 0;
    this.startPracticeTimer();
    this.connect();
    return true;
  }

  // The lobby writes to every queued socket  // The lobby writes to every queued socket every ~3s (queue-size), so
  // prolonged silence means the connection died without a close frame
  // (locked phone, dropped wifi). Left alone, that leaves a ghost in the
  // queue and games start short-handed — only the client can detect this,
  // so reconnect. Rejoining is safe: one account holds one queue slot.
  private resetWatchdog() {
    this.clearWatchdog();
    this.watchdogTimeout = setTimeout(() => {
      console.warn("[Matchmaking] no server message for 15s, reconnecting");
      if (this.socket) {
        // A dead socket can take a long time to emit its close event;
        // detach handlers so it can't trigger a second reconnect later.
        this.socket.onclose = null;
        this.socket.onmessage = null;
        this.socket.onerror = null;
        this.socket.close();
      }
      this.connected = false;
      this.queueSize = null;
      this.connect();
    }, 15000);
  }

  private clearWatchdog() {
    if (this.watchdogTimeout) {
      clearTimeout(this.watchdogTimeout);
      this.watchdogTimeout = null;
    }
  }

  private showMatchmakingError(messageKey: string) {
    window.dispatchEvent(
      new CustomEvent("show-message", {
        detail: {
          message: translateText(messageKey),
          color: "red",
          duration: 5000,
        },
      }),
    );
  }

  private async connect() {
    // Pending timers from a previous socket must not fire on this one.
    this.clearWatchdog();
    if (this.connectTimeout) {
      clearTimeout(this.connectTimeout);
      this.connectTimeout = null;
    }
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
    // Nor may the previous socket itself: requeue()/onOpen() reset
    // intentionalClose and gameID before reconnecting, so a delayed close
    // event from the old socket would look unexpected and schedule a
    // duplicate connection — the server would then kick this one as
    // "replaced by newer connection".
    if (this.socket) {
      this.socket.onopen = null;
      this.socket.onmessage = null;
      this.socket.onerror = null;
      this.socket.onclose = null;
      if (this.socket.readyState !== WebSocket.CLOSED) {
        this.socket.close();
      }
    }
    // instance_id is the rendering server's own id, which the API ignores
    // (docs/MultiServer.md) and a static page does not have. Sent only when
    // the page carries one, rather than as an empty parameter.
    const instanceId = ClientEnv.instanceId();
    const instanceParam =
      instanceId === "" ? "" : `instance_id=${encodeURIComponent(instanceId)}&`;
    // The queue is partitioned by build (OPE-470), so a match is only ever
    // assigned on a server this page can play on. Sent only when the build
    // names a commit: the API rejects anything else, and a label like "DEV"
    // names no build to partition by.
    const ownCommit = ClientEnv.gitCommit();
    const versionParam = isCommitLike(ownCommit)
      ? `&version=${encodeURIComponent(ownCommit)}`
      : "";
    // The queue is also partitioned by SITE: a matched game id is resolved
    // through this page's server list, so the API pools this page only with
    // servers registered under the site that list is read for. Without it,
    // any server on the API that shared blue's letter and build could win
    // the match — a branch preview did, on 15 Sept 2026 — and the id would
    // point at a host this page cannot reach. Sent only when the site is a
    // name the API accepts; a page with none joins the legacy shared pool.
    const site = matchmakingSite();
    const siteParam =
      site === undefined ? "" : `&site=${encodeURIComponent(site)}`;
    // The queue runs on this site's own server.
    const wsOrigin = `${window.location.protocol === "https:" ? "wss" : "ws"}://${window.location.host}`;
    const socket = new WebSocket(
      `${wsOrigin}/matchmaking/join?${instanceParam}mode=${this.mode}${versionParam}${siteParam}`,
    );
    this.socket = socket;
    let openedAt: number | null = null;
    this.socket.onopen = async () => {
      openedAt = Date.now();
      console.log("Connected to matchmaking server");
      this.connectTimeout = setTimeout(async () => {
        if (this.socket?.readyState !== WebSocket.OPEN) {
          console.warn("[Matchmaking] socket not ready");
          return;
        }
        // Set a delay so the user can see the "connecting" message,
        // otherwise the "searching" message will be shown immediately.
        // Also wait so people who back out immediately aren't added
        // to the matchmaking queue.
        const message: MatchmakingJoin = {
          type: "join",
          jwt: await getPlayToken(),
        };
        this.socket.send(JSON.stringify(message));
        this.connected = true;
        // The server starts broadcasting queue-size once we're queued;
        // from here on, silence means the connection is dead.
        this.resetWatchdog();
        this.requestUpdate();
      }, 2000);
    };
    this.socket.onmessage = (event) => {
      console.log(event.data);
      this.resetWatchdog();
      const data = JSON.parse(event.data);
      if (data.type === "queue-size") {
        this.queueSize = { count: data.count };
        return;
      }
      if (data.type === "match-assignment") {
        this.clearWatchdog();
        this.intentionalClose = true;
        this.socket?.close();
        console.log(`matchmaking: got game ID: ${data.gameId}`);
        this.clearPracticeTimer();
        this.gameID = data.gameId;
        this.gameCheckInterval = setInterval(() => this.checkGame(), 1000);
      }
    };
    this.socket.onclose = (event: CloseEvent) => {
      const detail = `Matchmaking socket ${describeSocketClose(socket.url, event, openedAt)}`;
      if (this.intentionalClose || this.gameID !== null) {
        console.log(detail);
      } else {
        console.warn(detail);
      }
      this.clearWatchdog();
      this.queueSize = null;
      if (this.intentionalClose || this.gameID !== null) {
        return;
      }
      if (event.code === CloseCode.Normal) {
        // A newer connection for this account (e.g. a second tab) took the
        // queue slot; this socket was replaced. Do not retry.
        window.dispatchEvent(
          new CustomEvent("show-message", {
            detail: {
              message: translateText("matchmaking_modal.replaced"),
              color: "red",
              duration: 5000,
            },
          }),
        );
        this.close();
        return;
      }
      if (isTerminalClose(event.code)) {
        this.connected = false;
        this.close();
        this.showMatchmakingError("matchmaking_modal.rejected");
        return;
      }
      // 1008: the jwt was rejected — getPlayToken() refreshes expired tokens,
      // so rejoining sends a fresh one. Anything else is a server
      // restart/deploy; the queue is in-memory only, so rejoin. Back off in
      // case the failure repeats.
      this.connected = false;
      const delay = Math.min(1000 * 2 ** this.reconnectAttempts++, 15000);
      this.reconnectTimeout = setTimeout(() => this.connect(), delay);
    };
  }

  protected async onOpen(): Promise<void> {
    // Like a lobby bell, a new matchmaking session starts from the saved
    // default; a cancellation requeue keeps any per-session override.
    this.gameStartAlert.reset();
    const userMe = await getUserMe();
    // Early return if modal was closed during async operation
    if (!this.isModalOpen) {
      return;
    }

    // The `userMe === false` term is not redundant with the predicate below,
    // which also returns false for `false`: it narrows the type for the
    // leaderboard read that follows.
    if (userMe === false || !responseHasLinkedIdentity(userMe)) {
      window.dispatchEvent(
        new CustomEvent("show-message", {
          detail: {
            message: translateText("matchmaking_modal.must_login"),
            color: "red",
            duration: 3000,
          },
        }),
      );
      this.close();
      window.showPage?.("page-account");
      return;
    }

    this.ladders = userMe.player.leaderboard ?? {};

    this.connected = false;
    this.gameID = null;
    this.intentionalClose = false;
    this.queueSize = null;
    this.reconnectAttempts = 0;
    this.startPracticeTimer();
    this.connect();
  }

  protected onClose(): void {
    this.gameStartAlert.reset();
    this.connected = false;
    this.intentionalClose = true;
    this.socket?.close();
    this.clearWatchdog();
    this.clearPracticeTimer();
    if (this.connectTimeout) {
      clearTimeout(this.connectTimeout);
      this.connectTimeout = null;
    }
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
    if (this.gameCheckInterval) {
      clearInterval(this.gameCheckInterval);
      this.gameCheckInterval = null;
    }
  }

  private async checkGame() {
    if (this.gameID === null) {
      return;
    }
    // The matched game may carry any server's letter: resolve it through
    // the API's list (multi-server v2) rather than this page's own map. The
    // version check waits until the game exists, below: this poll fires
    // every second and must never navigate.
    await ensureServerList();
    const url = `${ClientEnv.gameHttpBase(this.gameID)}/${ClientEnv.gameWorkerPath(this.gameID)}/api/game/${this.gameID}/exists`;

    const response = await fetch(url, {
      method: "GET",
      headers: { "Content-Type": "application/json" },
    });

    const gameInfo = await response.json();

    if (response.status !== 200) {
      console.warn(`Error checking game ${this.gameID}: ${response.status}`);
      return;
    }

    if (!gameInfo.exists) {
      console.info(`Game ${this.gameID} does not exist or hasn't started yet`);
      return;
    }

    if (this.gameCheckInterval) {
      clearInterval(this.gameCheckInterval);
      this.gameCheckInterval = null;
    }

    // A match is made by rating, not by build, so it can land on a server
    // running another version. Open the game at that version now: being
    // bounced at join time costs a page load, which a ranked game's start
    // deadline does not allow. See docs/MultiServer.md, "Opening a game at
    // its server's version" (OPE-471).
    if (redirectToGameVersion(this.gameID)) {
      return;
    }

    this.dispatchEvent(
      new CustomEvent("join-lobby", {
        detail: {
          gameID: this.gameID,
          source: "matchmaking",
        } as JoinLobbyEvent,
        bubbles: true,
        composed: true,
      }),
    );
  }
}

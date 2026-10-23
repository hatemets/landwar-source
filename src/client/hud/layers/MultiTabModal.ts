import { GameType } from "@openfront/engine-api/game/GameTypes";
import { GameEnv } from "@openfront/shared/configuration/Env";
import { LitElement, html } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { ClientEnv } from "src/client/ClientEnv";
import { Controller } from "../../Controller";
import { MultiTabDetector } from "../../MultiTabDetector";
import { translateText } from "../../Utils";
import { GameView } from "../../view";

@customElement("multi-tab-modal")
export class MultiTabModal extends LitElement implements Controller {
  public game: GameView;

  private detector: MultiTabDetector;

  @property({ type: Number }) duration: number = 5000;
  @state() private countdown: number = 5;
  @state() private isVisible: boolean = false;
  @state() private fakeIp: string = "";
  @state() private deviceFingerprint: string = "";
  @state() private reported: boolean = true;

  private intervalId?: number;

  // Disable shadow DOM to allow Tailwind classes to work
  createRenderRoot() {
    return this;
  }

  tick() {
    if (
      this.game.inSpawnPhase() ||
      this.game.config().gameConfig().gameType === GameType.Singleplayer ||
      ClientEnv.env() === GameEnv.Dev ||
      this.game.config().isReplay()
    ) {
      return;
    }
    if (!this.detector) {
      this.detector = new MultiTabDetector();
      this.detector.startMonitoring((duration: number) => {
        this.show(duration);
      });
    }
  }

  init() {
    this.fakeIp = this.generateFakeIp();
    this.deviceFingerprint = this.generateDeviceFingerprint();
    this.reported = true;
  }

  // Generate fake IP in format xxx.xxx.xxx.xxx
  private generateFakeIp(): string {
    return Array.from({ length: 4 }, () =>
      Math.floor(Math.random() * 255),
    ).join(".");
  }

  // Generate fake device fingerprint (32 character hex)
  private generateDeviceFingerprint(): string {
    return Array.from({ length: 32 }, () =>
      Math.floor(Math.random() * 16).toString(16),
    ).join("");
  }

  // Show the modal with penalty information
  public show(duration: number): void {
    if (!this.game.myPlayer()?.isAlive()) {
      return;
    }
    this.duration = duration;
    this.countdown = Math.ceil(duration / 1000);
    this.isVisible = true;

    // Start countdown timer
    this.intervalId = window.setInterval(() => {
      this.countdown--;

      if (this.countdown <= 0) {
        this.hide();
      }
    }, 1000);

    this.requestUpdate();
  }

  // Hide the modal
  public hide(): void {
    this.isVisible = false;

    if (this.intervalId) {
      window.clearInterval(this.intervalId);
      this.intervalId = undefined;
    }

    // Dispatch event when modal is closed
    this.dispatchEvent(
      new CustomEvent("penalty-complete", {
        bubbles: true,
        composed: true,
      }),
    );

    this.requestUpdate();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    if (this.intervalId) {
      window.clearInterval(this.intervalId);
    }
  }

  render() {
    if (!this.isVisible) {
      return html``;
    }

    return html`
      <div
        class="fixed inset-0 z-50 overflow-auto bg-red-500/20 flex items-center justify-center"
      >
        <div class="relative p-6 bg-gray-900 rounded-lg max-w-md w-full m-4">
          <div class="flex items-center justify-between mb-4">
            <h2 class="text-lg font-semibold text-red-400">
              ${translateText("multi_tab.warning")}
            </h2>
            <div
              class="px-2 py-0.5 bg-red-500/15 text-red-300 text-xs font-medium rounded-sm"
            >
              RECORDING
            </div>
          </div>

          <p class="mb-4 text-sm text-gray-200">
            ${translateText("multi_tab.detected")}
          </p>

          <div class="mb-4 p-3 bg-gray-800 rounded-md text-sm tabular-nums">
            <div class="flex justify-between mb-1">
              <span class="text-gray-400">IP:</span>
              <span class="text-red-400">${this.fakeIp}</span>
            </div>
            <div class="flex justify-between mb-1">
              <span class="text-gray-400">Device Fingerprint:</span>
              <span class="text-red-400">${this.deviceFingerprint}</span>
            </div>
            <div class="flex justify-between">
              <span class="text-gray-400">Reported:</span>
              <span class="text-red-400"
                >${this.reported ? "TRUE" : "FALSE"}</span
              >
            </div>
          </div>

          <p class="mb-4 text-sm text-gray-200">
            ${translateText("multi_tab.please_wait")}
            <span class="font-semibold tabular-nums">${this.countdown}</span>
            ${translateText("multi_tab.seconds")}
          </p>

          <div class="w-full bg-gray-700 rounded-full h-2 mb-4">
            <div
              class="bg-red-500 h-2 rounded-full transition-all duration-1000 ease-linear w-(--width)"
              style="--width: ${(this.countdown / (this.duration / 1000)) *
              100}%"
            ></div>
          </div>

          <p class="text-sm text-gray-400">
            ${translateText("multi_tab.explanation")}
          </p>

          <p class="mt-3 text-xs text-red-400 font-medium">
            Repeated violations may result in permanent account suspension.
          </p>
        </div>
      </div>
    `;
  }
}

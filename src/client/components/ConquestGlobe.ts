import {
  LitElement,
  html,
  nothing,
  type PropertyValues,
  type TemplateResult,
} from "lit";
import { customElement, property, query } from "lit/decorators.js";
import type { ConquestGlobeScene } from "../globe/ConquestGlobeScene";
import type {
  GlobeFocus,
  GlobeRegionPin,
  MapRegion,
} from "../globe/MapRegions";
import { whenPageIdle } from "../WhenPageIdle";

/** Purple, black and orange, in the order they win. */
export const CONQUEST_NATION_COLORS = ["#8b5cf6", "#34343f", "#f2862e"];

const instances = new Set<ConquestGlobe>();

/** A press that moves less than this, in CSS pixels, is a click. */
const CLICK_SLOP = 6;

/** Fired when the player clicks a region pin. */
export type GlobeRegionSelectEvent = CustomEvent<{ region: MapRegion }>;

/**
 * A small globe with a status line, in place of a loading spinner. A
 * `compact` one fits a list footer or a section still loading.
 */
export function renderGlobeLoader(
  message?: string,
  { compact = false }: { compact?: boolean } = {},
): TemplateResult {
  return html`
    <div
      class="flex flex-col items-center justify-center text-[var(--field-paper)] ${compact
        ? "gap-2 py-3"
        : "gap-4 p-6 h-full min-h-[320px]"}"
      role="status"
    >
      <conquest-globe
        class="block max-w-full ${compact ? "size-20" : "size-56"}"
      ></conquest-globe>
      ${message
        ? html`<p class="text-sm text-[var(--field-muted)]">${message}</p>`
        : nothing}
    </div>
  `;
}

/**
 * The decorative conquest globe: three nations taking turns to conquer a
 * low-poly Earth. three.js and the scene load on demand (the homepage only
 * pays for them once idle), it animates only while on screen, and an
 * `exclusive` globe (a full-screen loader) pauses every other one.
 */
@customElement("conquest-globe")
export class ConquestGlobe extends LitElement {
  @property({ type: Boolean }) stars = false;
  /** Share of the smaller side the globe and its halo span, 0-1. */
  @property({ type: Number }) fill = 0.95;
  /** Raises the globe by this share of the element's height. */
  @property({ type: Number }) lift = 0;
  @property({ type: Boolean }) exclusive = false;
  /** Lets the player turn the globe by dragging it. */
  @property({ type: Boolean }) interactive = false;
  /** Shows a golden comet circling the globe, for "loading". */
  @property({ type: Boolean }) orbiting = false;
  /**
   * Region pins to stand on the globe. A click on one fires
   * `globe-region-select`; only an `interactive` globe takes clicks.
   */
  @property({ attribute: false }) pins: readonly GlobeRegionPin[] = [];
  /** A place to turn into view. */
  @property({ attribute: false }) focusOn: GlobeFocus | null = null;

  @query("canvas") private canvas!: HTMLCanvasElement;

  private scene: ConquestGlobeScene | null = null;
  private loading = false;
  private visible = false;
  private shown = false;
  private resizeObserver: ResizeObserver | null = null;
  private intersectionObserver: IntersectionObserver | null = null;
  private dragPointer: number | null = null;
  private dragX = 0;
  private dragY = 0;
  /** How far the current press has moved, to tell a click from a drag. */
  private dragDistance = 0;

  createRenderRoot() {
    return this;
  }

  /** Land share of each nation, 0-1; zeros until the scene has loaded. */
  shares(): number[] {
    return this.scene?.shares() ?? [0, 0, 0];
  }

  connectedCallback() {
    super.connectedCallback();
    instances.add(this);
    document.addEventListener("visibilitychange", this.refreshAll);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    instances.delete(this);
    document.removeEventListener("visibilitychange", this.refreshAll);
    this.resizeObserver?.disconnect();
    this.intersectionObserver?.disconnect();
    this.resizeObserver = this.intersectionObserver = null;
    this.scene?.dispose();
    this.scene = null;
    this.visible = false;
    this.shown = false;
    this.refreshAll();
  }

  firstUpdated() {
    // Without these (old browsers, jsdom) the globe stays an empty box.
    if (
      typeof ResizeObserver === "undefined" ||
      typeof IntersectionObserver === "undefined"
    ) {
      return;
    }
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this);
    this.intersectionObserver = new IntersectionObserver((entries) => {
      this.visible = entries[entries.length - 1].isIntersecting;
      if (this.visible) this.load();
      this.refreshAll();
    });
    this.intersectionObserver.observe(this);
  }

  updated(changed: PropertyValues<this>) {
    if (changed.has("orbiting")) this.scene?.setOrbiting(this.orbiting);
    if (changed.has("pins")) this.scene?.setPins(this.pins);
    if (changed.has("focusOn")) this.scene?.setFocus(this.focusOn);
  }

  render() {
    // pan-y keeps a vertical swipe scrolling the page on touch screens.
    return html`<canvas
      aria-hidden="true"
      class="block size-full opacity-0 transition-opacity duration-150 ${this
        .interactive
        ? "pointer-events-auto cursor-grab touch-pan-y active:cursor-grabbing"
        : ""}"
      @pointerdown=${this.onPointerDown}
      @pointermove=${this.onPointerMove}
      @pointerup=${this.onPointerUp}
      @pointercancel=${this.onPointerCancel}
      @pointerleave=${this.onPointerLeave}
    ></canvas>`;
  }

  private onPointerDown(e: PointerEvent) {
    if (!this.interactive || !this.scene || this.dragPointer !== null) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    this.dragPointer = e.pointerId;
    this.dragX = e.clientX;
    this.dragY = e.clientY;
    this.dragDistance = 0;
    this.canvas.setPointerCapture(e.pointerId);
    this.scene.beginDrag();
    e.preventDefault();
  }

  private onPointerMove(e: PointerEvent) {
    if (e.pointerId !== this.dragPointer) {
      // Hovering: a pin under the mouse shows it can be clicked.
      if (this.dragPointer === null && e.pointerType === "mouse") {
        this.canvas.classList.toggle(
          "cursor-pointer!",
          this.interactive && this.pinAt(e) !== null,
        );
      }
      return;
    }
    const dx = e.clientX - this.dragX;
    const dy = e.clientY - this.dragY;
    this.dragDistance += Math.hypot(dx, dy);
    this.scene?.dragBy(dx, dy);
    this.dragX = e.clientX;
    this.dragY = e.clientY;
  }

  private onPointerUp(e: PointerEvent) {
    if (e.pointerId !== this.dragPointer) return;
    this.dragPointer = null;
    this.scene?.endDrag();
    if (this.dragDistance >= CLICK_SLOP) return;
    const region = this.pinAt(e);
    if (region === null) return;
    this.dispatchEvent(
      new CustomEvent("globe-region-select", {
        detail: { region },
        bubbles: true,
        composed: true,
      }) satisfies GlobeRegionSelectEvent,
    );
  }

  private onPointerCancel(e: PointerEvent) {
    if (e.pointerId !== this.dragPointer) return;
    this.dragPointer = null;
    this.scene?.endDrag();
  }

  private onPointerLeave() {
    this.canvas.classList.remove("cursor-pointer!");
  }

  private pinAt(e: PointerEvent): MapRegion | null {
    if (!this.scene || !this.pins.length) return null;
    const rect = this.canvas.getBoundingClientRect();
    return this.scene.pinAt(
      e.clientX - rect.left,
      e.clientY - rect.top,
      rect.width,
      rect.height,
    );
  }

  private load() {
    if (this.scene || this.loading) return;
    this.loading = true;
    const run = () => {
      import("../globe/ConquestGlobeScene")
        .then(({ ConquestGlobeScene }) => {
          if (!this.isConnected) return;
          this.scene = new ConquestGlobeScene(this.canvas, {
            stars: this.stars,
            fill: this.fill,
            lift: this.lift,
          });
          this.scene.setOrbiting(this.orbiting);
          this.scene.setPins(this.pins);
          this.scene.setFocus(this.focusOn);
          this.resize();
          this.refreshAll();
        })
        .catch((e) => console.warn("conquest globe unavailable:", e))
        .finally(() => (this.loading = false));
    };
    // A loader needs it now; the homepage can wait for the page to settle.
    if (this.exclusive) run();
    else whenPageIdle(run);
  }

  private resize() {
    this.scene?.setSize(this.clientWidth, this.clientHeight);
  }

  private readonly refreshAll = () => {
    for (const globe of instances) globe.refresh();
  };

  private refresh() {
    if (!this.scene) return;
    const blocked =
      !this.exclusive && [...instances].some((g) => g.exclusive && g.visible);
    if (this.visible && !blocked && !document.hidden) {
      this.scene.start();
      if (!this.shown) {
        this.shown = true;
        requestAnimationFrame(() => this.canvas.classList.remove("opacity-0"));
      }
    } else {
      this.scene.stop();
    }
  }
}

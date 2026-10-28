import { ReactiveController, ReactiveControllerHost } from "lit";

type Host = ReactiveControllerHost & HTMLElement;

// Lets the user drag a fixed HUD panel by its header. The position is kept in
// localStorage under `storageKey`, and the panel stays inside the viewport.
// The host renders `style()` on the panel element (found by `selector`) and
// binds `handlers` on the drag handle.
export class PanelDrag implements ReactiveController {
  pos: { x: number; y: number } | null = null;
  private drag: { dx: number; dy: number } | null = null;
  private readonly onResize = () => this.clampToViewport();

  readonly handlers = {
    pointerdown: (e: PointerEvent) => this.start(e),
    pointermove: (e: PointerEvent) => this.move(e),
    pointerup: () => this.end(),
    pointercancel: () => this.end(),
  };

  constructor(
    private readonly host: Host,
    private readonly storageKey: string,
    private readonly selector: string,
  ) {
    host.addController(this);
  }

  hostConnected() {
    try {
      const raw = localStorage.getItem(this.storageKey);
      const p = raw ? JSON.parse(raw) : null;
      if (p && Number.isFinite(p.x) && Number.isFinite(p.y)) this.pos = p;
    } catch {
      // storage unavailable: keep the default position
    }
    window.addEventListener("resize", this.onResize);
  }

  hostDisconnected() {
    window.removeEventListener("resize", this.onResize);
  }

  /** Inline position: the dragged one, else `fallback`. */
  style(fallback: string): string {
    return this.pos ? `left:${this.pos.x}px;top:${this.pos.y}px;` : fallback;
  }

  private start(e: PointerEvent) {
    if (e.button !== 0) return;
    const box = this.panel()?.getBoundingClientRect();
    if (!box) return;
    this.drag = { dx: e.clientX - box.left, dy: e.clientY - box.top };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    e.preventDefault();
  }

  private move(e: PointerEvent) {
    if (this.drag === null) return;
    this.setPos(this.clamp(e.clientX - this.drag.dx, e.clientY - this.drag.dy));
  }

  private end() {
    if (this.drag === null) return;
    this.drag = null;
    try {
      localStorage.setItem(this.storageKey, JSON.stringify(this.pos));
    } catch {
      // storage unavailable: the position lasts for this game only
    }
  }

  private panel(): HTMLElement | null {
    return this.host.querySelector(this.selector);
  }

  private clamp(x: number, y: number) {
    const box = this.panel()?.getBoundingClientRect();
    const w = box?.width ?? 220;
    const h = box?.height ?? 200;
    return {
      x: Math.min(Math.max(0, x), Math.max(0, window.innerWidth - w)),
      y: Math.min(Math.max(0, y), Math.max(0, window.innerHeight - h)),
    };
  }

  private clampToViewport() {
    if (this.pos) this.setPos(this.clamp(this.pos.x, this.pos.y));
  }

  private setPos(pos: { x: number; y: number }) {
    this.pos = pos;
    this.host.requestUpdate();
  }
}

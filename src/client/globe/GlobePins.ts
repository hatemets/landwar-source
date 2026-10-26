import {
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Group,
  Line,
  LineBasicMaterial,
  LinearFilter,
  Mesh,
  MeshBasicMaterial,
  OctahedronGeometry,
  PerspectiveCamera,
  Raycaster,
  Sprite,
  SpriteMaterial,
  SRGBColorSpace,
  Vector2,
  Vector3,
} from "three";
import { DEG, fromLatLon } from "./ConquestWorld";
import {
  REGION_ANCHORS,
  type GlobeRegionPin,
  type MapRegion,
} from "./MapRegions";

/**
 * The leader line runs from the surface out and north to the card, so it
 * still shows when the pin faces the camera. In globe radii.
 */
const LINE_FROM = 1.0;
const LINE_OUT = 0.12;
const LINE_NORTH = 0.22;
/** Card height in globe radii; the width follows its text. */
const CARD_H = 0.2;
/** Canvas pixels per card height, for crisp text on high-DPI screens. */
const CANVAS_H = 96;
/** A pin fades in between these facings (1 = straight at the camera). */
const FADE_FROM = 0.12;
const FADE_TO = 0.42;
/** Only a pin at least this visible can be clicked. */
const PICK_OPACITY = 0.5;

const CARD_BG = "rgba(58, 62, 72, 0.94)";
const CARD_BORDER = "rgba(255, 255, 255, 0.16)";
const SELECTED_BORDER = "#f2862e";
const LABEL_COLOR = "#e4e7ee";
const COUNT_BG = "rgba(255, 255, 255, 0.14)";
const SELECTED_COUNT_BG = "#f2862e";
const LINE_COLOR = 0xe4e7ee;
const SELECTED_LINE_COLOR = 0xf2862e;

interface PinView {
  pin: GlobeRegionPin;
  anchor: Vector3;
  canvas: HTMLCanvasElement;
  texture: CanvasTexture;
  card: Sprite;
  line: Line;
  dot: Mesh;
  opacity: number;
}

/**
 * Region pins on the globe: a gray card with the region's name and lobby
 * count on a short leader line. They sit in the globe's spinning frame, so
 * they turn with it, and fade out as they turn away from the camera.
 */
export class GlobePins {
  readonly group = new Group();
  private readonly views = new Map<MapRegion, PinView>();
  private readonly raycaster = new Raycaster();
  private readonly dotGeometry = new OctahedronGeometry(0.012, 0);

  setPins(pins: readonly GlobeRegionPin[]) {
    const keep = new Set(pins.map((p) => p.region));
    for (const [region, view] of this.views) {
      if (!keep.has(region)) {
        this.removeView(view);
        this.views.delete(region);
      }
    }
    for (const pin of pins) {
      const view = this.views.get(pin.region);
      if (!view) {
        this.views.set(pin.region, this.createView(pin));
      } else if (
        view.pin.count !== pin.count ||
        view.pin.label !== pin.label ||
        view.pin.selected !== pin.selected
      ) {
        view.pin = pin;
        this.drawCard(view);
      }
    }
  }

  /** Fades each pin by how directly it faces the camera. */
  update(camera: PerspectiveCamera) {
    for (const view of this.views.values()) {
      view.card.getWorldPosition(tmp);
      tmpView.subVectors(camera.position, tmp).normalize();
      const facing = tmp.normalize().dot(tmpView);
      const t = Math.min(
        1,
        Math.max(0, (facing - FADE_FROM) / (FADE_TO - FADE_FROM)),
      );
      view.opacity = t * t * (3 - 2 * t);
      const visible = view.opacity > 0.01;
      view.card.visible = view.line.visible = view.dot.visible = visible;
      (view.card.material as SpriteMaterial).opacity = view.opacity;
      (view.line.material as LineBasicMaterial).opacity = 0.95 * view.opacity;
      (view.dot.material as MeshBasicMaterial).opacity = view.opacity;
    }
  }

  /** The region whose card is under a point in normalised device coords. */
  pick(ndc: Vector2, camera: PerspectiveCamera): MapRegion | null {
    const cards = [...this.views.values()]
      .filter((v) => v.opacity >= PICK_OPACITY)
      .map((v) => v.card);
    if (!cards.length) return null;
    this.raycaster.setFromCamera(ndc, camera);
    const hit = this.raycaster.intersectObjects(cards, false)[0];
    if (!hit) return null;
    for (const [region, view] of this.views) {
      if (view.card === hit.object) return region;
    }
    return null;
  }

  dispose() {
    for (const view of this.views.values()) this.removeView(view);
    this.views.clear();
    this.dotGeometry.dispose();
  }

  private createView(pin: GlobeRegionPin): PinView {
    const { lat, lon } = REGION_ANCHORS[pin.region];
    const anchor = new Vector3(...fromLatLon(lat, lon));
    // d/dlat of fromLatLon: the way north along the surface.
    const north = new Vector3(
      -Math.sin(lat * DEG) * Math.cos(lon * DEG),
      Math.cos(lat * DEG),
      Math.sin(lat * DEG) * Math.sin(lon * DEG),
    );
    const tip = anchor
      .clone()
      .multiplyScalar(1 + LINE_OUT)
      .addScaledVector(north, LINE_NORTH);

    const lineGeometry = new BufferGeometry();
    lineGeometry.setAttribute(
      "position",
      new BufferAttribute(
        new Float32Array([
          ...anchor.clone().multiplyScalar(LINE_FROM).toArray(),
          ...tip.toArray(),
        ]),
        3,
      ),
    );
    const line = new Line(
      lineGeometry,
      new LineBasicMaterial({ transparent: true, depthWrite: false }),
    );
    line.renderOrder = 9;

    const dot = new Mesh(
      this.dotGeometry,
      new MeshBasicMaterial({ transparent: true, depthWrite: false }),
    );
    dot.position.copy(anchor).multiplyScalar(1.03);
    dot.renderOrder = 9;

    const canvas = document.createElement("canvas");
    const texture = new CanvasTexture(canvas);
    texture.colorSpace = SRGBColorSpace;
    texture.minFilter = LinearFilter;
    texture.generateMipmaps = false;
    // Not depth tested: near the rim the flat card would cut into the globe.
    // A card on the far side has faded out instead.
    const card = new Sprite(
      new SpriteMaterial({
        map: texture,
        transparent: true,
        depthWrite: false,
        depthTest: false,
      }),
    );
    // The card stands on the line's end.
    card.position.copy(tip);
    card.center.set(0.5, 0);
    card.renderOrder = 10;

    this.group.add(line, dot, card);
    const view: PinView = {
      pin,
      anchor,
      canvas,
      texture,
      card,
      line,
      dot,
      opacity: 0,
    };
    this.drawCard(view);
    return view;
  }

  private drawCard(view: PinView) {
    const { pin, canvas } = view;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const h = CANVAS_H;
    const pad = h * 0.26;
    const font = getComputedStyle(document.body).fontFamily || "sans-serif";
    const labelFont = `600 ${Math.round(h * 0.4)}px ${font}`;
    const countFont = `700 ${Math.round(h * 0.4)}px ${font}`;
    const count = String(pin.count);
    ctx.font = labelFont;
    const labelW = ctx.measureText(pin.label).width;
    ctx.font = countFont;
    const pillH = h * 0.58;
    const pillW = Math.max(pillH, ctx.measureText(count).width + h * 0.36);
    const gap = h * 0.2;
    const w = Math.ceil(pad + labelW + gap + pillW + pad * 0.6);

    canvas.width = w;
    canvas.height = h;
    ctx.clearRect(0, 0, w, h);
    const border = h * 0.045;
    ctx.beginPath();
    ctx.roundRect(border, border, w - border * 2, h - border * 2, h * 0.24);
    ctx.fillStyle = CARD_BG;
    ctx.fill();
    ctx.lineWidth = pin.selected ? border * 1.6 : border;
    ctx.strokeStyle = pin.selected ? SELECTED_BORDER : CARD_BORDER;
    ctx.stroke();

    ctx.textBaseline = "middle";
    ctx.font = labelFont;
    ctx.fillStyle = LABEL_COLOR;
    ctx.fillText(pin.label, pad, h / 2 + h * 0.02);

    const pillX = pad + labelW + gap;
    ctx.beginPath();
    ctx.roundRect(pillX, (h - pillH) / 2, pillW, pillH, pillH / 2);
    ctx.fillStyle = pin.selected ? SELECTED_COUNT_BG : COUNT_BG;
    ctx.fill();
    ctx.font = countFont;
    ctx.fillStyle = "#ffffff";
    ctx.textAlign = "center";
    ctx.fillText(count, pillX + pillW / 2, h / 2 + h * 0.02);
    ctx.textAlign = "start";

    // A new canvas size needs a new GPU texture, not just an upload.
    view.texture.dispose();
    view.texture.needsUpdate = true;
    view.card.scale.set((CARD_H * w) / h, CARD_H, 1);
    const color = pin.selected ? SELECTED_LINE_COLOR : LINE_COLOR;
    (view.line.material as LineBasicMaterial).color.setHex(color);
    (view.dot.material as MeshBasicMaterial).color.setHex(color);
  }

  private removeView(view: PinView) {
    this.group.remove(view.card, view.line, view.dot);
    view.texture.dispose();
    (view.card.material as SpriteMaterial).dispose();
    view.line.geometry.dispose();
    (view.line.material as LineBasicMaterial).dispose();
    (view.dot.material as MeshBasicMaterial).dispose();
  }
}

const tmp = new Vector3();
const tmpView = new Vector3();

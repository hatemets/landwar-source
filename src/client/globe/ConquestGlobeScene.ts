import {
  AdditiveBlending,
  BackSide,
  BufferAttribute,
  BufferGeometry,
  Color,
  DirectionalLight,
  DynamicDrawUsage,
  Group,
  HemisphereLight,
  IcosahedronGeometry,
  Line,
  LineBasicMaterial,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  OctahedronGeometry,
  PerspectiveCamera,
  Points,
  Quaternion,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  Vector2,
  Vector3,
  WebGLRenderer,
} from "three";
import { Boat, ConquestSim, Phase } from "./ConquestSim";
import {
  ConquestWorld,
  DEG,
  conquestWorld,
  fromLatLon,
  mulberry32,
} from "./ConquestWorld";
import { GlobePins } from "./GlobePins";
import type { GlobeFocus, GlobeRegionPin, MapRegion } from "./MapRegions";

/**
 * Renders a ConquestSim on a low-poly, slowly turning Earth: flat-shaded
 * faces coloured by owner, boats arcing over the sea, drifting clouds and a
 * faceted atmosphere. Loaded on demand by <conquest-globe>.
 */

export interface GlobeSceneOptions {
  /** Draw a star field behind the globe (for full-screen use). */
  stars: boolean;
  /** Share of the canvas's smaller side the halo spans, 0-1. */
  fill: number;
  /** Moves the globe up by this share of the canvas height. */
  lift: number;
}

type Rgb = [number, number, number];
const hex = (h: number): Rgb => [(h >> 16) & 255, (h >> 8) & 255, h & 255];

interface NationStyle {
  fill: Rgb;
  border: Rgb;
  flash: Rgb;
  boat: number;
}

/** Purple, black and orange, in turn order. */
const NATIONS: NationStyle[] = [
  {
    fill: hex(0x8b5cf6),
    border: hex(0x4c22b0),
    flash: hex(0xe2d4ff),
    boat: 0xc9b2ff,
  },
  {
    fill: hex(0x1c1c23),
    border: hex(0x9aa1b6),
    flash: hex(0x7a8094),
    boat: 0xd5d9e4,
  },
  {
    fill: hex(0xf2862e),
    border: hex(0xa8480c),
    flash: hex(0xffe0c2),
    boat: 0xffc28c,
  },
];
const RELEASE_FLASH: Rgb = [235, 240, 248];
const FLASH = 0.45;
const STEP = 1 / 60;
const SIM_SPEED = 1.3;
const TRAIL = 20;
const HALO_RADIUS = 1.3;
const FOV = 30;
/** Points in the loading comet's trail, head first. */
const COMET_POINTS = 64;
/** Seconds of flight the comet's trail covers. */
const COMET_TRAIL_S = 0.6;
const COMET_RADIUS = 1.2;
/** The comet's fixed orbit: inclination and ascending node, in radians. */
const COMET_INCL = 1.15;
const COMET_NODE = 0.6;
/** Segments in the faint ring that marks the comet's orbit. */
const COMET_RING_SEGMENTS = 128;
/** Per second, how fast a released drag's spin dies away. */
const DRAG_DAMPING = 2.5;
/** Per second, how fast the globe turns to a focused place. */
const FOCUS_RATE = 4;
const X_AXIS = new Vector3(1, 0, 0);
const Y_AXIS = new Vector3(0, 1, 0);

export class ConquestGlobeScene {
  private readonly world: ConquestWorld;
  private readonly sim: ConquestSim;
  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera(FOV, 1, 0.1, 200);
  private readonly spin = new Group();
  private readonly tilt = new Group();
  /** The place the globe turns to show, while a lobby is hovered. */
  private focus: GlobeFocus | null = null;
  private readonly focusAnchor = new Vector3();
  /** Turned by mouse or touch drags, around the camera's axes. */
  private readonly grab = new Group();
  private readonly comet = new Group();
  private cometMat: ShaderMaterial | null = null;
  private cometPos: BufferAttribute | null = null;
  private cometRingMat: LineBasicMaterial | null = null;
  private cometTarget = 0;
  private cometLevel = 0;
  private cometTime = 0;
  /** Globe radius on screen, in CSS pixels. */
  private radiusPx = 1;
  private dragging = false;
  private lastDragAt = 0;
  /** Drag spin in radians per second, around screen y then screen x. */
  private readonly dragVelocity = { x: 0, y: 0 };
  private readonly clouds = new Group();
  private readonly pins = new GlobePins();
  private readonly colors: Uint8Array;
  private readonly colorAttr: BufferAttribute;
  private readonly dirtyFlag: Uint8Array;
  private dirty: number[] = [];
  private animating: number[] = [];
  private readonly boatViews: { line: Line; head: Mesh; color: Color }[] = [];
  private starMat: ShaderMaterial | null = null;
  private readonly spinRate: number;
  private readonly cometRate: number;
  private raf = 0;
  private last = 0;
  private acc = 0;

  constructor(
    canvas: HTMLCanvasElement,
    private readonly options: GlobeSceneOptions,
  ) {
    this.world = conquestWorld();
    const F = this.world.faces;
    this.dirtyFlag = new Uint8Array(F);
    this.colors = new Uint8Array(F * 9);
    this.colorAttr = new BufferAttribute(this.colors, 3, true);
    this.colorAttr.setUsage(DynamicDrawUsage);
    this.sim = new ConquestSim(this.world, (f) => this.touch(f));

    this.renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setClearColor(0x000000, 0);

    const reduceMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    this.spinRate = (Math.PI * 2) / (reduceMotion ? 160 : 55);
    this.cometRate = reduceMotion ? 1.2 : 2.6;
    this.buildScene();
  }

  /** Land share of each nation, 0-1. */
  shares(): number[] {
    return this.sim.counts.map((c) => c / this.sim.land);
  }

  get phase(): Phase {
    return this.sim.phase;
  }

  setSize(width: number, height: number) {
    if (width <= 0 || height <= 0) return;
    this.renderer.setSize(width, height, false);
    const aspect = width / height;
    this.camera.aspect = aspect;
    const half = Math.tan((FOV / 2) * DEG) * Math.min(1, aspect);
    const distance = HALO_RADIUS / (this.options.fill * half);
    // Moving the camera down by the lift raises the globe on screen.
    const y = -this.options.lift * 2 * distance * Math.tan((FOV / 2) * DEG);
    this.camera.position.set(0, y, distance);
    this.camera.lookAt(0, y, 0);
    this.camera.updateProjectionMatrix();
    this.radiusPx =
      (Math.min(width, height) / 2) * (this.options.fill / HALO_RADIUS);
    if (this.cometMat) {
      this.cometMat.uniforms.uScale.value =
        (this.radiusPx / 190) * this.renderer.getPixelRatio();
    }
    if (!this.raf) this.renderNow();
  }

  /** Shows these region pins, in place of any shown before. */
  setPins(pins: readonly GlobeRegionPin[]) {
    this.pins.setPins(pins);
    if (!this.raf) this.renderNow();
  }

  /** The region pin at a point on the canvas, in CSS pixels. */
  pinAt(x: number, y: number, width: number, height: number): MapRegion | null {
    tmpNdc.set((x / width) * 2 - 1, 1 - (y / height) * 2);
    return this.pins.pick(tmpNdc, this.camera);
  }

  /**
   * Turns the globe until this place faces the camera;
   * null lets the globe spin on from where it stands.
   */
  setFocus(focus: GlobeFocus | null) {
    this.focus = focus;
    if (focus !== null) {
      this.focusAnchor.set(...fromLatLon(focus.lat, focus.lon));
      this.dragVelocity.x = this.dragVelocity.y = 0;
    }
  }

  /** Shows (or fades out) the golden comet that circles the globe. */
  setOrbiting(on: boolean) {
    this.cometTarget = on ? 1 : 0;
  }

  beginDrag() {
    this.dragging = true;
    this.dragVelocity.x = this.dragVelocity.y = 0;
    this.lastDragAt = performance.now();
  }

  /** Turns the globe as if the pointer moved its surface by dx, dy pixels. */
  dragBy(dx: number, dy: number) {
    const now = performance.now();
    const ax = dx / this.radiusPx;
    const ay = dy / this.radiusPx;
    this.rotateGrab(ax, ay);
    // Smoothed, so one jittery event does not decide the throw.
    const dt = Math.max(0.008, (now - this.lastDragAt) / 1000);
    this.dragVelocity.x = this.dragVelocity.x * 0.5 + (ax / dt) * 0.5;
    this.dragVelocity.y = this.dragVelocity.y * 0.5 + (ay / dt) * 0.5;
    this.lastDragAt = now;
    if (!this.raf) this.renderNow();
  }

  endDrag() {
    this.dragging = false;
    // A pointer held still before release throws nothing.
    if (performance.now() - this.lastDragAt > 80) {
      this.dragVelocity.x = this.dragVelocity.y = 0;
    }
  }

  private rotateGrab(ax: number, ay: number) {
    const q = this.grab.quaternion;
    q.premultiply(tmpQuat.setFromAxisAngle(Y_AXIS, ax));
    q.premultiply(tmpQuat.setFromAxisAngle(X_AXIS, ay));
    q.normalize();
  }

  start() {
    if (this.raf) return;
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  stop() {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  dispose() {
    this.stop();
    this.pins.dispose();
    this.scene.traverse((o) => {
      if (o instanceof Mesh || o instanceof Line || o instanceof Points) {
        o.geometry.dispose();
        const m = o.material;
        (Array.isArray(m) ? m : [m]).forEach((x) => x.dispose());
      }
    });
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }

  private readonly frame = (now: number) => {
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    this.acc += dt;
    let steps = 0;
    while (this.acc >= STEP && steps < 6) {
      this.sim.step(STEP * SIM_SPEED);
      this.acc -= STEP;
      steps++;
    }
    if (steps === 6) this.acc = 0;

    this.flushColors();
    this.updateBoats();
    const focusEarth = this.focus !== null && !this.dragging;
    if (focusEarth) this.turnToFocus(dt);
    else this.spin.rotation.y += this.spinRate * dt;
    this.clouds.rotation.y += this.spinRate * 1.25 * dt;
    if (!this.dragging && !focusEarth) {
      const v = this.dragVelocity;
      if (v.x !== 0 || v.y !== 0) {
        this.rotateGrab(v.x * dt, v.y * dt);
        const k = Math.exp(-DRAG_DAMPING * dt);
        v.x *= k;
        v.y *= k;
        if (Math.abs(v.x) + Math.abs(v.y) < 0.01) v.x = v.y = 0;
      }
    }
    this.updateComet(dt);
    if (this.starMat) this.starMat.uniforms.uTime.value = now / 1000;
    this.renderNow();
    this.raf = requestAnimationFrame(this.frame);
  };

  /** Eases the drag frame so the focused place faces the camera, north up. */
  private turnToFocus(dt: number) {
    // The globe frame's turn, short of the drag frame.
    tmpQuat.copy(this.tilt.quaternion).multiply(this.spin.quaternion);
    const a = tmpA.copy(this.focusAnchor).applyQuaternion(tmpQuat);
    const n = tmpB.copy(Y_AXIS).applyQuaternion(tmpQuat);
    n.addScaledVector(a, -n.dot(a)).normalize();
    tmpFrom.makeBasis(a, n, tmpC.crossVectors(a, n));
    const c = tmpA.copy(this.camera.position).normalize();
    const up = tmpB.copy(Y_AXIS).addScaledVector(c, -c.y).normalize();
    tmpTo.makeBasis(c, up, tmpC.crossVectors(c, up));
    // From and to are rotations, so the inverse is the transpose.
    tmpTo.multiply(tmpFrom.transpose());
    tmpQuat.setFromRotationMatrix(tmpTo);
    this.grab.quaternion.slerp(tmpQuat, 1 - Math.exp(-FOCUS_RATE * dt));
  }

  private renderNow() {
    this.scene.updateMatrixWorld();
    this.pins.update(this.camera);
    this.renderer.render(this.scene, this.camera);
  }

  private touch(f: number) {
    this.animating.push(f);
    this.markDirty(f);
    const { neighbours: nb, isLand } = this.world;
    for (let k = 0; k < 3; k++) {
      const g = nb[f * 3 + k];
      if (isLand[g]) this.markDirty(g);
    }
  }

  private markDirty(f: number) {
    if (this.dirtyFlag[f]) return;
    this.dirtyFlag[f] = 1;
    this.dirty.push(f);
  }

  private flushColors() {
    if (!this.dirty.length && !this.animating.length) return;
    const still: number[] = [];
    for (const f of this.animating) {
      this.markDirty(f);
      if (this.sim.time - this.sim.changedAt[f] < FLASH) still.push(f);
    }
    this.animating = still;
    for (const f of this.dirty) {
      this.dirtyFlag[f] = 0;
      this.writeColor(f);
    }
    this.dirty = [];
    this.colorAttr.needsUpdate = true;
  }

  private writeColor(f: number) {
    const { baseColors, neighbours: nb, isLand, shade } = this.world;
    const o = this.sim.owner[f];
    let r: number;
    let g: number;
    let b: number;
    if (o < 0) {
      r = baseColors[f * 3];
      g = baseColors[f * 3 + 1];
      b = baseColors[f * 3 + 2];
    } else {
      let border = false;
      for (let k = 0; k < 3; k++) {
        const h = nb[f * 3 + k];
        if (isLand[h] && this.sim.owner[h] !== o) {
          border = true;
          break;
        }
      }
      const c = border ? NATIONS[o].border : NATIONS[o].fill;
      const s = border ? 1 : shade[f];
      r = c[0] * s;
      g = c[1] * s;
      b = c[2] * s;
    }
    const age = this.sim.time - this.sim.changedAt[f];
    if (age < FLASH) {
      const t = 1 - age / FLASH;
      const k = t * t * (o < 0 ? 0.35 : 0.85);
      const fl = o < 0 ? RELEASE_FLASH : NATIONS[o].flash;
      r += (fl[0] - r) * k;
      g += (fl[1] - g) * k;
      b += (fl[2] - b) * k;
    }
    const c = this.colors;
    for (let i = f * 9; i < f * 9 + 9; i += 3) {
      c[i] = Math.min(255, r);
      c[i + 1] = Math.min(255, g);
      c[i + 2] = Math.min(255, b);
    }
  }

  private buildScene() {
    const { world, scene } = this;
    scene.add(new HemisphereLight(0xa9bcff, 0x1b2236, 1.1));
    const sun = new DirectionalLight(0xfff1dc, 2.6);
    sun.position.set(-3.2, 2.2, 4);
    scene.add(sun);

    // Axial tilt, tipped towards the viewer so the north reads well.
    const tilt = this.tilt;
    tilt.rotation.set(0.32, 0, 23.4 * DEG);
    scene.add(this.grab);
    this.grab.add(tilt);
    tilt.add(this.spin);
    this.spin.rotation.y = -55 * DEG; // the Atlantic faces the camera

    // One flat colour per face, so the geometry is unindexed.
    const F = world.faces;
    const pos = new Float32Array(F * 9);
    const { faceVertices: fv, vertices: vx, heights } = world;
    for (let i = 0; i < F * 3; i++) {
      const v = fv[i];
      const r = heights[v];
      pos[i * 3] = vx[v * 3] * r;
      pos[i * 3 + 1] = vx[v * 3 + 1] * r;
      pos[i * 3 + 2] = vx[v * 3 + 2] * r;
    }
    for (let f = 0; f < F; f++) this.writeColor(f);
    const geo = new BufferGeometry();
    geo.setAttribute("position", new BufferAttribute(pos, 3));
    geo.setAttribute("color", this.colorAttr);
    geo.computeVertexNormals();
    const globeMat = new MeshStandardMaterial({
      vertexColors: true,
      flatShading: true,
      roughness: 0.88,
      metalness: 0,
    });
    // Colours are stored as sRGB bytes; three.js expects linear vertex colours.
    globeMat.onBeforeCompile = (s) => {
      s.vertexShader = s.vertexShader.replace(
        "#include <color_vertex>",
        "#include <color_vertex>\n  vColor.rgb = pow(vColor.rgb, vec3(2.2));",
      );
    };
    this.spin.add(new Mesh(geo, globeMat));

    const boats = new Group();
    for (let i = 0; i < this.sim.boats.length; i++) {
      const g = new BufferGeometry();
      g.setAttribute(
        "position",
        new BufferAttribute(new Float32Array(TRAIL * 3), 3),
      );
      g.setAttribute(
        "color",
        new BufferAttribute(new Float32Array(TRAIL * 3), 3),
      );
      const line = new Line(
        g,
        new LineBasicMaterial({
          vertexColors: true,
          transparent: true,
          blending: AdditiveBlending,
          depthWrite: false,
        }),
      );
      line.frustumCulled = false;
      const head = new Mesh(
        new OctahedronGeometry(0.009, 0),
        new MeshBasicMaterial(),
      );
      line.visible = head.visible = false;
      boats.add(line, head);
      this.boatViews.push({ line, head, color: new Color() });
    }
    this.spin.add(boats);
    this.spin.add(this.pins.group);

    this.buildClouds(tilt);
    this.buildAtmosphere(tilt);
    this.buildComet();
    if (this.options.stars) this.buildStars();
  }

  /**
   * The loading indicator: a golden comet on one fixed circular orbit,
   * marked by a faint ring, with a short fading trail behind it. The globe
   * hides it on the far side through the depth test.
   */
  private buildComet() {
    const pos = new Float32Array(COMET_POINTS * 3);
    const t = new Float32Array(COMET_POINTS);
    for (let i = 0; i < COMET_POINTS; i++) t[i] = i / (COMET_POINTS - 1);
    const g = new BufferGeometry();
    this.cometPos = new BufferAttribute(pos, 3);
    this.cometPos.setUsage(DynamicDrawUsage);
    g.setAttribute("position", this.cometPos);
    g.setAttribute("trail", new BufferAttribute(t, 1));
    this.cometMat = new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      uniforms: {
        uLevel: { value: 0 },
        uScale: { value: this.renderer.getPixelRatio() },
      },
      vertexShader: `attribute float trail;
        uniform float uScale; varying float vT;
        void main() {
          vT = trail;
          gl_PointSize = mix(18.0, 5.0, sqrt(trail)) * uScale;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: `uniform float uLevel; varying float vT;
        void main() {
          float d = length(gl_PointCoord - 0.5);
          if (d > 0.5) discard;
          float glow = exp(-d * d * (vT < 0.02 ? 22.0 : 28.0));
          vec3 c = mix(vec3(1.0, 0.96, 0.78), vec3(1.0, 0.62, 0.14), smoothstep(0.0, 0.5, vT));
          float fade = pow(1.0 - vT, 2.2);
          gl_FragColor = vec4(c, glow * fade * uLevel * 0.75);
        }`,
    });
    const points = new Points(g, this.cometMat);
    points.frustumCulled = false;
    this.comet.add(points);
    const ring = new Float32Array((COMET_RING_SEGMENTS + 1) * 3);
    const period = (2 * Math.PI) / this.cometRate;
    for (let i = 0; i <= COMET_RING_SEGMENTS; i++) {
      this.cometPoint((i / COMET_RING_SEGMENTS) * period, tmp);
      ring.set([tmp.x, tmp.y, tmp.z], i * 3);
    }
    const ringGeometry = new BufferGeometry();
    ringGeometry.setAttribute("position", new BufferAttribute(ring, 3));
    this.cometRingMat = new LineBasicMaterial({
      color: 0xffd58a,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });
    const ringLine = new Line(ringGeometry, this.cometRingMat);
    ringLine.frustumCulled = false;
    this.comet.add(ringLine);
    this.comet.visible = false;
    this.scene.add(this.comet);
  }

  private updateComet(dt: number) {
    if (!this.cometMat || !this.cometPos) return;
    this.cometLevel +=
      (this.cometTarget - this.cometLevel) * Math.min(1, dt * 4);
    if (this.cometTarget === 0 && this.cometLevel < 0.01) {
      this.cometLevel = 0;
      this.comet.visible = false;
      return;
    }
    this.comet.visible = true;
    this.cometTime += dt;
    this.cometMat.uniforms.uLevel.value = this.cometLevel;
    if (this.cometRingMat) this.cometRingMat.opacity = 0.18 * this.cometLevel;
    const step = COMET_TRAIL_S / (COMET_POINTS - 1);
    for (let i = 0; i < COMET_POINTS; i++) {
      this.cometPoint(this.cometTime - i * step, tmp);
      this.cometPos.setXYZ(i, tmp.x, tmp.y, tmp.z);
    }
    this.cometPos.needsUpdate = true;
  }

  /** Where the comet is at time s on its fixed circular orbit. */
  private cometPoint(s: number, out: Vector3) {
    const phi = s * this.cometRate;
    const x = Math.cos(phi);
    const y = Math.sin(phi) * Math.sin(COMET_INCL);
    const z = Math.sin(phi) * Math.cos(COMET_INCL);
    const cn = Math.cos(COMET_NODE);
    const sn = Math.sin(COMET_NODE);
    const r = COMET_RADIUS;
    out.set((x * cn + z * sn) * r, y * r, (z * cn - x * sn) * r);
  }

  private buildClouds(parent: Group) {
    const rng = mulberry32(5);
    const mat = new MeshStandardMaterial({
      color: 0xf2f5fa,
      flatShading: true,
      roughness: 1,
      transparent: true,
      opacity: 0.82,
    });
    for (let i = 0; i < 9; i++) {
      const cluster = new Group();
      const [x, y, z] = fromLatLon(-50 + 110 * rng(), 360 * rng());
      cluster.position.set(x, y, z).multiplyScalar(1.045);
      cluster.lookAt(0, 0, 0);
      const puffs = 3 + ((rng() * 3) | 0);
      for (let p = 0; p < puffs; p++) {
        const m = new Mesh(
          new IcosahedronGeometry(0.022 + 0.022 * rng(), 0),
          mat,
        );
        m.position.set(
          (p - puffs / 2) * 0.03 + rng() * 0.01,
          (rng() - 0.5) * 0.03,
          0,
        );
        m.scale.set(1.3, 1, 0.55);
        cluster.add(m);
      }
      this.clouds.add(cluster);
    }
    parent.add(this.clouds);
  }

  private buildAtmosphere(parent: Group) {
    // Faceted shell: flat normals from screen derivatives, bright at the rim.
    parent.add(
      new Mesh(
        new IcosahedronGeometry(1.065, 3),
        new ShaderMaterial({
          transparent: true,
          depthWrite: false,
          uniforms: { uColor: { value: new Color(0xbfe0ff) } },
          vertexShader: `varying vec3 vView;
            void main() {
              vec4 mv = modelViewMatrix * vec4(position, 1.0);
              vView = mv.xyz;
              gl_Position = projectionMatrix * mv;
            }`,
          fragmentShader: `uniform vec3 uColor; varying vec3 vView;
            void main() {
              vec3 n = normalize(cross(dFdx(vView), dFdy(vView)));
              float f = 1.0 - abs(dot(n, normalize(-vView)));
              gl_FragColor = vec4(uColor * (0.55 + 0.6 * f), pow(f, 4.0) * 0.8 + 0.01);
            }`,
        }),
      ),
    );
    parent.add(
      new Mesh(
        new SphereGeometry(1.24, 64, 32),
        new ShaderMaterial({
          transparent: true,
          depthWrite: false,
          side: BackSide,
          blending: AdditiveBlending,
          uniforms: { uColor: { value: new Color(0x3b7cff) } },
          vertexShader: `varying vec3 vN; varying vec3 vV;
            void main() {
              vec4 mv = modelViewMatrix * vec4(position, 1.0);
              vN = normalize(normalMatrix * normal);
              vV = normalize(-mv.xyz);
              gl_Position = projectionMatrix * mv;
            }`,
          fragmentShader: `uniform vec3 uColor; varying vec3 vN; varying vec3 vV;
            void main() {
              float i = pow(max(0.0, -dot(vN, vV)), 4.0);
              gl_FragColor = vec4(uColor, i * 0.9);
            }`,
        }),
      ),
    );
  }

  private buildStars() {
    const rng = mulberry32(3);
    const N = 1600;
    const p = new Float32Array(N * 3);
    const phase = new Float32Array(N);
    const size = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const u = rng() * 2 - 1;
      const th = rng() * Math.PI * 2;
      const r = 60 + rng() * 30;
      const q = Math.sqrt(1 - u * u);
      p[i * 3] = q * Math.cos(th) * r;
      p[i * 3 + 1] = u * r;
      p[i * 3 + 2] = q * Math.sin(th) * r;
      phase[i] = rng() * 6.283;
      size[i] = rng() < 0.04 ? 3.2 : 1 + rng() * 1.4;
    }
    const g = new BufferGeometry();
    g.setAttribute("position", new BufferAttribute(p, 3));
    g.setAttribute("phase", new BufferAttribute(phase, 1));
    g.setAttribute("size", new BufferAttribute(size, 1));
    this.starMat = new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: {
        uTime: { value: 0 },
        uDpr: { value: this.renderer.getPixelRatio() },
      },
      vertexShader: `attribute float phase; attribute float size;
        uniform float uTime; uniform float uDpr; varying float vA;
        void main() {
          vA = 0.45 + 0.55 * (0.5 + 0.5 * sin(uTime * 1.3 + phase * 3.0));
          gl_PointSize = size * uDpr;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: `varying float vA;
        void main() {
          float d = length(gl_PointCoord - 0.5);
          if (d > 0.5) discard;
          gl_FragColor = vec4(vec3(0.85, 0.9, 1.0), vA * (1.0 - d * 1.6));
        }`,
    });
    this.scene.add(new Points(g, this.starMat));
  }

  private updateBoats() {
    const boats = this.sim.boats;
    for (let i = 0; i < boats.length; i++) {
      const b = boats[i];
      const view = this.boatViews[i];
      if (!b.active) {
        view.line.visible = view.head.visible = false;
        continue;
      }
      if (!view.line.visible) {
        view.color.setHex(NATIONS[b.nation].boat);
        (view.head.material as MeshBasicMaterial).color.setHex(
          NATIONS[b.nation].boat,
        );
        view.line.visible = view.head.visible = true;
      }
      const u = Math.min(1, b.t / b.duration);
      this.arcPoint(b, u, view.head.position);
      const p = view.line.geometry.attributes.position as BufferAttribute;
      const c = view.line.geometry.attributes.color as BufferAttribute;
      for (let k = 0; k < TRAIL; k++) {
        this.arcPoint(b, Math.max(0, u - (k / (TRAIL - 1)) * 0.35), tmp);
        p.setXYZ(k, tmp.x, tmp.y, tmp.z);
        const fade = 1 - k / (TRAIL - 1);
        c.setXYZ(
          k,
          view.color.r * fade,
          view.color.g * fade,
          view.color.b * fade,
        );
      }
      p.needsUpdate = c.needsUpdate = true;
    }
  }

  /** A point on the great circle from src to dst, lifted into an arc. */
  private arcPoint(b: Boat, u: number, out: Vector3) {
    const c = this.world.centroids;
    const s = Math.sin(b.angle) || 1;
    const wa = Math.sin((1 - u) * b.angle) / s;
    const wc = Math.sin(u * b.angle) / s;
    out
      .set(
        c[b.src * 3] * wa + c[b.dst * 3] * wc,
        c[b.src * 3 + 1] * wa + c[b.dst * 3 + 1] * wc,
        c[b.src * 3 + 2] * wa + c[b.dst * 3 + 2] * wc,
      )
      .normalize()
      .multiplyScalar(
        1.016 + Math.min(0.09, 0.05 + b.angle * 0.15) * Math.sin(Math.PI * u),
      );
  }
}

const tmp = new Vector3();
const tmpA = new Vector3();
const tmpB = new Vector3();
const tmpC = new Vector3();
const tmpFrom = new Matrix4();
const tmpTo = new Matrix4();
const tmpQuat = new Quaternion();
const tmpNdc = new Vector2();

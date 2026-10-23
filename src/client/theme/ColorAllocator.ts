import { PseudoRandom } from "@openfront/engine-lib/PseudoRandom";
import { simpleHash } from "@openfront/engine-lib/Util";
import { Colord, extend } from "colord";
import labPlugin from "colord/plugins/lab";
import lchPlugin from "colord/plugins/lch";
extend([lchPlugin]);
extend([labPlugin]);

/**
 * A primary color is only used while it is at least this far (delta-E 2000
 * divided by 100) from every color already handed out. Below that, the
 * allocator looks at the fallback colors too and takes the most distinct one.
 */
export const MIN_PRIMARY_DISTANCE = 0.08;

interface Lab {
  l: number;
  a: number;
  b: number;
}

/**
 * The colors handed out so far. Allocators that share one registry avoid each
 * other's colors, so two pools (e.g. humans and nations) never produce look
 * alike territories.
 */
export class ColorRegistry {
  readonly labs: Lab[] = [];

  add(color: Colord): void {
    this.labs.push(toLab(color));
  }
}

interface Candidate {
  color: Colord;
  lab: Lab;
  primary: boolean;
  /** Distance to the nearest registry color; 0 once this color is taken. */
  minDistance: number;
}

/**
 * Assigns a stable, visually distinct color to each id. Theme-agnostic: it
 * knows nothing about teams or palettes; a theme supplies the pool and owns
 * any team-color logic.
 */
export class ColorAllocator {
  private candidates: Candidate[];
  private assigned = new Map<string, Colord>();
  /** How many registry entries `candidates[*].minDistance` already covers. */
  private synced = 0;

  constructor(
    colors: Colord[],
    fallback: Colord[],
    private registry: ColorRegistry = new ColorRegistry(),
  ) {
    const seen = new Set<string>();
    this.candidates = [];
    for (const [pool, primary] of [
      [colors, true],
      [fallback, false],
    ] as const) {
      for (const color of pool) {
        const key = color.toHex();
        if (seen.has(key)) continue;
        seen.add(key);
        this.candidates.push({
          color,
          lab: toLab(color),
          primary,
          minDistance: Infinity,
        });
      }
    }
  }

  /**
   * Return the color assigned to `id`, allocating one on first request. The
   * new color is the one farthest (delta-E 2000) from every color handed out
   * so far, preferring the primary pool. The first color is a seeded pick.
   * When every color is taken, the least-bad one is reused. Assignments are
   * stable for the allocator's lifetime.
   */
  assignColor(id: string): Colord {
    const existing = this.assigned.get(id);
    if (existing !== undefined) {
      return existing;
    }

    this.sync();

    let chosen: Candidate;
    if (this.registry.labs.length === 0) {
      const primaries = this.candidates.filter((c) => c.primary);
      const pool = primaries.length > 0 ? primaries : this.candidates;
      const rand = new PseudoRandom(simpleHash(id));
      chosen = pool[rand.nextInt(0, pool.length)];
    } else {
      const bestPrimary = this.farthest(true);
      chosen =
        bestPrimary !== undefined &&
        bestPrimary.minDistance >= MIN_PRIMARY_DISTANCE
          ? bestPrimary
          : this.farthest(false)!;
    }

    this.registry.add(chosen.color);
    this.assigned.set(id, chosen.color);
    return chosen.color;
  }

  /** Fold registry colors added since the last call into every candidate. */
  private sync(): void {
    const labs = this.registry.labs;
    for (; this.synced < labs.length; this.synced++) {
      const taken = labs[this.synced];
      for (const candidate of this.candidates) {
        const d = deltaE2000(candidate.lab, taken);
        if (d < candidate.minDistance) candidate.minDistance = d;
      }
    }
  }

  /** The candidate with the largest `minDistance`; the first one on ties. */
  private farthest(primaryOnly: boolean): Candidate | undefined {
    let best: Candidate | undefined;
    for (const candidate of this.candidates) {
      if (primaryOnly && !candidate.primary) continue;
      if (best === undefined || candidate.minDistance > best.minDistance) {
        best = candidate;
      }
    }
    return best;
  }
}

/**
 * Index of the available color that is most perceptually different from the
 * already-assigned colors (the one whose nearest assigned neighbor is farthest
 * away, by delta-E 2000). Throws if no colors have been assigned yet.
 */
export function selectDistinctColorIndex(
  availableColors: Colord[],
  assignedColors: Colord[],
): number {
  if (assignedColors.length === 0) {
    throw new Error("No assigned colors");
  }

  const assignedLabs = assignedColors.map(toLab);
  let maxDeltaE = 0;
  let maxIndex = 0;

  for (let i = 0; i < availableColors.length; i++) {
    const lab = toLab(availableColors[i]);
    const deltaE = assignedLabs.reduce(
      (min, other) => Math.min(min, deltaE2000(lab, other)),
      Infinity,
    );
    if (deltaE > maxDeltaE) {
      maxDeltaE = deltaE;
      maxIndex = i;
    }
  }
  return maxIndex;
}

function toLab(color: Colord): Lab {
  const { l, a, b } = color.toLab();
  return { l, a, b };
}

/**
 * CIEDE2000 colour difference, divided by 100 (the scale of colord's
 * `delta()`). Precomputed Lab values make this cheap enough to run for every
 * candidate on every allocation.
 */
export function deltaE2000(c1: Lab, c2: Lab): number {
  const rad = Math.PI / 180;
  const deg = 180 / Math.PI;
  const pow7 = (x: number) => x ** 7;

  const cBar = (Math.hypot(c1.a, c1.b) + Math.hypot(c2.a, c2.b)) / 2;
  const g = 0.5 * (1 - Math.sqrt(pow7(cBar) / (pow7(cBar) + pow7(25))));
  const a1 = c1.a * (1 + g);
  const a2 = c2.a * (1 + g);
  const chroma1 = Math.hypot(a1, c1.b);
  const chroma2 = Math.hypot(a2, c2.b);
  const hue = (b: number, a: number) => {
    if (a === 0 && b === 0) return 0;
    const h = Math.atan2(b, a) * deg;
    return h < 0 ? h + 360 : h;
  };
  const h1 = hue(c1.b, a1);
  const h2 = hue(c2.b, a2);

  const dL = c2.l - c1.l;
  const dC = chroma2 - chroma1;
  let dh = 0;
  if (chroma1 * chroma2 !== 0) {
    dh = h2 - h1;
    if (dh > 180) dh -= 360;
    else if (dh < -180) dh += 360;
  }
  const dH = 2 * Math.sqrt(chroma1 * chroma2) * Math.sin((dh * rad) / 2);

  const lBar = (c1.l + c2.l) / 2;
  const cBar2 = (chroma1 + chroma2) / 2;
  let hBar = h1 + h2;
  if (chroma1 * chroma2 !== 0) {
    hBar =
      Math.abs(h1 - h2) <= 180
        ? (h1 + h2) / 2
        : h1 + h2 < 360
          ? (h1 + h2 + 360) / 2
          : (h1 + h2 - 360) / 2;
  }

  const t =
    1 -
    0.17 * Math.cos((hBar - 30) * rad) +
    0.24 * Math.cos(2 * hBar * rad) +
    0.32 * Math.cos((3 * hBar + 6) * rad) -
    0.2 * Math.cos((4 * hBar - 63) * rad);
  const sL = 1 + (0.015 * (lBar - 50) ** 2) / Math.sqrt(20 + (lBar - 50) ** 2);
  const sC = 1 + 0.045 * cBar2;
  const sH = 1 + 0.015 * cBar2 * t;
  const dTheta = 30 * Math.exp(-(((hBar - 275) / 25) ** 2));
  const rC = 2 * Math.sqrt(pow7(cBar2) / (pow7(cBar2) + pow7(25)));
  const rT = -Math.sin(2 * dTheta * rad) * rC;

  const lTerm = dL / sL;
  const cTerm = dC / sC;
  const hTerm = dH / sH;
  return (
    Math.sqrt(
      lTerm * lTerm + cTerm * cTerm + hTerm * hTerm + rT * cTerm * hTerm,
    ) / 100
  );
}

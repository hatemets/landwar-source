import { ConquestWorld, DEG, fromLatLon, mulberry32 } from "./ConquestWorld";

/**
 * A toy territory war on the globe's land faces, looping forever: three
 * nations spawn, grow over neutral land and send boats across the sea, then
 * one of them (in turn) conquers everything, holds it, and a wave clears the
 * map for the next round. Purely cosmetic; it shares nothing with the engine.
 */

export const NATION_COUNT = 3;

export enum Phase {
  Spawn,
  Expand,
  War,
  Hold,
  Reset,
}

export interface Boat {
  active: boolean;
  nation: number;
  src: number;
  dst: number;
  /** Great-circle angle between src and dst, radians. */
  angle: number;
  t: number;
  duration: number;
  allowEnemy: boolean;
}

const BOAT_POOL = 48;
const COS_MIN_HOP = Math.cos(0.9 * DEG);

/** A set of candidate faces with O(1) random removal. */
class Front {
  readonly items: number[] = [];
  private readonly flag: Uint8Array;
  constructor(faces: number) {
    this.flag = new Uint8Array(faces);
  }
  add(f: number) {
    if (this.flag[f]) return;
    this.flag[f] = 1;
    this.items.push(f);
  }
  pop(rng: () => number): number {
    const a = this.items;
    const i = (rng() * a.length) | 0;
    const f = a[i];
    a[i] = a[a.length - 1];
    a.pop();
    this.flag[f] = 0;
    return f;
  }
  get size() {
    return this.items.length;
  }
}

interface Fronts {
  neutral: Front;
  enemy: Front;
}

const smooth = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export class ConquestSim {
  readonly owner: Int8Array;
  /** Sim time of each face's last change, for the claim flash. */
  readonly changedAt: Float32Array;
  readonly counts = [0, 0, 0];
  readonly boats: Boat[] = [];
  readonly land: number;
  time = 0;
  phase = Phase.Spawn;
  winner = 0;

  private phaseT = 0;
  private cycle = 0;
  private rng = mulberry32(1);
  private fronts: Fronts[] = [];
  private readonly mult = [1, 1, 1];
  private readonly boatTimer = [0, 0, 0];
  private readonly inFlight = [0, 0, 0];
  private resetOrder: number[] = [];
  private resetIdx = 0;
  private holdouts: number[] = [];
  private readonly firstSeeds: number[];

  constructor(
    private readonly world: ConquestWorld,
    private readonly onChange: (face: number) => void,
  ) {
    this.owner = new Int8Array(world.faces).fill(-1);
    this.changedAt = new Float32Array(world.faces).fill(-10);
    this.land = world.landFaces.length;
    for (let i = 0; i < BOAT_POOL; i++) {
      this.boats.push({
        active: false,
        nation: 0,
        src: 0,
        dst: 0,
        angle: 0,
        t: 0,
        duration: 1,
        allowEnemy: false,
      });
    }
    // Round one opens in Europe, East Asia and North America.
    this.firstSeeds = [
      this.nearestLand(49, 12),
      this.nearestLand(42, 102),
      this.nearestLand(39, -97),
    ];
    this.startCycle();
  }

  step(dt: number) {
    this.time += dt;
    this.phaseT += dt;
    switch (this.phase) {
      case Phase.Spawn:
        if (this.phaseT > 0.7) this.setPhase(Phase.Expand);
        break;
      case Phase.Expand:
      case Phase.War:
        this.stepConflict(dt);
        break;
      case Phase.Hold:
        if (this.phaseT > 1.8) this.beginReset();
        break;
      case Phase.Reset: {
        const target = Math.floor(this.land * smooth(0, 1.4, this.phaseT));
        while (this.resetIdx < target)
          this.release(this.resetOrder[this.resetIdx++]);
        if (this.resetIdx >= this.land && this.phaseT > 1.7) {
          this.cycle++;
          this.startCycle();
        }
        break;
      }
    }
    this.stepBoats(dt);
  }

  private setPhase(p: Phase) {
    this.phase = p;
    this.phaseT = 0;
  }

  private stepConflict(dt: number) {
    const war = this.phase === Phase.War;
    const { counts, land, rng } = this;
    for (let n = 0; n < NATION_COUNT; n++) {
      if (counts[n] === 0) continue;
      const rate = (40 + 22 * Math.sqrt(counts[n])) * this.mult[n];
      this.growNeutral(n, Math.round(rate * dt + rng()));
      if (war) {
        // The round's winner ramps up; the others push back briefly.
        const attack =
          n === this.winner
            ? 120 + 2600 * smooth(0, 6, this.phaseT)
            : 260 * Math.max(0, 1 - this.phaseT / 3.5);
        this.attack(n, Math.round(attack * dt + rng()));
      }
      this.boatTimer[n] -= dt;
      if (this.boatTimer[n] <= 0) {
        const lead = war && n === this.winner;
        const starving = this.fronts[n].neutral.size < 4;
        this.launchBoat(n, lead);
        const interval = lead
          ? this.phaseT > 10
            ? 0.06
            : 0.18
          : starving
            ? 0.15
            : 0.9;
        this.boatTimer[n] = interval * (0.6 + 0.8 * rng());
      }
    }
    const neutral = land - counts[0] - counts[1] - counts[2];
    if (!war && (neutral < land * 0.03 || this.phaseT > 9)) {
      this.setPhase(Phase.War);
      return;
    }
    if (!war) return;
    if (counts[this.winner] === land) {
      this.setPhase(Phase.Hold);
      for (const b of this.boats) b.active = false;
      this.inFlight.fill(0);
      return;
    }
    // Once the winner holds almost everything, the last holdouts fold.
    if (counts[this.winner] > land * 0.96 || this.phaseT > 11) {
      if (!this.holdouts.length || rng() < 0.05) {
        this.holdouts = Array.from(this.world.landFaces).filter(
          (f) => this.owner[f] !== this.winner,
        );
      }
      let k = Math.max(3, Math.ceil(this.holdouts.length / 45));
      while (k-- > 0 && this.holdouts.length) {
        const i = (rng() * this.holdouts.length) | 0;
        const f = this.holdouts[i];
        this.holdouts[i] = this.holdouts[this.holdouts.length - 1];
        this.holdouts.pop();
        if (this.owner[f] !== this.winner) this.claim(f, this.winner);
      }
    }
  }

  private startCycle() {
    this.rng = mulberry32(1000 + this.cycle * 7919);
    this.winner = this.cycle % NATION_COUNT;
    const F = this.world.faces;
    this.fronts = [0, 1, 2].map(() => ({
      neutral: new Front(F),
      enemy: new Front(F),
    }));
    for (let n = 0; n < NATION_COUNT; n++) {
      this.mult[n] = 0.85 + 0.3 * this.rng();
      this.boatTimer[n] = 0.8 + this.rng();
    }
    this.holdouts = [];
    const seeds = this.cycle === 0 ? this.firstSeeds : this.pickSeeds();
    seeds.forEach((s, n) => {
      this.claim(s, n);
      for (let i = 0; i < 10; i++) this.growNeutral(n, 1);
    });
    this.setPhase(Phase.Spawn);
  }

  private beginReset() {
    const { centroids: c, landFaces } = this.world;
    const [ox, oy, oz] = fromLatLon(
      -30 + 60 * this.rng(),
      -180 + 360 * this.rng(),
    );
    const d = (f: number) =>
      ox * c[f * 3] + oy * c[f * 3 + 1] + oz * c[f * 3 + 2];
    this.resetOrder = Array.from(landFaces).sort((a, b) => d(b) - d(a));
    this.resetIdx = 0;
    this.setPhase(Phase.Reset);
  }

  private claim(f: number, n: number) {
    const p = this.owner[f];
    if (p === n) return;
    if (p >= 0) this.counts[p]--;
    this.owner[f] = n;
    this.counts[n]++;
    this.changedAt[f] = this.time;
    this.onChange(f);
    const { neighbours: nb, isLand } = this.world;
    let pBorders = false;
    for (let k = 0; k < 3; k++) {
      const g = nb[f * 3 + k];
      if (!isLand[g]) continue;
      const o = this.owner[g];
      if (o === -1) this.fronts[n].neutral.add(g);
      else if (o !== n) this.fronts[n].enemy.add(g);
      if (o === p) pBorders = true;
    }
    if (p >= 0 && pBorders) this.fronts[p].enemy.add(f);
  }

  private release(f: number) {
    const p = this.owner[f];
    if (p < 0) return;
    this.counts[p]--;
    this.owner[f] = -1;
    this.changedAt[f] = this.time;
    this.onChange(f);
  }

  private growNeutral(n: number, budget: number) {
    const fr = this.fronts[n];
    let done = 0;
    let tries = budget * 3;
    while (done < budget && tries-- > 0 && fr.neutral.size) {
      const f = fr.neutral.pop(this.rng);
      const o = this.owner[f];
      if (o === -1) {
        this.claim(f, n);
        done++;
      } else if (o !== n) {
        fr.enemy.add(f);
      }
    }
  }

  private attack(n: number, budget: number) {
    const fr = this.fronts[n];
    let done = 0;
    let tries = budget * 3;
    while (done < budget && tries-- > 0 && fr.enemy.size) {
      const f = fr.enemy.pop(this.rng);
      const o = this.owner[f];
      if (o === n) continue;
      if (o === -1) {
        fr.neutral.add(f);
      } else {
        this.claim(f, n);
        done++;
      }
    }
  }

  /** Sails from one of a few random home ports, keeping the best crossing. */
  private launchBoat(n: number, allowEnemy: boolean) {
    const cap = this.phase === Phase.War && n === this.winner ? 22 : 7;
    if (this.inFlight[n] >= cap) return;
    const { coastal, centroids: c, massPull } = this.world;
    let src = -1;
    let best = -1;
    let bestScore = Infinity;
    for (let s = 0; s < 6; s++) {
      let from = -1;
      for (let k = 0; k < 40; k++) {
        const f = coastal[(this.rng() * coastal.length) | 0];
        if (this.owner[f] === n) {
          from = f;
          break;
        }
      }
      if (from < 0) continue;
      const sx = c[from * 3];
      const sy = c[from * 3 + 1];
      const sz = c[from * 3 + 2];
      for (let i = 0; i < coastal.length; i++) {
        const t = coastal[i];
        const o = this.owner[t];
        if (o === n || (o !== -1 && !allowEnemy)) continue;
        const d = sx * c[t * 3] + sy * c[t * 3 + 1] + sz * c[t * 3 + 2];
        if (d >= COS_MIN_HOP) continue;
        // Big landmasses count as closer than specks.
        const score = (1 - d) / (massPull[t] * massPull[t]);
        if (score < bestScore) {
          bestScore = score;
          best = t;
          src = from;
        }
      }
    }
    if (best < 0) return;
    const boat = this.boats.find((b) => !b.active);
    if (!boat) return;
    const dot =
      c[src * 3] * c[best * 3] +
      c[src * 3 + 1] * c[best * 3 + 1] +
      c[src * 3 + 2] * c[best * 3 + 2];
    const angle = Math.acos(Math.max(-1, Math.min(1, dot)));
    Object.assign(boat, {
      active: true,
      nation: n,
      src,
      dst: best,
      angle,
      t: 0,
      duration: 0.35 + angle * 1.4,
      allowEnemy,
    });
    this.inFlight[n]++;
  }

  private stepBoats(dt: number) {
    const { neighbours: nb, isLand } = this.world;
    for (const b of this.boats) {
      if (!b.active) continue;
      b.t += dt;
      if (b.t < b.duration) continue;
      b.active = false;
      this.inFlight[b.nation]--;
      if (this.phase !== Phase.Expand && this.phase !== Phase.War) continue;
      const o = this.owner[b.dst];
      if (o === b.nation || (o !== -1 && !b.allowEnemy)) continue;
      // Beachhead: the landing face plus two rings around it.
      this.claim(b.dst, b.nation);
      let ring = [b.dst];
      for (let r = 0; r < 2; r++) {
        const next: number[] = [];
        for (const f of ring) {
          for (let k = 0; k < 3; k++) {
            const g = nb[f * 3 + k];
            const go = this.owner[g];
            if (isLand[g] && go !== b.nation && (go === -1 || b.allowEnemy)) {
              this.claim(g, b.nation);
              next.push(g);
            }
          }
        }
        ring = next;
      }
    }
  }

  private nearestLand(lat: number, lon: number): number {
    const [x, y, z] = fromLatLon(lat, lon);
    const { landFaces, centroids: c } = this.world;
    let best = landFaces[0];
    let bd = -2;
    for (const f of landFaces) {
      const d = x * c[f * 3] + y * c[f * 3 + 1] + z * c[f * 3 + 2];
      if (d > bd) {
        bd = d;
        best = f;
      }
    }
    return best;
  }

  private pickSeeds(): number[] {
    const { landFaces, centroids: c, coastal } = this.world;
    const coastSet = new Set(coastal);
    const minDot = Math.cos(55 * DEG);
    const seeds: number[] = [];
    for (let tries = 0; seeds.length < NATION_COUNT && tries < 4000; tries++) {
      const f = landFaces[(this.rng() * landFaces.length) | 0];
      const lat = Math.asin(c[f * 3 + 1]) / DEG;
      if (lat < -45 || lat > 66 || coastSet.has(f)) continue;
      const apart = seeds.every(
        (s) =>
          c[s * 3] * c[f * 3] +
            c[s * 3 + 1] * c[f * 3 + 1] +
            c[s * 3 + 2] * c[f * 3 + 2] <
          minDot,
      );
      if (apart) seeds.push(f);
    }
    while (seeds.length < NATION_COUNT)
      seeds.push(this.firstSeeds[seeds.length]);
    return seeds;
  }
}

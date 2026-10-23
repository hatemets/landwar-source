import { IcosahedronGeometry } from "three";
import { LAND_MASK_HEIGHT, LAND_MASK_RUNS, LAND_MASK_WIDTH } from "./LandMask";

/**
 * The static half of the conquest globe: a subdivided icosahedron whose
 * triangles are classified as land or sea from the Natural Earth mask, with
 * edge adjacency, vertex heights and terrain colours. Built once per page and
 * shared by every globe on it.
 */
export interface ConquestWorld {
  /** Triangle count. */
  faces: number;
  /** Unit-sphere vertices, xyz per vertex. */
  vertices: Float32Array;
  /** Vertex indices, three per face. */
  faceVertices: Uint32Array;
  /** The three edge neighbours of each face. */
  neighbours: Int32Array;
  /** Unit centroid, xyz per face. */
  centroids: Float32Array;
  isLand: Uint8Array;
  landFaces: Int32Array;
  /** Land faces with at least one sea neighbour. */
  coastal: Int32Array;
  /** Grows with the size of the landmass a face is on; boats favour big ones. */
  massPull: Float32Array;
  /** Radius of each vertex: raised land, sloped coasts, lowered deep sea. */
  heights: Float32Array;
  /** Unowned colour of each face, sRGB 0-255. */
  baseColors: Float32Array;
  /** Per-face brightness jitter, ~0.93-1.05, for the faceted look. */
  shade: Float32Array;
}

const DETAIL = 64;
export const DEG = Math.PI / 180;

export function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** lon 0 on +x, east towards -z, north on +y. */
export function fromLatLon(lat: number, lon: number): [number, number, number] {
  const c = Math.cos(lat * DEG);
  return [
    c * Math.cos(lon * DEG),
    Math.sin(lat * DEG),
    -c * Math.sin(lon * DEG),
  ];
}
const latOf = (y: number) => Math.asin(Math.max(-1, Math.min(1, y))) / DEG;
const lonOf = (x: number, z: number) => Math.atan2(-z, x) / DEG;

/** Smooth, cheap pseudo-noise in 0..1 for terrain variety. */
function noise3(x: number, y: number, z: number): number {
  return (
    0.5 +
    0.5 *
      (0.55 *
        Math.sin(3.1 * x + 1.7) *
        Math.cos(2.9 * y - 0.4) *
        Math.sin(3.7 * z + 2.2) +
        0.3 * Math.sin(7.3 * x - 2.1 * y + 1.1) * Math.cos(5.7 * z + 0.3) +
        0.15 * Math.sin(13.1 * z + 11.3 * y - 4.1 * x))
  );
}

function decodeMask(): Uint8Array {
  const bin = atob(LAND_MASK_RUNS);
  const mask = new Uint8Array(LAND_MASK_WIDTH * LAND_MASK_HEIGHT);
  let i = 0;
  let p = 0;
  let land = false;
  while (p < bin.length) {
    let run = 0;
    let mul = 1;
    let b: number;
    do {
      b = bin.charCodeAt(p++);
      run += (b & 127) * mul;
      mul *= 128;
    } while (b & 128);
    if (land) mask.fill(1, i, i + run);
    i += run;
    land = !land;
  }
  return mask;
}

type Rgb = [number, number, number];
const hex = (h: number): Rgb => [(h >> 16) & 255, (h >> 8) & 255, h & 255];
const mix = (a: Rgb, b: Rgb, t: number): Rgb => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];

// Muted, like the in-game terrain, so the nation colours carry the scene.
const TERRAIN = {
  jungle: hex(0x5d7a52),
  grass: hex(0x7c8e62),
  savanna: hex(0x9f9a6c),
  desert: hex(0xbfa97f),
  steppe: hex(0x958d66),
  boreal: hex(0x5c6f5a),
  tundra: hex(0x8a9186),
  ice: hex(0xdae2ea),
  shallow: hex(0x2f8aa3),
  mid: hex(0x1f5f88),
  deep: hex(0x123660),
};

let cached: ConquestWorld | null = null;

export function conquestWorld(): ConquestWorld {
  cached ??= buildWorld();
  return cached;
}

function buildWorld(): ConquestWorld {
  const mask = decodeMask();
  const landAt = (lat: number, lon: number) => {
    const x =
      ((Math.floor(((lon + 180) / 360) * LAND_MASK_WIDTH) % LAND_MASK_WIDTH) +
        LAND_MASK_WIDTH) %
      LAND_MASK_WIDTH;
    const y = Math.min(
      LAND_MASK_HEIGHT - 1,
      Math.max(0, Math.floor(((90 - lat) / 180) * LAND_MASK_HEIGHT)),
    );
    return mask[y * LAND_MASK_WIDTH + x] === 1;
  };

  // three.js emits the polyhedron unindexed; weld it back into shared vertices.
  const ico = new IcosahedronGeometry(1, DETAIL);
  const raw = ico.attributes.position.array as Float32Array;
  ico.dispose();
  const F = raw.length / 9;
  const ids = new Map<string, number>();
  const vx: number[] = [];
  const fv = new Uint32Array(F * 3);
  for (let i = 0; i < F * 3; i++) {
    const x = raw[i * 3];
    const y = raw[i * 3 + 1];
    const z = raw[i * 3 + 2];
    const key = `${Math.round(x * 1e5)},${Math.round(y * 1e5)},${Math.round(z * 1e5)}`;
    let id = ids.get(key);
    if (id === undefined) {
      id = vx.length / 3;
      vx.push(x, y, z);
      ids.set(key, id);
    }
    fv[i] = id;
  }
  const V = vx.length / 3;
  const vertices = new Float32Array(vx);

  const nb = new Int32Array(F * 3).fill(-1);
  const edges = new Map<number, number>();
  for (let f = 0; f < F; f++) {
    for (let k = 0; k < 3; k++) {
      const a = fv[f * 3 + k];
      const b = fv[f * 3 + ((k + 1) % 3)];
      const key = a < b ? a * V + b : b * V + a;
      const g = edges.get(key);
      if (g === undefined) {
        edges.set(key, f * 3 + k);
      } else {
        nb[f * 3 + k] = (g / 3) | 0;
        nb[g] = f;
      }
    }
  }

  // Land by majority of the centroid and three points towards the corners.
  const cen = new Float32Array(F * 3);
  const isLand = new Uint8Array(F);
  for (let f = 0; f < F; f++) {
    let cx = 0;
    let cy = 0;
    let cz = 0;
    for (let k = 0; k < 3; k++) {
      const v = fv[f * 3 + k];
      cx += vertices[v * 3];
      cy += vertices[v * 3 + 1];
      cz += vertices[v * 3 + 2];
    }
    const l = Math.hypot(cx, cy, cz);
    cx /= l;
    cy /= l;
    cz /= l;
    cen[f * 3] = cx;
    cen[f * 3 + 1] = cy;
    cen[f * 3 + 2] = cz;
    let hits = landAt(latOf(cy), lonOf(cx, cz)) ? 1 : 0;
    for (let k = 0; k < 3; k++) {
      const v = fv[f * 3 + k];
      const sx = cx + vertices[v * 3];
      const sy = cy + vertices[v * 3 + 1];
      const sz = cz + vertices[v * 3 + 2];
      const sl = Math.hypot(sx, sy, sz);
      if (landAt(latOf(sy / sl), lonOf(sx / sl, sz / sl))) hits++;
    }
    isLand[f] = hits >= 2 ? 1 : 0;
  }

  const land: number[] = [];
  const coast: number[] = [];
  for (let f = 0; f < F; f++) {
    if (!isLand[f]) continue;
    land.push(f);
    if (
      !isLand[nb[f * 3]] ||
      !isLand[nb[f * 3 + 1]] ||
      !isLand[nb[f * 3 + 2]]
    ) {
      coast.push(f);
    }
  }

  const massPull = new Float32Array(F);
  const seen = new Uint8Array(F);
  for (const start of land) {
    if (seen[start]) continue;
    const comp = [start];
    seen[start] = 1;
    for (let i = 0; i < comp.length; i++) {
      for (let k = 0; k < 3; k++) {
        const g = nb[comp[i] * 3 + k];
        if (isLand[g] && !seen[g]) {
          seen[g] = 1;
          comp.push(g);
        }
      }
    }
    const pull = 1 + 0.12 * Math.sqrt(comp.length);
    for (const f of comp) massPull[f] = pull;
  }

  // Sea depth in face steps from the coast.
  const depth = new Uint8Array(F).fill(255);
  for (const f of land) depth[f] = 0;
  let ring = coast.slice();
  for (let d = 1; d <= 8 && ring.length; d++) {
    const next: number[] = [];
    for (const f of ring) {
      for (let k = 0; k < 3; k++) {
        const g = nb[f * 3 + k];
        if (depth[g] === 255) {
          depth[g] = d;
          next.push(g);
        }
      }
    }
    ring = next;
  }

  const rng = mulberry32(7);
  const vLand = new Uint8Array(V);
  const vSea = new Uint8Array(V);
  const vDepth = new Float32Array(V);
  for (let f = 0; f < F; f++) {
    for (let k = 0; k < 3; k++) {
      const v = fv[f * 3 + k];
      if (isLand[f]) vLand[v]++;
      else {
        vSea[v]++;
        vDepth[v] += Math.min(depth[f], 8);
      }
    }
  }
  const heights = new Float32Array(V);
  for (let v = 0; v < V; v++) {
    const n = noise3(
      vertices[v * 3] * 1.6,
      vertices[v * 3 + 1] * 1.6,
      vertices[v * 3 + 2] * 1.6,
    );
    const j = rng();
    if (!vSea[v]) heights[v] = 1.012 + 0.012 * n * n + 0.004 * j;
    else if (vLand[v]) heights[v] = 1.003 + 0.002 * j;
    else heights[v] = 0.996 - 0.006 * (vDepth[v] / vSea[v] / 8) + 0.0025 * j;
  }

  const crng = mulberry32(11);
  const baseColors = new Float32Array(F * 3);
  const shade = new Float32Array(F);
  for (let f = 0; f < F; f++) {
    shade[f] = 0.93 + 0.12 * crng();
    const x = cen[f * 3];
    const y = cen[f * 3 + 1];
    const z = cen[f * 3 + 2];
    const lat = latOf(y);
    const lon = lonOf(x, z);
    const a = Math.abs(lat);
    const n = noise3(x * 2.3, y * 2.3, z * 2.3);
    let c: Rgb;
    if (isLand[f]) {
      const greenland = lat > 59 && lon > -74 && lon < -12;
      if (a > 71 || lat < -60 || greenland) c = TERRAIN.ice;
      else if (a < 12) c = mix(TERRAIN.jungle, TERRAIN.grass, n);
      else if (a < 33) c = mix(TERRAIN.desert, TERRAIN.savanna, n);
      else if (a < 52) c = mix(TERRAIN.grass, TERRAIN.steppe, n);
      else
        c = mix(
          TERRAIN.boreal,
          TERRAIN.tundra,
          Math.min(1, (a - 52) / 18 + 0.3 * n),
        );
    } else {
      const d = depth[f];
      c =
        d <= 1
          ? TERRAIN.shallow
          : d <= 3
            ? mix(TERRAIN.shallow, TERRAIN.mid, (d - 1) / 2)
            : mix(TERRAIN.mid, TERRAIN.deep, Math.min(1, (d - 3) / 5));
    }
    baseColors[f * 3] = c[0] * shade[f];
    baseColors[f * 3 + 1] = c[1] * shade[f];
    baseColors[f * 3 + 2] = c[2] * shade[f];
  }

  return {
    faces: F,
    vertices,
    faceVertices: fv,
    neighbours: nb,
    centroids: cen,
    isLand,
    landFaces: Int32Array.from(land),
    coastal: Int32Array.from(coast),
    massPull,
    heights,
    baseColors,
    shade,
  };
}

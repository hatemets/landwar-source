/**
 * Vector unit sprites, drawn with Canvas2D at load time in place of the old
 * 13px pixel atlas.
 *
 * The layout matches what unit.frag.glsl expects: one 13×13-tile cell per
 * unit type (UnitPass's UNIT_ORDER), and the red channel carries a gray band
 * the shader swaps for the owner's colours:
 *   180 → territory colour, 130 → mid (territory/border mix),
 *   100 → centre accent (warship), 70 → border colour.
 * Anti-aliased edges between two bands land on an intermediate gray, which
 * the shader maps to the nearer band or the mid mix — a soft seam, not a
 * stray colour.
 */

/** Atlas pixels per sprite tile. */
export const UNIT_SPRITE_SCALE = 8;

const CELL = 13; // tiles per cell side (unit.vert.glsl's UNIT_SIZE quad)

const LIGHT = "rgb(180,180,180)"; // territory colour
const MID = "rgb(130,130,130)"; // territory/border mix
const CENTER = "rgb(100,100,100)"; // warship centre accent
const DARK = "rgb(70,70,70)"; // border colour
const WHITE = "rgb(255,255,255)"; // drawn as-is (shells, warheads)

type Ctx = CanvasRenderingContext2D;

/** A diamond with rounded corners, centred on the origin. */
function diamond(ctx: Ctx, r: number, round = 0.28): void {
  const c = r * round;
  ctx.beginPath();
  ctx.moveTo(-c, -r + c);
  ctx.quadraticCurveTo(0, -r, c, -r + c);
  ctx.lineTo(r - c, -c);
  ctx.quadraticCurveTo(r, 0, r - c, c);
  ctx.lineTo(c, r - c);
  ctx.quadraticCurveTo(0, r, -c, r - c);
  ctx.lineTo(-r + c, c);
  ctx.quadraticCurveTo(-r, 0, -r + c, -c);
  ctx.closePath();
}

function circle(ctx: Ctx, r: number): void {
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
}

function fill(ctx: Ctx, color: string, shape: () => void): void {
  shape();
  ctx.fillStyle = color;
  ctx.fill();
}

// One drawing per atlas column, in UnitPass's UNIT_ORDER, in tile units
// around the cell centre.
const SPRITES: ((ctx: Ctx) => void)[] = [
  // Transport: light diamond in a border-colour rim.
  (ctx) => {
    fill(ctx, DARK, () => diamond(ctx, 2.6));
    fill(ctx, LIGHT, () => diamond(ctx, 1.7));
  },
  // Trade ship: the inverse, a dark core in a light rim.
  (ctx) => {
    fill(ctx, LIGHT, () => diamond(ctx, 2.6));
    fill(ctx, DARK, () => diamond(ctx, 1.6));
  },
  // Warship: light outer ring (goes red when attacking), dark hull, centre
  // accent (blinks while retreating).
  (ctx) => {
    fill(ctx, LIGHT, () => diamond(ctx, 5.8, 0.42));
    fill(ctx, DARK, () => diamond(ctx, 4.3, 0.42));
    fill(ctx, CENTER, () => circle(ctx, 1.5));
  },
  // Atom bomb: mid-band shell around a light core.
  (ctx) => {
    fill(ctx, MID, () => circle(ctx, 3.3));
    fill(ctx, LIGHT, () => circle(ctx, 1.8));
  },
  // Hydrogen bomb: larger shell, diamond core.
  (ctx) => {
    fill(ctx, MID, () => circle(ctx, 4.6));
    fill(ctx, LIGHT, () => diamond(ctx, 2.6, 0.35));
  },
  // MIRV: large shell with a light ring and four warhead pips.
  (ctx) => {
    fill(ctx, MID, () => circle(ctx, 6.2));
    ctx.beginPath();
    ctx.arc(0, 0, 3.6, 0, Math.PI * 2);
    ctx.lineWidth = 0.9;
    ctx.strokeStyle = LIGHT;
    ctx.stroke();
    for (let i = 0; i < 4; i++) {
      const a = (i * Math.PI) / 2 + Math.PI / 4;
      ctx.save();
      ctx.translate(Math.cos(a) * 2.0, Math.sin(a) * 2.0);
      fill(ctx, LIGHT, () => circle(ctx, 0.75));
      ctx.restore();
    }
    fill(ctx, LIGHT, () => circle(ctx, 0.8));
  },
  // SAM missile: small mid diamond, light tip.
  (ctx) => {
    fill(ctx, MID, () => diamond(ctx, 1.5, 0.3));
    fill(ctx, LIGHT, () => circle(ctx, 0.55));
  },
  // Shell: a bright round slug.
  (ctx) => fill(ctx, WHITE, () => circle(ctx, 0.6)),
  // MIRV warhead.
  (ctx) => fill(ctx, WHITE, () => circle(ctx, 1.4)),
  // Train engine: solid border-colour diamond.
  (ctx) => fill(ctx, DARK, () => diamond(ctx, 1.6, 0.35)),
  // Train carriage: light car with a border-colour core.
  (ctx) => {
    fill(ctx, LIGHT, () => diamond(ctx, 1.6, 0.35));
    fill(ctx, DARK, () => circle(ctx, 0.55));
  },
  // Loaded carriage: same car, fuller core.
  (ctx) => {
    fill(ctx, LIGHT, () => diamond(ctx, 1.6, 0.35));
    fill(ctx, DARK, () => circle(ctx, 0.8));
  },
];

/**
 * Draw the unit atlas: `columns` cells of CELL×CELL tiles at
 * UNIT_SPRITE_SCALE px per tile. Returns null where Canvas2D is unavailable
 * (e.g. tests), so the caller keeps its placeholder texture.
 */
export function drawUnitAtlas(columns: number): HTMLCanvasElement | null {
  if (columns !== SPRITES.length) {
    throw new Error(
      `unit atlas has ${SPRITES.length} sprites, expected ${columns}`,
    );
  }
  if (typeof document === "undefined") return null;
  const k = UNIT_SPRITE_SCALE;
  const canvas = document.createElement("canvas");
  canvas.width = columns * CELL * k;
  canvas.height = CELL * k;
  const ctx = canvas.getContext("2d");
  if (ctx === null) return null;
  SPRITES.forEach((draw, col) => {
    ctx.save();
    ctx.scale(k, k);
    ctx.translate(col * CELL + CELL / 2, CELL / 2);
    draw(ctx);
    ctx.restore();
  });
  return canvas;
}

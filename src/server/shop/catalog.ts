import type { Cosmetics } from "@openfront/shared/CosmeticSchemas";

// What the shop sells. Everything here is free to use and costs soft currency,
// which players earn by playing. The flags are files in resources/flags. The
// patterns are drawn here from a few lines of code, so Kleopolis ships no
// licensed artwork.

type Rarity = "common" | "uncommon" | "rare" | "epic" | "legendary";

export const RARITY_PRICE: Record<Rarity, number> = {
  common: 300,
  uncommon: 500,
  rare: 900,
  epic: 1500,
  legendary: 2500,
};

// Players start with this much, enough for a first flag or pattern.
export const STARTING_SOFT = 1000;

// ---- Flags ----

const FLAG_FILES: [file: string, rarity: Rarity][] = [
  ["1_Kent", "common"],
  ["1_Essex", "common"],
  ["1_Sussex", "common"],
  ["Alabama", "common"],
  ["Alaska", "common"],
  ["Arizona", "common"],
  ["Arkansas", "common"],
  ["Athens", "common"],
  ["Atlanta", "common"],
  ["Austin", "common"],
  ["Dallas", "common"],
  ["1_Wessex", "uncommon"],
  ["1_Mercia", "uncommon"],
  ["1_Northumbria", "uncommon"],
  ["Aceh", "uncommon"],
  ["Acadiana", "uncommon"],
  ["Anishinaabe", "uncommon"],
  ["Arapaho", "uncommon"],
  ["Assyria", "uncommon"],
  ["Danu", "uncommon"],
  ["African union", "uncommon"],
  ["Arabia", "uncommon"],
  ["Abbasid Caliphate", "rare"],
  ["Achaemenid Empire", "rare"],
  ["Ayyubid Dynasty", "rare"],
  ["Almohad Dynasty", "rare"],
  ["Almoravid Dynasty", "rare"],
  ["Aram Damascus", "rare"],
  ["Adal Sultanate", "rare"],
  ["Alash Autonomy", "rare"],
  ["County of Tripoli", "rare"],
  ["Courland Governorate", "rare"],
  ["Armenian Kingdom Of Cilicia", "epic"],
  ["Crown Of Aragon", "epic"],
  ["Amazigh flag", "epic"],
  ["Alkebulan", "epic"],
  ["Ambazonia", "epic"],
  ["Australian Aboriginal Flag", "epic"],
  ["Cthulhu Republic", "legendary"],
  ["Anarchist flag", "legendary"],
];

export interface FlagItem {
  name: string;
  file: string;
  rarity: Rarity;
  priceSoft: number;
}

// "County of Tripoli" -> "county_of_tripoli". Names are a-z, 0-9 and _.
export function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export const FLAGS: FlagItem[] = FLAG_FILES.map(([file, rarity]) => ({
  name: slug(file),
  file: `${file}.svg`,
  rarity,
  priceSoft: RARITY_PRICE[rarity],
}));

// ---- Colour palettes ----

export interface Palette {
  name: string;
  primaryColor: string;
  secondaryColor: string;
}

export const PALETTES: Palette[] = [
  { name: "ember", primaryColor: "#b3402a", secondaryColor: "#f2c14e" },
  { name: "ocean", primaryColor: "#1d4e89", secondaryColor: "#7fb7be" },
  { name: "forest", primaryColor: "#2d6a4f", secondaryColor: "#b7e4c7" },
  { name: "royal", primaryColor: "#4a2c82", secondaryColor: "#d8b4fe" },
  { name: "mono", primaryColor: "#262626", secondaryColor: "#e5e5e5" },
  { name: "sunset", primaryColor: "#d62828", secondaryColor: "#f77f00" },
];

// ---- Patterns ----

// A pattern is a small bitmap, repeated over a player's land. A set bit paints
// the secondary colour. See PatternDecoder for the layout: a version byte, a
// byte with the scale and part of the width, a byte with the rest of the width
// and the height, then the bits, row by row, low bit first.
export function encodePattern(
  width: number,
  height: number,
  scale: number,
  secondary: (x: number, y: number) => boolean,
): string {
  const bytes = new Uint8Array(3 + ((width * height + 7) >> 3));
  bytes[0] = 0;
  bytes[1] = (scale & 0x07) | (((width - 2) & 0x1f) << 3);
  bytes[2] = (((width - 2) >> 5) & 0x03) | (((height - 2) & 0x3f) << 2);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!secondary(x, y)) continue;
      const idx = y * width + x;
      bytes[3 + (idx >> 3)]! |= 1 << (idx & 7);
    }
  }
  return Buffer.from(bytes).toString("base64url");
}

interface PatternDef {
  name: string;
  rarity: Rarity;
  data: string;
}

const PATTERN_DEFS: PatternDef[] = [
  {
    name: "stripes",
    rarity: "common",
    data: encodePattern(4, 4, 1, (_x, y) => y % 2 === 1),
  },
  {
    name: "checker",
    rarity: "common",
    data: encodePattern(4, 4, 1, (x, y) => (x + y) % 2 === 1),
  },
  {
    name: "pinstripe",
    rarity: "common",
    data: encodePattern(8, 2, 1, (x) => x % 4 === 0),
  },
  {
    name: "dots",
    rarity: "uncommon",
    data: encodePattern(8, 8, 1, (x, y) => x % 4 === 1 && y % 4 === 1),
  },
  {
    name: "diagonal",
    rarity: "uncommon",
    data: encodePattern(8, 8, 1, (x, y) => (x + y) % 4 < 2),
  },
  {
    name: "grid",
    rarity: "uncommon",
    data: encodePattern(8, 8, 1, (x, y) => x % 4 === 0 || y % 4 === 0),
  },
  {
    name: "bricks",
    rarity: "rare",
    data: encodePattern(
      8,
      8,
      1,
      (x, y) => y % 4 === 0 || x % 8 === (y < 4 ? 0 : 4),
    ),
  },
  {
    name: "zigzag",
    rarity: "rare",
    data: encodePattern(
      8,
      4,
      1,
      (x, y) => (x % 8 < 4 ? x % 4 : 7 - (x % 8)) === y,
    ),
  },
  {
    name: "rings",
    rarity: "epic",
    data: encodePattern(8, 8, 1, (x, y) => {
      const d = Math.max(Math.abs(x - 3.5), Math.abs(y - 3.5));
      return d > 1 && d < 3;
    }),
  },
];

export interface PatternItem {
  name: string;
  rarity: Rarity;
  data: string;
  priceSoft: number;
}

export const PATTERNS: PatternItem[] = PATTERN_DEFS.map((p) => ({
  ...p,
  priceSoft: RARITY_PRICE[p.rarity] + 100,
}));

// ---- Lookups ----

export const flagFlare = (name: string) => `flag:${name}`;
export const patternFlare = (name: string, palette: string) =>
  `pattern:${name}:${palette}`;

export interface Offer {
  flare: string;
  priceSoft: number;
}

// The item a purchase names, or null when the shop does not sell it.
export function findOffer(
  type: string,
  name: string,
  palette?: string,
): Offer | null {
  if (type === "flag") {
    const flag = FLAGS.find((f) => f.name === name);
    return flag
      ? { flare: flagFlare(flag.name), priceSoft: flag.priceSoft }
      : null;
  }
  if (type === "pattern") {
    const pattern = PATTERNS.find((p) => p.name === name);
    if (!pattern || !palette || !PALETTES.some((p) => p.name === palette)) {
      return null;
    }
    return {
      flare: patternFlare(pattern.name, palette),
      priceSoft: pattern.priceSoft,
    };
  }
  return null;
}

// The catalog in the shape the client reads (cosmetics.json).
export function buildCatalog(): Cosmetics {
  return {
    colorPalettes: Object.fromEntries(PALETTES.map((p) => [p.name, p])),
    patterns: Object.fromEntries(
      PATTERNS.map((p) => [
        p.name,
        {
          name: p.name,
          product: null,
          priceSoft: p.priceSoft,
          rarity: p.rarity,
          pattern: p.data,
          colorPalettes: PALETTES.map((c) => ({
            name: c.name,
            isArchived: false,
          })),
        },
      ]),
    ),
    flags: Object.fromEntries(
      FLAGS.map((f) => [
        f.name,
        {
          name: f.name,
          product: null,
          priceSoft: f.priceSoft,
          rarity: f.rarity,
          // A path under resources/. The client turns it into an asset URL.
          url: `flags/${f.file}`,
        },
      ]),
    ),
  } as Cosmetics;
}

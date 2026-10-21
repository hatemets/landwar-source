import { CosmeticsSchema } from "@openfront/shared/CosmeticSchemas";
import { decodePatternData } from "@openfront/shared/PatternDecoder";
import fs from "fs";
import { base64url } from "jose";
import path from "path";
import { describe, expect, it } from "vitest";
import {
  buildCatalog,
  encodePattern,
  findOffer,
  FLAGS,
  PALETTES,
  PATTERNS,
  slug,
} from "../../../src/server/shop/catalog";

describe("shop catalog", () => {
  it("passes the client's own catalog schema", () => {
    expect(() => CosmeticsSchema.parse(buildCatalog())).not.toThrow();
  });

  it("sells flags that exist as files", () => {
    for (const flag of FLAGS) {
      const file = path.join(__dirname, "../../../resources/flags", flag.file);
      expect(fs.existsSync(file), flag.file).toBe(true);
    }
  });

  it("gives every item a unique valid name and a price", () => {
    const names = [...FLAGS.map((f) => f.name), ...PATTERNS.map((p) => p.name)];
    expect(new Set(names).size).toBe(names.length);
    for (const item of [...FLAGS, ...PATTERNS]) {
      expect(item.name).toMatch(/^[a-z0-9_]+$/);
      expect(item.priceSoft).toBeGreaterThan(0);
    }
  });

  it("slugs a file name", () => {
    expect(slug("County of Tripoli")).toBe("county_of_tripoli");
    expect(slug("1_Wessex")).toBe("1_wessex");
    expect(slug("Anarchist flag")).toBe("anarchist_flag");
  });

  it("draws patterns the game can decode", () => {
    for (const p of PATTERNS) {
      const decoded = decodePatternData(p.data, base64url.decode);
      expect(decoded.width).toBeGreaterThanOrEqual(2);
      expect(decoded.height).toBeGreaterThanOrEqual(2);
    }
  });

  it("encodes the bits where the decoder reads them", () => {
    // 4x4, secondary on odd rows.
    const data = encodePattern(4, 4, 1, (_x, y) => y % 2 === 1);
    const { bytes, width } = decodePatternData(data, base64url.decode);
    expect(width).toBe(4);
    // Row 1 is bits 4-7 of the first data byte. Rows 0 and 2 stay clear.
    expect(bytes[3]! & 0x0f).toBe(0);
    expect(bytes[3]! >> 4).toBe(0x0f);
    expect(bytes[4]! & 0x0f).toBe(0);
    expect(bytes[4]! >> 4).toBe(0x0f);
  });

  it("finds an offer, and refuses what it does not sell", () => {
    const flag = FLAGS[0]!;
    expect(findOffer("flag", flag.name)).toEqual({
      flare: `flag:${flag.name}`,
      priceSoft: flag.priceSoft,
    });
    const pattern = PATTERNS[0]!;
    expect(findOffer("pattern", pattern.name, PALETTES[0]!.name)).toEqual({
      flare: `pattern:${pattern.name}:${PALETTES[0]!.name}`,
      priceSoft: pattern.priceSoft,
    });
    // A pattern needs a palette.
    expect(findOffer("pattern", pattern.name)).toBeNull();
    expect(findOffer("pattern", pattern.name, "nope")).toBeNull();
    expect(findOffer("flag", "nope")).toBeNull();
    expect(findOffer("crown", "x")).toBeNull();
  });
});

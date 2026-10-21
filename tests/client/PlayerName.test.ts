import { UsernameSchema } from "@openfront/engine-api/Schemas";
import { describe, expect, it } from "vitest";
import {
  clampUsername,
  fallbackPlayerName,
  genAnonUsername,
  looksGenerated,
  resolvePlayerName,
  type PlayerNameInputs,
} from "../../src/client/PlayerName";
import { MAX_USERNAME_LENGTH } from "../../src/client/validations/username";

// The resolver takes plain values, so every case below is expressed as a full
// set of inputs rather than by mounting the component.
function inputs(overrides: Partial<PlayerNameInputs> = {}): PlayerNameInputs {
  return {
    storedName: null,
    generatedName: "AnonBadger",
    ...overrides,
  };
}

describe("resolvePlayerName precedence", () => {
  it("uses the stored name when there is one", () => {
    expect(resolvePlayerName(inputs({ storedName: "MyCoolName" }))).toEqual({
      name: "MyCoolName",
      source: "stored",
      verified: false,
    });
  });

  it("uses the generated name when nothing is stored", () => {
    expect(resolvePlayerName(inputs())).toEqual({
      name: "AnonBadger",
      source: "generated",
      verified: false,
    });
  });

  // A blank or whitespace-only stored name is not a name — it is the player
  // having cleared the field, which the component reports as invalid. The
  // resolver must not hand the join an empty string.
  it("treats a blank stored name as absent", () => {
    expect(resolvePlayerName(inputs({ storedName: "   " })).source).toBe(
      "generated",
    );
    expect(resolvePlayerName(inputs({ storedName: "" })).source).toBe(
      "generated",
    );
  });

  it("trims and clamps a stored name rather than rejecting it", () => {
    const long = "a".repeat(MAX_USERNAME_LENGTH + 7);
    expect(resolvePlayerName(inputs({ storedName: long })).name).toBe(
      "a".repeat(MAX_USERNAME_LENGTH),
    );
    expect(resolvePlayerName(inputs({ storedName: "  Spaced  " })).name).toBe(
      "Spaced",
    );
  });

  // The player typed it; resolution reports it as-is so the component can show
  // its own validation error, rather than silently swapping in another name.
  it("keeps an invalid stored name instead of falling through", () => {
    expect(resolvePlayerName(inputs({ storedName: "ab" }))).toEqual({
      name: "ab",
      source: "stored",
      verified: false,
    });
  });

  // The generated branch must be representable on the wire, or the join
  // socket closes with 1002 and the Play button stays lit.
  it("returns a wire-valid generated name", () => {
    const resolved = resolvePlayerName(
      inputs({ generatedName: genAnonUsername() }),
    );
    expect(UsernameSchema.safeParse(resolved.name).success).toBe(true);
  });
});

describe("looksGenerated", () => {
  it("recognises what genAnonUsername produces", () => {
    for (let i = 0; i < 200; i++) {
      const name = genAnonUsername();
      expect(looksGenerated(name), name).toBe(true);
    }
  });

  it("does not claim an ordinary name", () => {
    for (const name of [
      "Ada",
      "AnonymousCoward",
      "Anonymous",
      "Anon",
      "AnonBadger42",
      "NotAnonBadger",
      "anonbadger",
      "José",
    ]) {
      expect(looksGenerated(name), name).toBe(false);
    }
  });
});

describe("clampUsername", () => {
  it("trims a name that predates the cap rather than rejecting it", () => {
    expect(clampUsername("a".repeat(MAX_USERNAME_LENGTH + 7))).toBe(
      "a".repeat(MAX_USERNAME_LENGTH),
    );
  });

  it("leaves a name within the cap alone", () => {
    expect(clampUsername("MyCoolName")).toBe("MyCoolName");
  });
});

describe("fallbackPlayerName", () => {
  // The join path's last resort when the component is missing entirely.
  it("is a wire-valid generated name", () => {
    const resolved = fallbackPlayerName();
    expect(resolved.source).toBe("generated");
    expect(resolved.verified).toBe(false);
    expect(UsernameSchema.safeParse(resolved.name).success).toBe(true);
  });
});

describe("genAnonUsername", () => {
  it("produces wire-valid names", () => {
    for (let i = 0; i < 200; i++) {
      const name = genAnonUsername();
      expect(name).toMatch(/^[A-Za-z]+ [A-Za-z]+ \d{2}$/);
      expect(name.startsWith("Anon")).toBe(false);
      expect(name.length).toBeLessThanOrEqual(MAX_USERNAME_LENGTH);
      expect(UsernameSchema.safeParse(name).success, name).toBe(true);
    }
  });
});

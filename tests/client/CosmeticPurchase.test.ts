import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  purchaseCosmetic,
  type ResolvedCosmetic,
} from "../../src/client/Cosmetics";

vi.mock("../../src/client/Api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/client/Api")>()),
  getUserMe: vi.fn(),
  invalidateUserMe: vi.fn(),
  purchaseWithCurrency: vi.fn(),
}));

vi.mock("../../src/client/InGameModal", () => ({
  showInGameAlert: vi.fn().mockResolvedValue(true),
  showInGameConfirm: vi.fn().mockResolvedValue(true),
}));

const { getUserMe, invalidateUserMe, purchaseWithCurrency } =
  await import("../../src/client/Api");
const { showInGameAlert } = await import("../../src/client/InGameModal");

const translations = {
  "cosmetics.soft": "caps",
  "inventory.selected_cosmetic_variant": "{name} ({variant})",
  "territory_patterns.pattern.stripes": "Ocean Stripes",
  "territory_patterns.color_palette.red": "Crimson",
  "flags.pirate": "Jolly Roger",
  "store.already_owned": "already owned",
  "store.purchase_failed": "failed",
  "store.purchase_success": "bought {name}",
};

const stripesRed: ResolvedCosmetic = {
  type: "pattern",
  cosmetic: {
    name: "stripes",
    pattern: "AAAAAA",
    product: null,
    priceSoft: 400,
    rarity: "rare",
  } as never,
  colorPalette: {
    name: "red",
    primaryColor: "#ef4444",
    secondaryColor: "#7f1d1d",
  },
  relationship: "purchasable",
  key: "pattern:stripes:red",
};

const pirateFlag: ResolvedCosmetic = {
  type: "flag",
  cosmetic: { name: "pirate", priceSoft: 400 },
  colorPalette: null,
  relationship: "purchasable",
  key: "flag:pirate",
} as unknown as ResolvedCosmetic;

function userWith(soft: number) {
  return { player: { currency: { hard: 0, soft }, flares: [] } } as never;
}

describe("purchaseCosmetic", () => {
  let languageFixture: HTMLElement;
  let reloadMock: ReturnType<typeof vi.fn>;
  const originalLocation = window.location;

  beforeEach(() => {
    languageFixture = document.createElement("lang-selector");
    Object.assign(languageFixture, {
      translations,
      defaultTranslations: translations,
      currentLang: "en",
    });
    document.body.appendChild(languageFixture);
    reloadMock = vi.fn();
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...originalLocation, reload: reloadMock },
    });
    vi.mocked(getUserMe).mockResolvedValue(userWith(5000));
  });

  afterEach(() => {
    languageFixture.remove();
    Object.defineProperty(window, "location", {
      configurable: true,
      value: originalLocation,
    });
    vi.mocked(getUserMe).mockReset();
    vi.mocked(invalidateUserMe).mockReset();
    vi.mocked(purchaseWithCurrency).mockReset();
    vi.mocked(showInGameAlert).mockClear();
  });

  it("names the colour when the balance is short", async () => {
    vi.mocked(getUserMe).mockResolvedValue(userWith(10));

    const result = await purchaseCosmetic(stripesRed, "soft");

    // Every palette of a pattern shares one name, so "you need 390 more for
    // Ocean Stripes" would not say which tile is short.
    expect(result).toMatchObject({
      item: "Ocean Stripes (Crimson)",
      shortfall: 390,
      currency: "caps",
    });
    expect(purchaseWithCurrency).not.toHaveBeenCalled();
  });

  it("asks the player to sign in when there is no account", async () => {
    vi.mocked(getUserMe).mockResolvedValue(false);
    translations["store.login_required" as keyof typeof translations] =
      "log in";

    const result = await purchaseCosmetic(pirateFlag, "soft");

    expect(result).toBeUndefined();
    expect(purchaseWithCurrency).not.toHaveBeenCalled();
  });

  it("buys the item and reloads so it shows as owned", async () => {
    vi.mocked(purchaseWithCurrency).mockResolvedValue({ ok: true });

    const result = await purchaseCosmetic(pirateFlag, "soft");

    expect(purchaseWithCurrency).toHaveBeenCalledWith(
      "flag",
      "pirate",
      "soft",
      undefined,
    );
    expect(showInGameAlert).toHaveBeenCalledWith("bought pirate");
    expect(result).toBeUndefined();
    expect(invalidateUserMe).toHaveBeenCalled();
    expect(reloadMock).toHaveBeenCalledTimes(1);
  });

  it("reloads on an already-owned refusal rather than telling the player to retry", async () => {
    vi.mocked(purchaseWithCurrency).mockResolvedValue({
      ok: false,
      code: "already_owned",
    });

    const result = await purchaseCosmetic(pirateFlag, "soft");

    expect(showInGameAlert).toHaveBeenCalledWith("already owned");
    // A retry would 409 again, so "try again" would loop forever.
    expect(showInGameAlert).not.toHaveBeenCalledWith("failed");
    expect(result).toBeUndefined();
    expect(invalidateUserMe).toHaveBeenCalled();
    expect(reloadMock).toHaveBeenCalledTimes(1);
  });

  it("reports an unknown refusal as a failure without reloading", async () => {
    vi.mocked(purchaseWithCurrency).mockResolvedValue({
      ok: false,
      code: "failed",
    });

    await purchaseCosmetic(pirateFlag, "soft");

    expect(showInGameAlert).toHaveBeenCalledWith("failed");
    expect(reloadMock).not.toHaveBeenCalled();
  });
});

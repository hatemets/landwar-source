import type { UserMeResponse } from "@openfront/shared/ApiSchemas";
import type { Cosmetics } from "@openfront/shared/CosmeticSchemas";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getUserMe } from "../../src/client/Api";
import { fetchCosmetics, purchaseCosmetic } from "../../src/client/Cosmetics";
import "../../src/client/Store";
import type { StoreModal } from "../../src/client/Store";
import { encodePattern } from "../../src/server/shop/catalog";

vi.mock("../../src/client/Api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/client/Api")>()),
  getUserMe: vi.fn(),
}));

vi.mock("../../src/client/Cosmetics", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/client/Cosmetics")>()),
  fetchCosmetics: vi.fn(),
  purchaseCosmetic: vi.fn(),
}));

const base = { product: null, affiliateCode: null } as const;

const catalog = {
  colorPalettes: {
    red: { name: "red", primaryColor: "#f00", secondaryColor: "#fff" },
    blue: { name: "blue", primaryColor: "#00f", secondaryColor: "#fff" },
  },
  patterns: {
    stripes: {
      ...base,
      name: "stripes",
      rarity: "common",
      priceSoft: 400,
      pattern: encodePattern(4, 4, 1, (_x, y) => y % 2 === 1),
      colorPalettes: [
        { name: "red", isArchived: false },
        { name: "blue", isArchived: false },
      ],
    },
  },
  flags: {
    cheap: {
      ...base,
      name: "cheap",
      rarity: "common",
      priceSoft: 300,
      url: "a.svg",
    },
    dear: {
      ...base,
      name: "dear",
      rarity: "legendary",
      priceSoft: 2500,
      url: "b.svg",
    },
    mine: {
      ...base,
      name: "mine",
      rarity: "common",
      priceSoft: 500,
      url: "c.svg",
    },
  },
} as unknown as Cosmetics;

const me = (soft: number, flares: string[] = []): UserMeResponse =>
  ({
    user: {},
    player: {
      publicId: "p1",
      flares,
      currency: { soft, hard: 0 },
      friends: [],
      clans: [],
    },
  }) as unknown as UserMeResponse;

const settle = async (modal: StoreModal) => {
  for (let i = 0; i < 4; i++) {
    await modal.updateComplete;
    await new Promise((r) => setTimeout(r, 0));
  }
};

describe("StoreModal", () => {
  let modal: StoreModal;

  async function openAs(profile: UserMeResponse | false, tab = "patterns") {
    vi.mocked(getUserMe).mockResolvedValue(profile);
    vi.mocked(fetchCosmetics).mockResolvedValue(catalog);
    modal.inline = true;
    modal.open();
    await settle(modal);
    if (tab !== "patterns") {
      modal.setActiveTab(tab);
      await settle(modal);
    }
  }
  const items = () =>
    Array.from(modal.querySelectorAll<HTMLElement>("[data-store-item]"));
  const buyButton = (key: string) =>
    modal.querySelector<HTMLButtonElement>(
      `[data-store-item="${key}"] [data-store-buy]`,
    );

  beforeEach(() => {
    vi.mocked(purchaseCosmetic).mockReset();
    modal = document.createElement("store-modal") as StoreModal;
    document.body.appendChild(modal);
  });
  afterEach(() => modal.remove());

  it("shows the balance in the header", async () => {
    await openAs(me(1234));
    expect(
      modal
        .querySelector("[data-store-balance]")
        ?.getAttribute("data-store-balance"),
    ).toBe("1234");
  });

  it("groups a pattern's colours into one card and prices it", async () => {
    await openAs(me(1000));
    expect(items().map((i) => i.dataset.storeItem)).toEqual([
      "pattern:stripes:red",
    ]);
    expect(buyButton("pattern:stripes:red")?.dataset.price).toBe("400");
  });

  it("lists flags cheapest first, and marks what is owned", async () => {
    await openAs(me(1000, ["flag:mine"]), "flags");
    expect(items().map((i) => i.dataset.storeItem)).toEqual([
      "flag:cheap",
      "flag:mine",
      "flag:dear",
    ]);
    expect(buyButton("flag:mine")?.disabled).toBe(true);
    expect(buyButton("flag:mine")?.textContent).toContain("store.owned");
    expect(buyButton("flag:cheap")?.disabled).toBe(false);
  });

  it("buys the item on the card with soft currency", async () => {
    vi.mocked(purchaseCosmetic).mockResolvedValue(undefined);
    await openAs(me(1000), "flags");
    buyButton("flag:cheap")!.click();
    await settle(modal);
    expect(purchaseCosmetic).toHaveBeenCalledTimes(1);
    const [resolved, method] = vi.mocked(purchaseCosmetic).mock.calls[0]!;
    expect(method).toBe("soft");
    expect(resolved.key).toBe("flag:cheap");
  });

  it("shows the shortfall when the purchase says the player is short", async () => {
    vi.mocked(purchaseCosmetic).mockResolvedValue({
      currency: "Caps",
      shortfall: 1500,
      item: "Dear",
    });
    await openAs(me(1000), "flags");
    buyButton("flag:dear")!.click();
    await settle(modal);
    const dialog = modal.querySelector("insufficient-currency-dialog");
    expect(dialog).toBeTruthy();
    expect(
      (dialog as unknown as { info: { shortfall: number } }).info.shortfall,
    ).toBe(1500);

    dialog!.dispatchEvent(new CustomEvent("close"));
    await settle(modal);
    expect(modal.querySelector("insufficient-currency-dialog")).toBeNull();
  });

  it("does not start a second purchase while one is running", async () => {
    let finish: () => void = () => {};
    vi.mocked(purchaseCosmetic).mockReturnValue(
      new Promise((resolve) => (finish = () => resolve(undefined))),
    );
    await openAs(me(1000), "flags");
    buyButton("flag:cheap")!.click();
    buyButton("flag:mine")!.click();
    await settle(modal);
    expect(purchaseCosmetic).toHaveBeenCalledTimes(1);
    finish();
  });

  it("filters by the search box", async () => {
    await openAs(me(1000), "flags");
    const input = modal.querySelector<HTMLInputElement>("input[type=text]")!;
    input.value = "dea";
    input.dispatchEvent(new Event("input"));
    await settle(modal);
    expect(items().map((i) => i.dataset.storeItem)).toEqual(["flag:dear"]);
  });

  it("asks a signed-out visitor to sign in, and hides the balance", async () => {
    await openAs(false);
    expect(modal.querySelector("[data-store-balance]")).toBeNull();
    expect(modal.textContent).toContain("store.login_required");
  });

  it("offers a retry when the catalog will not load", async () => {
    vi.mocked(getUserMe).mockResolvedValue(me(10));
    vi.mocked(fetchCosmetics).mockResolvedValue(null);
    modal.inline = true;
    modal.open();
    await settle(modal);
    expect(modal.querySelector("[data-store-state=error]")).toBeTruthy();
  });
});

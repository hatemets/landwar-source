import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/client/Api", () => ({
  fetchPlayerById: vi.fn(async () => ({ stats: {} })),
  getUserMe: vi.fn(async () => ({
    user: {
      email: "player@example.com",
      google: { email: "player@example.com" },
    },
    player: {
      publicId: "player-1",
      friends: [],
      rewards: [],
      clans: [],
      clanRequests: [],
    },
  })),
  invalidateUserMe: vi.fn(),
}));

vi.mock("../../src/client/Auth", () => ({
  linkGoogle: vi.fn(),
}));

vi.mock("../../src/client/Utils", () => ({
  currentPagePath: vi.fn((path: string) => path),
  translateText: vi.fn(
    (key: string, params?: Record<string, string>) =>
      `${key}${params ? JSON.stringify(params) : ""}`,
  ),
}));

vi.mock(
  "../../src/client/components/baseComponents/stats/PlayerGameHistoryView",
  () => ({}),
);
vi.mock(
  "../../src/client/components/baseComponents/stats/PlayerStatsTable",
  () => ({}),
);
vi.mock(
  "../../src/client/components/baseComponents/stats/PlayerStatsTree",
  () => ({}),
);
vi.mock("../../src/client/components/CopyButton", () => ({}));
vi.mock("../../src/client/components/CurrencyDisplay", () => ({}));
vi.mock("../../src/client/components/Difficulties", () => ({}));
vi.mock("../../src/client/components/FriendsList", () => ({}));
vi.mock("../../src/client/GameStatsModal", () => ({}));
vi.mock("../../src/client/PlayerProfileModal", () => ({}));

import { AccountModal } from "../../src/client/AccountModal";

const EMAIL = "player@example.com";

describe("Account email privacy", () => {
  let modal: AccountModal;

  beforeEach(async () => {
    localStorage.clear();
    if (!customElements.get("account-modal")) {
      customElements.define("account-modal", AccountModal);
    }
    modal = document.createElement("account-modal") as AccountModal;
    modal.setAttribute("inline", "");
    document.body.appendChild(modal);
    modal.open({ tab: "account" });
    await vi.waitFor(async () => {
      await modal.updateComplete;
      expect(modal.querySelector("[data-account-email]")).not.toBeNull();
    });
  });

  afterEach(() => {
    modal.remove();
    localStorage.clear();
  });

  it("hides the email until the player reveals it", async () => {
    expect(modal.textContent).not.toContain(EMAIL);

    const toggle = modal.querySelector<HTMLButtonElement>(
      'button[aria-label="account_modal.show_email"]',
    );
    expect(toggle).not.toBeNull();
    toggle!.click();
    await modal.updateComplete;

    expect(modal.textContent).toContain(EMAIL);
    expect(localStorage.getItem("settings.accountEmailVisible")).toBe("true");

    modal
      .querySelector<HTMLButtonElement>(
        'button[aria-label="account_modal.hide_email"]',
      )!
      .click();
    await modal.updateComplete;
    expect(modal.textContent).not.toContain(EMAIL);
  });
});

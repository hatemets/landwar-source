import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { isOnCrazyGames } = vi.hoisted(() => ({
  isOnCrazyGames: vi.fn(() => false),
}));
vi.mock("@openfront/shared/AssetUrls", () => ({
  assetUrl: (path: string) => path,
}));

// Rendering play-page mounts its children too (steam-wishlist, cosmetic
// background, …), and some reach for browser APIs jsdom doesn't ship.
vi.stubGlobal(
  "ResizeObserver",
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
);

import { PlayPage } from "../../src/client/components/PlayPage";
import { SiteHeader } from "../../src/client/components/SiteHeader";

describe("site header", () => {
  let el: SiteHeader | PlayPage;

  async function mount(tag = "site-header") {
    if (!customElements.get("site-header")) {
      customElements.define("site-header", SiteHeader);
    }
    if (!customElements.get("play-page")) {
      customElements.define("play-page", PlayPage);
    }
    el = document.createElement(tag) as SiteHeader | PlayPage;
    document.body.appendChild(el);
    await el.updateComplete;
  }

  afterEach(() => {
    el?.remove();
    vi.clearAllMocks();
    isOnCrazyGames.mockReturnValue(false);
  });

  // The phone and desktop profile triggers are two instances; only one is
  // shown at a time (lg:hidden / hidden lg:block).
  const rightSlot = () =>
    Array.from(el.querySelector("header .menu-topbar__actions")!.children).map(
      (c) => c.tagName.toLowerCase(),
    );

  describe("off CrazyGames", () => {
    beforeEach(() => mount());

    it("puts utility icons, profile menus and language picker in one row", () => {
      expect(rightSlot()).toEqual([
        "nav-utility-icons",
        "details",
        "nav-account-menu",
        "nav-account-menu",
        "lang-selector",
      ]);
    });

    it("renders exactly one language selector", () => {
      expect(el.querySelectorAll("lang-selector")).toHaveLength(1);
    });
  });

  describe("on CrazyGames", () => {
    beforeEach(async () => {
      isOnCrazyGames.mockReturnValue(true);
      await mount();
    });

    it("renders the same controls — the menu covers their sign-in too", () => {
      // News and Help left the hamburger, so the icons have to be here for
      // CrazyGames players; the profile menu's own "Sign in" item hands off to
      // their SDK prompt, so no platform-specific button is needed.
      expect(rightSlot()).toEqual([
        "nav-utility-icons",
        "details",
        "nav-account-menu",
        "nav-account-menu",
        "lang-selector",
      ]);
    });
  });

  describe("legal line", () => {
    beforeEach(() => mount("play-page"));

    it("shows the copyright notice and links the source code", () => {
      const line = el.querySelector(".menu-legal")!;
      expect(line.textContent).toContain("main.copyright");
      const link = line.querySelector("a")!;
      expect(link.getAttribute("href")).toMatch(
        /^https:\/\/github\.com\/hatemets\/landwar-source/,
      );
      expect(link.textContent).toBe("main.source_code");
    });
  });
});

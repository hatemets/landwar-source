import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { logOut, showInGameConfirm, copyToClipboard, showToast } = vi.hoisted(
  () => ({
    logOut: vi.fn(async () => {}),
    showInGameConfirm: vi.fn(async () => true),
    copyToClipboard: vi.fn(async (_text: string) => {}),
    showToast: vi.fn(),
  }),
);
vi.mock("../../src/client/Auth", () => ({ logOut }));
vi.mock("../../src/client/InGameModal", () => ({ showInGameConfirm }));
vi.mock("../../src/client/Navigation", () => ({
  closeMobileSidebar: vi.fn(),
}));
vi.mock("../../src/client/Utils", () => ({
  translateText: (key: string) => key,
  copyToClipboard,
  showToast,
}));

import type { UserMeResponse } from "@openfront/shared/ApiSchemas";
import { NavAccountMenu } from "../../src/client/components/NavAccountMenu";
import { updateAccountNavButton } from "../../src/client/NavAccountButton";

function userMe(publicId = "p"): UserMeResponse {
  return {
    user: { email: "player@example.com" },
    player: { publicId },
  } as unknown as UserMeResponse;
}

function fireUserMe(detail: UserMeResponse | false) {
  document.dispatchEvent(new CustomEvent("userMeResponse", { detail }));
}

describe("nav-account-menu", () => {
  let el: NavAccountMenu;

  beforeEach(async () => {
    // The @customElement decorator's define() side-effect doesn't run under the
    // test transform, so register the element explicitly.
    if (!customElements.get("nav-account-menu")) {
      customElements.define("nav-account-menu", NavAccountMenu);
    }
    el = document.createElement("nav-account-menu") as NavAccountMenu;
    document.body.appendChild(el);
    await el.updateComplete;
  });

  afterEach(() => {
    el.remove();
    vi.clearAllMocks();
    window.showPage = undefined;
  });

  const trigger = () =>
    el.querySelector<HTMLButtonElement>("[data-account-trigger]")!;
  // The panel is portalled to document.body (see NavAccountMenu.updated).
  const menu = () => document.querySelector('[role="menu"]');
  const itemKeys = () =>
    Array.from(document.querySelectorAll("[data-menu-item]")).map((n) =>
      n.getAttribute("data-menu-item"),
    );

  async function click(node: Element) {
    node.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await el.updateComplete;
  }

  it("shows sign-in and sign-up directly while signed out", async () => {
    fireUserMe(false);
    await el.updateComplete;
    expect(trigger()).toBeNull();
    expect(el.querySelector(".menu-auth-signin")).not.toBeNull();
    expect(el.querySelector(".menu-auth-signup")).not.toBeNull();
    const showPage = vi.fn();
    window.showPage = showPage;
    await click(el.querySelector(".menu-auth-signin")!);
    expect(showPage).toHaveBeenLastCalledWith("page-signin");
    await click(el.querySelector(".menu-auth-signup")!);
    expect(showPage).toHaveBeenLastCalledWith("page-signup");
  });

  it("treats an anonymous session as signed out", async () => {
    fireUserMe({
      user: {},
      player: { publicId: "p" },
    } as unknown as UserMeResponse);
    await el.updateComplete;
    expect(trigger()).toBeNull();
    expect(el.querySelector(".menu-auth-signin")).not.toBeNull();
    expect(el.querySelector(".menu-auth-signup")).not.toBeNull();
  });

  it("toggles the menu for a signed-in user", async () => {
    fireUserMe(userMe());
    await el.updateComplete;
    await click(trigger());
    expect(menu()).not.toBeNull();
    expect(trigger().getAttribute("aria-expanded")).toBe("true");
    await click(trigger());
    expect(menu()).toBeNull();
  });

  it("copies the profile URL and toasts, and hides without a publicId", async () => {
    fireUserMe(userMe());
    await el.updateComplete;
    await click(trigger());
    await click(document.querySelector('[data-menu-item="copy-profile-url"]')!);
    await new Promise((r) => setTimeout(r, 0));

    expect(copyToClipboard).toHaveBeenCalledTimes(1);
    expect(vi.mocked(copyToClipboard).mock.calls[0][0]).toContain("/player/p");
    expect(showToast).toHaveBeenCalledWith("common.copied", "green");

    // No publicId (older backend / unresolved player) — nothing to share.
    fireUserMe(userMe(""));
    await el.updateComplete;
    await click(trigger());
    expect(itemKeys()).not.toContain("copy-profile-url");
  });

  it("logs out only after the confirmation is accepted", async () => {
    fireUserMe(userMe());
    await el.updateComplete;
    await click(trigger());

    showInGameConfirm.mockResolvedValueOnce(false);
    await click(document.querySelector('[data-menu-item="log-out"]')!);
    await new Promise((r) => setTimeout(r, 0));
    expect(logOut).not.toHaveBeenCalled();

    await click(trigger());
    await click(document.querySelector('[data-menu-item="log-out"]')!);
    await new Promise((r) => setTimeout(r, 0));
    expect(logOut).toHaveBeenCalledTimes(1);
  });

  it("seeds itself from the cached auth state when created late", async () => {
    // Auth resolves once, early. A menu mounted afterwards never sees the
    // userMeResponse event, so it has to read the cached response instead.
    updateAccountNavButton(userMe());

    const late = document.createElement("nav-account-menu") as NavAccountMenu;
    document.body.appendChild(late);
    await late.updateComplete;
    await late.updateComplete;

    late
      .querySelector("[data-account-trigger]")!
      .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await late.updateComplete;
    expect(menu()).not.toBeNull();
    late.remove();
  });

  it("portals the panel to the body and takes it down again", async () => {
    // Rendered inside the nav it would inherit the nav's stacking context —
    // which put it under open modals, and the nav over the toasts.
    fireUserMe(userMe());
    await el.updateComplete;
    await click(trigger());

    const panel = menu()!;
    expect(panel).not.toBeNull();
    expect(el.contains(panel)).toBe(false);
    expect(panel.closest("body")).not.toBeNull();

    await click(trigger());
    expect(menu()).toBeNull();
  });

  it("closes when a click lands outside the menu", async () => {
    fireUserMe(userMe());
    await el.updateComplete;
    await click(trigger());
    expect(menu()).not.toBeNull();

    document.body.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await el.updateComplete;
    expect(menu()).toBeNull();
  });
});

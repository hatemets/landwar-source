// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_USERNAME_LENGTH } from "../src/client/validations/username";

// Partial: only translateText is stubbed (echoing keys so assertions read as
// i18n keys). The rest of Utils stays real.
vi.mock("../src/client/Utils", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/client/Utils")>()),
  translateText: (key: string, vars?: Record<string, unknown>) =>
    vars ? `${key}:${JSON.stringify(vars)}` : key,
}));

// Side-effect import registers <username-input>; vi.mock is hoisted above it.
import "../src/client/UsernameInput";
import type { UsernameInput as UsernameInputEl } from "../src/client/UsernameInput";

async function mount(): Promise<UsernameInputEl> {
  const el = document.createElement("username-input") as UsernameInputEl;
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
}

const q = <T extends HTMLElement>(el: UsernameInputEl, sel: string) =>
  el.querySelector<T>(sel);

function type(el: UsernameInputEl, value: string) {
  const input = q<HTMLInputElement>(el, "#player-username")!;
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = "";
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("UsernameInput", () => {
  it("shows one username field", async () => {
    const el = await mount();
    expect(q(el, "#player-username")).not.toBeNull();
  });

  it("starts on a generated name that is valid to play with", async () => {
    const el = await mount();
    expect(el.getUsername()).not.toBe("");
    expect(el.resolvedName().verified).toBe(false);
    expect(el.canPlay()).toBe(true);
  });

  it("uses the stored name", async () => {
    localStorage.setItem("username", "MyCoolName");
    localStorage.setItem("usernameIsGenerated", "false");
    const el = await mount();
    expect(el.getUsername()).toBe("MyCoolName");
    expect(el.resolvedName().source).toBe("stored");
  });

  it("stores a name the player types and marks it as theirs", async () => {
    const el = await mount();
    type(el, "Ada Lovelace");
    await el.updateComplete;

    expect(el.getUsername()).toBe("Ada Lovelace");
    expect(localStorage.getItem("username")).toBe("Ada Lovelace");
    expect(localStorage.getItem("usernameIsGenerated")).toBe("false");
  });

  it("strips brackets from what is typed", async () => {
    const el = await mount();
    const toast = vi.fn();
    window.addEventListener("show-message", toast);
    type(el, "[Ada]");
    await el.updateComplete;
    window.removeEventListener("show-message", toast);

    expect(el.getUsername()).toBe("Ada");
    expect(toast).toHaveBeenCalledTimes(1);
  });

  it("blocks play while the field holds an invalid name", async () => {
    const el = await mount();
    const validity: boolean[] = [];
    const onValidity = (e: Event) =>
      validity.push((e as CustomEvent<{ isValid: boolean }>).detail.isValid);
    window.addEventListener("username-validity-change", onValidity);
    type(el, "a");
    await el.updateComplete;
    window.removeEventListener("username-validity-change", onValidity);

    expect(el.canPlay()).toBe(false);
    expect(validity[validity.length - 1]).toBe(false);
    expect(el.validationError).not.toBe("");
    // The invalid text is not saved over the last good name.
    expect(localStorage.getItem("username")).not.toBe("a");
  });
});

describe("UsernameInput name length", () => {
  it("trims a stored name that predates the cap instead of blocking play", async () => {
    const long = "a".repeat(MAX_USERNAME_LENGTH + 7);
    localStorage.setItem("username", long);
    localStorage.setItem("usernameIsGenerated", "false");

    const el = await mount();

    expect(el.getUsername()).toBe("a".repeat(MAX_USERNAME_LENGTH));
    expect(el.canPlay()).toBe(true);
  });

  it("caps what can be typed into the field", async () => {
    const el = await mount();
    expect(
      q<HTMLInputElement>(el, 'input[aria-label="username.enter_username"]')!
        .maxLength,
    ).toBe(MAX_USERNAME_LENGTH);
  });
});

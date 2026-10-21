import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { showInGameAlert } from "../../src/client/InGameModal";
import { consumeLinkResult } from "../../src/client/LinkResult";

vi.mock("../../src/client/InGameModal", () => ({
  showInGameAlert: vi.fn(async () => undefined),
}));

vi.mock("../../src/client/Utils", () => ({
  translateText: (key: string) => key,
}));

const alertMock = vi.mocked(showInGameAlert);

function setHash(hash: string) {
  history.replaceState(null, "", hash);
}

beforeEach(() => {
  alertMock.mockClear();
});

afterEach(() => {
  history.replaceState(null, "", "/");
});

describe("consumeLinkResult", () => {
  it.each([
    ["google", "account_modal.link_google_success"],
    ["already_linked", "account_modal.link_google_already_linked"],
    ["error", "account_modal.link_google_error"],
  ])("surfaces %s", (link, expectedKey) => {
    setHash(`#modal=account&link=${link}`);

    consumeLinkResult({ modal: "account", link });

    expect(alertMock).toHaveBeenCalledTimes(1);
    expect(alertMock).toHaveBeenCalledWith(expectedKey);
  });

  it("says nothing when the user cancelled at the provider", () => {
    setHash("#modal=account&link=cancel");

    consumeLinkResult({ modal: "account", link: "cancel" });

    expect(alertMock).not.toHaveBeenCalled();
  });

  // `link` is read straight off the URL hash, so it is attacker-chosen. A
  // plain object lookup inherits from Object.prototype, so these names resolve
  // to inherited members rather than undefined and would be shown to the user.
  it.each([
    "toString",
    "constructor",
    "__proto__",
    "valueOf",
    "hasOwnProperty",
  ])("says nothing for the inherited property %s", (link) => {
    setHash(`#modal=account&link=${link}`);

    consumeLinkResult({ modal: "account", link });

    expect(alertMock).not.toHaveBeenCalled();
  });

  it("says nothing for an unrecognised result", () => {
    setHash("#modal=account&link=something-new");

    consumeLinkResult({ modal: "account", link: "something-new" });

    expect(alertMock).not.toHaveBeenCalled();
  });

  it("says nothing when there is no link arg", () => {
    consumeLinkResult({ modal: "account" });

    expect(alertMock).not.toHaveBeenCalled();
  });

  // One-shot: a refresh or a re-open must not replay it.
  it("strips the param but leaves the rest of the hash", () => {
    setHash("#modal=account&link=google");

    consumeLinkResult({ modal: "account", link: "google" });

    expect(window.location.hash).toBe("#modal=account");
  });

  it("clears the hash entirely when link was the only param", () => {
    setHash("#link=google");

    consumeLinkResult({ link: "google" });

    expect(window.location.hash).toBe("");
  });
});

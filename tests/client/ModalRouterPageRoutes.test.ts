import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/client/LazyModals", () => ({
  loadModal: () => Promise.resolve(),
}));
vi.mock("../../src/client/PagePin", () => ({ pagePin: () => null }));

import { modalRouter } from "../../src/client/ModalRouter";

class FakePage extends HTMLElement {
  opened: Record<string, unknown>[] = [];
  closed = 0;
  open(args: Record<string, unknown> = {}) {
    this.opened.push(args);
  }
  close() {
    this.closed++;
  }
}
customElements.define("fake-page", FakePage);
modalRouter.register("fake", {
  tag: "fake-page",
  pageId: "page-fake",
  path: "/fake",
});

describe("ModalRouter page routes", () => {
  let el: FakePage;

  beforeEach(() => {
    document.body.innerHTML = "";
    el = document.createElement("fake-page") as FakePage;
    document.body.appendChild(el);
    history.replaceState(null, "", "/");
  });

  it("pushes the page's path when it opens in-app", () => {
    const before = history.length;
    modalRouter.syncOpened("fake", { tab: "audio" });
    expect(window.location.pathname).toBe("/fake");
    expect(window.location.search).toBe("?tab=audio");
    expect(history.length).toBe(before + 1);
  });

  it("returns to the home path when the page closes", () => {
    modalRouter.syncOpened("fake");
    modalRouter.syncClosed("fake");
    expect(window.location.pathname).toBe("/");
  });

  it("closes the page when Back leaves its path", () => {
    modalRouter.syncOpened("fake");
    history.replaceState(null, "", "/");
    expect(modalRouter.routeFromHistory()).toBe(true);
    expect(el.closed).toBe(1);
    // The URL already moved: the close must not rewrite it.
    expect(window.location.pathname).toBe("/");
  });

  it("opens the page from its path with the query as args", async () => {
    history.replaceState(null, "", "/fake?tab=audio");
    expect(modalRouter.routeFromHistory()).toBe(true);
    await vi.waitFor(() => expect(el.opened).toEqual([{ tab: "audio" }]));
  });

  it("rewrites an old #modal= link to the page's path", async () => {
    history.replaceState(null, "", "/#modal=fake&tab=audio");
    expect(modalRouter.routeFromHash()).toBe(true);
    expect(window.location.pathname).toBe("/fake");
    expect(window.location.search).toBe("?tab=audio");
    expect(window.location.hash).toBe("");
    await vi.waitFor(() => expect(el.opened).toEqual([{ tab: "audio" }]));
  });
});

// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getApiBase, getAudience } from "../src/client/Api";
import { ClientEnv } from "../src/client/ClientEnv";

const { getAuthHeader, logOut, userAuth, isSessionActive, getPlayToken } =
  vi.hoisted(() => ({
    getAuthHeader: vi.fn(async () => "Bearer test"),
    logOut: vi.fn(async () => true),
    userAuth: vi.fn(async () => ({
      jwt: "jwt",
      claims: { sub: "player-1" },
    })),
    isSessionActive: vi.fn(() => true),
    getPlayToken: vi.fn(async () => "token"),
  }));
vi.mock("../src/client/Auth", () => ({
  getAuthHeader,
  logOut,
  userAuth,
  isSessionActive,
  getPlayToken,
}));

function setConfig(jwtAudience: string) {
  (window as any).BOOTSTRAP_CONFIG = {
    gameEnv: "prod",
    numWorkers: 1,
    turnstileSiteKey: "x",
    jwtAudience,
    instanceId: "desktop",
    gitCommit: "test",
  };
  ClientEnv.reset();
}

// setConfig sets window.BOOTSTRAP_CONFIG; clear it (and the cached env) after
// every test so a stray value can't leak into a later test.
afterEach(() => {
  delete (window as any).BOOTSTRAP_CONFIG;
  ClientEnv.reset();
});

describe("getAudience / getApiBase from BOOTSTRAP_CONFIG", () => {
  beforeEach(() => ClientEnv.reset());

  it("serves the API from the page's own origin in every environment", () => {
    for (const audience of ["localhost", "landwar.example"]) {
      setConfig(audience);
      expect(getAudience()).toBe(audience);
      expect(getApiBase()).toBe("/api");
    }
  });
});

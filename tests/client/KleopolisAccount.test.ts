import { UserMeResponseSchema } from "@openfront/shared/ApiSchemas";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fetchAccountProfile,
  toUserMeCandidate,
} from "../../src/client/KleopolisAccount";

const account = {
  id: "0b0f6d52-2d2e-4a43-8d3d-6f6a5c1f2a01",
  publicId: "abc123",
  displayName: "Tester",
  email: "t@example.com",
  avatarUrl: null,
  google: true,
  discord: false,
};

describe("toUserMeCandidate", () => {
  it("carries the shop's currency and owned items to the profile", () => {
    const parsed = UserMeResponseSchema.parse(
      toUserMeCandidate(account, {
        ratings: { oneVone: { elo: 1016 } },
        currency: { soft: 700, hard: 0 },
        flares: ["flag:1_essex", "pattern:checker:ember"],
      }),
    );
    expect(parsed.player.currency).toEqual({ soft: 700, hard: 0 });
    expect(parsed.player.flares).toEqual([
      "flag:1_essex",
      "pattern:checker:ember",
    ]);
    expect(parsed.player.leaderboard?.oneVone?.elo).toBe(1016);
  });

  it("owns nothing and has no wallet when the server sent none", () => {
    const parsed = UserMeResponseSchema.parse(toUserMeCandidate(account));
    expect(parsed.player.flares).toEqual([]);
    expect(parsed.player.currency).toBeUndefined();
  });
});

describe("sign-in methods", () => {
  it("names only the providers the account has", () => {
    const discordOnly = UserMeResponseSchema.parse(
      toUserMeCandidate({ ...account, google: false, discord: true }),
    );
    expect(discordOnly.user.google).toBeUndefined();
    expect(discordOnly.user.discord?.username).toBe("Tester");

    const googleOnly = UserMeResponseSchema.parse(toUserMeCandidate(account));
    expect(googleOnly.user.google).toEqual({ email: "t@example.com" });
    expect(googleOnly.user.discord).toBeUndefined();
  });
});

describe("fetchAccountProfile", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("reads /api/me into a profile with ratings and the wallet", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        status: 200,
        json: async () => ({
          user: account,
          ratings: { ffa: { elo: 1100 } },
          currency: { soft: 1000, hard: 0 },
          flares: ["flag:1_kent"],
        }),
      })),
    );
    const profile = await fetchAccountProfile(new AbortController().signal);
    if (profile === false) throw new Error("expected a profile");
    expect(profile.player.currency?.soft).toBe(1000);
    expect(profile.player.flares).toEqual(["flag:1_kent"]);
    expect(profile.player.leaderboard?.ffa?.elo).toBe(1100);
  });

  it("reads a signed-out answer as no profile", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ status: 200, json: async () => ({ user: null }) })),
    );
    expect(await fetchAccountProfile(new AbortController().signal)).toBe(false);
  });
});

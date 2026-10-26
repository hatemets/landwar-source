import { describe, expect, it, vi } from "vitest";
import { readDiscordProfile } from "../../../src/server/auth/discord";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const user = {
  id: "80351110224678912",
  username: "nelly",
  global_name: "Nelly",
  avatar: "8342729096ea3675442027381ff50dfe",
  email: "nelly@example.com",
  verified: true,
};

describe("readDiscordProfile", () => {
  it("returns the profile and sends the access token", async () => {
    const fetchFn = vi.fn(async () => jsonResponse(200, user));
    const profile = await readDiscordProfile("tok-1", fetchFn as typeof fetch);
    expect(profile).toEqual({
      sub: "80351110224678912",
      email: "nelly@example.com",
      name: "Nelly",
      picture:
        "https://cdn.discordapp.com/avatars/80351110224678912/8342729096ea3675442027381ff50dfe.png?size=128",
    });
    const init = (fetchFn.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect(new Headers(init.headers).get("authorization")).toBe("Bearer tok-1");
  });

  it("falls back to the username and no picture", async () => {
    const fetchFn = vi.fn(async () =>
      jsonResponse(200, { ...user, global_name: null, avatar: null }),
    );
    const profile = await readDiscordProfile("tok", fetchFn as typeof fetch);
    expect(profile.name).toBe("nelly");
    expect(profile.picture).toBeNull();
  });

  it("refuses an unverified or missing email", async () => {
    for (const body of [
      { ...user, verified: false },
      { ...user, email: null },
    ]) {
      const fetchFn = vi.fn(async () => jsonResponse(200, body));
      await expect(
        readDiscordProfile("tok", fetchFn as typeof fetch),
      ).rejects.toThrow("not verified");
    }
  });

  it("fails on an HTTP error", async () => {
    const fetchFn = vi.fn(async () => jsonResponse(401, {}));
    await expect(
      readDiscordProfile("tok", fetchFn as typeof fetch),
    ).rejects.toThrow("HTTP 401");
  });
});

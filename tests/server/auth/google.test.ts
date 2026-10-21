import { describe, expect, it, vi } from "vitest";
import { readGoogleProfile } from "../../../src/server/auth/google";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("readGoogleProfile", () => {
  it("returns the profile and sends the access token", async () => {
    const fetchFn = vi.fn(async () =>
      jsonResponse(200, {
        sub: "1234567890",
        email: "player@example.com",
        email_verified: true,
        name: "Player One",
        picture: "https://lh3.example/p.png",
      }),
    );
    const profile = await readGoogleProfile("tok-1", fetchFn as typeof fetch);
    expect(profile).toEqual({
      sub: "1234567890",
      email: "player@example.com",
      name: "Player One",
      picture: "https://lh3.example/p.png",
    });
    const init = (fetchFn.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect(new Headers(init.headers).get("authorization")).toBe("Bearer tok-1");
  });

  it("refuses an unverified email", async () => {
    const fetchFn = vi.fn(async () =>
      jsonResponse(200, {
        sub: "1",
        email: "a@example.com",
        email_verified: false,
      }),
    );
    await expect(
      readGoogleProfile("tok", fetchFn as typeof fetch),
    ).rejects.toThrow("not verified");
  });

  it("fails on an HTTP error", async () => {
    const fetchFn = vi.fn(async () => jsonResponse(401, {}));
    await expect(
      readGoogleProfile("tok", fetchFn as typeof fetch),
    ).rejects.toThrow("HTTP 401");
  });

  it("fails on a body with no subject", async () => {
    const fetchFn = vi.fn(async () =>
      jsonResponse(200, { email: "a@example.com" }),
    );
    await expect(
      readGoogleProfile("tok", fetchFn as typeof fetch),
    ).rejects.toThrow("unexpected shape");
  });
});

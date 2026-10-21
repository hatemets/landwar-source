import { SignJWT } from "jose";
import { describe, expect, it } from "vitest";
import { sessionSecret } from "../../../src/server/auth/config";
import {
  JOIN_TOKEN_AUDIENCE,
  JOIN_TOKEN_ISSUER,
  signJoinToken,
  verifyJoinToken,
} from "../../../src/server/auth/joinToken";

const USER_ID = "7d1f5c2e-3b4a-4c5d-8e9f-0a1b2c3d4e5f";

describe("join token", () => {
  it("round-trips a user token", async () => {
    const { token } = await signJoinToken({ sub: USER_ID, kind: "user" });
    const result = await verifyJoinToken(token);
    expect(result).toEqual({
      type: "success",
      claims: { sub: USER_ID, kind: "user" },
    });
  });

  it("round-trips a guest token", async () => {
    const { token } = await signJoinToken({ sub: USER_ID, kind: "guest" });
    const result = await verifyJoinToken(token);
    expect(result.type === "success" && result.claims.kind).toBe("guest");
  });

  it("rejects a token signed with another secret", async () => {
    const forged = await new SignJWT({ kind: "user" })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(USER_ID)
      .setIssuer(JOIN_TOKEN_ISSUER)
      .setAudience(JOIN_TOKEN_AUDIENCE)
      .setExpirationTime("15m")
      .sign(
        new TextEncoder().encode("another-secret-that-is-long-enough-0000"),
      );
    expect((await verifyJoinToken(forged)).type).toBe("error");
  });

  it("rejects a token for another audience", async () => {
    const wrong = await new SignJWT({ kind: "user" })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(USER_ID)
      .setIssuer(JOIN_TOKEN_ISSUER)
      .setAudience("some-other-service")
      .setExpirationTime("15m")
      .sign(sessionSecret());
    expect((await verifyJoinToken(wrong)).type).toBe("error");
  });

  it("rejects an expired token", async () => {
    const past = Math.floor(Date.now() / 1000) - 60;
    const expired = await new SignJWT({ kind: "user" })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(USER_ID)
      .setIssuer(JOIN_TOKEN_ISSUER)
      .setAudience(JOIN_TOKEN_AUDIENCE)
      .setExpirationTime(past)
      .sign(sessionSecret());
    expect((await verifyJoinToken(expired)).type).toBe("error");
  });

  it("rejects a token whose subject is not a UUID", async () => {
    const bad = await new SignJWT({ kind: "user" })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject("not-a-uuid")
      .setIssuer(JOIN_TOKEN_ISSUER)
      .setAudience(JOIN_TOKEN_AUDIENCE)
      .setExpirationTime("15m")
      .sign(sessionSecret());
    expect((await verifyJoinToken(bad)).type).toBe("error");
  });

  it("rejects an alg=none token", async () => {
    const header = Buffer.from(JSON.stringify({ alg: "none" })).toString(
      "base64url",
    );
    const body = Buffer.from(
      JSON.stringify({
        sub: USER_ID,
        kind: "user",
        iss: JOIN_TOKEN_ISSUER,
        aud: JOIN_TOKEN_AUDIENCE,
      }),
    ).toString("base64url");
    expect((await verifyJoinToken(`${header}.${body}.`)).type).toBe("error");
  });
});

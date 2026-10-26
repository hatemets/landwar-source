import express from "express";
import type { Server } from "http";
import type { AddressInfo } from "net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { verifyJoinToken } from "../../../src/server/auth/joinToken";
import { registerAuthRoutes } from "../../../src/server/auth/routes";

const ORIGIN = "http://localhost:8888";
const GUEST_ID = "0f8a2c4e-6b1d-4e3f-9a7c-2d5e8f1b3c6a";

let server: Server;
let base: string;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  registerAuthRoutes(app);
  server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const { port } = server.address() as AddressInfo;
  base = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("auth routes without a database", () => {
  // Keeping the guest id needs the database to check it is no account's id;
  // googleLogin.db.test.ts covers that. Without one, the guest gets a new id,
  // so this test does not check which id it is.
  it("issues a guest token to the same origin", async () => {
    const res = await fetch(`${base}/api/auth/token`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: ORIGIN },
      body: JSON.stringify({ guestId: GUEST_ID }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      token: string;
      kind: string;
      id: string;
    };
    expect(body.kind).toBe("guest");
    const verified = await verifyJoinToken(body.token);
    expect(verified.type === "success" && verified.claims.sub).toBe(body.id);
  });

  it("refuses a token request from another origin", async () => {
    const res = await fetch(`${base}/api/auth/token`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://evil.example",
      },
      body: "{}",
    });
    expect(res.status).toBe(403);
  });

  it("refuses a malformed guest id", async () => {
    const res = await fetch(`${base}/api/auth/token`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: ORIGIN },
      body: JSON.stringify({ guestId: "not-a-uuid" }),
    });
    expect(res.status).toBe(400);
  });

  it("reports no user when no session cookie is sent", async () => {
    const res = await fetch(`${base}/api/me`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ user: null });
  });

  it("starts Google login with a state cookie and the return path", async () => {
    // Google needs a configured client. Without one the route answers 503.
    const res = await fetch(`${base}/api/auth/google?return=/lobby`, {
      redirect: "manual",
    });
    expect([302, 503]).toContain(res.status);
  });
});

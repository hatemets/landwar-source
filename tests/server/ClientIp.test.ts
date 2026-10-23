import type http from "node:http";
import { describe, expect, it } from "vitest";
import { clientIp } from "../../src/server/ClientIp";

function req(remoteAddress: string, xff?: string): http.IncomingMessage {
  return {
    socket: { remoteAddress },
    headers: xff === undefined ? {} : { "x-forwarded-for": xff },
  } as unknown as http.IncomingMessage;
}

describe("clientIp", () => {
  it("reads the client behind nginx and Caddy", () => {
    // Caddy sets "<client>", nginx appends Caddy's address.
    expect(clientIp(req("127.0.0.1", "203.0.113.7, 172.18.0.3"))).toBe(
      "203.0.113.7",
    );
  });

  it("ignores addresses the client put in X-Forwarded-For itself", () => {
    expect(clientIp(req("127.0.0.1", "1.1.1.1, 203.0.113.7, 172.18.0.3"))).toBe(
      "203.0.113.7",
    );
  });

  it("falls back to the furthest address with no proxy in front", () => {
    expect(clientIp(req("192.0.2.5"))).toBe("192.0.2.5");
    expect(clientIp(req("127.0.0.1", "192.0.2.5"))).toBe("192.0.2.5");
  });
});

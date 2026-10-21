import { ServerListSchema } from "@openfront/shared/ServerList";
import express from "express";
import type { Server } from "http";
import type { AddressInfo } from "net";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { registerClusterListRoute } from "../../src/server/ClusterListRoute";

describe("cluster list route", () => {
  let server: Server;
  let base: string;

  beforeAll(() => {
    const app = express();
    registerClusterListRoute(app);
    server = app.listen(0);
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => {
    server.close();
  });
  afterEach(() => vi.unstubAllEnvs());

  it("lists nothing for a build without a commit sha", async () => {
    vi.stubEnv("GIT_COMMIT", "DEV");
    const res = await fetch(`${base}/api/cluster.json?site=x`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ servers: {} });
  });

  it("lists this server as open for a real build", async () => {
    const sha = "0123456789abcdef0123456789abcdef01234567";
    vi.stubEnv("GIT_COMMIT", sha);
    vi.stubEnv("GAME_ENV", "dev");
    vi.stubEnv("INSTANCE_LETTER", "b");
    const res = await fetch(`${base}/api/cluster.json`);
    const list = ServerListSchema.parse(await res.json());
    expect(list.latest).toBe(sha);
    expect(list.servers.b).toMatchObject({ version: sha, state: "open" });
    expect(list.servers.b?.host).toContain("127.0.0.1");
  });
});

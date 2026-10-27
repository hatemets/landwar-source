import express from "express";
import fs from "fs";
import http from "http";
import type { AddressInfo } from "net";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const loadGameRecordMock = vi.hoisted(() => vi.fn());

vi.mock("../../src/server/RenderHtml", () => ({
  getAppShellContent: async () =>
    `<html><head><title data-i18n="main.title">Kleopolis</title><meta name="description" content="Generic" /></head><body></body></html>`,
  setHtmlNoCacheHeaders: (res: express.Response) => {
    res.setHeader("Content-Type", "text/html");
  },
}));
vi.mock("../../src/server/db", () => ({ db: () => ({ db: {} }) }));
vi.mock("../../src/server/GameStore", () => ({
  loadGameRecord: loadGameRecordMock,
}));
vi.mock("../../src/server/GamePreviewBuilder", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  buildPreview: async (gameID: string, origin: string, workerPath: string) => ({
    title: `FFA on <World>`,
    description: "Winner: Bob & co",
    image: "https://cdn.example/world.webp",
    joinUrl: `${origin}/${workerPath}/game/${gameID}`,
  }),
}));

import { registerGamePreviewRoute } from "../../src/server/GamePreviewRoute";
import { ServerEnv } from "../../src/server/ServerEnv";

describe("game preview route", () => {
  let server: http.Server;
  let base: string;
  let tmp: string;

  beforeEach(async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "game-route-"));
    fs.mkdirSync(path.join(tmp, "static"));
    fs.writeFileSync(path.join(tmp, "static/index.html"), "template");
    loadGameRecordMock.mockReset();
    const app = express();
    registerGamePreviewRoute({
      app,
      gm: { game: () => null } as never,
      workerId: 0,
      log: { warn: vi.fn(), error: vi.fn() } as never,
      baseDir: path.join(tmp, "dist/server"),
    });
    server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  test("a finished game gets a title, description and canonical link", async () => {
    loadGameRecordMock.mockResolvedValue({
      info: { config: { gameType: "Public" }, end: 1 },
    });
    const res = await fetch(`${base}/game/AbCdEfGh`);
    expect(res.status).toBe(200);
    const html = await res.text();
    const worker = ServerEnv.workerPath("AbCdEfGh");
    expect(html).toContain("<title>FFA on &lt;World&gt; - Kleopolis</title>");
    expect(html).toContain(
      '<meta name="description" content="Winner: Bob &amp; co" >',
    );
    expect(html).toContain(
      `<link rel="canonical" href="http://localhost:8888/${worker}/game/AbCdEfGh" >`,
    );
    expect(html).toContain(
      '<meta name="twitter:card" content="summary_large_image" >',
    );
    expect(html.match(/<title/g)).toHaveLength(1);
    expect(html.match(/name="description"/g)).toHaveLength(1);
    expect(html).not.toContain("noindex");
  });

  test("a private game is not indexed", async () => {
    loadGameRecordMock.mockResolvedValue({
      info: { config: { gameType: "Private" }, end: 1 },
    });
    const html = await (await fetch(`${base}/game/AbCdEfGh`)).text();
    expect(html).toContain('<meta name="robots" content="noindex" >');
  });
});

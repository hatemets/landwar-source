import express from "express";
import fs from "fs";
import http from "http";
import type { AddressInfo } from "net";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const getAppShellContentMock = vi.hoisted(() => vi.fn());

vi.mock("../../src/server/RenderHtml", () => ({
  getAppShellContent: getAppShellContentMock,
  setAppShellCacheHeaders: (res: express.Response) => {
    res.setHeader("Content-Type", "text/html");
  },
}));

import { registerPlayerProfileRoute } from "../../src/server/PlayerProfileRoute";
import type { ProfileSummary } from "../../src/server/stats/seoQueries";
import { stripWorkerPrefix } from "../../src/server/WorkerPathPrefix";

const SHELL = `<!doctype html><html><head>
<title data-i18n="main.title">Kleopolis</title>
<meta name="description" content="Generic" />
<meta property="og:title" content="Kleopolis" />
<meta property="og:image" content="https://kleopolis.io/shot.png" />
<meta property="og:type" content="game" />
</head><body>app</body></html>`;

describe("profile link route", () => {
  let server: http.Server;
  let base: string;
  let tmp: string;
  const log = { error: vi.fn(), warn: vi.fn() };
  const loadProfile = vi.fn<(id: string) => Promise<ProfileSummary | null>>();

  beforeEach(async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "profile-route-"));
    fs.mkdirSync(path.join(tmp, "static"));
    fs.mkdirSync(path.join(tmp, "dist/server"), { recursive: true });
    fs.writeFileSync(path.join(tmp, "static/index.html"), "template");

    getAppShellContentMock.mockReset();
    getAppShellContentMock.mockResolvedValue(SHELL);
    loadProfile.mockReset();
    loadProfile.mockImplementation(async (id) =>
      id === "abc123"
        ? {
            publicId: "abc123",
            displayName: `Bob <script>"x"&'y'</script>`,
            gamesPlayed: 12,
            wins: 3,
            rating: { ladder: "1v1", elo: 1234 },
          }
        : null,
    );
    log.error.mockReset();
    log.warn.mockReset();
    const app = express();
    // As the worker mounts it: the /w<n> prefix is stripped before routing.
    app.use(stripWorkerPrefix(0));
    registerPlayerProfileRoute({
      app,
      log: log as never,
      baseDir: path.join(tmp, "dist/server"),
      loadProfile,
    });
    server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  test("names the player and their stats in the head", async () => {
    const res = await fetch(`${base}/player/abc123`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(getAppShellContentMock).toHaveBeenCalledWith(
      path.join(tmp, "static/index.html"),
    );
    const html = await res.text();
    const name =
      "Bob &lt;script&gt;&quot;x&quot;&amp;&#39;y&#39;&lt;/script&gt;";
    expect(html).toContain(`<title>${name} - Kleopolis player profile</title>`);
    expect(html).toContain(
      `<meta name="description" content="${name} has played 12 games of Kleopolis and won 3 (25% win rate). 1v1 Elo: 1234. See their stats and recent games." >`,
    );
    expect(html).toContain(
      '<link rel="canonical" href="http://localhost:8888/player/abc123" >',
    );
    expect(html).toContain(
      '<meta property="og:url" content="http://localhost:8888/player/abc123" >',
    );
    expect(html).toContain('<meta property="og:type" content="profile" >');
    expect(html).toContain('<meta name="twitter:card" content="summary" >');
    expect(html).toContain(`<meta property="og:title" content="${name}`);
    // The shell's own tags are replaced, not repeated; its image stays.
    expect(html.match(/<title/g)).toHaveLength(1);
    expect(html.match(/name="description"/g)).toHaveLength(1);
    expect(html.match(/property="og:type"/g)).toHaveLength(1);
    expect(html).toContain("https://kleopolis.io/shot.png");
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("noindex");
  });

  test("an unknown player gets the shell with noindex and a 404", async () => {
    for (const p of ["/player/nobody", "/player/bad%20id!"]) {
      const res = await fetch(`${base}${p}`);
      expect(res.status, p).toBe(404);
      const html = await res.text();
      expect(html, p).toContain('<meta name="robots" content="noindex" >');
      expect(html, p).not.toContain('rel="canonical"');
      expect(html, p).not.toContain("og:url");
      expect(html, p).toContain("<body>app</body>");
    }
    // A malformed id never reaches the database.
    expect(loadProfile).toHaveBeenCalledTimes(1);
  });

  test("serves it with a trailing slash, a tab, and the worker prefix", async () => {
    for (const p of [
      "/player/abc123/",
      "/player/abc123?tab=progression",
      "/w0/player/abc123",
    ]) {
      const res = await fetch(`${base}${p}`);
      expect(res.status, p).toBe(200);
      expect(await res.text(), p).toContain("Kleopolis player profile");
    }
  });

  test("serves the plain shell when the database can't be read", async () => {
    loadProfile.mockRejectedValue(new Error("connection refused"));
    const res = await fetch(`${base}/player/abc123`);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(SHELL);
    expect(log.warn).toHaveBeenCalled();
  });

  test("leaves other paths alone", async () => {
    expect((await fetch(`${base}/player`)).status).toBe(404);
    expect((await fetch(`${base}/player/a/b`)).status).toBe(404);
    expect(getAppShellContentMock).not.toHaveBeenCalled();
  });

  test("answers 500 when the shell can't be rendered", async () => {
    getAppShellContentMock.mockRejectedValue(new Error("missing index.html"));
    const res = await fetch(`${base}/player/abc123`);
    expect(res.status).toBe(500);
    expect(log.error).toHaveBeenCalled();
  });
});

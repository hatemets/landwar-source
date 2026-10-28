import {
  type AssetManifest,
  buildAssetUrl,
} from "@openfront/shared/AssetPaths";
import { rewriteAssetsForCdn } from "@openfront/shared/AssetUrls";
import tailwindcss from "@tailwindcss/vite";
import fs from "fs";
import http from "http";
import { lookup as lookupMime } from "mrmime";
import path from "path";
import { fileURLToPath } from "url";
import { defineConfig, loadEnv, type Plugin } from "vite";
import { createHtmlPlugin } from "vite-plugin-html";
import { configDefaults } from "vitest/config";
import {
  buildPublicAssetManifest,
  copyRootPublicFiles,
  createHashedPublicAssetFiles,
  getPublicDir,
  getResourcesDir,
  writePublicAssetManifest,
  writeRootFilesIndex,
} from "./src/server/PublicAssetManifest";

// Vite already handles these, but its good practice to define them explicitly
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Dev-only: resources/public/ is served at the site root, as the build copies
// it into static/. Vite's publicDir (resources/) would put it under /public/.
function serveRootPublicDir(publicDir: string): Plugin {
  return {
    name: "serve-root-public-dir",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!req.url) return next();
        let rel = decodeURIComponent(
          new URL(req.url, "http://x").pathname,
        ).replace(/^\/+/, "");
        if (rel.split(/[\\/]/).some((part) => part === "." || part === ".."))
          return next();
        if (rel === "" || rel.endsWith("/")) rel += "index.html";
        const filePath = path.join(publicDir, rel);
        if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile())
          return next();
        const mime = lookupMime(filePath);
        if (mime) res.setHeader("Content-Type", mime);
        res.setHeader("Cache-Control", "no-store");
        fs.createReadStream(filePath).pipe(res);
      });
    },
  };
}

// Dev-only stand-in for the nginx random-worker routing (the openfront_workers
// upstream). Forwards these prefix-less POSTs to a randomly chosen worker port
// so the worker can mint a self-owned id. Runs as direct middleware (before
// vite's /api proxy).
const RANDOM_WORKER_PATHS = ["/api/create_game", "/api/adminbot/create_game"];
function randomWorkerCreateProxy(
  numWorkers: number,
  firstWorkerPort: number,
): Plugin {
  return {
    name: "random-worker-create-proxy",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.method !== "POST") return next();
        const path = (req.url ?? "").split("?")[0];
        if (!RANDOM_WORKER_PATHS.includes(path)) return next();
        const port = firstWorkerPort + Math.floor(Math.random() * numWorkers);
        const proxyReq = http.request(
          {
            host: "localhost",
            port,
            path,
            method: "POST",
            headers: req.headers,
          },
          (proxyRes) => {
            res.writeHead(proxyRes.statusCode ?? 502, proxyRes.headers);
            proxyRes.pipe(res);
          },
        );
        proxyReq.on("error", (err) => {
          res.statusCode = 502;
          res.end(`create proxy error: ${err.message}`);
        });
        req.pipe(proxyReq);
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  // The dev game server's master port; workers follow it
  // (ServerEnv.masterPort). Set in .env when another app holds 3000.
  const SERVER_PORT = env.SERVER_PORT ? Number(env.SERVER_PORT) : 3000;
  const isProduction = mode === "production";
  // Dev identity: the same INSTANCE_LETTER / NUM_WORKERS defaults the dev
  // server boots with (ServerEnv), so the dev-served index.html carries the
  // one-entry map production RenderHtml injects. The proxy below needs the
  // worker count to know how many /wN paths to forward.
  const devInstanceLetter = env.INSTANCE_LETTER || "a";
  // Strict decimal first: Number() alone would take "1e3" or " 2".
  const devNumWorkers = /^[1-9][0-9]*$/.test(env.NUM_WORKERS || "2")
    ? Number(env.NUM_WORKERS || 2)
    : NaN;
  // The same checks ServerEnv applies: the letter leads every game id, and
  // the count feeds a modulo, so a bad value here is a wNaN worker path.
  if (!/^[a-z]$/.test(devInstanceLetter)) {
    throw new Error(
      `INSTANCE_LETTER must be one lowercase letter, got ${JSON.stringify(devInstanceLetter)}`,
    );
  }
  if (!Number.isInteger(devNumWorkers) || devNumWorkers < 1) {
    throw new Error(
      `NUM_WORKERS must be a positive integer, got ${JSON.stringify(env.NUM_WORKERS)}`,
    );
  }
  const devClusterJson = JSON.stringify({
    [devInstanceLetter]: { host: "localhost", numWorkers: devNumWorkers },
  });
  const resourcesDir = getResourcesDir(__dirname);
  const sourceDirs = [resourcesDir];
  const assetManifest: AssetManifest = isProduction
    ? buildPublicAssetManifest(sourceDirs)
    : {};
  const cdnBase = env.CDN_BASE ?? "";
  const htmlAssetData = {
    assetManifest: JSON.stringify(assetManifest),
    cdnBase: JSON.stringify(cdnBase),
    gameEnv: JSON.stringify(env.GAME_ENV ?? "dev"),
    cluster: devClusterJson,
    instanceLetter: JSON.stringify(devInstanceLetter),
    turnstileSiteKey: JSON.stringify(
      env.TURNSTILE_SITE_KEY ?? "1x00000000000000000000AA",
    ),
    jwtAudience: JSON.stringify(env.DOMAIN ?? "localhost"),
    // Dev only: set FARO_COLLECTOR_URL in .env to point a local client at a
    // collector; unset drops the guarded line, exactly as in production.
    faroCollectorUrl: env.FARO_COLLECTOR_URL
      ? JSON.stringify(env.FARO_COLLECTOR_URL)
      : undefined,
    instanceId: JSON.stringify(env.INSTANCE_ID ?? "DEV_ID"),
    manifestHref: buildAssetUrl("manifest.json", assetManifest, cdnBase),
    faviconHref: buildAssetUrl("images/Favicon.svg", assetManifest, cdnBase),
    appleTouchIconHref: buildAssetUrl(
      "icons/apple-touch-icon.png",
      assetManifest,
      cdnBase,
    ),
    gameplayScreenshotUrl: buildAssetUrl(
      "images/GameplayScreenshot.png",
      assetManifest,
      cdnBase,
    ),
    backgroundImageUrl: buildAssetUrl(
      "images/background.webp",
      assetManifest,
      cdnBase,
    ),
    desktopLogoImageUrl: buildAssetUrl(
      "images/CleoLogo.svg",
      assetManifest,
      cdnBase,
    ),
    mobileLogoImageUrl: buildAssetUrl(
      "images/Favicon.svg",
      assetManifest,
      cdnBase,
    ),
  };

  // Vite's HTML transform replaces the source <script src="/src/client/Main.ts">
  // with the hashed bundle URL and injects <link rel="modulepreload"> /
  // <link rel="stylesheet"> tags. rewriteAssetsForCdn rewrites those refs to
  // an EJS placeholder so RenderHtml.ts can prefix them with CDN_BASE at
  // request time.
  const injectCdnBaseTemplate = (): Plugin => ({
    name: "inject-cdn-base-template",
    apply: "build" as const,
    enforce: "post",
    transformIndexHtml: rewriteAssetsForCdn,
  });

  let viteBundleFiles: string[] = [];
  const syncHashedPublicAssets = (): Plugin => ({
    name: "sync-hashed-public-assets",
    apply: "build" as const,
    writeBundle(_options, bundle) {
      viteBundleFiles = Object.keys(bundle);
    },
    closeBundle() {
      const outDir = path.join(__dirname, "static");
      copyRootPublicFiles(getPublicDir(resourcesDir), outDir);
      writeRootFilesIndex(getPublicDir(resourcesDir), outDir);
      // Run the source→hashed copy first; createHashedPublicAssetFiles iterates
      // assetManifest and expects every key to resolve to a file in resources/.
      // Vite's bundle output (assets/...) doesn't, so it's
      // merged in after.
      createHashedPublicAssetFiles(sourceDirs, outDir, assetManifest);
      // Track Vite's own bundle output (vendor chunks, JS, CSS, workers under
      // static/assets/) in the manifest so the deploy-time R2 upload covers
      // them alongside the hashed source assets. Skip non-assets/ emits like
      // index.html — those are served by the app, not from R2.
      for (const fileName of viteBundleFiles) {
        if (!fileName.startsWith("assets/")) continue;
        assetManifest[fileName] = `/${fileName}`;
      }
      writePublicAssetManifest(outDir, assetManifest);
    },
  });

  // In dev, redirect visits to /w*/game/* and /w*/player/* to "/" so Vite
  // serves the index.html. Only the /w<n> proxies below call this: a bare
  // /player/<id> isn't proxied, so Vite's SPA fallback serves it the
  // index.html already, as the master's fallback does in production.
  const devGameHtmlBypass = (req?: {
    url?: string;
    method?: string;
    headers?: { accept?: string | string[] };
  }) => {
    if (req?.method !== "GET") return undefined;
    const accept = req.headers?.accept;
    const acceptValue = Array.isArray(accept)
      ? accept.join(",")
      : (accept ?? "");
    if (!acceptValue.includes("text/html")) return undefined;
    if (!req.url) return undefined;
    if (/^\/w\d+\/(?:game|player)\/[^/]+/.test(req.url)) {
      return "/";
    }
    return undefined;
  };

  return {
    test: {
      globals: true,
      setupFiles: "./tests/setup.ts",
      // Node 25 turned Web Storage on by default, where `localStorage` is a
      // built-in global that evaluates to undefined unless --localstorage-file
      // is passed. It shadows the jsdom localStorage vitest installs, so every
      // test touching UserSettings dies on "Cannot read properties of
      // undefined (reading 'getItem')". Turn Node's own Web Storage off in the
      // test workers so jsdom always provides it. No-op on Node 24, which keeps
      // Web Storage behind a flag.
      execArgv: ["--no-experimental-webstorage"],
      // Git worktrees live inside the repo, so their tests match the default
      // glob and run against that worktree's own (often stale) source and
      // node_modules. Anyone with a worktree checked out sees failures that
      // have nothing to do with their branch.
      // Spread the defaults rather than restating them: setting `exclude`
      // replaces vitest's built-in list, and hand-copying a subset silently
      // drops the dot-directory pattern (.git, .cache, .output, ...) --
      // reintroducing the same stray-file problem this is here to fix.
      exclude: [
        ...configDefaults.exclude,
        "**/.worktrees/**",
        "**/.claude/worktrees/**",
      ],
      // Starting jsdom costs every file ~0.5s, more than many of them spend
      // running tests, so only the client tests get it. A test elsewhere that
      // needs a DOM opts in with a `// @vitest-environment jsdom` first line.
      projects: [
        {
          extends: true,
          test: {
            name: "client",
            environment: "jsdom",
            include: ["tests/client/**/*.test.ts"],
          },
        },
        {
          extends: true,
          test: {
            name: "node",
            environment: "node",
            exclude: ["tests/client/**"],
          },
        },
      ],
    },
    root: "./",
    base: "/",
    publicDir: isProduction ? false : "resources",

    // Vite's JS preload helper (`__vitePreload`, used by dynamic import())
    // resolves a chunk's dependency list against `base`, so with base "/" the
    // helper chunks behind e.g. the lazy Faro import were requested from the
    // page origin, where nothing serves /assets/ (openfront.io answered 503,
    // and the import() rejected, so telemetry never started). Emitting those
    // references relative makes the helper resolve them against
    // import.meta.url, i.e. wherever the importing chunk itself was loaded
    // from -- the CDN in production, same-origin in dev -- without baking
    // CDN_BASE into the bundle (the Docker build does not have it). HTML keeps
    // Vite's /assets/ refs so rewriteAssetsForCdn can turn them into the
    // request-time EJS placeholder.
    experimental: {
      renderBuiltUrl(_filename, { hostType }) {
        if (hostType === "js") return { relative: true };
        return undefined;
      },
    },

    resolve: {
      tsconfigPaths: true,
      alias: {
        resources: path.resolve(__dirname, "resources"),
      },
    },

    plugins: [
      ...(!isProduction
        ? [
            serveRootPublicDir(getPublicDir(resourcesDir)),
            randomWorkerCreateProxy(devNumWorkers, SERVER_PORT + 1),
          ]
        : []),
      ...(isProduction
        ? []
        : [
            createHtmlPlugin({
              minify: false,
              entry: "/src/client/Main.ts",
              template: "index.html",
              inject: {
                data: {
                  gitCommit: JSON.stringify("DEV"),
                  ...htmlAssetData,
                },
              },
            }),
          ]),
      ...(isProduction
        ? [injectCdnBaseTemplate(), syncHashedPublicAssets()]
        : []),
      tailwindcss(),
    ],

    define: {
      __ASSET_MANIFEST__: JSON.stringify(assetManifest),
      "process.env.WEBSOCKET_URL": JSON.stringify(
        isProduction ? "" : `localhost:${SERVER_PORT}`,
      ),
      "process.env.GAME_ENV": JSON.stringify(isProduction ? "prod" : "dev"),
      // Add other process.env variables if needed, OR migrate code to import.meta.env
    },

    build: {
      outDir: "static", // Webpack outputs to 'static', assuming we want to keep this.
      emptyOutDir: true,
      assetsDir: "assets", // Sub-directory for assets
      rollupOptions: {
        output: {
          codeSplitting: {
            groups: [
              {
                name: "vendor",
                test: (id) =>
                  ["howler", "zod"].some((module) => id.includes(module)),
                priority: 2,
              },
              // Everything the page needs at startup stays in the entry
              // chunk. Without this, a module shared by the entry and the
              // lazily loaded screens (Lit, translateText, the cosmetics
              // catalog, ...) can be split into chunks of its own, each one
              // more request before the page can start, for no saving: the
              // entry needs them all anyway.
              { name: "index", tags: ["$initial"], priority: 1 },
            ],
          },
        },
      },
    },

    server: {
      port: 8888,
      host: process.env.VITE_HOST === "lan",
      // Automatically open the browser when the server starts
      open: process.env.SKIP_BROWSER_OPEN !== "true",
      proxy: {
        "/lobbies": {
          target: `ws://localhost:${SERVER_PORT}`,
          ws: true,
          changeOrigin: true,
        },
        // The ranked queues run on the master.
        "/matchmaking": {
          target: `ws://localhost:${SERVER_PORT}`,
          ws: true,
          changeOrigin: true,
        },
        // Worker proxies
        "/w0": {
          target: `ws://localhost:${SERVER_PORT + 1}`,
          ws: true,
          secure: false,
          changeOrigin: true,
          bypass: (req) => devGameHtmlBypass(req),
          rewrite: (path) => path.replace(/^\/w0/, ""),
        },
        "/w1": {
          target: `ws://localhost:${SERVER_PORT + 2}`,
          ws: true,
          secure: false,
          changeOrigin: true,
          bypass: (req) => devGameHtmlBypass(req),
          rewrite: (path) => path.replace(/^\/w1/, ""),
        },
        // API proxies
        "/api": {
          target: `http://localhost:${SERVER_PORT}`,
          changeOrigin: true,
          secure: false,
        },
      },
    },
  };
});

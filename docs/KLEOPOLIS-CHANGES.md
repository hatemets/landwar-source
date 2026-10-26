# Kleopolis changes to the OpenFront base

Kleopolis is a fork of OpenFront. See `NOTICE.md` for the upstream credit. This file lists what the fork removes or stubs, and why. For the upstream design, see `docs/Architecture.md`.

## Kept

- Game engine, maps, map generator, game server, replay code.
- Game client (Lit, WebGL) and HUD.
- Crowdin i18n files. English only is the target.
- Sound effects in `resources/sounds/effects/`.

## Removed

| Area           | Removed items                                                                                                                                                                             | Reason                                                                                                                                |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Asset overlay  | `proprietary/` folder, overlay middleware in `vite.config.ts`, `getProprietaryDir`, Dockerfile copy, tsconfig glob                                                                        | Restricted licence. See `LICENSE-ASSETS`.                                                                                             |
| Assets         | `ads.txt`, Apple Pay domain file, `OpenFront*` logos, `OF.png`, OpenFront font, OpenFront menu and gameplay music                                                                         | Restricted branding or licence. Replaced by `resources/images/LandWarLogo*.svg` and `Favicon.svg`. Music is off. See the flags below. |
| Payments       | `Payments.ts`, `SubscriptionModal.ts`, `SubscriptionPolicy.ts`, purchase buttons, `LobbyQueuePayment.ts`, `POST /api/game/:id/queue`                                                      | Stripe and Steam payments.                                                                                                            |
| Steam          | `SteamWishlist*`, Steam notices, grants, handoff                                                                                                                                          | Steam is not a target platform.                                                                                                       |
| Desktop shell  | `DesktopRelease.ts`, `RenderDesktopDescriptor.ts`, `/desktop/*` routes, desktop nav and status bars, desktop display settings tab                                                         | Desktop build is not a target.                                                                                                        |
| Ranked         | `RankedCheckin.ts`, `RankedModal.ts`, ranked loop in `Worker.ts`                                                                                                                          | Not in scope.                                                                                                                         |
| Telemetry      | Grafana Faro, OpenTelemetry logs and metrics (`Logger.ts` is console only, `WorkerMetrics.ts` removed), telemetry emitter (`BufferedMatchTelemetryEmitter.ts`, `MatchTelemetryConfig.ts`) | No data leaves the server. The match recorder stays for Phase 4.                                                                      |
| Ads            | Admiral loader and ad-block popup (`Admiral.ts`), `AdGatekeeper.ts`, Google tags and ramp in `index.html`                                                                                 | No ads. The Admiral script showed an ad-block popup to every free user.                                                               |
| Theme          | Halloween theme (`halloween.css`, `halloween-theme` body class)                                                                                                                           | Replaced by a plain dark theme.                                                                                                       |
| Footer         | Footer bar (`Footer.ts`, `<page-footer>`), social links, version line                                                                                                                     | Replaced by the top bar. The OpenFront notice stays in the Terms of Service and Privacy Policy.                                       |
| Portals        | `PokiSDK.ts`, `CrazyGamesSDK.ts`, `GamePortal.ts`, `CrazyGamesAccountButton.ts`, midgame ads, portal invite links                                                                         | Web only. No third-party portals.                                                                                                     |
| Promos         | Featured stream, Streaming Now, marketing consent toast, purchase nudge, iOS add-to-home banner, creator codes, free-play perks, troubleshooting modal, win-modal promos                  | Not part of the product.                                                                                                              |
| Account        | Token login, email magic link, Steam and Discord link, account settings modal (consent, privacy, identity tokens, delete), boot interrupts, subscription and lapse notices                | The server has no such routes. Google sign-in only.                                                                                   |
| Progression    | XP, levels, prestige, rewards, Legend ceremony, provisional XP, XP bar, level badges, share moments                                                                                       | The server already answered "progression off".                                                                                        |
| Clans          | `ClanModal`, `components/clan/*`, `ClanApi.ts`, `src/server/clans/`, clan tables and `game_players.clan_tag` (migration `0008_drop_clans.sql`), clan leaderboard, clan wars               | Cut for a leaner product. The engine can still draw a clan tag, but nothing sets one.                                                 |
| Ranked 2v2     | 2v2 queue, team Elo, `RankedType.TwoVTwo` and `ClanWars`, ranked team rules in `WinCheckExecution`, 2v2 and clan wars config in `MapPlaylist`                                             | Ranked is 1v1 only.                                                                                                                   |
| Tribe boards   | Tribes panel, tribe leaderboard, tribe boost                                                                                                                                              | No purchasable tribe names.                                                                                                           |
| Hetzner deploy | `deploy.sh`, `update.sh`, `setup.sh`, `build.sh`, `build-deploy.sh`, `release.yml`, their tests, the Steam `/link` and Apple Pay nginx routes                                             | Replaced by the GCP deploy in `infra/` and `docs/Deploy.md`.                                                                          |
| Dependencies   | `@grafana/faro-web-sdk`, `@opentelemetry/*`, `@stripe/stripe-js`, `ts-node`                                                                                                               | Unused after removal.                                                                                                                 |

## Flags

- `src/client/sound/SoundManager.ts`: `BACKGROUND_MUSIC_ENABLED = false`.
- `src/client/sound/MenuMusic.ts`: `MENU_THEME_ENABLED = false`.

To turn music on, add a licensed track under `resources/sounds/music/`. Then set the flag.

## Build changes

- Package manager: pnpm 11. Node 24.22.0 (`.nvmrc`). `pnpm run inst` runs `pnpm install --frozen-lockfile --ignore-scripts`.
- Workspace packages are root dependencies with `workspace:*`.
- Dev port: 8888 (`vite.config.ts`).
- `deploy.sh` letter check uses an explicit list. A range like `[a-z]` matched `C` in some locales.

## Backend (Postgres)

- Finished games: `Archive.ts` writes to Postgres through `GameStore.ts`. It fills `games`, `game_players`, `user_stats` and `game_records`. A retry never counts a game twice.
- Read routes on the master (`src/server/stats/routes.ts`): `GET /api/games/:id` (record without account ids), `GET /api/players/:publicId`, `GET /api/me/stats`, `GET /api/leaderboard?limit=`.
- The master serves `GET /api/cluster.json`, a list holding this server. The client reads it, so multiplayer is not gated on the closed API. The replay check (`JoinLobbyModal`) and the profile screen (`Api.ts`) read `/api/games/:id` and `/api/players/:publicId/profile`.
- Game preview pages read the archive from Postgres.
- Cluster check-in is off unless `CLUSTER_CHECKIN=true`. Without it the master schedules public lobbies itself.
- Purchased tribe names are always empty.
- The master applies pending migrations when it starts (`SKIP_MIGRATIONS=true` turns that off). `pnpm run db:migrate` still works by hand. DB tests run with `TEST_DATABASE_URL` set.

- Google sign-in: for development, `GOOGLE_OAUTH_BASE_URL` points the flow at a stand-in server (`tests/util/FakeGoogle.ts`, which checks PKCE and the client secret). Staging and production refuse it. `tests/server/auth/googleLogin.db.test.ts` walks the real routes against it.
- Ranked queue (`src/server/matchmaking/`): the master serves `WS /matchmaking/join?mode=1v1`. A signed-in player sends `{type:"join", jwt}`. The server pairs players by Elo (window 100, plus 20 per second waited, up to 800). A match becomes an invite-only game on a worker (`createMatchGame` over IPC): `rankedType`, `allowedPublicIds`, no bots or nations, a 30 minute limit, and 45 seconds for everyone to connect. The home page has a Ranked 1v1 button.
- Elo (`stats/elo.ts`, K=32): public free-for-all games between accounts rate the `ffa` ladder. A 1v1 rates the `1v1` ladder. A matchmade game with no winner, or with a guest, is not rated. `GET /api/leaderboard/ranked` serves both ladders. There is no tribe board.
- Friends: the master serves `/api/friends` (list, requests, accept, decline, remove) on the `friendships` table. The session cookie names the account. The client (`FriendsApi.ts`) calls it.
- Progression is off. `/api/progression/*` answers 404, and the XP route answers 403 so the client stops polling. The client reads that as "no progression".
- The news and stream lists come from `resources/`, and the identity list is empty, all served at `/api/*` by `ServedConfigRoutes.ts`. The cosmetics catalog comes from the shop.
- The home page no longer calls any other host.
- `runMigrations` takes a Postgres advisory lock, so servers that start together do not race.
- Store and Inventory (`src/server/shop/`, `src/client/Store.ts`): one currency, Caps, earned by playing. A new account starts with 1000. A finished game with at least two accounts that lasted a minute pays 50, and 100 more for a win. The store sells free flags (files in `resources/flags`) and patterns drawn in code (`shop/catalog.ts`), each in 6 colours, for 300 to 2600 Caps. `POST /api/shop/purchase` takes the price in one transaction, with the wallet row locked, and refuses a second copy. `GET /api/cosmetics.json` serves the catalog, and `/api/me` reports `currency` and `flares`. The inventory equips what the account owns. At join the worker checks that every flag and pattern named is owned (a country flag is free), refuses the join with `cosmetics_forbidden` otherwise, and sends the pattern data to other players. There are no payments, crowns, skins or effects.

## Open for later phases

- Account and login: Phase 2 replaces `jwt.ts`, `JoinVerify.ts`, `Privilege.ts`, and the `Auth.ts` flows.
- `packages/shared` still holds Stripe and Steam schema fields. Trim them when the modules that use them are removed.

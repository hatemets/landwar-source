<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="resources/images/LandWarLogoDark.svg">
    <source media="(prefers-color-scheme: light)" srcset="resources/images/LandWarLogo.svg">
    <img src="resources/images/LandWarLogo.svg" alt="LandWar logo" width="300">
  </picture>
</p>

LandWar is a real-time strategy game about territory, nations, and alliances. This repository builds on the OpenFrontIO codebase. See [CREDITS](CREDITS.md) for upstream attribution.

![CI](https://github.com/hatemets/landwar/actions/workflows/ci.yml/badge.svg)
[![License: AGPL v3](https://img.shields.io/badge/License-AGPL%20v3-blue.svg)](https://www.gnu.org/licenses/agpl-3.0)
[![Assets: CC BY-SA 4.0](https://img.shields.io/badge/Assets-CC%20BY--SA%204.0-lightgrey.svg)](https://creativecommons.org/licenses/by-sa/4.0/)

## License

The OpenFront-derived code is licensed under the **GNU Affero General Public License v3.0**. Assets included in this repository are licensed under **CC BY-SA 4.0**, subject to the exclusions in [LICENSE-ASSETS](LICENSE-ASSETS).

Current copyright notices appear in:

- Footer: "© OpenFront and Contributors"
- Loading screen: "© OpenFront and Contributors"

Modified versions must preserve these notices in reasonably visible locations.

See the [LICENSE](LICENSE) for complete requirements.

For asset licensing, see [LICENSE-ASSETS](LICENSE-ASSETS).  
For license history, see [LICENSING.md](LICENSING.md).

## 🌟 Features

- **Real-time Strategy Gameplay**: Expand your territory and engage in strategic battles
- **Alliance System**: Form alliances with other players for mutual defense
- **Multiple Maps**: Play across various geographical regions including Europe, Asia, Africa, and more
- **Resource Management**: Balance your expansion with defensive capabilities
- **Cross-platform**: Play in any modern web browser

## 📋 Prerequisites

- [Node.js](https://nodejs.org/) v24.15.0 or newer in the Node 24 release line
- [pnpm](https://pnpm.io/) v11.1.0 or newer in the pnpm 11 release line
- A modern web browser (Chrome, Firefox, Edge, etc.)

## 🚀 Installation

1. **Clone the repository**

   ```bash
   git clone https://github.com/hatemets/landwar.git
   cd landwar
   ```

2. **Install dependencies**

   ```bash
   pnpm install --frozen-lockfile --ignore-scripts
   ```

   Use pnpm for this workspace. The frozen lockfile keeps installs aligned with `pnpm-lock.yaml`, and install scripts stay disabled by default.

   The repository also rejects dependency releases less than seven days old and dependencies sourced from Git, remote URLs, local tarballs, or directories. Wait until a new release passes the seven-day window before updating it; security exceptions require explicit maintainer review.

## 🎮 Running the Game

### Development Mode

Run both the client and server in development mode with live reloading:

```bash
pnpm dev
```

This will:

- Start the Vite dev server for the client
- Launch the game server with development settings
- Open the game in your default browser (to disable this behavior, set `SKIP_BROWSER_OPEN=true` in your environment)

### Client Only

To run just the client with hot reloading:

```bash
pnpm run start:client
```

### Server Only

To run just the server with development settings:

```bash
pnpm run start:server-dev
```

### Connecting to staging or production backends

Sometimes it's useful to connect to production servers when replaying a game, testing user profiles, purchases, or login flow.

> To replay a production game, make sure you're on the same commit that the game you want to replay was executed on, you can find the `gitCommit` value via `https://api.openfront.io/game/[gameId]`.
> Unfinished games cannot be replayed on localhost.

To connect to staging api servers:

```bash
npm run dev:staging
```

To connect to production api servers:

```bash
npm run dev:prod
```

## 🛠️ Development Tools

- **Format code**:

  ```bash
  pnpm run format
  ```

- **Lint code with Oxlint and ESLint**:

  ```bash
  pnpm run lint
  ```

- **Lint and fix code with Oxlint and ESLint**:

  ```bash
  pnpm run lint:fix
  ```

- **Testing**
  ```bash
  pnpm test
  ```

## 🏗️ Project Structure

- `/src/client` - Frontend game client
- `/src/server` - Backend game server
- `/packages/engine` - Deterministic game simulation (`@openfront/engine`)
- `/packages/engine-api` - The engine's contract: types, schemas, game updates and the worker protocol (`@openfront/engine-api`)
- `/packages/engine-lib` - Engine code also used outside the engine: map grid, rules, helpers (`@openfront/engine-lib`)
- `/packages/shared` - Code shared by client and server: wire schemas, env, asset URLs (`@openfront/shared`)
- `/packages/zbin` - Compact binary wire format for zod schemas (self-contained, zod-only)
- `/resources` - Static assets (images, maps, etc.)

## 🤝 Contributing

Contributions and translations are welcome! See [CONTRIBUTING.md](CONTRIBUTING.md) for the workflow, the approved-issue process, project governance, and translation info.

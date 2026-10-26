import { ClientEnv } from "./ClientEnv";

// Base path of the account/stats API. Kleopolis has no separate API host: the
// game server serves it under /api on the page's own origin. Lives apart from
// Api.ts so modules that Api.ts itself depends on (ServerList) can reach it
// without an import cycle; Api.ts re-exports both for its existing importers.
export function getApiBase() {
  return "/api";
}

export function getAudience() {
  // Sourced from BOOTSTRAP_CONFIG (server-injected) rather than
  // window.location.
  return ClientEnv.jwtAudience();
}

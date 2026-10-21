import type http from "node:http";

// Proxies between the player and node, nearest first: nginx in the container
// (the socket peer) and Caddy on the VM (infra/vm/Caddyfile), whose address
// nginx appends. Caddy drops any X-Forwarded-For the client sent and sets the
// client's own address. Express's "trust proxy" and the WebSocket path both
// skip this many hops, so even a header that got through sits further left
// and is never read.
export const TRUSTED_PROXY_HOPS = 2;

// The client address, read the way Express reads req.ip with
// `trust proxy` set to a hop count. With fewer hops than expected (local dev,
// no proxy) it falls back to the furthest address known.
export function clientIp(
  req: http.IncomingMessage,
  hops: number = TRUSTED_PROXY_HOPS,
): string {
  const header = req.headers["x-forwarded-for"];
  const raw = Array.isArray(header) ? header.join(",") : (header ?? "");
  const forwarded = raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .reverse();
  const addrs = [req.socket.remoteAddress ?? "unknown", ...forwarded];
  return addrs[Math.min(hops, addrs.length - 1)];
}

import fsPromises from "fs/promises";
import { parse } from "node-html-parser";
import path from "path";
import { escapeHtml } from "./GamePreviewBuilder";
import { ServerEnv } from "./ServerEnv";

// The head tags a crawler or a link preview reads for one page.
export interface HeadMeta {
  title: string;
  description: string;
  // Absolute URL. Omitted for a page that must not be indexed.
  canonical?: string;
  // og:url. Defaults to the canonical URL.
  url?: string;
  ogType?: string;
  // Absolute URL. Omitted to keep the shell's own og:image.
  image?: string;
  twitterCard?: "summary" | "summary_large_image";
  noindex?: boolean;
}

/**
 * Put `meta` into the head of a rendered app shell. Each tag it sets replaces
 * the shell's tag of the same name, so the page has one of each. All values
 * are HTML-escaped.
 */
export function injectHeadMeta(html: string, meta: HeadMeta): string {
  const root = parse(html);
  const head = root.querySelector("head");
  if (!head) return html;

  const url = meta.url ?? meta.canonical;
  const props: [string, string | undefined][] = [
    ["og:title", meta.title],
    ["og:description", meta.description],
    ["og:url", url],
    ["og:type", meta.ogType],
    ["og:image", meta.image],
  ];
  const names: [string, string | undefined][] = [
    ["description", meta.description],
    ["robots", meta.noindex ? "noindex" : undefined],
    ["twitter:card", meta.twitterCard ?? "summary"],
    ["twitter:title", meta.title],
    ["twitter:description", meta.description],
    ["twitter:image", meta.image],
  ];

  head.querySelectorAll("title").forEach((el) => el.remove());
  head.querySelectorAll('link[rel="canonical"]').forEach((el) => el.remove());
  // A crawler must not index a page under another page's og:url.
  if (url === undefined) {
    head.querySelectorAll('meta[property="og:url"]').forEach((el) => {
      el.remove();
    });
  }
  for (const [key, value] of props) {
    if (value === undefined) continue;
    head
      .querySelectorAll(`meta[property="${key}"]`)
      .forEach((el) => el.remove());
  }
  for (const [key, value] of names) {
    if (value === undefined) continue;
    head.querySelectorAll(`meta[name="${key}"]`).forEach((el) => el.remove());
  }

  const tags = [`<title>${escapeHtml(meta.title)}</title>`];
  if (meta.canonical !== undefined) {
    tags.push(`<link rel="canonical" href="${escapeHtml(meta.canonical)}" />`);
  }
  for (const [key, value] of props) {
    if (value === undefined) continue;
    tags.push(`<meta property="${key}" content="${escapeHtml(value)}" />`);
  }
  for (const [key, value] of names) {
    if (value === undefined) continue;
    tags.push(`<meta name="${key}" content="${escapeHtml(value)}" />`);
  }
  for (const tag of tags) head.insertAdjacentHTML("beforeend", tag);
  return root.toString();
}

/**
 * The app shell template on disk: `static/index.html` in a build, or the
 * repo's `index.html` in dev. Null when neither exists.
 */
export async function resolveShellPath(
  baseDir: string,
): Promise<string | null> {
  for (const candidate of [
    path.join(baseDir, "../../static/index.html"),
    path.join(baseDir, "../../index.html"),
  ]) {
    try {
      await fsPromises.access(candidate);
      return candidate;
    } catch {
      // Try the next one.
    }
  }
  return null;
}

// The link that serves a game's preview tags: the worker that owns the id.
export function gamePageUrl(origin: string, gameID: string): string {
  return new URL(
    `/${ServerEnv.workerPath(gameID)}/game/${encodeURIComponent(gameID)}`,
    origin,
  ).href;
}

export function playerPageUrl(origin: string, publicId: string): string {
  return new URL(`/player/${encodeURIComponent(publicId)}`, origin).href;
}

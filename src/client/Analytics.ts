// A PostHog project key is public: it only lets a client send events.
const POSTHOG_KEY = "phc_tgxLwmspJa8qACxGnT9wDSvmoZi88RjrWyVkUTJZW4a4";
const POSTHOG_HOST = "https://eu.i.posthog.com";

type PostHog = (typeof import("posthog-js"))["default"];

let posthog: Promise<PostHog | null> | null = null;

/**
 * Starts PostHog on production builds that have a project key. The library
 * loads as its own chunk, so it never delays the homepage. Every call after
 * this one is a no-op until it has resolved, and always when disabled.
 */
export function initAnalytics(): void {
  if (posthog !== null) return;
  if (!POSTHOG_KEY || process.env.GAME_ENV !== "prod") {
    posthog = Promise.resolve(null);
    return;
  }
  posthog = import("posthog-js")
    .then(({ default: ph }) => {
      // Cookieless: PostHog stores nothing on the device and counts visitors
      // with a daily-rotating hash on its servers. With no cookies and no
      // per-player id, the EU ePrivacy rules need no consent banner. The
      // PostHog project must have cookieless mode on, or it drops the events.
      ph.init(POSTHOG_KEY, {
        api_host: POSTHOG_HOST,
        cookieless_mode: "always",
        person_profiles: "never",
        capture_pageview: "history_change",
      });
      return ph;
    })
    .catch(() => null);
}

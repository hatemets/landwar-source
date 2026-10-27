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
        // Uncaught errors, as the plan's client_error event.
        capture_exceptions: true,
      });
      return ph;
    })
    .catch(() => null);
}

/**
 * The funnel events the business plan measures (MARKET-STRATEGY.md section
 * 9.1). Properties hold only game facts: no names, ids or chat.
 */
export type AnalyticsEvent =
  | "play_clicked"
  | "invite_opened"
  | "match_ready"
  | "first_valid_action"
  | "match_ended"
  | "rematch_started"
  | "replay_shared";

/** Sends one event. A no-op off production and before initAnalytics. */
export function track(
  event: AnalyticsEvent,
  props?: Record<string, string | number | boolean>,
): void {
  void posthog?.then((ph) => ph?.capture(event, props));
}

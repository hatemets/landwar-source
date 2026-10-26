import type { UserMeResponse } from "@openfront/shared/ApiSchemas";

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
      ph.init(POSTHOG_KEY, {
        api_host: POSTHOG_HOST,
        person_profiles: "identified_only",
        capture_pageview: "history_change",
      });
      return ph;
    })
    .catch(() => null);

  // Tie events to the player's public id, never to an email or a name.
  document.addEventListener("userMeResponse", (e) => {
    const me = (e as CustomEvent<UserMeResponse | false>).detail;
    void posthog?.then((ph) => {
      if (ph === null) return;
      if (me === false) ph.reset();
      else ph.identify(me.player.publicId);
    });
  });
}

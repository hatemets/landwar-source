import { PostHog } from "posthog-node";

// Same public project key and host as the client (src/client/Analytics.ts).
const POSTHOG_KEY = "phc_tgxLwmspJa8qACxGnT9wDSvmoZi88RjrWyVkUTJZW4a4";
const POSTHOG_HOST = "https://eu.i.posthog.com";

let client: PostHog | null | undefined;

function getClient(): PostHog | null {
  if (client !== undefined) return client;
  client =
    process.env.GAME_ENV === "prod"
      ? new PostHog(POSTHOG_KEY, { host: POSTHOG_HOST, flushAt: 20 })
      : null;
  return client;
}

// Sends an event for an account. Does nothing outside prod. Never throws.
export function trackServer(
  userId: string,
  event: string,
  props: Record<string, unknown> = {},
): void {
  try {
    getClient()?.capture({ distinctId: userId, event, properties: props });
  } catch {
    // Analytics must never break the request.
  }
}

// Flushes queued events. Call on shutdown.
export async function shutdownAnalytics(): Promise<void> {
  await client?.shutdown();
}

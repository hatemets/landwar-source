/**
 * Prime time: one big public match at a fixed local time each day, so a
 * small player base meets in the same lobby instead of spreading across the
 * day (MARKET-STRATEGY.md test C1). The master opens the lobby
 * PRIME_TIME_LEAD_MS before the start and the home page counts down to it.
 */

export interface PrimeTimeWindow {
  /** IANA zone the hour is local to, so the start follows its DST. */
  timeZone: string;
  hour: number;
  /** The zone's short name, shown next to the time. */
  zoneLabel: string;
}

export const PRIME_TIME_WINDOWS: readonly PrimeTimeWindow[] = [
  { timeZone: "Europe/Paris", hour: 19, zoneLabel: "CET" },
  { timeZone: "America/New_York", hour: 19, zoneLabel: "ET" },
];

/** How long before the start the lobby opens for joining. */
export const PRIME_TIME_LEAD_MS = 15 * 60_000;

const DAY_MS = 24 * 60 * 60_000;

/** Milliseconds the zone is ahead of UTC at the instant `t`. */
function zoneOffset(t: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
  }).formatToParts(t);
  const get = (type: string) =>
    Number(parts.find((p) => p.type === type)?.value ?? 0);
  const asUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour"),
    get("minute"),
    get("second"),
  );
  return asUtc - Math.floor(t / 1000) * 1000;
}

/** The instant the window starts on the zone-local calendar day of `t`. */
function startOnDayOf(t: number, w: PrimeTimeWindow): number {
  const local = new Date(t + zoneOffset(t, w.timeZone));
  const wall = Date.UTC(
    local.getUTCFullYear(),
    local.getUTCMonth(),
    local.getUTCDate(),
    w.hour,
  );
  // Correct with the offset at the result itself, in case a DST change lies
  // between `t` and the window.
  const guess = wall - zoneOffset(wall, w.timeZone);
  return wall - zoneOffset(guess, w.timeZone);
}

export interface PrimeTimeSlot {
  startsAt: number;
  window: PrimeTimeWindow;
}

/** The first prime-time start strictly after `now`. */
export function nextPrimeTime(now: number): PrimeTimeSlot {
  let best: PrimeTimeSlot | null = null;
  for (const window of PRIME_TIME_WINDOWS) {
    for (let day = -1; day <= 2; day++) {
      const startsAt = startOnDayOf(now + day * DAY_MS, window);
      if (startsAt > now && (best === null || startsAt < best.startsAt)) {
        best = { startsAt, window };
      }
    }
  }
  return best!;
}

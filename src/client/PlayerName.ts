import { ANON_WORDS } from "@openfront/shared/AnonNames";
import { MAX_USERNAME_LENGTH } from "./validations/username";

// What name a player plays under, resolved in one place. Everything here is
// pure: callers pass values in, so the whole precedence is unit-testable
// without a component, and every caller gets the same answer.

/** Which branch of the precedence produced the name. */
export type PlayerNameSource = "stored" | "generated";

export interface PlayerNameInputs {
  /**
   * The free-form name the player typed or has stored. Reported as-is (trimmed
   * and clamped) even when it fails validation — it is the player's own text,
   * so the caller shows an error rather than resolution silently swapping in
   * another name.
   */
  storedName: string | null;
  /** The generated callsign to fall back to. Minted once per session. */
  generatedName: string;
}

export interface ResolvedPlayerName {
  name: string;
  source: PlayerNameSource;
  /** Always false: LandWar has no verified account names. */
  verified: boolean;
}

// Trim rather than reject: a name stored before the cap would otherwise fail
// validation and block play.
export function clampUsername(name: string): string {
  return name.length > MAX_USERNAME_LENGTH
    ? name.slice(0, MAX_USERNAME_LENGTH).trim()
    : name;
}

// Recognise current callsigns and legacy guest names when the stored generation
// flag is absent. Explicitly chosen names keep their stored flag.
export function looksGenerated(name: string): boolean {
  const match = /^Anon([A-Za-z]+)\d?$/u.exec(name);
  if (match !== null && ANON_WORDS.includes(match[1])) return true;
  const callsign = /^([A-Za-z]+) ([A-Za-z]+) \d{2}$/.exec(name);
  return (
    callsign !== null &&
    (CALLSIGN_PREFIXES as readonly string[]).includes(callsign[1]) &&
    (CALLSIGN_NAMES as readonly string[]).includes(callsign[2])
  );
}

/**
 * The one ordered rule for what name a player plays under:
 *
 * 1. the free-form name the player typed or stored
 * 2. else a generated callsign
 */
export function resolvePlayerName(
  inputs: PlayerNameInputs,
): ResolvedPlayerName {
  const { storedName, generatedName } = inputs;

  // An empty field is the player having cleared it, not a name — fall through
  // rather than handing the join an empty string.
  const stored = storedName?.trim();
  if (stored) {
    return { name: clampUsername(stored), source: "stored", verified: false };
  }

  return { name: generatedName, source: "generated", verified: false };
}

/**
 * Resolution with nothing to go on — for join paths that can't reach the
 * identity bar at all. Nothing is stored or claimed from here, so this is
 * always branch 4.
 */
export function fallbackPlayerName(): ResolvedPlayerName {
  return { name: genAnonUsername(), source: "generated", verified: false };
}

// LandWar guest callsigns use a descriptor, an animal, and a two-digit suffix.
// Rejection sampling keeps every combination equally likely.
const CALLSIGN_PREFIXES = [
  "Iron",
  "Cobalt",
  "Arctic",
  "Silent",
  "North",
  "Copper",
  "Storm",
  "Silver",
  "Wild",
  "Swift",
  "Stone",
  "Ember",
] as const;
const CALLSIGN_NAMES = [
  "Kestrel",
  "Fox",
  "Lynx",
  "Raven",
  "Falcon",
  "Wolf",
  "Badger",
  "Hawk",
  "Osprey",
  "Otter",
  "Pike",
  "Heron",
] as const;

export function genAnonUsername(): string {
  const bound = CALLSIGN_PREFIXES.length * CALLSIGN_NAMES.length * 100;
  const limit = Math.floor(0x1_0000_0000 / bound) * bound;
  const buffer = new Uint32Array(1);
  let random: number;
  do {
    crypto.getRandomValues(buffer);
    random = buffer[0];
  } while (random >= limit);
  const slot = random % bound;
  return `${CALLSIGN_PREFIXES[Math.floor(slot / (CALLSIGN_NAMES.length * 100))]} ${CALLSIGN_NAMES[Math.floor(slot / 100) % CALLSIGN_NAMES.length]} ${String(slot % 100).padStart(2, "0")}`;
}

import {
  GameType,
  HumansVsNations,
} from "@openfront/engine-api/game/GameTypes";
import { GameConfig, MAX_LOBBY_FILLERS } from "@openfront/engine-api/Schemas";
import { PublicGameType } from "@openfront/shared/WireSchemas";
import { generateID } from "@openfront/shared/SharedUtil";

// A seat the server fills in a public lobby, so a newcomer never waits in an
// empty one. It is listed in the lobby like a player and plays as a nation
// that clients show as a player (GameStartInfo.fillers).
export interface LobbyFiller {
  clientID: string;
  username: string;
}

const MIN_FILLERS = 4;
const MAX_FILLERS = 5;

// While the lobby waits, one filler leaves or a new one joins every 18 to 30
// seconds (two or three times a minute), so the roster looks like real
// players coming and going. The count stays in this range.
export const FILLER_CHURN_MIN_MS = 18_000;
export const FILLER_CHURN_MAX_MS = 30_000;
const CHURN_MIN_FILLERS = 2;
const CHURN_MAX_FILLERS = 7;

// Open lobbies (public games the master lists as "hosted") start with one
// of these filler counts, so some look empty and some have players waiting.
const OPEN_LOBBY_FILLER_COUNTS = [0, 0, 2, 3, 4, 5];

// Whether a lobby gets fillers: only the lobbies the server opens. Private
// and player-hosted lobbies, matchmade and ranked games keep their real
// roster, and Humans vs Nations would put the fillers on the nations' side.
export function fillsSeats(
  config: GameConfig,
  publicGameType: PublicGameType | undefined,
): boolean {
  return (
    publicGameType !== undefined &&
    (publicGameType !== "hosted" || config.gameType === GameType.Public) &&
    config.rankedType === undefined &&
    config.playerTeams !== HumansVsNations
  );
}

// Fillers for a new lobby.
export function pickFillers(
  config: GameConfig,
  publicGameType: PublicGameType | undefined,
  random: () => number = Math.random,
): LobbyFiller[] {
  if (!fillsSeats(config, publicGameType)) {
    return [];
  }
  const wanted =
    publicGameType === "hosted"
      ? OPEN_LOBBY_FILLER_COUNTS[
          Math.floor(random() * OPEN_LOBBY_FILLER_COUNTS.length)
        ]!
      : MIN_FILLERS + Math.floor(random() * (MAX_FILLERS - MIN_FILLERS + 1));
  // At least one seat stays free for a real player.
  const count = Math.max(
    0,
    Math.min(wanted, MAX_LOBBY_FILLERS, (config.maxPlayers ?? Infinity) - 1),
  );
  const used = new Set<string>();
  const fillers: LobbyFiller[] = [];
  // Bounded: a source that keeps repeating itself yields fewer fillers, not
  // a hang.
  for (let attempt = 0; fillers.length < count && attempt < 100; attempt++) {
    const username = fillerName(random);
    if (used.has(username)) continue;
    used.add(username);
    fillers.push({ clientID: generateID(), username });
  }
  return fillers;
}

// The wait until the next filler leaves or joins.
export function nextChurnDelay(random: () => number = Math.random): number {
  return (
    FILLER_CHURN_MIN_MS +
    Math.floor(random() * (FILLER_CHURN_MAX_MS - FILLER_CHURN_MIN_MS + 1))
  );
}

// One filler leaves, or a new one joins. A join adds to the end, so the
// fillers already seated keep their seats (see seatedFillers).
export function churnFillers(
  fillers: readonly LobbyFiller[],
  maxPlayers: number | undefined,
  random: () => number = Math.random,
): LobbyFiller[] {
  const most = Math.min(
    CHURN_MAX_FILLERS,
    MAX_LOBBY_FILLERS,
    (maxPlayers ?? Infinity) - 1,
  );
  const join =
    fillers.length < most &&
    (fillers.length <= CHURN_MIN_FILLERS || random() < 0.5);
  if (!join) {
    if (fillers.length === 0) return [];
    const leaver = Math.floor(random() * fillers.length);
    return fillers.filter((_, i) => i !== leaver);
  }
  const used = new Set(fillers.map((f) => f.username));
  for (let attempt = 0; attempt < 100; attempt++) {
    const username = fillerName(random);
    if (!used.has(username)) {
      return [...fillers, { clientID: generateID(), username }];
    }
  }
  return [...fillers];
}

// The fillers that still have a seat. Real players take precedence: each one
// past the free seats pushes the last filler out.
export function seatedFillers(
  fillers: readonly LobbyFiller[],
  players: number,
  maxPlayers: number | undefined,
): LobbyFiller[] {
  const free = (maxPlayers ?? Infinity) - players;
  return fillers.slice(0, Math.max(0, Math.min(fillers.length, free)));
}

const FIRST_NAMES = [
  "Lukas",
  "Mateo",
  "Jonas",
  "Emil",
  "Kai",
  "Aron",
  "Viktor",
  "Nico",
  "Leo",
  "Oskar",
  "Timo",
  "Marek",
  "Ivan",
  "Pavel",
  "Tomas",
  "Diego",
  "Hugo",
  "Sven",
  "Erik",
  "Mika",
  "Anton",
  "Felix",
  "Theo",
  "Liam",
  "Jakub",
  "Milan",
  "Luca",
  "Sami",
  "Andrei",
  "Karl",
  "Rasmus",
  "Bruno",
  "Elias",
  "Max",
  "Adam",
  "Mario",
];

const WORDS = [
  "Wolf",
  "Raven",
  "Storm",
  "Frost",
  "Ghost",
  "Viper",
  "Nomad",
  "Atlas",
  "Comet",
  "Ember",
  "Falcon",
  "Titan",
  "Rogue",
  "Drift",
  "Pixel",
  "Echo",
  "Onyx",
  "Blaze",
  "Baron",
  "Tsar",
  "Kaiser",
  "Duke",
  "Hawk",
  "Bear",
  "Fox",
  "Lynx",
  "Iron",
  "Steel",
  "North",
  "Night",
];

function pick<T>(list: readonly T[], random: () => number): T {
  return list[Math.floor(random() * list.length)]!;
}

function digits(random: () => number, length: number): string {
  let s = "";
  for (let i = 0; i < length; i++) s += Math.floor(random() * 10);
  return s;
}

// A name in one of the shapes real players pick: "jonas07", "FrostRaven",
// "Viktor_wolf", "storm312", "TheBaron".
function fillerName(random: () => number): string {
  const first = pick(FIRST_NAMES, random);
  const word = pick(WORDS, random);
  switch (Math.floor(random() * 6)) {
    case 0:
      return `${first.toLowerCase()}${digits(random, 2)}`;
    case 1:
      return `${word}${pick(WORDS, random)}`;
    case 2:
      return `${first}_${word.toLowerCase()}`;
    case 3:
      return `${word.toLowerCase()}${digits(random, 3)}`;
    case 4:
      return `The${word}`;
    default:
      return first;
  }
}

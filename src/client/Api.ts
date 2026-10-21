import type { NewsItem } from "@openfront/shared/ApiSchemas";
import {
  GetMyTribeNamesResponse,
  GetMyTribeNamesResponseSchema,
  NewsItemSchema,
  PlayerGameModeFilter,
  PlayerGameTypeFilter,
  PlayerProfile,
  PlayerProfileSchema,
  PostTribeNameResponse,
  PostTribeNameResponseSchema,
  PublicPlayerGamesResponse,
  PublicPlayerGamesResponseSchema,
  PutUsernameResponse,
  PutUsernameResponseSchema,
  RankedLeaderboardResponse,
  RankedLeaderboardResponseSchema,
  TribeLeaderboardResponse,
  TribeLeaderboardResponseSchema,
  TribeStatsResponse,
  TribeStatsResponseSchema,
  UserMeResponse,
} from "@openfront/shared/ApiSchemas";
import {
  AnalyticsRecord,
  ArchivedAnalyticsRecordSchema,
  GameInfo,
} from "@openfront/shared/WireSchemas";
import newsItemsFallback from "resources/news.json";
import { z } from "zod";
import { getApiBase, getAudience } from "./ApiBase";
import {
  getAuthHeader,
  getPlayToken,
  isSessionActive,
  logOut,
  userAuth,
} from "./Auth";
import { ClientEnv } from "./ClientEnv";
import { fetchAccountProfile } from "./LandWarAccount";
import { ensureServerList } from "./ServerList";
import { UserSettings } from "./UserSettings";

export async function fetchPlayerById(
  playerId: string,
): Promise<PlayerProfile | false> {
  return fetchPublicPlayerProfile(playerId);
}

// GET /public/player/:publicId — public player profile (stats tree). No auth,
// so logged-out visitors can view shared profiles.
export async function fetchPublicPlayerProfile(
  publicId: string,
): Promise<PlayerProfile | false> {
  try {
    const url = `/api/players/${encodeURIComponent(publicId)}/profile`;

    const res = await fetch(url, {
      headers: { Accept: "application/json" },
    });

    if (res.status !== 200) {
      console.warn(
        "fetchPublicPlayerProfile: unexpected status",
        res.status,
        res.statusText,
      );
      return false;
    }

    const json = await res.json();
    const parsed = PlayerProfileSchema.safeParse(json);
    if (!parsed.success) {
      console.warn(
        "fetchPublicPlayerProfile: Zod validation failed",
        parsed.error,
      );
      return false;
    }

    return parsed.data;
  } catch (err) {
    console.warn("fetchPublicPlayerProfile: request failed", err);
    return false;
  }
}

// GET /public/player/:publicId/games — keyset-paginated personal game history.
// Public (no auth). `filter` (mode bucket) and `type` (game-type split) are
// orthogonal; `cursor` is the opaque token from the previous response's
// nextCursor — round-trip verbatim, never construct it.
export async function fetchPublicPlayerGames(
  publicId: string,
  opts: {
    filter?: PlayerGameModeFilter;
    type?: PlayerGameTypeFilter;
    cursor?: string;
  } = {},
): Promise<PublicPlayerGamesResponse | { error: "failed" }> {
  try {
    const url = new URL(
      `${getApiBase()}/public/player/${encodeURIComponent(publicId)}/games`,
      window.location.origin,
    );
    if (opts.filter) url.searchParams.set("filter", opts.filter);
    if (opts.type) url.searchParams.set("type", opts.type);
    if (opts.cursor) url.searchParams.set("cursor", opts.cursor);

    const res = await fetch(url.toString(), {
      headers: { Accept: "application/json" },
    });
    if (!res.ok) {
      console.warn(
        "fetchPublicPlayerGames: unexpected status",
        res.status,
        res.statusText,
      );
      return { error: "failed" };
    }

    const json = await res.json();
    const parsed = PublicPlayerGamesResponseSchema.safeParse(json);
    if (!parsed.success) {
      console.warn(
        "fetchPublicPlayerGames: Zod validation failed",
        parsed.error,
      );
      return { error: "failed" };
    }
    return parsed.data;
  } catch (err) {
    console.warn("fetchPublicPlayerGames: request failed", err);
    return { error: "failed" };
  }
}

let __userMe: Promise<UserMeResponse | false> | null = null;

// The profile outlives the session it describes unless this is dropped with
// it: getUserMe answers from the cache before it checks authentication, so a
// consumer calling it after a background logout would read the expired
// account straight back. Handled here rather than in Auth, which cannot
// import this module — the dependency runs the other way.
document.addEventListener("session-cleared", () => invalidateUserMe());
/**
 * True for the rejection AbortSignal.timeout (or an explicit abort) produces.
 * Deliberately narrow: a client-imposed deadline is the one failure that says
 * nothing at all about the account, so it is the one worth retrying.
 */
function isAbortError(e: unknown): boolean {
  const name = (e as { name?: unknown } | null)?.name;
  return name === "TimeoutError" || name === "AbortError";
}

/**
 * One /users/@me round trip, with no memoisation of any kind.
 *
 * `aborted` distinguishes the one failure that concluded nothing about the
 * account (a deadline we imposed ourselves) from every other falsy answer,
 * which is a conclusion. Only getUserMe acts on it; see the un-caching rule
 * there.
 */
async function requestUserMe(): Promise<{
  profile: UserMeResponse | false;
  aborted: boolean;
}> {
  try {
    const userAuthResult = await userAuth();
    if (!userAuthResult) return { profile: false, aborted: false };
    const { claims } = userAuthResult;
    const profile = await fetchAccountProfile(AbortSignal.timeout(10_000));
    if (profile === false) return { profile: false, aborted: false };
    // Only apply the player-scoped settings while the session that asked is
    // still current. A response that arrives after a logout must not reach
    // them.
    if (isSessionActive(claims.sub)) {
      UserSettings.setPlayerId(profile.player.publicId);
    }
    return { profile, aborted: false };
  } catch (e) {
    return { profile: false, aborted: isAbortError(e) };
  }
}

export async function getUserMe(): Promise<UserMeResponse | false> {
  if (__userMe !== null) {
    return __userMe;
  }
  // A holder rather than a plain local so the body below can recognise its
  // own promise as the cached one. Filled in immediately after, which is
  // always before any await inside can resume.
  const attempt: { request?: Promise<UserMeResponse | false> } = {};
  attempt.request = (async () => {
    const { profile, aborted } = await requestUserMe();
    // Un-cache a timeout, and ONLY a timeout. Every other falsy answer is
    // a conclusion about the account — signed out, a 401, a rejected token
    // — and stays remembered; re-deriving those would put an /auth/refresh
    // behind every getUserMe() call for every logged-out player, which is
    // the storm, not the fix. A deadline we imposed ourselves concluded
    // nothing, so leaving it cached would strand a merely-slow connection
    // as "signed out" for the rest of the session: no player-scoped
    // settings, no cosmetics, no verified badge, recoverable only by
    // reloading. Same shape as fetchCosmetics, for the same reason.
    // Remembering an unreachable backend so the retry is not paid at full
    // price is OPE-403.
    //
    // Cleared here rather than from a .then on the request: this runs
    // before the promise resolves, so a caller awaiting it cannot observe
    // the timed-out answer still cached. attempt.request is always set by
    // now — this line can only be reached after an await.
    if (aborted && __userMe === attempt.request) {
      __userMe = null;
    }
    return profile;
  })();
  __userMe = attempt.request;
  return attempt.request;
}

export function invalidateUserMe() {
  __userMe = null;
}

export type UpdateUsernameResult =
  | { ok: true; data: PutUsernameResponse }
  | { ok: false; code: "invalid"; message?: string }
  | { ok: false; code: "profane" }
  | { ok: false; code: "taken" }
  // A subscriber asked for a bare name another subscriber holds. Nothing was
  // written and no cooldown was spent; resubmit with acceptSuffixed to take
  // the numbered form (spec, 10 Sept 2026).
  | { ok: false; code: "bare_taken"; base: string }
  | { ok: false; code: "cooldown"; retryAfterSeconds: number | null }
  | { ok: false; code: "failed" };

// PUT /users/@me/username — renames the account username. Every failure is
// atomic (no name change, no cooldown consumed). The surviving plain 409
// bodies ("name equals an existing public id" and "suffix space exhausted")
// map to "taken": the user remedy is the same — pick another name. A 409
// carrying code BARE_NAME_TAKEN maps to "bare_taken": the caller offers the
// numbered form and, on yes, calls again with `acceptSuffixed`. Invalidates
// the cached /users/@me on success so the next read reflects the new name.
//
// Against an API that predates the strict rule, a held bare name still comes
// back as a 200 with `bareClaim: "unavailable"` — a real rename that consumed
// the cooldown — so `ok: true` callers must still read `data.bareClaim` and
// say so (see UsernamePanel.warnBareClaimUnavailable).
export async function updateUsername(
  username: string,
  opts: { acceptSuffixed?: boolean } = {},
): Promise<UpdateUsernameResult> {
  try {
    const response = await fetch(`${getApiBase()}/users/@me/username`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: await getAuthHeader(),
      },
      body: JSON.stringify(
        opts.acceptSuffixed ? { username, acceptSuffixed: true } : { username },
      ),
    });
    if (response.status === 401) {
      await logOut();
      return { ok: false, code: "failed" };
    }
    if (response.status === 400) {
      const body = await response.json().catch(() => null);
      if (body?.code === "USERNAME_PROFANE") {
        return { ok: false, code: "profane" };
      }
      return {
        ok: false,
        code: "invalid",
        message: typeof body?.reason === "string" ? body.reason : undefined,
      };
    }
    if (response.status === 409) {
      const body = await response.json().catch(() => null);
      if (body?.code === "BARE_NAME_TAKEN") {
        return {
          ok: false,
          code: "bare_taken",
          base: typeof body.base === "string" ? body.base : username,
        };
      }
      return { ok: false, code: "taken" };
    }
    if (response.status === 429) {
      const retryAfter = response.headers.get("Retry-After");
      const seconds = retryAfter === null ? NaN : Number(retryAfter);
      return {
        ok: false,
        code: "cooldown",
        retryAfterSeconds: Number.isFinite(seconds) ? seconds : null,
      };
    }
    if (!response.ok) {
      console.error(
        "updateUsername: request failed",
        response.status,
        response.statusText,
      );
      return { ok: false, code: "failed" };
    }
    const parsed = PutUsernameResponseSchema.safeParse(await response.json());
    if (!parsed.success) {
      console.error("updateUsername: Zod validation failed", parsed.error);
      return { ok: false, code: "failed" };
    }
    invalidateUserMe();
    return { ok: true, data: parsed.data };
  } catch (e) {
    console.error("updateUsername: request failed", e);
    return { ok: false, code: "failed" };
  }
}

// GET /users/@me/tribe_names — the player's purchased custom tribe names plus
// the current purchase price. Auth required; returns false when logged out or
// on any error (callers show a login/empty state rather than a hard failure).
export async function getMyTribeNames(): Promise<
  GetMyTribeNamesResponse | false
> {
  try {
    const response = await fetch(`${getApiBase()}/users/@me/tribe_names`, {
      headers: {
        Authorization: await getAuthHeader(),
      },
    });
    if (response.status === 401) {
      await logOut();
      return false;
    }
    if (!response.ok) {
      console.error(
        "getMyTribeNames: request failed",
        response.status,
        response.statusText,
      );
      return false;
    }
    const parsed = GetMyTribeNamesResponseSchema.safeParse(
      await response.json(),
    );
    if (!parsed.success) {
      console.error("getMyTribeNames: Zod validation failed", parsed.error);
      return false;
    }
    return parsed.data;
  } catch (e) {
    console.error("getMyTribeNames: request failed", e);
    return false;
  }
}

// The branch key the shared spend helper returns when a refund or chargeback
// has left the wallet negative. A machine key, never prose: it must not reach
// the player, which is what happened before the debt paths were handled.
//
// Since OPE-389 the API sends it as `code`; before that the same token was
// the `reason`, which is exactly why it used to be rendered. One constant
// because the token is the same either way.
const DEBT_REFUSAL_CODE = "insufficient_balance_debt";

// Stands in for a `code` key that is present but is not a usable machine key
// (42, "", null). That is not the same as absent: the server did mean to send
// a code, so falling back to matching its English would be reading a body we
// have already established we do not understand. Nothing maps this, so every
// caller lands on its generic failure. Not a valid identifier, so no code the
// API could ever add collides with it.
const UNUSABLE_REFUSAL_CODE = " unusable";

// The stable machine key the API puts beside the prose `reason` in a 400
// (OPE-389). `undefined` means the key is absent — an older server that
// predates the codes, or a body that is not a refusal at all — and only that
// leaves the caller on its pre-OPE-389 string matching. Nothing but the
// presence and identity of this key is trusted: it is never rendered or
// logged.
function refusalCode(body: unknown): string | undefined {
  if (body === null || typeof body !== "object" || !("code" in body)) {
    return undefined;
  }
  const code = (body as { code?: unknown }).code;
  return typeof code === "string" && code !== "" ? code : UNUSABLE_REFUSAL_CODE;
}

// Reads the debt refusal off a 400 body for every spend path. Returns
// undefined when this is not that refusal, so the caller carries on matching
// its own reasons; otherwise it returns the result the caller should return.
//
// The amount IS the message ("your balance is X in debt"), so a debt we
// cannot state is worse than a generic failure — it would render a blank, or
// "[object Object]", at the player. A string of digits only: the API sends a
// stringified positive bigint, so everything else (missing, empty, negative,
// an object) fails closed.
//
// Type-checked before the pattern rather than stringified into it, because
// String() launders things that are not amounts into ones that look like
// amounts: String(300) and String([300]) are both "300". Whatever the API
// starts sending, it has to be the string it promises.
//
// `context` is the calling function's name as a literal at each call site.
// Nothing from the body reaches the warn: an amount we rejected is by
// definition one we do not understand.
function parseDebtRefusal(
  body: unknown,
  context: string,
):
  | { ok: false; code: "debt"; debt: string }
  | { ok: false; code: "failed" }
  | undefined {
  const code = refusalCode(body);
  // `code` when the server sends one, the old prose token only when it does
  // not: production can lag the API, so the string match stays as a fallback
  // and never as an override.
  const isDebt =
    code !== undefined
      ? code === DEBT_REFUSAL_CODE
      : (body as { reason?: unknown } | null | undefined)?.reason ===
        DEBT_REFUSAL_CODE;
  if (!isDebt) return undefined;
  const debt = (body as { debt?: unknown } | null | undefined)?.debt;
  if (typeof debt !== "string" || !/^\d+$/.test(debt)) {
    console.warn(`${context}: debt refusal with no usable amount`);
    return { ok: false, code: "failed" };
  }
  return { ok: false, code: "debt", debt };
}

export type PurchaseTribeNameResult =
  | { ok: true; data: PostTribeNameResponse }
  // 400 "Insufficient balance": the balance moved since the client's
  // pre-check. Nothing charged.
  | { ok: false; code: "insufficient_balance" }
  // 400 insufficient_balance_debt: a refund/chargeback left the wallet
  // negative; `debt` (bigint string) must be settled before anything is
  // spendable. Nothing charged.
  | { ok: false; code: "debt"; debt: string }
  // 400: the name itself was refused. Each of the server's refusal codes
  // maps to a code the caller translates — none of them reach the player as
  // the server's English. See TRIBE_NAME_REFUSAL_CODES for why the set is an
  // allowlist.
  | { ok: false; code: "invalid_charset" }
  | { ok: false; code: "invalid_no_letter" }
  | { ok: false; code: "not_allowed" }
  // The length rule carries its bounds, so the caller interpolates them.
  | { ok: false; code: "length"; min: number; max: number }
  // 409: the name is already taken (names are globally unique).
  | { ok: false; code: "duplicate" }
  // 429: buying names too fast. `retryAfterSeconds` from the Retry-After
  // header (null when absent/unparseable).
  | { ok: false; code: "rate_limited"; retryAfterSeconds: number | null }
  | { ok: false; code: "failed" };

// The endpoint's refusal codes, mapped to the codes the caller translates
// (OPE-389). The server's `code` is the branch key; its `reason` is English
// documentation and is never read for meaning and never rendered.
//
// An allowlist rather than a denylist, because the failure mode is
// asymmetric. Anything unrecognised becomes a generic failure — mildly
// unhelpful. Echoing anything unrecognised puts the next machine branch key
// the API adds straight on the player's screen, which is how
// "insufficient_balance_debt" came to be displayed as an error message.
//
// `no_letter` is renamed on the way in: the caller's `invalid_no_letter` is
// pre-existing public API of this module, so the two vocabularies are mapped
// here rather than one being churned to match the other.
//
// A Map rather than an object literal because the key comes off the wire:
// a plain lookup of "constructor" or "toString" returns something from
// Object.prototype instead of undefined, and that is not a refusal code.
const TRIBE_NAME_REFUSAL_CODES = new Map<
  string,
  "invalid_charset" | "invalid_no_letter" | "not_allowed"
>([
  ["invalid_charset", "invalid_charset"],
  ["no_letter", "invalid_no_letter"],
  ["not_allowed", "not_allowed"],
]);

// The same refusals keyed on the server's exact English, for a server that
// predates OPE-389 and sends no `code`. Production can lag the API, so this
// stays — but only as the fallback. If the API rewords one of these on an
// older deployment the player gets the generic failure, which is the safe
// direction.
const LEGACY_TRIBE_NAME_REFUSAL_REASONS = new Map<
  string,
  "invalid_charset" | "invalid_no_letter" | "not_allowed"
>([
  [
    "Name may only contain letters, numbers, spaces, and ' - . _ ! ?",
    "invalid_charset",
  ],
  ["Name must contain a letter", "invalid_no_letter"],
  ["This name is not allowed", "not_allowed"],
]);
// The length rule interpolates its bounds ("Name must be 3-24 characters"),
// so on a pre-OPE-389 server — where the numbers are only in the prose — it
// is matched by shape rather than listed. Anchored and digit-specific: a
// bare "Name must be " prefix would pass through anything the API ever chose
// to start that way, which is the denylist failure this is meant to avoid.
// The bounds are captured so the caller can translate the message instead of
// rendering the server's English.
const TRIBE_NAME_LENGTH_REASON_RE = /^Name must be (\d+)-(\d+) characters$/;

function legacyTribeNameInvalidResult(
  reason: string,
): PurchaseTribeNameResult | undefined {
  const bounds = proseBounds(reason);
  if (bounds !== undefined) return { ok: false, code: "length", ...bounds };
  const code = LEGACY_TRIBE_NAME_REFUSAL_REASONS.get(reason);
  return code === undefined ? undefined : { ok: false, code };
}

// A single `length` bound. The bounds are what the message says, so an
// unusable one is not usable at all: a positive safe integer or nothing.
function isUsableBound(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

// The `length` bounds as a range, or nothing. Validated as a pair rather than
// one at a time: `{min: 24, max: 3}` is two individually plausible numbers
// and one impossible range, and it would render as "24-3" at the player.
//
// Every source of bounds goes through here, including the ones scraped out of
// the prose. Digits in a sentence are not more trustworthy than numbers in a
// field — "Name must be 24-3 characters" and a 30-digit bound both parse.
function usableBounds(
  min: unknown,
  max: unknown,
): { min: number; max: number } | undefined {
  if (!isUsableBound(min) || !isUsableBound(max) || min > max) return undefined;
  return { min, max };
}

// The bounds the API sends as fields (OPE-389).
function bodyBounds(body: unknown): { min: number; max: number } | undefined {
  const record = body as Record<string, unknown> | null | undefined;
  return usableBounds(record?.min, record?.max);
}

// The bounds a pre-OPE-389 server only puts in the sentence.
function proseBounds(reason: string): { min: number; max: number } | undefined {
  const parsed = TRIBE_NAME_LENGTH_REASON_RE.exec(reason);
  return parsed === null
    ? undefined
    : usableBounds(Number(parsed[1]), Number(parsed[2]));
}

// Why the name was refused, keyed on the server's machine `code` (OPE-389).
// Returns undefined for a code this client does not know, which the caller
// turns into a generic failure — the code is never rendered.
function tribeNameInvalidResult(
  code: string,
  body: unknown,
): PurchaseTribeNameResult | undefined {
  if (code === "length") {
    const fromBody = bodyBounds(body);
    if (fromBody !== undefined) {
      return { ok: false, code: "length", ...fromBody };
    }
    // The bounds ARE the message, so there is nothing to render without
    // them. The prose still carries them on every server that sends this
    // code, so read them out of it rather than showing a blank range — and
    // hold them to the same standard, since a sentence can carry an
    // impossible range as easily as a field can. Only the length pattern is
    // tried here: a `length` code sitting next to some other refusal's prose
    // is a body we do not understand. Nothing usable either way is the
    // caller's generic failure.
    const reason = (body as { reason?: unknown } | null | undefined)?.reason;
    if (typeof reason !== "string") return undefined;
    const fromProse = proseBounds(reason);
    return fromProse === undefined
      ? undefined
      : { ok: false, code: "length", ...fromProse };
  }
  const mapped = TRIBE_NAME_REFUSAL_CODES.get(code);
  return mapped === undefined ? undefined : { ok: false, code: mapped };
}

// POST /users/@me/tribe_names — buy a custom tribe name (200 plutonium). The
// name is screened, charged, and goes live right away as `pending`; review is
// post-hoc and only takes bad names down. Spends hard currency, so callers
// should invalidate the cached /users/@me afterwards.
export async function purchaseTribeName(
  name: string,
): Promise<PurchaseTribeNameResult> {
  try {
    const response = await fetch(`${getApiBase()}/users/@me/tribe_names`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: await getAuthHeader(),
      },
      body: JSON.stringify({ name }),
    });
    if (response.status === 401) {
      await logOut();
      return { ok: false, code: "failed" };
    }
    if (response.status === 400) {
      const body = await response.json().catch(() => null);
      const reason = typeof body?.reason === "string" ? body.reason : "";
      const code = refusalCode(body);
      // Balance refusals first: both are branch keys the shared spend helper
      // emits, not prose to echo at the player.
      const debt = parseDebtRefusal(body, "purchaseTribeName");
      if (debt !== undefined) return debt;
      if (
        code === undefined
          ? reason === "Insufficient balance"
          : code === "insufficient_balance"
      ) {
        return { ok: false, code: "insufficient_balance" };
      }
      // `code` when the server sends one (OPE-389), the English only when it
      // does not — production can lag the API.
      const invalid =
        code === undefined
          ? legacyTribeNameInvalidResult(reason)
          : tribeNameInvalidResult(code, body);
      if (invalid !== undefined) return invalid;
      // Not logging the body: an unrecognised refusal is exactly the case
      // where we don't know what it contains.
      console.warn("purchaseTribeName: unrecognised 400 reason");
      return { ok: false, code: "failed" };
    }
    if (response.status === 409) {
      return { ok: false, code: "duplicate" };
    }
    if (response.status === 429) {
      const retryAfter = response.headers.get("Retry-After");
      const seconds = retryAfter === null ? NaN : Number(retryAfter);
      return {
        ok: false,
        code: "rate_limited",
        retryAfterSeconds: Number.isFinite(seconds) ? seconds : null,
      };
    }
    if (!response.ok) {
      console.error(
        "purchaseTribeName: request failed",
        response.status,
        response.statusText,
      );
      return { ok: false, code: "failed" };
    }
    const parsed = PostTribeNameResponseSchema.safeParse(await response.json());
    if (!parsed.success) {
      console.error("purchaseTribeName: Zod validation failed", parsed.error);
      return { ok: false, code: "failed" };
    }
    return { ok: true, data: parsed.data };
  } catch (e) {
    console.error("purchaseTribeName: request failed", e);
    return { ok: false, code: "failed" };
  }
}

// GET /public/tribe/:name — live stats for one custom tribe name. Public
// (no auth), so it works for any name, but 404s for names that are unknown,
// rejected/revoked, or whose owner is banned — that folds into false along
// with every other failure, since callers can't act on the difference.
export async function fetchTribeStats(
  name: string,
): Promise<TribeStatsResponse | false> {
  try {
    const res = await fetch(
      `${getApiBase()}/public/tribe/${encodeURIComponent(name)}`,
      { headers: { Accept: "application/json" } },
    );
    if (res.status !== 200) {
      console.warn(
        "fetchTribeStats: unexpected status",
        res.status,
        res.statusText,
      );
      return false;
    }
    const parsed = TribeStatsResponseSchema.safeParse(await res.json());
    if (!parsed.success) {
      console.warn("fetchTribeStats: Zod validation failed", parsed.error);
      return false;
    }
    return parsed.data;
  } catch (err) {
    console.warn("fetchTribeStats: request failed", err);
    return false;
  }
}

// POST /shop/purchase — buy a single cosmetic for hard or soft currency. The
// only spend path that takes soft currency. Any error means no debit and no
// grant. Callers invalidate the cached /users/@me on success.
export type PurchaseWithCurrencyResult =
  | { ok: true }
  // 400 "Insufficient balance": the balance moved since the client's
  // pre-check. Nothing charged.
  | { ok: false; code: "insufficient_balance" }
  // 400 insufficient_balance_debt: a refund/chargeback left the wallet
  // negative; `debt` (bigint string) must be settled before anything is
  // spendable. Nothing charged. Distinct from the above because buying more
  // currency is not the remedy.
  | { ok: false; code: "debt"; debt: string }
  // 409 "Already owned": the player already holds this cosmetic. Also what a
  // retry after a timed-out success returns — treat it as "already bought"
  // and refetch. Nothing charged. No payload: unlike the pack's 409 the body
  // carries no item list, only {error, message}.
  | { ok: false; code: "already_owned" }
  | { ok: false; code: "failed" };

export async function purchaseWithCurrency(
  cosmeticType: "pattern" | "skin" | "flag" | "crown" | "effect",
  cosmeticName: string,
  currencyType: "hard" | "soft",
  colorPaletteName?: string,
): Promise<PurchaseWithCurrencyResult> {
  try {
    const response = await fetch("/api/shop/purchase", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        cosmeticType,
        cosmeticName,
        currencyType,
        colorPaletteName,
      }),
    });
    if (response.status === 401) {
      await logOut();
      return { ok: false, code: "failed" };
    }
    if (response.status === 400) {
      const body = await response.json().catch(() => null);
      const reason = typeof body?.reason === "string" ? body.reason : "";
      const debt = parseDebtRefusal(body, "purchaseWithCurrency");
      if (debt !== undefined) return debt;
      if (reason === "Insufficient balance") {
        return { ok: false, code: "insufficient_balance" };
      }
      // Not logging the body: an unrecognised reason is exactly the case
      // where we don't know what it contains.
      console.warn("purchaseWithCurrency: unrecognised 400 reason");
      return { ok: false, code: "failed" };
    }
    if (response.status === 409) {
      // The body is deliberately not read: it carries no item list, so there
      // is nothing to extract, and not touching it is the cheapest way to
      // keep a server body away from a log line.
      return { ok: false, code: "already_owned" };
    }
    if (!response.ok) {
      console.error(
        "purchaseWithCurrency: request failed",
        response.status,
        response.statusText,
      );
      return { ok: false, code: "failed" };
    }
    return { ok: true };
  } catch (e) {
    console.error("purchaseWithCurrency: request failed", e);
    return { ok: false, code: "failed" };
  }
}

export async function changeSubscriptionTier(
  tierName: string,
): Promise<boolean | "rate_limited" | "steam_licence_required"> {
  try {
    const response = await fetch(
      `${getApiBase()}/subscriptions/@me/change-tier`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: await getAuthHeader(),
        },
        body: JSON.stringify({ tierName }),
      },
    );
    if (response.status === 401) {
      await logOut();
      return false;
    }
    // The API allows one tier change per minute per player.
    if (response.status === 429) {
      return "rate_limited";
    }
    if (response.status === 403) {
      const body = await response.json().catch(() => null);
      if (body?.reason === "steam_licence_required") {
        return "steam_licence_required";
      }
    }
    if (!response.ok) {
      console.error(
        "changeSubscriptionTier: request failed",
        response.status,
        response.statusText,
      );
      return false;
    }
    return true;
  } catch (e) {
    console.error("changeSubscriptionTier: request failed", e);
    return false;
  }
}

export async function openSubscriptionPortal(): Promise<string | false> {
  try {
    const response = await fetch(`${getApiBase()}/subscriptions/@me/portal`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: await getAuthHeader(),
      },
      body: JSON.stringify({
        returnUrl: window.location.origin,
      }),
    });
    if (response.status === 401) {
      await logOut();
      return false;
    }
    if (!response.ok) {
      console.error(
        "openSubscriptionPortal: request failed",
        response.status,
        response.statusText,
      );
      return false;
    }
    const json = await response.json();
    return json.url;
  } catch (e) {
    console.error("openSubscriptionPortal: request failed", e);
    return false;
  }
}

// GET /api/game/:id on the game server (worker) — whether the game is a
// publicly listed lobby. False on any failure: callers use this to hide
// host powers that the server blocks in listed games anyway, so the safe
// default is to change nothing.
export async function fetchLobbyListed(gameID: string): Promise<boolean> {
  try {
    await ensureServerList();
    const res = await fetch(
      `${ClientEnv.gameHttpBase(gameID)}/${ClientEnv.gameWorkerPath(gameID)}/api/game/${gameID}`,
      { headers: { Accept: "application/json" } },
    );
    if (!res.ok) return false;
    const json = await res.json();
    return json?.listed === true;
  } catch (e) {
    console.warn("fetchLobbyListed: request failed", e);
    return false;
  }
}

// POST /api/game/:id/listing on the game server (worker) — toggles whether a
// private lobby appears in the public lobby browser. Creator-only and
// server-authoritative (subscription, whitelist/cheat and quota checks).
// On failure, `error` is the server's rejection code when available (e.g.
// "subscription_required", "listing_limit_reached", "listing_full").
export async function setLobbyListed(
  gameID: string,
  listed: boolean,
  options: { autoStartMs?: number; maxPlayers?: number } = {},
): Promise<{ ok: true; listed: boolean } | { ok: false; error?: string }> {
  try {
    await ensureServerList();
    const token = await getPlayToken();
    const response = await fetch(
      `${ClientEnv.gameHttpBase(gameID)}/${ClientEnv.gameWorkerPath(gameID)}/api/game/${gameID}/listing`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ listed, ...options }),
      },
    );
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      return { ok: false, error: body?.error };
    }
    return {
      ok: true,
      listed: typeof body?.listed === "boolean" ? body.listed : listed,
    };
  } catch (e) {
    console.error("setLobbyListed: request failed", e);
    return { ok: false };
  }
}

// POST /api/game/:id/queue on the game server — the host of a listed lobby
// pays plutonium to put it in the public Special queue. The worker charges
// through the API with the host's token. On failure, `error` is the server's
// code when available ("insufficient_balance", "queue_payment_failed", ...).
export async function queueLobby(
  gameID: string,
): Promise<{ ok: true } | { ok: false; error?: string }> {
  try {
    await ensureServerList();
    const token = await getPlayToken();
    const response = await fetch(
      `${ClientEnv.gameHttpBase(gameID)}/${ClientEnv.gameWorkerPath(gameID)}/api/game/${gameID}/queue`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      },
    );
    if (response.ok) return { ok: true };
    const body = await response.json().catch(() => null);
    return { ok: false, error: body?.error };
  } catch (e) {
    console.error("queueLobby: request failed", e);
    return { ok: false };
  }
}

// POST /api/create_game on the game server — mints a fresh private lobby with
// the caller as creator. Deliberately has no worker prefix and no id: the edge
// (nginx in prod, the vite dev proxy locally) picks a worker, which mints a
// self-owned id and returns it, along with the play token the lobby was
// created under. The host must join with that same token: a cookieless guest
// (blocked third-party cookies, some iframes) is minted a new identity on each
// JWT refresh, and a refresh landing between create and join leaves the host
// in their own lobby as someone who is not its creator.
export async function createLobby(): Promise<{
  lobby: GameInfo;
  creatorToken: string;
}> {
  // A new game needs a server that takes new games on this build: ask the
  // API (multi-server v2), falling back to the page's own server. When the
  // list says nothing runs this build any more, creating against the page's
  // own (by then stale) host would at best mint a lobby on a server that is
  // going away, so stop here instead. By the time Create is clicked the
  // lobby socket has almost always raised the "update available" prompt
  // already; a Create that gets there first fails like any other failed
  // request, and the caller's own failure path (re-enabling the button,
  // clearing the share link) runs as usual.
  //
  // "outdated" is by construction a page that names no server of its own
  // (docs/MultiServer.md, OPE-430): there the list is the only thing that
  // knows where a server is, and it says there is none for this build. A
  // page a game server rendered answers "fallback" whatever the list says
  // about its own host, and creating against that host is right — it is
  // running this build, because it served this page, and it is where this
  // tab's lobby list and its session already live. That is how Create
  // behaved before the list existed, and the signal that moves such a tab
  // off a deployment on its way out is the lobby feed's commit compare and
  // drain flag, not this.
  if ((await ensureServerList()) === "outdated") {
    throw new Error(
      "createLobby: this build has no server; a newer version is available",
    );
  }
  // Send JWT token for creator identification - server extracts persistentID from it
  // persistentID should never be exposed to other clients
  const token = await getPlayToken();
  try {
    const response = await fetch(
      `${ClientEnv.serverHttpBase()}/api/create_game`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
      },
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Server error response:", errorText);
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    console.log("Success:", data);

    return { lobby: data as GameInfo, creatorToken: token };
  } catch (error) {
    console.error("Error creating lobby:", error);
    throw error;
  }
}

// POST /wX/api/create_game?previous=<gameID>, targeted at the worker that owns
// the finished game — mints a successor private lobby (same creator, default
// settings) and has the old game broadcast the new id to everyone still
// connected. Returns the successor's info; the caller navigates the host there.
// Idempotent server-side: repeat calls return the same successor.
export async function createNextLobby(
  previousGameID: string,
): Promise<GameInfo> {
  // Nothing is caught here: a NoServerError from gameWorkerPath below
  // propagates to the only caller (GameRightSidebar's successor-lobby
  // button), which already catches, logs and re-enables the button — the
  // right answer for "there is no server to create it on". No "outdated"
  // check either, unlike createLobby: this continues an existing game on
  // the server that game already lives on, rather than starting something
  // new somewhere.
  await ensureServerList();
  const token = await getPlayToken();
  const response = await fetch(
    `${ClientEnv.gameHttpBase(previousGameID)}/${ClientEnv.gameWorkerPath(previousGameID)}/api/create_game?previous=${previousGameID}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
    },
  );
  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    console.error("createNextLobby: server error response:", errorText);
    throw new Error(`create next lobby failed: HTTP ${response.status}`);
  }
  return (await response.json()) as GameInfo;
}

// getApiBase/getAudience moved to ApiBase.ts so ServerList.ts (which this
// module imports) can use them without a cycle; re-exported here for every
// existing importer.
export { getApiBase, getAudience };

export async function fetchGameById(
  gameId: string,
): Promise<AnalyticsRecord | false> {
  try {
    const url = `${getApiBase()}/games/${encodeURIComponent(gameId)}`;
    const res = await fetch(url, {
      headers: {
        Accept: "application/json",
      },
    });

    if (res.status !== 200) {
      console.warn(
        "fetchGameById: unexpected status",
        res.status,
        res.statusText,
      );
      return false;
    }

    const json = await res.json();
    // Lenient schema: archives written by older builds predate several
    // schema changes (see ArchivedAnalyticsRecordSchema).
    const parsed = ArchivedAnalyticsRecordSchema.safeParse(json);
    if (!parsed.success) {
      console.warn("fetchGameById: Zod validation failed", parsed.error);
      return false;
    }

    return parsed.data;
  } catch (err) {
    console.warn("fetchGameById: request failed", err);
    return false;
  }
}

// The API answers a page past the end of the ranked leaderboard with a 400
// instead of an empty list, so the end is only detectable from the error body.
// Its wording is part of the contract; the bounds vary with the page cap.
const PAGE_BOUNDS_MESSAGE = /^Page must be between \d+ and \d+$/;

export function isPageBoundsMessage(body: unknown): boolean {
  return (
    typeof body === "object" &&
    body !== null &&
    "message" in body &&
    typeof body.message === "string" &&
    PAGE_BOUNDS_MESSAGE.test(body.message)
  );
}

export async function fetchPlayerLeaderboard(
  page: number,
): Promise<RankedLeaderboardResponse | "reached_limit" | false> {
  try {
    const url = new URL("/api/leaderboard/ranked", window.location.origin);
    url.searchParams.set("page", String(page));
    const res = await fetch(url.toString(), {
      headers: { Accept: "application/json" },
    });

    if (!res.ok) {
      if (res.status === 400) {
        const body = await res.json().catch(() => null);
        if (isPageBoundsMessage(body)) {
          return "reached_limit";
        }
      }
      console.warn(
        "fetchPlayerLeaderboard: unexpected status",
        res.status,
        res.statusText,
      );
      return false;
    }

    const parsed = RankedLeaderboardResponseSchema.safeParse(await res.json());
    if (!parsed.success) {
      console.warn(
        "fetchPlayerLeaderboard: Zod validation failed",
        parsed.error.toString(),
      );
      return false;
    }

    return parsed.data;
  } catch (err) {
    console.error("fetchPlayerLeaderboard: request failed", err);
    return false;
  }
}

const TRIBE_LEADERBOARD_PAGE_SIZE = 50;

async function fetchTribeLeaderboardPage(
  page: number,
): Promise<TribeLeaderboardResponse | false> {
  try {
    const url = new URL(
      `${getApiBase()}/leaderboard/tribes`,
      window.location.origin,
    );
    url.searchParams.set("page", String(page));
    const res = await fetch(url.toString(), {
      headers: { Accept: "application/json" },
    });

    if (!res.ok) {
      console.warn(
        "fetchTribeLeaderboardPage: unexpected status",
        res.status,
        res.statusText,
      );
      return false;
    }

    const parsed = TribeLeaderboardResponseSchema.safeParse(await res.json());
    if (!parsed.success) {
      console.warn(
        "fetchTribeLeaderboardPage: Zod validation failed",
        parsed.error.toString(),
      );
      return false;
    }

    return parsed.data;
  } catch (err) {
    console.error("fetchTribeLeaderboardPage: request failed", err);
    return false;
  }
}

// Fetches the whole tribe-name board. It caps at two 50-entry pages and the
// response carries no total or hasMore, so a full first page is the only
// signal that a second one exists — and the common case early on is one
// short page, i.e. a single request.
export async function fetchTribeLeaderboard(): Promise<
  TribeLeaderboardResponse | false
> {
  const first = await fetchTribeLeaderboardPage(1);
  if (first === false) return false;
  if (first.tribes.length < TRIBE_LEADERBOARD_PAGE_SIZE) return first;

  // A truncated board beats an error screen, so keep page 1 if the tail fails.
  const second = await fetchTribeLeaderboardPage(2);
  if (second === false) return first;

  return { ...first, tribes: [...first.tribes, ...second.tribes] };
}

export async function getNews(): Promise<NewsItem[]> {
  try {
    const res = await fetch("/api/news.json", {
      headers: { Accept: "application/json" },
    });
    if (res.status !== 200) {
      console.warn("getNews: unexpected status", res.status);
      return newsItemsFallback as NewsItem[];
    }
    const json = await res.json();
    const parsed = z.array(NewsItemSchema).safeParse(json);
    if (!parsed.success) {
      console.warn("getNews: Zod validation failed", parsed.error);
      return newsItemsFallback as NewsItem[];
    }
    return parsed.data;
  } catch (err) {
    console.warn("getNews: request failed, using fallback", err);
    return newsItemsFallback as NewsItem[];
  }
}

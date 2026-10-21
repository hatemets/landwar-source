import {
  isGrantedSubscription,
  UserMeResponse,
} from "@openfront/shared/ApiSchemas";
import { assetUrl } from "@openfront/shared/AssetUrls";
import {
  ColorPalette,
  CosmeticPack,
  CosmeticPackItem,
  Cosmetics,
  CosmeticsSchema,
  Crown,
  Effect,
  findEffectForSlot,
  Flag,
  Pack,
  Pattern,
  Skin,
  Subscription,
} from "@openfront/shared/CosmeticSchemas";
import {
  PlayerCosmeticRefs,
  PlayerCosmetics,
  PlayerEffect,
  PlayerPattern,
} from "@openfront/shared/WireSchemas";
import { getUserMe, invalidateUserMe, purchaseWithCurrency } from "./Api";
import { showInGameAlert } from "./InGameModal";
import { UserSettings } from "./UserSettings";
import { translateText } from "./Utils"; // 1 minute

/**
 * Ceiling on the cosmetics catalog request. Matches the bound the auth calls
 * already use (Auth.ts, Api.ts) rather than something tighter: when the
 * catalog fails to load, getPlayerCosmeticsRefs cannot expand the saved
 * `pattern:<name>` selection into pattern data, so an online player who is
 * merely slow rather than offline would join without their territory
 * pattern. A connection that has not answered in ten seconds is down; one
 * that answers in eight is not, and should keep its cosmetics.
 */
export const COSMETICS_FETCH_TIMEOUT_MS = 10_000;

let __cosmetics: Promise<Cosmetics | null> | null = null;
let __cosmeticsHash: string | null = null;
let __cosmeticsCache: Cosmetics | null = null;

/**
 * Synchronous accessor for the most recently resolved cosmetics. Returns null
 * before the first successful `fetchCosmetics()` call. Useful when a code path
 * cannot await (e.g. WebGL per-frame sync).
 */
export function getCachedCosmetics(): Cosmetics | null {
  return __cosmeticsCache;
}

export type PaymentMethod = "soft";

/** Returned by {@link purchaseCosmetic} when the player can't afford an item. */
export interface InsufficientCurrency {
  /** Display name of the currency, e.g. "Caps". */
  currency: string;
  /** How much more currency is needed (raw; localized in the dialog text). */
  shortfall: number;
  /** Display name of the item being bought. */
  item: string;
}

/** Outcome of a purchase: unaffordable details, or void on success/redirect. */
export type PurchaseResult = InsufficientCurrency | void;

/**
 * Re-read the profile and tell the app about it.
 *
 * `invalidateUserMe()` alone only drops the cache; nothing refetches and
 * nothing is notified, so a surface holding a `userMeResponse` -- an open
 * StoreModal, the header balance -- keeps rendering the old one. This is the
 * pair that actually refreshes them.
 *
 * A `false` result is deliberately NOT broadcast: getUserMe returns false on
 * any error, not only an auth failure, and broadcasting it would flip the
 * whole app to its logged-out UI immediately after a successful purchase. A
 * stale balance is much the better failure.
 */
export async function broadcastFreshUserMe(): Promise<UserMeResponse | false> {
  invalidateUserMe();
  const fresh = await getUserMe();
  if (fresh === false) return false;
  document.dispatchEvent(
    new CustomEvent("userMeResponse", {
      detail: fresh,
      bubbles: true,
      cancelable: true,
    }),
  );
  // Returned so a caller that also needs the new balance reads the same
  // profile it just broadcast, rather than re-fetching it separately.
  return fresh;
}

export async function purchaseCosmetic(
  resolved: ResolvedCosmetic,
  method: PaymentMethod,
): Promise<PurchaseResult> {
  if (!resolved.cosmetic || method !== "soft") return;
  const c = resolved.cosmetic;
  const colorPaletteName = resolved.colorPalette?.name;
  const priced = c as Pattern | Flag;
  const price = priced.priceSoft ?? 0;
  const userMe = await getUserMe();
  if (userMe === false) {
    await showInGameAlert(translateText("store.login_required"));
    return;
  }
  const balance = userMe.player.currency?.soft ?? 0;
  // Built for the pre-check below and reused when the server refuses for the
  // same reason, so both routes describe the same item the same way.
  const insufficient = (available: number): InsufficientCurrency => {
    let itemName =
      resolved.type === "flag"
        ? translateCosmetic("flags", c.name)
        : translateCosmetic("territory_patterns.pattern", c.name);
    // Every palette of a pattern shares one name, so say which colour is short.
    if (resolved.colorPalette !== null) {
      itemName = translateText("inventory.selected_cosmetic_variant", {
        name: itemName,
        variant: translateCosmetic(
          "territory_patterns.color_palette",
          resolved.colorPalette.name,
        ),
      });
    }
    return {
      currency: translateText("cosmetics.soft"),
      // Clamped: the server can refuse on a balance the client still reads as
      // sufficient, and a zero or negative shortfall reads as "you have
      // enough", which is the one thing we know is untrue.
      shortfall: Math.max(1, price - available),
      item: itemName,
    };
  };
  if (balance < price) {
    return insufficient(balance);
  }

  const result = await purchaseWithCurrency(
    resolved.type as "pattern" | "flag",
    c.name,
    "soft",
    colorPaletteName,
  );
  if (!result.ok) {
    switch (result.code) {
      case "insufficient_balance": {
        // The balance moved since the pre-check: re-read it for the shortfall.
        // Broadcast as well as re-read, so the open Store renders the new
        // balance.
        const fresh = await broadcastFreshUserMe();
        if (fresh === false) {
          await showInGameAlert(translateText("store.purchase_failed"));
          return;
        }
        const available = fresh.player.currency?.soft ?? 0;
        if (price - available <= 0) {
          await showInGameAlert(translateText("store.purchase_failed"));
          return;
        }
        return insufficient(available);
      }
      case "already_owned":
        // Either a genuine double-buy or a retry of a purchase that did go
        // through (the success response was lost): both mean the local
        // ownership state is stale, so refetch.
        await showInGameAlert(translateText("store.already_owned"));
        invalidateUserMe();
        window.location.reload();
        return;
      default:
        await showInGameAlert(translateText("store.purchase_failed"));
        return;
    }
  }
  await showInGameAlert(
    translateText("store.purchase_success", { name: c.name }),
  );
  invalidateUserMe();
  window.location.reload();
}

function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash;
  }
  return hash.toString(36);
}

/**
 * Drops the cached cosmetics.json so the next fetchCosmetics() goes to the
 * network. The remedy for a checkout rejected with a stale listing ("Pack not
 * available" / "Tier not available"): the catalog the store rendered from no
 * longer matches what the rail sells.
 */
export function invalidateCosmetics(): void {
  __cosmetics = null;
}

export function cosmeticsJsonUrl(): string {
  return "/api/cosmetics.json";
}

export async function fetchCosmetics(): Promise<Cosmetics | null> {
  if (__cosmetics !== null) {
    return __cosmetics;
  }
  const request = (async () => {
    try {
      const response = await fetch(cosmeticsJsonUrl(), {
        signal: AbortSignal.timeout(COSMETICS_FETCH_TIMEOUT_MS),
      });
      if (!response.ok) {
        console.warn(`HTTP error! status: ${response.status}`);
        return null;
      }
      const result = CosmeticsSchema.safeParse(await response.json());
      if (!result.success) {
        console.error(`Invalid cosmetics: ${result.error.message}`);
        return null;
      }
      const patternKeys = Object.keys(result.data.patterns).sort();
      const hashInput = patternKeys.join(",");
      __cosmeticsHash = simpleHash(hashInput);
      // The catalog names a flag by its path under resources/. Make it a URL.
      for (const flag of Object.values(result.data.flags ?? {})) {
        if (!/^(https?:)?\//.test(flag.url)) flag.url = assetUrl(flag.url);
      }
      __cosmeticsCache = result.data;
      return result.data;
    } catch (error) {
      console.warn("Error getting cosmetics:", error);
      return null;
    }
  })();
  __cosmetics = request;
  void request.then((result) => {
    if (result === null && __cosmetics === request) {
      __cosmetics = null;
    }
  });
  return request;
}

/**
 * Warms the two caches every cosmetics resolution reads — the profile and the
 * catalog — so a later getPlayerCosmetics()/getPlayerCosmeticsRefs() answers
 * from memory instead of the network.
 *
 * Called from paths that are about to need cosmetics but are not ready to wait
 * for them, so the network time is spent while the player is still choosing
 * rather than after they commit. Never rejects: both calls already resolve to
 * a falsy value on failure, and callers fire and forget.
 */
export function prewarmCosmetics(): Promise<void> {
  return Promise.all([getUserMe(), fetchCosmetics()]).then(
    () => undefined,
    () => undefined,
  );
}

export async function resolveFlagUrl(
  flagRef: string,
): Promise<string | undefined> {
  if (flagRef.startsWith("flag:")) {
    const key = flagRef.slice("flag:".length);
    const cosmetics = await fetchCosmetics();
    const flagData = cosmetics?.flags?.[key];
    return flagData?.url;
  }
  if (flagRef.startsWith("country:")) {
    const code = flagRef.slice("country:".length);
    return assetUrl(`flags/${code}.svg`);
  }
  return undefined;
}

export async function getCosmeticsHash(): Promise<string | null> {
  await fetchCosmetics();
  return __cosmeticsHash;
}

export function cosmeticRelationship(
  opts: {
    wildcardFlare: string;
    requiredFlare: string;
    priceSoft?: number;
    priceHard?: number;
    affiliateCode: string | null;
    itemAffiliateCode: string | null;
  },
  userMeResponse: UserMeResponse | false,
): "owned" | "purchasable" | "blocked" {
  const flares =
    userMeResponse === false ? [] : (userMeResponse.player.flares ?? []);

  if (flares.includes(opts.wildcardFlare)) {
    return "owned";
  }

  if (flares.includes(opts.requiredFlare)) {
    return "owned";
  }

  if (opts.affiliateCode !== opts.itemAffiliateCode) {
    return "blocked";
  }

  // Cosmetics are sold for currency only (USD checkout was removed).
  if (opts.priceSoft !== undefined || opts.priceHard !== undefined) {
    return "purchasable";
  }

  return "blocked";
}

export function patternRelationship(
  pattern: Pattern,
  colorPalette: { name: string; isArchived?: boolean } | null,
  userMeResponse: UserMeResponse | false,
  affiliateCode: string | null,
): "owned" | "purchasable" | "blocked" {
  if (colorPalette === null) {
    // For backwards compatibility only show non-colored patterns if they are owned.
    const flares =
      userMeResponse === false ? [] : (userMeResponse.player.flares ?? []);
    if (
      flares.includes("pattern:*") ||
      flares.includes(`pattern:${pattern.name}`)
    ) {
      return "owned";
    }
    return "blocked";
  }

  if (colorPalette.isArchived) {
    // Check ownership first — if owned, show it even if archived.
    const flares =
      userMeResponse === false ? [] : (userMeResponse.player.flares ?? []);
    if (
      flares.includes("pattern:*") ||
      flares.includes(`pattern:${pattern.name}:${colorPalette.name}`)
    ) {
      return "owned";
    }
    return "blocked";
  }

  return cosmeticRelationship(
    {
      wildcardFlare: "pattern:*",
      requiredFlare: `pattern:${pattern.name}:${colorPalette.name}`,
      priceSoft: pattern.priceSoft,
      priceHard: pattern.priceHard,
      affiliateCode,
      itemAffiliateCode: pattern.affiliateCode ?? null,
    },
    userMeResponse,
  );
}

export function flagRelationship(
  flag: Flag,
  userMeResponse: UserMeResponse | false,
  affiliateCode: string | null,
): "owned" | "purchasable" | "blocked" {
  return cosmeticRelationship(
    {
      wildcardFlare: "flag:*",
      requiredFlare: `flag:${flag.name}`,
      priceSoft: flag.priceSoft,
      priceHard: flag.priceHard,
      affiliateCode,
      itemAffiliateCode: flag.affiliateCode ?? null,
    },
    userMeResponse,
  );
}

export function crownRelationship(
  crown: Crown,
  userMeResponse: UserMeResponse | false,
  affiliateCode: string | null,
): "owned" | "purchasable" | "blocked" {
  return cosmeticRelationship(
    {
      wildcardFlare: "crown:*",
      requiredFlare: `crown:${crown.name}`,
      priceSoft: crown.priceSoft,
      priceHard: crown.priceHard,
      affiliateCode,
      itemAffiliateCode: crown.affiliateCode ?? null,
    },
    userMeResponse,
  );
}

export function skinRelationship(
  skin: Skin,
  userMeResponse: UserMeResponse | false,
  affiliateCode: string | null,
): "owned" | "purchasable" | "blocked" {
  return cosmeticRelationship(
    {
      wildcardFlare: "skin:*",
      requiredFlare: `skin:${skin.name}`,
      priceSoft: skin.priceSoft,
      priceHard: skin.priceHard,
      affiliateCode,
      itemAffiliateCode: skin.affiliateCode ?? null,
    },
    userMeResponse,
  );
}

export function effectRelationship(
  effect: Effect,
  userMeResponse: UserMeResponse | false,
  affiliateCode: string | null,
): "owned" | "purchasable" | "blocked" {
  return cosmeticRelationship(
    {
      wildcardFlare: "effect:*",
      requiredFlare: `effect:${effect.name}`,
      priceSoft: effect.priceSoft,
      priceHard: effect.priceHard,
      affiliateCode,
      itemAffiliateCode: effect.affiliateCode ?? null,
    },
    userMeResponse,
  );
}

/** The flare a pack item's purchase grants, e.g. "pattern:camo:red". */
export function packItemFlare(item: CosmeticPackItem): string {
  const base = `${item.type}:${item.name}`;
  return item.colorPalette ? `${base}:${item.colorPalette}` : base;
}

/**
 * The resolved entry a pack item refers to, or undefined if its cosmetic is
 * no longer in the catalog. A pattern item is the entry for its palette —
 * the "pattern:<key>:<palette>" one, or the uncoloured "pattern:<key>" one
 * when the item names no palette — since that is the flare the pack grants.
 */
export function findPackItem(
  item: CosmeticPackItem,
  candidates: readonly ResolvedCosmetic[],
): ResolvedCosmetic | undefined {
  return candidates.find(
    (r) =>
      r.type === item.type &&
      r.cosmetic?.name === item.name &&
      (item.type !== "pattern" ||
        r.key.split(":")[2] === (item.colorPalette ?? undefined)),
  );
}

/**
 * The pack's items the player already owns — by the item's own flare or the
 * type wildcard. Any owned item blocks buying the pack (the server answers
 * 409; there is no partial grant), so callers use this to explain why.
 */
export function ownedPackItems(
  pack: CosmeticPack,
  userMeResponse: UserMeResponse | false,
): CosmeticPackItem[] {
  const flares =
    userMeResponse === false ? [] : (userMeResponse.player.flares ?? []);
  return pack.items.filter(
    (item) =>
      flares.includes(packItemFlare(item)) || flares.includes(`${item.type}:*`),
  );
}

export function cosmeticPackRelationship(
  pack: CosmeticPack,
  userMeResponse: UserMeResponse | false,
  affiliateCode: string | null,
): "owned" | "purchasable" | "blocked" {
  if (pack.items.length === 0) return "blocked";
  const owned = ownedPackItems(pack, userMeResponse).length;
  if (owned === pack.items.length) return "owned";
  // Pack revenue isn't attributed to affiliates: hidden in affiliate mode.
  if (affiliateCode !== null) return "blocked";
  // Partially owned packs can't be bought (see ownedPackItems).
  if (owned > 0) return "blocked";
  return pack.priceHard > 0 ? "purchasable" : "blocked";
}

export type ResolvedCosmetic = {
  type:
    | "pattern"
    | "skin"
    | "flag"
    | "crown"
    | "effect"
    | "pack"
    | "cosmeticPack"
    | "subscription";
  cosmetic:
    | Pattern
    | Skin
    | Flag
    | Crown
    | Effect
    | Pack
    | CosmeticPack
    | Subscription
    | null;
  colorPalette: ColorPalette | null;
  relationship: "owned" | "purchasable" | "blocked";
  /** Unique key for selection/identity, e.g. "pattern:hearts:red" or "skin:mountain" */
  key: string;
  /** For effects only: the effectType (also the catalog's outer key). */
  effectType?: string;
  /**
   * For cosmetic packs only: the pack's items resolved against this catalog,
   * in pack order. An item whose cosmetic is no longer in the catalog is
   * skipped (the server still sells whatever remains in the pack).
   */
  packItems?: ResolvedCosmetic[];
};

/**
 * Resolves all cosmetics into a flat display-ready list with relationship
 * status and resolved color palettes. Callers can filter by relationship.
 */
export function resolveCosmetics(
  cosmetics: Cosmetics | null,
  userMeResponse: UserMeResponse | false,
  affiliateCode: string | null,
): ResolvedCosmetic[] {
  if (!cosmetics) return [];
  const result: ResolvedCosmetic[] = [];

  // Default pattern (always owned)
  result.push({
    type: "pattern",
    cosmetic: null,
    colorPalette: null,
    relationship: "owned",
    key: "pattern:default",
  });

  // Patterns × color palettes
  for (const [patternKey, pattern] of Object.entries(cosmetics.patterns)) {
    const colorPalettes = [...(pattern.colorPalettes ?? []), null];
    for (const cp of colorPalettes) {
      const rel = patternRelationship(
        pattern,
        cp,
        userMeResponse,
        affiliateCode,
      );
      const resolvedPalette = cp
        ? (cosmetics.colorPalettes?.[cp.name] ?? null)
        : null;
      const key = cp
        ? `pattern:${patternKey}:${cp.name}`
        : `pattern:${patternKey}`;
      result.push({
        type: "pattern",
        cosmetic: pattern,
        colorPalette: resolvedPalette,
        relationship: rel,
        key,
      });
    }
  }

  // Flags
  for (const [flagKey, flag] of Object.entries(cosmetics.flags)) {
    const rel = flagRelationship(flag, userMeResponse, affiliateCode);
    result.push({
      type: "flag",
      cosmetic: flag,
      colorPalette: null,
      relationship: rel,
      key: `flag:${flagKey}`,
    });
  }

  // Crowns
  for (const [crownKey, crown] of Object.entries(cosmetics.crowns ?? {})) {
    const rel = crownRelationship(crown, userMeResponse, affiliateCode);
    result.push({
      type: "crown",
      cosmetic: crown,
      colorPalette: null,
      relationship: rel,
      key: `crown:${crownKey}`,
    });
  }

  // Skins (image-based territory cosmetics). No separate "default" entry —
  // the pattern default doubles as "no skin": selecting it clears both.
  for (const [skinKey, skin] of Object.entries(cosmetics.skins ?? {})) {
    const rel = skinRelationship(skin, userMeResponse, affiliateCode);
    result.push({
      type: "skin",
      cosmetic: skin,
      colorPalette: null,
      relationship: rel,
      key: `skin:${skinKey}`,
    });
  }

  // Effects (boat-trail wakes, etc.) — a cosmetic category like skins/flags.
  // Catalog is nested: effects[effectType][effectName]. We carry effectType (the
  // outer key, which each effect also stores) on the resolved item.
  for (const [effectType, byName] of Object.entries(cosmetics.effects ?? {})) {
    for (const [effectKey, effect] of Object.entries(byName ?? {})) {
      const rel = effectRelationship(effect, userMeResponse, affiliateCode);
      result.push({
        type: "effect",
        cosmetic: effect,
        colorPalette: null,
        relationship: rel,
        key: `effect:${effectType}:${effectKey}`,
        effectType,
      });
    }
  }

  // Packs
  for (const [packKey, pack] of Object.entries(cosmetics.currencyPacks ?? {})) {
    // NEVER gate this on `pack.product`. That block is the Stripe
    // {productId, priceId} pair and it is null for every Steam-only listing,
    // so gating rendered those packs as blocked and their buy button never
    // appeared. A listed currency pack is buyable; if a rail cannot sell it,
    // the checkout call is what says so.
    const rel = "purchasable";
    result.push({
      type: "pack",
      cosmetic: pack,
      colorPalette: null,
      relationship: rel,
      key: `pack:${packKey}`,
    });
  }

  // Cosmetic packs. Items reference cosmetics resolved above (findPackItem).
  for (const [packKey, pack] of Object.entries(cosmetics.packs ?? {})) {
    const packItems = pack.items.flatMap((item) => {
      const found = findPackItem(item, result);
      return found ? [found] : [];
    });
    result.push({
      type: "cosmeticPack",
      cosmetic: pack,
      colorPalette: null,
      relationship: cosmeticPackRelationship(
        pack,
        userMeResponse,
        affiliateCode,
      ),
      key: `cosmeticPack:${packKey}`,
      packItems,
    });
  }

  // Subscriptions
  const flares =
    userMeResponse === false ? [] : (userMeResponse.player.flares ?? []);
  const currentSub =
    userMeResponse === false
      ? null
      : (userMeResponse.player.subscription ?? null);
  const currentSubTier = currentSub?.tier ?? null;
  // OPE-440. A grant is free access nobody is billing, not something the
  // player bought, and the tier it confers is the one they are likeliest to
  // buy. Calling it "owned" is what rendered a dead "Subscribed" box where
  // the buy button goes, so a granted player had no way to pay us for the
  // tier they were already enjoying. `owned` is read by the store and nowhere
  // else, so this changes the buy affordance and nothing about what the grant
  // currently entitles them to.
  //
  // A flare is untouched by this: it is a permanent unlock, not a month, and
  // there is genuinely nothing to sell someone who holds one.
  const grantIsCurrent = isGrantedSubscription(currentSub);
  for (const [subKey, sub] of Object.entries(cosmetics.subscriptions ?? {})) {
    const key = `subscription:${subKey}`;
    // `subscriptions` is this rail's storefront, so every tier in it is for
    // sale. NEVER gate on `sub.product`: that is the Stripe listing, null for
    // a tier only Steam sells, and gating on it hid such tiers from the store
    // (see currency packs above). If a rail cannot sell it, checkout says so.
    const isCurrentTier = subKey === currentSubTier;
    const demoteGrant = grantIsCurrent && isCurrentTier;
    const isCurrent = flares.includes(key) || (isCurrentTier && !demoteGrant);
    const rel: ResolvedCosmetic["relationship"] = isCurrent
      ? "owned"
      : "purchasable";
    result.push({
      type: "subscription",
      cosmetic: sub,
      colorPalette: null,
      relationship: rel,
      key,
    });
  }
  const heldUnlisted =
    currentSubTier !== null && !cosmetics.subscriptions?.[currentSubTier]
      ? cosmetics.unlistedSubscriptions?.[currentSubTier]
      : undefined;
  if (heldUnlisted) {
    result.push({
      type: "subscription",
      cosmetic: heldUnlisted,
      colorPalette: null,
      relationship: "owned",
      key: `subscription:${currentSubTier}`,
    });
  }

  return result;
}

/**
 * Groups resolved cosmetics so that colour-palette variants of the same pattern
 * collapse into a single entry. Returns an array of groups in first-seen order
 */
export function groupCosmeticVariants(
  items: ResolvedCosmetic[],
): ResolvedCosmetic[][] {
  const groups: ResolvedCosmetic[][] = [];
  const patternGroupByName = new Map<string, number>();
  for (const item of items) {
    if (item.type === "pattern" && item.cosmetic !== null) {
      const name = item.cosmetic.name;
      const existing = patternGroupByName.get(name);
      if (existing !== undefined) {
        groups[existing].push(item);
        continue;
      }
      patternGroupByName.set(name, groups.length);
    }
    groups.push([item]);
  }
  return groups;
}

export function resolvedToPlayerPattern(
  resolved: ResolvedCosmetic,
): PlayerPattern | null {
  if (resolved.type !== "pattern") return null;
  const c = resolved.cosmetic;
  if (c === null) return null;
  return {
    name: c.name,
    patternData: (c as Pattern).pattern,
    colorPalette: resolved.colorPalette ?? undefined,
  };
}

// `verified` is passed in rather than looked up: the caller has already
// resolved what name the player is joining under (see resolvePlayerName), and
// the badge has to agree with that exact decision. Reading it back out of the
// DOM here was the same missing seam.
export async function getPlayerCosmeticsRefs(
  opts: { verified?: boolean } = {},
): Promise<PlayerCosmeticRefs> {
  const userSettings = new UserSettings();
  // Resolve the profile first: getUserMe activates the per-player cosmetics
  // scope (UserSettings.setPlayerId), which must happen before selections are
  // read below.
  await getUserMe();
  const cosmetics = await fetchCosmetics();
  let pattern: PlayerPattern | null =
    userSettings.getSelectedPatternName(cosmetics);
  let patternDenied = false;

  if (pattern) {
    const userMe = await getUserMe();
    if (userMe) {
      const flareName =
        pattern.colorPalette?.name === undefined
          ? `pattern:${pattern.name}`
          : `pattern:${pattern.name}:${pattern.colorPalette.name}`;
      const flares = userMe.player.flares ?? [];
      const hasWildcard = flares.includes("pattern:*");
      if (!hasWildcard && !flares.includes(flareName)) {
        pattern = null;
        patternDenied = true;
      }
    } else {
      // Unknown profile: keep the selection in settings, but do not send it.
      pattern = null;
    }
    if (patternDenied) {
      userSettings.setSelectedPatternName(undefined);
    }
  }

  let flag = userSettings.getFlag();
  // Dropping a flag from this join and erasing the player's saved selection
  // are two different decisions, and only one of them is reversible. Erase
  // only on a definite answer — the catalog no longer lists the flag, or the
  // profile says the player is not entitled. "We could not ask" is not an
  // answer: getUserMe() returns the same `false` for "signed out" and for a
  // refused connection, a timed-out request or an expired session, so
  // treating it as "not entitled" erased saved flags over network failures.
  let flagDenied = false;
  if (flag?.startsWith("flag:")) {
    const key = flag.slice("flag:".length);
    const flagData = cosmetics?.flags?.[key];
    if (!flagData) {
      // Only clear if cosmetics loaded successfully but the key is missing
      if (cosmetics) {
        flag = null;
        flagDenied = true;
      }
    } else {
      const userMe = await getUserMe();
      if (userMe) {
        const flares = userMe.player.flares ?? [];
        const hasWildcard = flares.includes("flag:*");
        if (!hasWildcard && !flares.includes(`flag:${flagData.name}`)) {
          flag = null;
          flagDenied = true;
        }
      } else {
        // Unknown profile: keep the selection, but do not send it. An
        // entitlement we cannot verify is not one to claim — the server does
        // not strip an unowned cosmetic ref, it refuses the connection
        // (Privilege returns "forbidden", Worker.ts closes the socket with
        // CosmeticsForbidden), so sending it would trade a lost flag for an
        // unjoinable multiplayer.
        flag = null;
      }
    }
  }
  if (flagDenied) {
    userSettings.clearFlag();
  }

  let skinName = userSettings.getSelectedSkinName() ?? undefined;
  let skinDenied = false;
  if (skinName) {
    const skin = cosmetics?.skins?.[skinName];
    if (!skin) {
      skinName = undefined;
      if (cosmetics) {
        // Cosmetics loaded but the saved skin no longer exists.
        skinDenied = true;
      }
    } else {
      const userMe = await getUserMe();
      if (userMe) {
        const flares = userMe.player.flares ?? [];
        const hasWildcard = flares.includes("skin:*");
        if (!hasWildcard && !flares.includes(`skin:${skin.name}`)) {
          skinName = undefined;
          skinDenied = true;
        }
      } else {
        // Unknown profile: keep the selection, but do not send it.
        skinName = undefined;
      }
    }
    if (skinDenied) {
      userSettings.setSelectedPatternName(undefined);
    }
  }

  let crownName = userSettings.getSelectedCrownName() ?? undefined;
  let crownDenied = false;
  if (crownName) {
    const crown = cosmetics?.crowns?.[crownName];
    if (!crown) {
      crownName = undefined;
      if (cosmetics) {
        // Cosmetics loaded but the saved crown no longer exists.
        crownDenied = true;
      }
    } else {
      const userMe = await getUserMe();
      if (userMe) {
        const flares = userMe.player.flares ?? [];
        const hasWildcard = flares.includes("crown:*");
        if (!hasWildcard && !flares.includes(`crown:${crown.name}`)) {
          crownName = undefined;
          crownDenied = true;
        }
      } else {
        // Unknown profile: keep the selection, but do not send it.
        crownName = undefined;
      }
    }
    if (crownDenied) {
      userSettings.setSelectedCrownName(undefined);
    }
  }

  // Effects: a per-slot map (slot -> effect name). A slot is the effectType for
  // trails and the nukeType for nuke explosions (see effectTypeForSlot). Drop any
  // entry whose effect no longer exists, doesn't fit the slot, or the user can't
  // access. Like skins/flags/patterns above, a selection is kept in settings (and
  // omitted from join refs) when cosmetics or userMe fail to load.
  const selectedEffects = userSettings.getSelectedEffects();
  const effects: Record<string, string> = {};
  for (const [slot, name] of Object.entries(selectedEffects)) {
    const effect = findEffectForSlot(cosmetics, slot, name);
    if (!effect) {
      if (cosmetics) {
        userSettings.setSelectedEffectName(slot, undefined);
      }
      continue;
    }
    const userMe = await getUserMe();
    if (userMe) {
      const flares = userMe.player.flares ?? [];
      const hasWildcard = flares.includes("effect:*");
      if (!hasWildcard && !flares.includes(`effect:${effect.name}`)) {
        userSettings.setSelectedEffectName(slot, undefined);
        continue;
      }
    } else {
      // Unknown profile: keep the selection in settings, but do not send it.
      continue;
    }
    effects[slot] = name;
  }

  return {
    flag: flag ?? undefined,
    patternName: pattern?.name ?? undefined,
    patternColorPaletteName: pattern?.colorPalette?.name ?? undefined,
    skinName,
    crownName,
    effects: Object.keys(effects).length > 0 ? effects : undefined,
    verified: opts.verified ? true : undefined,
  };
}

export async function getPlayerCosmetics(
  opts: { verified?: boolean } = {},
): Promise<PlayerCosmetics> {
  const refs = await getPlayerCosmeticsRefs(opts);
  const cosmetics = await fetchCosmetics();

  const result: PlayerCosmetics = {};

  if (refs.flag) {
    result.flag = await resolveFlagUrl(refs.flag);
  }

  const devPattern = new UserSettings().getDevOnlyPattern();

  if (devPattern) {
    result.pattern = {
      name: devPattern.name,
      patternData: devPattern.patternData,
      colorPalette: devPattern.colorPalette,
    };
  } else if (refs.patternName && cosmetics) {
    const pattern = cosmetics.patterns[refs.patternName];

    if (pattern) {
      result.pattern = {
        name: refs.patternName,
        patternData: pattern.pattern,
        colorPalette: refs.patternColorPaletteName
          ? cosmetics.colorPalettes?.[refs.patternColorPaletteName]
          : undefined,
      };
    }
  }

  if (refs.skinName && cosmetics) {
    const skin = cosmetics.skins?.[refs.skinName];
    if (skin) {
      result.skin = { name: refs.skinName, url: skin.url };
    }
  }

  const devCrown = new UserSettings().getDevOnlyCrown();

  if (devCrown) {
    result.crown = { name: "dev_crown", url: devCrown };
  } else if (refs.crownName && cosmetics) {
    const crown = cosmetics.crowns?.[refs.crownName];
    if (crown) {
      result.crown = { name: refs.crownName, url: crown.url };
    }
  }

  if (refs.effects && cosmetics) {
    const effects: Record<string, PlayerEffect> = {};
    for (const [slot, name] of Object.entries(refs.effects)) {
      const effect = findEffectForSlot(cosmetics, slot, name);
      if (effect) {
        effects[slot] = { name: effect.name, effectType: effect.effectType };
      }
    }
    if (Object.keys(effects).length > 0) result.effects = effects;
  }

  if (refs.verified) {
    result.verified = true;
  }

  return result;
}

export function translateCosmetic(prefix: string, name: string): string {
  const translation = translateText(`${prefix}.${name}`);
  if (translation.startsWith(prefix)) {
    return name
      .split("_")
      .filter((word) => word.length > 0)
      .map((word) => word[0].toUpperCase() + word.substring(1))
      .join(" ");
  }
  return translation;
}

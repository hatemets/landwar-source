import { showInGameAlert } from "./InGameModal";
import { translateText } from "./Utils";

/**
 * Message for each `link=<result>` the auth callbacks redirect back with.
 *
 * `cancel` is deliberately absent: the user chose to back out at the provider
 * and needs no feedback. Anything unrecognised is likewise silent.
 */
const LINK_RESULT_KEYS: Record<string, string> = {
  google: "account_modal.link_google_success",
  discord: "account_modal.link_discord_success",
  already_linked: "account_modal.link_google_already_linked",
  error: "account_modal.link_google_error",
};

/**
 * Handle the `link=<result>` router arg an account-link callback returns with.
 *
 * `linkGoogle()` sends the current URL as the redirect target, so the result
 * lands on whichever modal started the flow: the account modal or the
 * standalone account-settings modal. Both call this on open: surface the
 * outcome, then strip the one-shot param so a refresh or re-open can't replay
 * it.
 */
export function consumeLinkResult(args?: Record<string, unknown>): void {
  const link = typeof args?.link === "string" ? args.link : undefined;
  if (link === undefined) return;

  // replaceState doesn't fire hashchange, so removing the param won't re-route.
  const params = new URLSearchParams(window.location.hash.slice(1));
  params.delete("link");
  const rest = params.toString();
  history.replaceState(
    null,
    "",
    rest ? `#${rest}` : window.location.pathname + window.location.search,
  );

  // An own-property check, not an `=== undefined` check on the lookup. `link`
  // comes straight off the URL hash, so it is fully attacker-chosen, and a
  // plain object literal inherits from Object.prototype: `link=toString`
  // resolves to the inherited function rather than undefined.
  //
  // hasOwnProperty.call rather than Object.hasOwn: the latter needs an es2022
  // lib target and this project builds below that.
  if (!Object.prototype.hasOwnProperty.call(LINK_RESULT_KEYS, link)) return;

  void showInGameAlert(translateText(LINK_RESULT_KEYS[link]!));
}

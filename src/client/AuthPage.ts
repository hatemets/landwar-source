import { assetUrl } from "@openfront/shared/AssetUrls";
import { html, LitElement, TemplateResult } from "lit";
import { customElement, state } from "lit/decorators.js";
import { hasLinkedIdentity } from "./AccountIdentity";
import { getUserMe } from "./Api";
import { googleLogin } from "./Auth";
import { statusNotice } from "./components/ui/StatusNotice";
import { consumeLoginResult, LoginResult } from "./LoginResult";
import { modalRouter } from "./ModalRouter";
import { currentPagePath, translateText } from "./Utils";

// Each login refusal says its own thing. A player refused because their
// account is pending deletion must not be told their email is already in use.
const LOGIN_ERROR_KEYS: Record<LoginResult, string> = {
  email_exists: "account_modal.login_email_exists",
  deleted: "account_modal.login_deleted",
  error: "account_modal.login_error",
  no_account: "account_modal.login_no_account",
};

type AuthIntent = "signin" | "signup";

const PAGE_IDS: Record<AuthIntent, string> = {
  signin: "page-signin",
  signup: "page-signup",
};

/**
 * A sign-in or sign-up page of its own: a route (`/signin`, `/signup`) with no
 * site header and no back button, only the logo, a title and the sign-in
 * methods. It implements the page contract the router and `showPage` drive
 * (`open`, `close`, `isOpen`) without the modal shell.
 */
abstract class AuthPage extends LitElement {
  protected abstract readonly intent: AuthIntent;

  @state() private pageOpen = false;
  // One-shot outcome of a rejected sign-in, read from the `login=` router arg
  // on open. Reassigned on every open, so reopening clears it.
  @state() private loginError: LoginResult | undefined;

  // showPage() re-invokes open() with no args after we call it; that nested
  // call must not run the open logic twice.
  private opening = false;

  createRenderRoot() {
    return this;
  }

  public isOpen(): boolean {
    return this.pageOpen;
  }

  public open(args?: Record<string, unknown>): void {
    if (this.opening) return;
    this.opening = true;
    try {
      this.loginError = consumeLoginResult(args);
      if (this.pageOpen) return;
      this.pageOpen = true;
      if (this.classList.contains("hidden")) {
        window.showPage?.(PAGE_IDS[this.intent]);
      }
      this.style.pointerEvents = "auto";
      modalRouter.syncOpened(this.intent, args);
      void this.leaveIfSignedIn();
    } finally {
      this.opening = false;
    }
  }

  public close(): void {
    this.pageOpen = false;
    this.style.pointerEvents = "none";
    window.showPage?.("page-play");
    modalRouter.syncClosed(this.intent);
  }

  // A signed-in player has nothing to do here: send them home.
  private async leaveIfSignedIn(): Promise<void> {
    try {
      const me = await getUserMe();
      if (me && hasLinkedIdentity(me.user) && this.pageOpen) this.close();
    } catch (err) {
      console.warn("Failed to fetch user info in AuthPage:", err);
    }
  }

  private renderLoginError(): TemplateResult {
    if (this.loginError === undefined) return html``;
    return statusNotice(
      "danger",
      translateText(LOGIN_ERROR_KEYS[this.loginError]),
      {
        dismissLabel: translateText("common.close"),
        onDismiss: () => (this.loginError = undefined),
      },
    );
  }

  private renderSwitch(): TemplateResult {
    const other: AuthIntent = this.intent === "signup" ? "signin" : "signup";
    return html`<p class="auth-page__switch">
      ${translateText(
        this.intent === "signup"
          ? "auth_page.have_account"
          : "auth_page.no_account",
      )}
      <a
        href=${`/${other}`}
        @click=${(e: Event) => {
          e.preventDefault();
          window.showPage?.(PAGE_IDS[other]);
        }}
        >${translateText(
          other === "signup" ? "main.sign_up" : "main.sign_in",
        )}</a
      >
    </p>`;
  }

  render(): TemplateResult {
    // Google is the only sign-in provider configured by LandWar's backend.
    return html`
      <div class="auth-page">
        <div class="auth-page__inner">
          <div class="menu-brand auth-page__brand">
            <img src=${assetUrl("images/CleoLogo.svg")} alt="" />
            <span class="menu-brand__name">cleo</span>
          </div>

          <div class="auth-page__heading">
            <h1 class="auth-page__title">
              ${translateText(
                this.intent === "signup" ? "main.sign_up" : "main.sign_in",
              )}
            </h1>
            <p class="auth-page__desc">
              ${translateText(
                this.intent === "signup"
                  ? "account_modal.sign_up_desc"
                  : "account_modal.sign_in_desc",
              )}
            </p>
          </div>

          ${this.renderLoginError()}

          <div class="auth-page__options">
            <!-- Google brand guidelines: the multicolor "G" mark -->
            <button
              @click=${() => googleLogin(currentPagePath("/"))}
              class="auth-provider-button auth-provider-google"
            >
              <img
                src=${assetUrl("images/GoogleLogo.svg")}
                alt=${translateText("account_modal.google_alt")}
                class="w-6 h-6"
              />
              <span>${translateText("main.login_google")}</span>
            </button>
          </div>

          ${this.renderSwitch()}
        </div>
      </div>
    `;
  }
}

@customElement("signin-page")
export class SignInPage extends AuthPage {
  protected readonly intent = "signin";
}

@customElement("signup-page")
export class SignUpPage extends AuthPage {
  protected readonly intent = "signup";
}

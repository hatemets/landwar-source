import { UserMeResponse } from "@openfront/shared/ApiSchemas";
import type {
  Cosmetics,
  Flag,
  Pattern,
} from "@openfront/shared/CosmeticSchemas";
import { html, nothing, type TemplateResult } from "lit";
import { customElement, state } from "lit/decorators.js";
import { getUserMe } from "./Api";
import { BaseModal } from "./components/BaseModal";
import "./components/CosmeticCard";
import "./components/InsufficientCurrencyDialog";
import { modalHeader } from "./components/ui/ModalHeader";
import { signedOutNotice } from "./components/ui/SignedOutNotice";
import {
  fetchCosmetics,
  groupCosmeticVariants,
  type InsufficientCurrency,
  purchaseCosmetic,
  resolveCosmetics,
  type ResolvedCosmetic,
} from "./Cosmetics";
import { translateText } from "./Utils";

// The item store. Everything costs Caps, which players earn by finishing games
// with other players. What a player buys shows in their inventory.

type StoreTab = "patterns" | "flags";

const priceOf = (resolved: ResolvedCosmetic): number =>
  ((resolved.cosmetic as Pattern | Flag | null)?.priceSoft ?? 0) as number;

@customElement("store-modal")
export class StoreModal extends BaseModal {
  protected routerName = "store";

  @state() private loading = true;
  @state() private loadFailed = false;
  @state() private search = "";
  @state() private buying: string | null = null;
  @state() private shortfall: InsufficientCurrency | null = null;
  // The colour picked for each pattern, by pattern name.
  @state() private colours = new Map<string, string>();

  private cosmetics: Cosmetics | null = null;
  private me: UserMeResponse | false = false;
  private loadId = 0;

  constructor() {
    super();
    this.activeTab = "patterns";
  }

  protected modalConfig() {
    return {
      tabs: [
        { key: "patterns", label: translateText("store.patterns") },
        { key: "flags", label: translateText("store.flags") },
      ],
    };
  }

  private onUserMe = (event: Event) => {
    this.me = (event as CustomEvent<UserMeResponse | false>).detail;
    this.requestUpdate();
  };

  connectedCallback() {
    super.connectedCallback();
    document.addEventListener("userMeResponse", this.onUserMe);
  }

  disconnectedCallback() {
    document.removeEventListener("userMeResponse", this.onUserMe);
    super.disconnectedCallback();
  }

  protected onOpen(): void {
    void this.load();
  }

  // Main calls this when the account changes while the store is up.
  public refresh(): void {
    if (this.isModalOpen) void this.load();
  }

  private async load(): Promise<void> {
    const id = ++this.loadId;
    this.loading = true;
    this.loadFailed = false;
    const [cosmetics, me] = await Promise.all([fetchCosmetics(), getUserMe()]);
    if (id !== this.loadId) return;
    this.cosmetics = cosmetics;
    this.me = me;
    this.loadFailed = cosmetics === null;
    this.loading = false;
  }

  private balance(): number {
    return this.me === false ? 0 : (this.me.player.currency?.soft ?? 0);
  }

  private matchesSearch(resolved: ResolvedCosmetic): boolean {
    const name = (resolved.cosmetic?.name ?? "").replace(/_/g, " ");
    return name.toLowerCase().includes(this.search.trim().toLowerCase());
  }

  // Everything on sale in this tab, cheapest first. Owned items stay, marked.
  private groups(tab: StoreTab): ResolvedCosmetic[][] {
    const type = tab === "patterns" ? "pattern" : "flag";
    const items = resolveCosmetics(this.cosmetics, this.me, null).filter(
      (r) =>
        r.type === type &&
        r.cosmetic !== null &&
        r.relationship !== "blocked" &&
        this.matchesSearch(r),
    );
    return groupCosmeticVariants(items).sort(
      (a, b) =>
        priceOf(a[0]!) - priceOf(b[0]!) ||
        (a[0]!.cosmetic!.name < b[0]!.cosmetic!.name ? -1 : 1),
    );
  }

  private chosen(group: ResolvedCosmetic[]): ResolvedCosmetic {
    const name = group[0]!.cosmetic!.name;
    const picked = this.colours.get(name);
    return group.find((r) => r.key === picked) ?? group[0]!;
  }

  private async buy(resolved: ResolvedCosmetic): Promise<void> {
    if (this.buying !== null) return;
    this.buying = resolved.key;
    try {
      const result = await purchaseCosmetic(resolved, "soft");
      // A shortfall comes back as a value. It becomes the dialog.
      if (result) this.shortfall = result;
    } finally {
      this.buying = null;
    }
  }

  private renderCard(group: ResolvedCosmetic[]): TemplateResult {
    const resolved = this.chosen(group);
    const owned = resolved.relationship === "owned";
    const price = priceOf(resolved);
    const busy = this.buying === resolved.key;
    return html`<cosmetic-card
      data-store-item=${resolved.key}
      .resolved=${group[0]!}
      .variants=${group}
      .activeVariantKey=${resolved.key}
      .onVariantActivate=${(variant: ResolvedCosmetic) => {
        this.colours = new Map(this.colours).set(
          variant.cosmetic!.name,
          variant.key,
        );
      }}
      .actionContent=${html`<button
        type="button"
        data-store-buy
        data-price=${price}
        ?disabled=${owned || busy}
        class="mt-2 w-full rounded-lg px-3 py-2 text-xs font-black uppercase tracking-wider text-white transition-colors ${owned
          ? "cursor-default bg-white/10 text-white/50"
          : "bg-malibu-blue hover:bg-aquarius disabled:opacity-50"}"
        @click=${(event: Event) => {
          event.stopPropagation();
          void this.buy(resolved);
        }}
      >
        ${owned
          ? translateText("store.owned")
          : translateText("store.buy", { price: price.toLocaleString() })}
      </button>`}
    ></cosmetic-card>`;
  }

  protected renderHeaderSlot() {
    const signedIn = this.me !== false;
    return html`
      <div
        class="relative flex flex-col border-b border-white/10 pb-4 shrink-0"
      >
        ${modalHeader({
          title: translateText("store.title"),
          onBack: () => this.close(),
          ariaLabel: translateText("common.back"),
          rightContent: signedIn
            ? html`<span
                data-store-balance=${this.balance()}
                class="rounded-full bg-white/10 px-4 py-2 text-sm font-bold text-white"
                >${translateText("store.balance", {
                  amount: this.balance().toLocaleString(),
                })}</span
              >`
            : undefined,
        })}
        <div class="mt-4 flex justify-center">
          <input
            class="h-12 w-full max-w-md rounded-xl border border-white/10 bg-black/60 text-center text-xl text-white placeholder-white/30 shadow-inner focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
            type="text"
            placeholder=${translateText("cosmetics.search")}
            .value=${this.search}
            @input=${(e: Event) =>
              (this.search = (e.target as HTMLInputElement).value)}
          />
        </div>
      </div>
      ${this.shortfall
        ? html`<insufficient-currency-dialog
            .info=${this.shortfall}
            @close=${() => (this.shortfall = null)}
          ></insufficient-currency-dialog>`
        : nothing}
    `;
  }

  protected renderBody(tab: string) {
    if (!this.isModalOpen) return html``;
    if (this.loading) return this.renderLoadingSpinner();
    if (this.loadFailed) {
      return html`<div
        data-store-state="error"
        class="flex flex-col items-center gap-4 p-8 text-center text-red-300"
      >
        <p>${translateText("store.load_failed")}</p>
        <button
          type="button"
          class="rounded-lg bg-blue-600 px-4 py-2 font-bold text-white"
          @click=${() => void this.load()}
        >
          ${translateText("inventory.retry")}
        </button>
      </div>`;
    }
    const groups = this.groups(tab === "flags" ? "flags" : "patterns");
    return html`
      ${this.me === false
        ? signedOutNotice(
            () => window.showPage?.("page-account"),
            translateText("store.login_required"),
          )
        : nothing}
      ${groups.length === 0
        ? html`<p class="p-8 text-center text-white/60">
            ${translateText("store.empty")}
          </p>`
        : html`<div
            data-store-grid=${tab}
            class="grid grid-cols-2 gap-3 p-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5"
          >
            ${groups.map((group) => this.renderCard(group))}
          </div>`}
    `;
  }
}

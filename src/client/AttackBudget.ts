/**
 * Tracks the troops already committed to attack intents within one game tick.
 *
 * The view's troop count only changes when a tick arrives. Two clicks inside
 * the same tick (a double-click, or a mouse that bounces) both read the same
 * count. Each then asked for `ratio * troops`, and the engine let the two
 * attacks add up: at 50% they sent 100% of the troops (openfrontio issue
 * 4237). Each click now takes `ratio` of what the earlier clicks left, so two
 * clicks at ratio r send 1 - (1 - r)^2.
 */
export class AttackBudget {
  private tick = -1;
  private committed = 0;

  /**
   * Returns the troops for one attack and commits them. `troops` is the
   * player's troops as seen at `tick`. `cap` limits the attack, for example
   * to the size of the attack being countered.
   */
  take(
    tick: number,
    troops: number,
    ratio: number,
    cap: number = Infinity,
  ): number {
    if (tick !== this.tick) {
      this.tick = tick;
      this.committed = 0;
    }
    const remaining = Math.max(0, troops - this.committed);
    const wanted = ratio * remaining;
    // A cap that is not a finite number (a corrupt attack size) is ignored.
    const amount = Number.isFinite(cap) ? Math.min(wanted, cap) : wanted;
    if (Number.isFinite(amount) && amount > 0) {
      this.committed += amount;
    }
    return amount;
  }
}

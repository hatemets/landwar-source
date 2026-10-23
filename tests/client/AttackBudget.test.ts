import { describe, expect, it } from "vitest";
import { AttackBudget } from "../../src/client/AttackBudget";

describe("AttackBudget", () => {
  it("sends ratio of the troops for a single attack", () => {
    expect(new AttackBudget().take(10, 1000, 0.5)).toBe(500);
  });

  // Issue 4237: two clicks in one tick used to send ratio * troops twice,
  // which at 50% is all of the troops.
  it("takes ratio of the remaining troops for a second attack in the same tick", () => {
    const budget = new AttackBudget();
    const first = budget.take(10, 1000, 0.5);
    const second = budget.take(10, 1000, 0.5);
    expect(first).toBe(500);
    expect(second).toBe(250);
    expect(first + second).toBe(750);
  });

  it("never sends more than the troops, however many clicks", () => {
    const budget = new AttackBudget();
    let total = 0;
    for (let i = 0; i < 10; i++) total += budget.take(5, 1000, 0.9);
    expect(total).toBeLessThan(1000);
  });

  it("starts fresh when the tick changes", () => {
    const budget = new AttackBudget();
    budget.take(10, 1000, 0.5);
    expect(budget.take(11, 600, 0.5)).toBe(300);
  });

  it("commits only the capped amount of a counter-attack", () => {
    const budget = new AttackBudget();
    expect(budget.take(10, 1000, 0.5, 100)).toBe(100);
    expect(budget.take(10, 1000, 0.5)).toBe(450);
  });

  it("ignores a cap that is not a finite number", () => {
    const budget = new AttackBudget();
    expect(budget.take(10, 1000, 0.5, NaN)).toBe(500);
  });

  it("passes a NaN ratio through so the transport can drop it", () => {
    const budget = new AttackBudget();
    expect(budget.take(10, 1000, NaN)).toBeNaN();
    expect(budget.take(10, 1000, 0.5)).toBe(500);
  });
});

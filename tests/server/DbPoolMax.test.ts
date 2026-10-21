import { afterEach, describe, expect, it, vi } from "vitest";
import { poolMax } from "../../src/server/db";

describe("poolMax", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("defaults to 10", () => {
    vi.stubEnv("DB_POOL_MAX", "");
    expect(poolMax()).toBe(10);
  });

  it("reads DB_POOL_MAX", () => {
    vi.stubEnv("DB_POOL_MAX", "4");
    expect(poolMax()).toBe(4);
  });

  it("refuses a value that is not a positive integer", () => {
    vi.stubEnv("DB_POOL_MAX", "0");
    expect(() => poolMax()).toThrow(/Invalid DB_POOL_MAX/);
  });
});

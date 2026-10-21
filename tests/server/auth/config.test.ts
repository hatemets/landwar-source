import { afterEach, describe, expect, it, vi } from "vitest";
import {
  googleEndpoints,
  publicOrigin,
  sessionSecret,
} from "../../../src/server/auth/config";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe.each(["staging", "prod"])("auth config in %s", (gameEnv) => {
  it("requires a public HTTPS origin", () => {
    vi.stubEnv("GAME_ENV", gameEnv);
    vi.stubEnv("PUBLIC_ORIGIN", "");
    expect(() => publicOrigin()).toThrow(
      "PUBLIC_ORIGIN must be set in staging and production",
    );

    vi.stubEnv("PUBLIC_ORIGIN", "http://game.example.com");
    expect(() => publicOrigin()).toThrow(
      "PUBLIC_ORIGIN must use HTTPS in staging and production",
    );

    vi.stubEnv("PUBLIC_ORIGIN", "https://game.example.com");
    expect(publicOrigin()).toBe("https://game.example.com");
  });

  it("requires a configured session secret of at least 32 characters", () => {
    vi.stubEnv("GAME_ENV", gameEnv);
    vi.stubEnv("SESSION_SECRET", "");
    expect(() => sessionSecret()).toThrow(
      "SESSION_SECRET must be set in staging and production",
    );

    vi.stubEnv(
      "SESSION_SECRET",
      "WARNING_DEV_SESSION_SECRET_DO_NOT_USE_IN_PRODUCTION_0123456789",
    );
    expect(() => sessionSecret()).toThrow(
      "The development session secret cannot be used in deployment",
    );

    vi.stubEnv("SESSION_SECRET", "short");
    expect(() => sessionSecret()).toThrow(
      "SESSION_SECRET must be at least 32 characters",
    );

    const configuredSecret = "s".repeat(48);
    vi.stubEnv("SESSION_SECRET", configuredSecret);
    expect(new TextDecoder().decode(sessionSecret())).toBe(configuredSecret);
  });
});

describe("auth config in development", () => {
  it("keeps local defaults for development", () => {
    vi.stubEnv("GAME_ENV", "dev");
    vi.stubEnv("PUBLIC_ORIGIN", undefined);
    vi.stubEnv("SESSION_SECRET", undefined);

    expect(publicOrigin()).toBe("http://localhost:8888");
    expect(new TextDecoder().decode(sessionSecret())).toContain(
      "DO_NOT_USE_IN_PRODUCTION",
    );
  });
});

describe("Google endpoints", () => {
  it("uses Google's own by default", () => {
    vi.stubEnv("GOOGLE_OAUTH_BASE_URL", "");
    expect(googleEndpoints().authorization).toBe(
      "https://accounts.google.com/o/oauth2/v2/auth",
    );
  });

  it("accepts a stand-in server in development", () => {
    vi.stubEnv("GAME_ENV", "dev");
    vi.stubEnv("GOOGLE_OAUTH_BASE_URL", "http://127.0.0.1:9444/");
    expect(googleEndpoints()).toEqual({
      authorization: "http://127.0.0.1:9444/auth",
      token: "http://127.0.0.1:9444/token",
      userinfo: "http://127.0.0.1:9444/userinfo",
    });
  });

  it.each(["staging", "prod"])("refuses a stand-in in %s", (gameEnv) => {
    vi.stubEnv("GAME_ENV", gameEnv);
    vi.stubEnv("GOOGLE_OAUTH_BASE_URL", "http://127.0.0.1:9444");
    expect(() => googleEndpoints()).toThrow(
      "GOOGLE_OAUTH_BASE_URL is not allowed in deployment",
    );
  });
});

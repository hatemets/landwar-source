import type { NextFunction, Request, Response } from "express";
import { describe, expect, it, vi } from "vitest";
import {
  readCookie,
  requireSameOrigin,
  safeReturnPath,
} from "../../../src/server/auth/routes";

function fakeRequest(headers: Record<string, string>): Request {
  return { headers } as unknown as Request;
}

describe("readCookie", () => {
  it("reads one named value from the header", () => {
    const req = fakeRequest({ cookie: "a=1; landwar_session=abc%2Bdef; b=2" });
    expect(readCookie(req, "landwar_session")).toBe("abc+def");
  });

  it("returns undefined when the cookie is absent", () => {
    expect(readCookie(fakeRequest({}), "landwar_session")).toBeUndefined();
    expect(readCookie(fakeRequest({ cookie: "x=1" }), "landwar_session")).toBe(
      undefined,
    );
  });
});

describe("safeReturnPath", () => {
  it("keeps a same-site path", () => {
    expect(safeReturnPath("/lobby/abc?x=1")).toBe("/lobby/abc?x=1");
  });

  it("refuses an absolute or protocol-relative URL", () => {
    expect(safeReturnPath("https://evil.example/")).toBe("/");
    expect(safeReturnPath("//evil.example/")).toBe("/");
    expect(safeReturnPath("/\\evil.example")).toBe("/");
  });

  it("falls back to the home page for a non-string value", () => {
    expect(safeReturnPath(undefined)).toBe("/");
    expect(safeReturnPath(["/a"])).toBe("/");
  });
});

describe("requireSameOrigin", () => {
  it("passes a request from the public origin", () => {
    const next = vi.fn() as unknown as NextFunction;
    const req = fakeRequest({ origin: "http://localhost:8888" });
    requireSameOrigin(req, {} as Response, next);
    expect(next).toHaveBeenCalledOnce();
  });

  it("refuses a request from another origin", () => {
    const next = vi.fn() as unknown as NextFunction;
    const status = vi.fn().mockReturnThis();
    const json = vi.fn();
    const res = { status, json } as unknown as Response;
    requireSameOrigin(
      fakeRequest({ origin: "https://evil.example" }),
      res,
      next,
    );
    expect(next).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(403);
  });

  it("refuses a request with no origin header", () => {
    const next = vi.fn() as unknown as NextFunction;
    const status = vi.fn().mockReturnThis();
    const res = { status, json: vi.fn() } as unknown as Response;
    requireSameOrigin(fakeRequest({}), res, next);
    expect(next).not.toHaveBeenCalled();
  });
});

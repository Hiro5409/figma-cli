import { describe, expect, test } from "bun:test";

import { CliError, errorHints } from "../errors.ts";
import { figmaApiError, retryAfterSeconds } from "./api-error.ts";

describe("figmaApiError", () => {
  test("uses the HTTP response status instead of trusting the body", () => {
    const cause = { status: 404, err: "denied" };
    const error = figmaApiError(cause, { status: 403 });

    expect(error).toBeInstanceOf(CliError);
    expect(error).toMatchObject({ code: "ACCESS_DENIED", exitCode: 2, cause });
    expect(error.message).toBe("Figma API error (403): denied");
  });

  test("reads both Figma error body shapes", () => {
    expect(figmaApiError({ status: 400, err: "Bad ids" }, { status: 400 }).message).toContain(
      "Bad ids",
    );
    expect(
      figmaApiError({ error: true, status: 400, message: "Bad scale" }, { status: 400 }).message,
    ).toContain("Bad scale");
  });

  test("treats Figma's 403 for a rejected token as an authentication failure", () => {
    expect(figmaApiError({ status: 403, err: "Invalid token" }, { status: 403 })).toMatchObject({
      code: "AUTHENTICATION",
      exitCode: 2,
      hint: errorHints.authentication,
    });
  });

  test("reports the wait and the rate limit Figma applied", () => {
    const headers = new Headers({
      "Retry-After": "120",
      "X-Figma-Plan-Tier": "pro",
      "X-Figma-Rate-Limit-Type": "low",
    });
    const error = figmaApiError(
      { status: 429, err: "Rate limit exceeded" },
      { status: 429, headers },
    );

    expect(error).toMatchObject({ code: "RATE_LIMITED", exitCode: 1 });
    expect(error.why).toBe("Figma rate-limited the request (plan tier pro, low rate limit).");
    expect(error.hint).toStartWith("Wait 120 seconds");
  });

  test("classifies transport failures without an HTTP response", () => {
    const cause = new TypeError("network down");

    expect(figmaApiError(cause)).toMatchObject({
      code: "UPSTREAM_FAILURE",
      cause,
    });
  });

  test("does not infer an HTTP status from an untrusted body", () => {
    expect(figmaApiError({ status: 401, err: "failed" })).toMatchObject({
      code: "UPSTREAM_FAILURE",
    });
  });

  test.each([
    [400, "INVALID_INPUT", 1],
    [401, "AUTHENTICATION", 2],
    [403, "ACCESS_DENIED", 2],
    [404, "NOT_FOUND", 1],
    [429, "RATE_LIMITED", 1],
    [503, "UPSTREAM_FAILURE", 1],
  ] as const)("maps HTTP %i to %s", (status, code, exitCode) => {
    expect(figmaApiError({ err: "request failed" }, { status })).toMatchObject({
      code,
      exitCode,
    });
  });
});

describe("retryAfterSeconds", () => {
  test("reads delay seconds and HTTP dates", () => {
    const now = Date.parse("2026-11-16T00:00:00Z");
    expect(retryAfterSeconds(new Headers({ "Retry-After": "30" }), now)).toBe(30);
    expect(
      retryAfterSeconds(new Headers({ "Retry-After": "Mon, 16 Nov 2026 00:01:00 GMT" }), now),
    ).toBe(60);
    expect(retryAfterSeconds(new Headers({ "Retry-After": "soon" }), now)).toBeUndefined();
    expect(retryAfterSeconds(new Headers(), now)).toBeUndefined();
  });
});

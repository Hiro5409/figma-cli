import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { cli } from "gunshi";
import { HttpResponse } from "msw/http";

import { useStoredToken } from "../../../test/config.ts";
import { createNetwork } from "../../../test/network.ts";
import { handleGetMe } from "../../types/figma/msw.gen.ts";
import { statusCommand } from "./status.ts";

const network = createNetwork(
  handleGetMe(({ request }) => {
    const token = request.headers.get("X-Figma-Token");
    if (token === "figd_environment") {
      return HttpResponse.json({ id: "1", handle: "Ada", img_url: "", email: "ada@example.com" });
    }
    if (token === "figd_limited") {
      return HttpResponse.json(
        { status: 429, err: "Rate limit exceeded" },
        { status: 429, headers: { "Retry-After": "86400" } },
      );
    }
    return HttpResponse.json({ status: 403, err: "Invalid token" }, { status: 403 });
  }),
);
useStoredToken("auth-status");

beforeAll(() => network.enable());
afterAll(() => network.disable());

describe("auth status command", () => {
  test("reports a token from FIGMA_ACCESS_TOKEN and its account", async () => {
    process.env.FIGMA_ACCESS_TOKEN = "figd_environment";
    const result = await cli([], statusCommand);
    expect(JSON.parse(String(result))).toEqual({
      source: "environment",
      profile: null,
      status: "ready",
      handle: "Ada",
      email: "ada@example.com",
    });
  });

  test("reports a rejected stored token with the command that replaces it", async () => {
    const result = await cli(["--profile", "default"], statusCommand);
    expect(JSON.parse(String(result))).toMatchObject({
      source: "profile",
      profile: "default",
      status: "login_required",
      hint: "figma-api auth login --profile default --replace",
    });
  });

  test("keeps a rate limit's wait instead of asking for a new token", async () => {
    process.env.FIGMA_ACCESS_TOKEN = "figd_limited";
    const result = await cli([], statusCommand);
    expect(JSON.parse(String(result))).toMatchObject({
      status: "unavailable",
      code: "RATE_LIMITED",
      hint: expect.stringContaining("Wait 86400 seconds"),
    });
  });
});

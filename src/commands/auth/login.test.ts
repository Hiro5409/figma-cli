import { afterAll, afterEach, beforeAll, describe, expect, mock, test } from "bun:test";

import { HttpResponse } from "msw/http";

import { useStoredToken } from "../../../test/config.ts";
import { MOCK_TOKEN } from "../../../test/credentials.ts";
import { createNetwork } from "../../../test/network.ts";
import { loadConfig } from "../../config/config.ts";
import { loadCredentials, saveCredentials } from "../../config/credentials.ts";
import { handleGetMe } from "../../types/figma/msw.gen.ts";
import { login, type TokenInput } from "./login.ts";

const onMe = mock();
const network = createNetwork(
  handleGetMe(({ request }) => {
    const token = request.headers.get("X-Figma-Token");
    onMe(token);
    if (token !== "figd_new") {
      return HttpResponse.json({ status: 403, err: "Invalid token" }, { status: 403 });
    }
    return HttpResponse.json({
      id: "42",
      handle: "Ada",
      img_url: "https://example.com/ada.png",
      email: "ada@example.com",
    });
  }),
);
const directory = useStoredToken("auth-login");

beforeAll(() => network.enable());
afterAll(() => network.disable());
afterEach(() => onMe.mockClear());

function input(overrides: Partial<TokenInput>): TokenInput {
  return {
    stdin: () => Promise.reject(new Error("stdin was not expected")),
    prompt: () => Promise.reject(new Error("prompt was not expected")),
    interactive: true,
    ...overrides,
  };
}

const values = { replace: false, "set-default": false, "with-token": false };

describe("auth login", () => {
  test("verifies a piped token, then stores it with the account it belongs to", async () => {
    const result = await login(
      { ...values, profile: "work", "with-token": true },
      input({ stdin: () => Promise.resolve("figd_new\n") }),
    );

    expect(JSON.parse(result)).toEqual({
      profile: "work",
      handle: "Ada",
      email: "ada@example.com",
      status: "ready",
    });
    expect(loadCredentials(directory).work).toEqual({ accessToken: "figd_new" });
    expect(loadConfig(directory).profiles.work).toEqual({
      userId: "42",
      handle: "Ada",
      email: "ada@example.com",
    });
  });

  test("stores nothing when Figma rejects the token", async () => {
    await expect(
      login({ ...values, profile: "work" }, input({ prompt: () => Promise.resolve("figd_bad") })),
    ).rejects.toMatchObject({ code: "AUTHENTICATION" });
    expect(loadCredentials(directory).work).toBeUndefined();
  });

  test("rejects pasted text that is more than one token before sending it", async () => {
    await expect(
      login(
        { ...values, profile: "work", "with-token": true },
        input({ stdin: () => Promise.resolve("export FIGMA_TOKEN=figd_new\nfigd_new") }),
      ),
    ).rejects.toThrow("Paste only the token");
    expect(onMe).not.toHaveBeenCalled();
  });

  test("never asks for a token without a terminal", async () => {
    await expect(
      login({ ...values, profile: "work" }, input({ interactive: false })),
    ).rejects.toMatchObject({ hint: expect.stringContaining("--with-token") });
  });

  test("does not replace a profile another login stored while this one waited", async () => {
    await expect(
      login(
        { ...values, profile: "work", "with-token": true },
        input({
          stdin: () => {
            saveCredentials(directory, {
              default: MOCK_TOKEN,
              work: { accessToken: "figd_other" },
            });
            return Promise.resolve("figd_new");
          },
        }),
      ),
    ).rejects.toMatchObject({ message: expect.stringContaining("--replace") });
    expect(loadCredentials(directory).work).toEqual({ accessToken: "figd_other" });
  });

  test("does not replace a stored token unless asked", async () => {
    await expect(
      login(
        { ...values, profile: "default", "with-token": true },
        input({ stdin: () => Promise.resolve("figd_new") }),
      ),
    ).rejects.toMatchObject({
      code: "AUTHENTICATION",
      message: expect.stringContaining("--replace"),
    });
    expect(onMe).not.toHaveBeenCalled();
  });
});

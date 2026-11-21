import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";

import { http, HttpResponse } from "msw/http";

import { createNetwork } from "../../test/network.ts";
import { handleGetMe } from "../types/figma/msw.gen.ts";
import { client, configureClient, getMe } from "./client.ts";

const ME = {
  id: "1",
  handle: "Ada",
  img_url: "https://example.com/ada.png",
  email: "a@example.com",
};
const network = createNetwork(handleGetMe({ body: ME }));

beforeAll(() => network.enable());
afterAll(() => network.disable());

afterEach(() => {
  network.resetHandlers();
  client.setConfig({
    baseUrl: "https://api.figma.com",
    fetch: undefined,
    headers: { "X-Figma-Token": null },
    throwOnError: true,
  });
  client.interceptors.error.clear();
});

describe("API client", () => {
  test("sends the token in X-Figma-Token through SDK functions", async () => {
    network.use(
      handleGetMe(({ request }) => {
        expect(request.headers.get("X-Figma-Token")).toBe("figd_test");
        expect(request.headers.get("Authorization")).toBeNull();
        return HttpResponse.json(ME);
      }),
    );
    configureClient("figd_test");

    const { data } = await getMe();
    expect(data.handle).toBe("Ada");
  });

  test("turns Figma error bodies into classified errors", async () => {
    network.use(
      http.get("https://api.figma.com/v1/files/missing/meta", () =>
        HttpResponse.json({ status: 404, err: "Not found" }, { status: 404 }),
      ),
    );
    configureClient("figd_test");

    await expect(client.get({ url: "/v1/files/missing/meta" })).rejects.toMatchObject({
      code: "NOT_FOUND",
      exitCode: 1,
      message: "Figma API error (404): Not found",
    });
  });

  test("retries read-only transient responses", async () => {
    let callCount = 0;
    network.use(
      handleGetMe(() => {
        callCount++;
        if (callCount < 3) {
          return HttpResponse.json(
            { status: 429, err: "Rate limit exceeded" },
            { headers: { "Retry-After": "0" }, status: 429 },
          );
        }
        return HttpResponse.json(ME);
      }),
    );
    configureClient("figd_test");

    const { data } = await getMe();
    expect(data.handle).toBe("Ada");
    expect(callCount).toBe(3);
  });

  test("a developer log search sent as POST is retried as a read", async () => {
    let callCount = 0;
    network.use(
      http.post("https://api.figma.com/v1/developer_logs", () => {
        callCount++;
        if (callCount < 2) return HttpResponse.json({ status: 503 }, { status: 503 });
        return HttpResponse.json({ status: 200, error: false, meta: { items: [] } });
      }),
    );
    configureClient("figd_test");

    const { data } = await client.post({ url: "/v1/developer_logs", body: {} });
    expect(data).toMatchObject({ meta: { items: [] } });
    expect(callCount).toBe(2);
  });

  test("a redirect is refused, so the token never reaches another host", async () => {
    let leaked = 0;
    network.use(
      handleGetMe(
        () =>
          new HttpResponse(null, { status: 307, headers: { Location: "https://other.test/me" } }),
      ),
      http.get("https://other.test/me", () => {
        leaked++;
        return HttpResponse.json(ME);
      }),
    );
    configureClient("figd_test");

    await expect(getMe()).rejects.toBeDefined();
    expect(leaked).toBe(0);
  });

  test("fails at once when Figma asks to wait longer than a minute", async () => {
    let callCount = 0;
    network.use(
      handleGetMe(() => {
        callCount++;
        return HttpResponse.json(
          { status: 429, err: "Rate limit exceeded" },
          { headers: { "Retry-After": "86400", "X-Figma-Plan-Tier": "starter" }, status: 429 },
        );
      }),
    );
    configureClient("figd_test");

    await expect(getMe()).rejects.toMatchObject({
      code: "RATE_LIMITED",
      hint: expect.stringContaining("Wait 86400 seconds"),
      why: expect.stringContaining("plan tier starter"),
    });
    expect(callCount).toBe(1);
  });

  test.each(["post", "delete"] as const)("never retries %s writes", async (method) => {
    let callCount = 0;
    network.use(
      http[method]("https://api.figma.com/v1/files/key/comments", () => {
        callCount++;
        return HttpResponse.json(
          { status: 429, err: "Rate limit exceeded" },
          { headers: { "Retry-After": "0" }, status: 429 },
        );
      }),
    );
    configureClient("figd_test");

    await expect(
      client[method]({ url: "/v1/files/key/comments", body: { message: "hi" } }),
    ).rejects.toMatchObject({ code: "RATE_LIMITED" });
    expect(callCount).toBe(1);
  });

  test.each([408, 503])(
    "a %s write response does not prove the write was rejected",
    async (status) => {
      let accepted = 0;
      network.use(
        http.post("https://api.figma.com/v1/files/key/comments", () => {
          accepted++;
          return HttpResponse.json({ status, err: "Request failed" }, { status });
        }),
      );
      configureClient("figd_test");

      await expect(
        client.post({ url: "/v1/files/key/comments", body: { message: "hi" } }),
      ).rejects.toMatchObject({
        code: "OUTCOME_UNKNOWN",
        message: expect.stringContaining(`Figma API error (${status}): Request failed`),
        hint: expect.stringContaining("Do not retry automatically"),
      });
      expect(accepted).toBe(1);
    },
  );

  test("an unreadable successful write response requires reading the resource", async () => {
    network.use(
      http.post(
        "https://api.figma.com/v1/files/key/comments",
        () => new HttpResponse("{invalid", { headers: { "Content-Type": "application/json" } }),
      ),
    );
    configureClient("figd_test");

    await expect(
      client.post({ url: "/v1/files/key/comments", body: { message: "hi" } }),
    ).rejects.toMatchObject({ code: "OUTCOME_UNKNOWN" });
  });

  test("an unreadable successful read is an upstream failure, not bad input", async () => {
    network.use(
      handleGetMe(
        () => new HttpResponse("{invalid", { headers: { "Content-Type": "application/json" } }),
      ),
    );
    configureClient("figd_test");

    await expect(getMe()).rejects.toMatchObject({ code: "UPSTREAM_FAILURE" });
  });

  test("a lost write response requires reading the resource before retrying", async () => {
    let accepted = 0;
    network.use(
      http.post("https://api.figma.com/v1/files/key/comments", () => {
        accepted++;
        return HttpResponse.error();
      }),
    );
    configureClient("figd_test");

    await expect(
      client.post({ url: "/v1/files/key/comments", body: { message: "hi" } }),
    ).rejects.toMatchObject({
      code: "OUTCOME_UNKNOWN",
      hint: expect.stringContaining("Do not retry automatically"),
    });
    expect(accepted).toBe(1);
  });
});

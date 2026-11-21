import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { cli, define } from "gunshi";
import { HttpResponse } from "msw/http";
import * as v from "valibot";

import { useStoredToken } from "../test/config.ts";
import { createNetwork } from "../test/network.ts";
import { type ApiCommand, apiCommands } from "./api-commands.ts";
import { commands } from "./types/figma/commands.gen.ts";
import {
  handleGetDeveloperLogs,
  handleGetFileVersions,
  handleGetLibraryAnalyticsComponentActions,
  handleGetTeamComponents,
} from "./types/figma/msw.gen.ts";

const testDir = useStoredToken("api-commands");
const requests: Array<{ url: URL; body?: unknown }> = [];
const network = createNetwork();

const numericChoice: ApiCommand = {
  request: v.object({ query: v.object({ level: v.picklist([1, 2]) }) }),
  command: ["level", "list"],
  summary: "List by level",
  method: "GET",
  path: "/v1/levels",
  parameters: [
    {
      name: "level",
      location: "query",
      required: true,
      type: "number",
      choices: [1, 2],
      description: "Level",
    },
  ],
};

const subCommands = apiCommands([...commands, numericChoice]);

async function run(args: Array<string>): Promise<unknown> {
  const output = await cli(args, define({ name: "figma-api", run: () => "" }), {
    name: "figma-api",
    subCommands,
  });
  return JSON.parse(String(output));
}

const preview = async (args: Array<string>) =>
  ((await run([...args, "--dry-run"])) as { request: Record<string, unknown> }).request;

beforeAll(() => network.enable());
afterAll(() => network.disable());
afterEach(() => {
  requests.length = 0;
  network.resetHandlers();
});

const runaway = () =>
  HttpResponse.json({ status: 400, err: "The command kept paging" } as never, { status: 400 });

const versionPages: Record<string, { ids: Array<string>; next?: string }> = {
  first: { ids: ["2422385195020961594", "2422385195020961593"], next: "2422385195020961593" },
  "2422385195020961593": { ids: [], next: "2422385195020961592" },
  "2422385195020961592": { ids: ["2422385195020961592"] },
};

describe("generated API commands", () => {
  test("a dry run shows the encoded URL with the API base", async () => {
    expect(
      await preview([
        "file",
        "comment",
        "create",
        "--file-key",
        "a/b c",
        "--body",
        '{"message":"Align this"}',
      ]),
    ).toEqual({
      method: "POST",
      url: "https://api.figma.com/v1/files/a%2Fb%20c/comments",
      body: { message: "Align this" },
    });
    expect(
      await preview(["webhook", "update", "--webhook-id", "W", "--body", '{"status":"PAUSED"}']),
    ).toMatchObject({ url: "https://api.figma.com/v2/webhooks/W", body: { status: "PAUSED" } });
    expect(
      await preview(["image", "render", "--file-key", "K", "--ids", "1:2", "--scale", "2"]),
    ).toEqual({
      method: "GET",
      url: "https://api.figma.com/v1/images/K?ids=1%3A2&scale=2",
    });
  });

  test("a body number that JSON would change is rejected", async () => {
    await expect(
      preview([
        "file",
        "variable",
        "apply",
        "--file-key",
        "K",
        "--body",
        '{"variableModeValues":[{"variableId":"v","modeId":"m","value":9007199254740993}]}',
      ]),
    ).rejects.toThrow("beyond 2^53 - 1");
    await expect(
      preview([
        "file",
        "variable",
        "apply",
        "--file-key",
        "K",
        "--body",
        '{"variableModeValues":[{"variableId":"v","modeId":"m","value":1e400}]}',
      ]),
    ).rejects.toThrow("too large for a number");
  });

  test("numeric choices stay numbers", async () => {
    expect(await preview(["level", "list", "--level", "2"])).toMatchObject({
      url: "https://api.figma.com/v1/levels?level=2",
    });
  });

  test("a dot segment cannot change the request path", async () => {
    await expect(
      preview(["file", "comment", "delete", "--file-key", "K", "--comment-id", ".."]),
    ).rejects.toThrow('--comment-id cannot be ".."');
  });

  test("a validation error names the field without echoing its value", async () => {
    const error = await preview([
      "webhook",
      "create",
      "--body",
      '{"event_type":"secret-value","context":"file","context_id":"K","endpoint":"https://e.test","passcode":"p"}',
    ]).catch((caught: unknown) => caught);

    expect(String(error)).toContain("body.event_type: expected");
    expect(String(error)).not.toContain("secret-value");
    await expect(
      preview(["file", "comment", "create", "--file-key", "K", "--body", "{}"]),
    ).rejects.toThrow("Invalid request: body.message: required");
  });

  test("--all follows next_page URLs verbatim, past an empty page, and keeps the last page's other fields", async () => {
    network.use(
      handleGetFileVersions(({ request }) => {
        const url = new URL(request.url);
        requests.push({ url });
        const page = versionPages[url.searchParams.get("before") ?? "first"];
        return HttpResponse.json({
          versions: (page?.ids ?? []).map((id) => ({ id })),
          pagination: page?.next
            ? { next_page: `https://api.figma.com/v1/files/K/versions?before=${page.next}` }
            : { prev_page: "https://api.figma.com/v1/files/K/versions?after=1" },
        } as never);
      }),
    );

    expect(await run(["file", "version", "list", "--file-key", "K", "--all"])).toEqual({
      versions: [
        { id: "2422385195020961594" },
        { id: "2422385195020961593" },
        { id: "2422385195020961592" },
      ],
      pagination: { prev_page: "https://api.figma.com/v1/files/K/versions?after=1" },
    });
    expect(requests.map(({ url }) => url.search)).toEqual([
      "",
      "?before=2422385195020961593",
      "?before=2422385195020961592",
    ]);
    expect(
      await preview([
        "file",
        "version",
        "list",
        "--file-key",
        "K",
        "--before",
        "2422385195020961593",
      ]),
    ).toMatchObject({
      url: "https://api.figma.com/v1/files/K/versions?before=2422385195020961593",
    });
    await expect(
      run(["file", "version", "list", "--file-key", "K", "--all", "--before", "1"]),
    ).rejects.toThrow("--all reads every page, so it cannot be combined with --before.");
  });

  test("--all follows an opaque query cursor, past an empty page, until Figma has no more", async () => {
    const cursor = "https://opaque.test/?k=v";
    network.use(
      handleGetLibraryAnalyticsComponentActions(({ request }) => {
        const url = new URL(request.url);
        requests.push({ url });
        const second = url.searchParams.get("cursor") === cursor;
        return HttpResponse.json({
          rows: second ? [{ week: "2" }] : [],
          next_page: !second,
          ...(second ? {} : { cursor }),
        } as never);
      }),
    );

    const args = ["analytics", "library", "component", "action", "list", "--file-key", "K"];
    expect(await run([...args, "--group-by", "component", "--all"])).toEqual({
      rows: [{ week: "2" }],
      next_page: false,
    });
    expect(requests.map(({ url }) => Object.fromEntries(url.searchParams))).toEqual([
      { group_by: "component" },
      { group_by: "component", cursor },
    ]);
  });

  test("--all fails when Figma reports another page without a cursor", async () => {
    network.use(
      handleGetLibraryAnalyticsComponentActions(() =>
        HttpResponse.json({ rows: [{}], next_page: true } as never),
      ),
    );

    await expect(
      run([
        "analytics",
        "library",
        "component",
        "action",
        "list",
        "--file-key",
        "K",
        "--group-by",
        "component",
        "--all",
      ]),
    ).rejects.toThrow("Figma reported another page without saying where it is.");
  });

  test("--all follows a nested after cursor and stops at an empty page", async () => {
    network.use(
      handleGetTeamComponents(({ request }) => {
        const url = new URL(request.url);
        requests.push({ url });
        if (requests.length > 3) return runaway();
        const after = Number(url.searchParams.get("after") ?? 0);
        const components = after < 2 ? [{ key: `c${after + 1}` }] : [];
        return HttpResponse.json({
          status: 200,
          error: false,
          meta: { components, cursor: { after: after + 1 } },
        } as never);
      }),
    );

    expect(await run(["team", "component", "list", "--team-id", "T", "--all"])).toMatchObject({
      meta: { components: [{ key: "c1" }, { key: "c2" }] },
    });
    expect(requests.map(({ url }) => url.searchParams.get("after"))).toEqual([null, "1", "2"]);
  });

  test("--all fails on a numeric cursor that JSON could not hold exactly", async () => {
    network.use(
      handleGetTeamComponents(
        () =>
          new HttpResponse(
            '{"status":200,"error":false,"meta":{"components":[{}],"cursor":{"after":9007199254740993}}}',
            { headers: { "Content-Type": "application/json" } },
          ),
      ),
    );

    await expect(run(["team", "component", "list", "--team-id", "T", "--all"])).rejects.toThrow(
      "a JSON number cannot hold exactly",
    );
  });

  test("--all sends a body cursor, stops when Figma has no more, and owns the cursor", async () => {
    network.use(
      handleGetDeveloperLogs(async ({ request }) => {
        const body: unknown = await request.json();
        requests.push({ url: new URL(request.url), body });
        const second = (body as { cursor?: string }).cursor === "n2";
        return HttpResponse.json({
          status: 200,
          error: false,
          meta: {
            items: [{ id: second ? "2" : "1" }],
            cursor: second ? "n3" : "n2",
            has_more: !second,
          },
        } as never);
      }),
    );

    const args = ["developer-log", "list", "--body", '{"limit":100}'];
    expect(await run([...args, "--all"])).toMatchObject({
      meta: { items: [{ id: "1" }, { id: "2" }] },
    });
    expect(requests.map(({ body }) => body)).toEqual([
      { limit: 100 },
      { limit: 100, cursor: "n2" },
    ]);
    await expect(
      run(["developer-log", "list", "--body", '{"cursor":"n2"}', "--all"]),
    ).rejects.toThrow('cannot be combined with "cursor" in --body');
  });

  test("--all stops with an error when Figma repeats a page", async () => {
    network.use(
      handleGetLibraryAnalyticsComponentActions(({ request }) => {
        requests.push({ url: new URL(request.url) });
        if (requests.length > 2) return runaway();
        return HttpResponse.json({ rows: [{}], next_page: true, cursor: "same" } as never);
      }),
    );

    await expect(
      run([
        "analytics",
        "library",
        "component",
        "action",
        "list",
        "--file-key",
        "K",
        "--group-by",
        "component",
        "--all",
      ]),
    ).rejects.toThrow("Figma returned the same next page twice.");
  });

  test("a body can come from a JSON file", async () => {
    const bodyFile = join(testDir, "body.json");
    writeFileSync(bodyFile, '{"message":"From a file"}');
    const args = ["file", "comment", "create", "--file-key", "K", "--body"];

    expect(await preview([...args, `@${bodyFile}`])).toMatchObject({
      body: { message: "From a file" },
    });
    await expect(preview([...args, "@/missing.json"])).rejects.toThrow("File not found");
  });

  test("a body that is not a JSON object is rejected before any request", async () => {
    await expect(
      run(["file", "comment", "create", "--file-key", "K", "--body", '["hi"]']),
    ).rejects.toThrow("--body must be a JSON object.");
  });

  test("schema describes the request of a generated command", async () => {
    expect(await run(["schema", "file", "comment", "reaction", "create"])).toMatchObject({
      method: "POST",
      path: "/v1/files/{file_key}/comments/{comment_id}/reactions",
      request: {
        properties: {
          body: { properties: { emoji: { type: "string" } }, required: ["emoji"] },
        },
      },
    });
    await expect(run(["schema", "file", "comment"])).rejects.toThrow("Unknown API command");
  });
});

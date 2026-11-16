import { afterAll, afterEach, beforeAll, describe, expect, mock, test } from "bun:test";

import { cli } from "gunshi";
import { HttpResponse } from "msw/http";

import { useStoredToken } from "../../../test/config.ts";
import { createNetwork } from "../../../test/network.ts";
import { handleGetFileVersions } from "../../types/figma/msw.gen.ts";
import { versionListCommand } from "./list.ts";

const user = { id: "1", handle: "Ada", img_url: "https://example.com/ada.png" };
const version = (id: string) => ({
  id,
  created_at: "2026-11-16T00:00:00Z",
  label: null,
  description: null,
  user,
});
const pages: Record<string, { ids: string[]; next?: string }> = {
  first: { ids: ["2422385195020961594", "2422385195020961593"], next: "cursor-b" },
  "cursor-b": { ids: ["2422385195020961592"], next: "cursor-c" },
  "cursor-c": { ids: ["2422385195020961591", "2422385195020961590"] },
};
const onPage = mock();
const network = createNetwork(
  handleGetFileVersions(({ request }) => {
    const query = new URL(request.url).searchParams;
    onPage(Object.fromEntries(query));
    const page = pages[query.get("before") ?? "first"];
    if (!page) return HttpResponse.json({ status: 400, err: "Bad cursor" }, { status: 400 });
    return HttpResponse.json({
      versions: page.ids.map(version),
      pagination: page.next
        ? {
            next_page: `https://api.figma.com/v1/files/abc123/versions?page_size=2&before=${page.next}`,
          }
        : {},
    });
  }),
);
useStoredToken("version-list");

beforeAll(() => network.enable());
afterAll(() => network.disable());
afterEach(() => onPage.mockClear());

describe("version list command", () => {
  test("follows Figma's next_page cursor unchanged, past short pages", async () => {
    const result = await cli(["--file", "abc123", "--limit", "4"], versionListCommand);

    expect(onPage.mock.calls.map(([query]) => query)).toEqual([
      { page_size: "4" },
      { page_size: "2", before: "cursor-b" },
      { page_size: "2", before: "cursor-c" },
    ]);
    expect(JSON.parse(String(result)).map((entry: { id: string }) => entry.id)).toEqual([
      "2422385195020961594",
      "2422385195020961593",
      "2422385195020961592",
      "2422385195020961591",
    ]);
  });

  test("stops when Figma reports no further page", async () => {
    const result = await cli(["--file", "abc123", "--limit", "50"], versionListCommand);
    expect(JSON.parse(String(result))).toHaveLength(5);
    expect(onPage).toHaveBeenCalledTimes(3);
  });

  test("stops requesting once the limit is reached", async () => {
    await cli(["--file", "abc123", "--limit", "2"], versionListCommand);
    expect(onPage).toHaveBeenCalledTimes(1);
  });
});

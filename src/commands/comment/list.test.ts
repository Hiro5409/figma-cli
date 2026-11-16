import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { cli } from "gunshi";
import { HttpResponse } from "msw/http";

import { useStoredToken } from "../../../test/config.ts";
import { createNetwork } from "../../../test/network.ts";
import { handleGetComments } from "../../types/figma/msw.gen.ts";
import { commentListCommand } from "./list.ts";

const user = { id: "1", handle: "Ada", img_url: "https://example.com/ada.png" };
const comment = {
  file_key: "abc123",
  user,
  created_at: "2026-11-16T00:00:00Z",
  order_id: null,
  reactions: [],
  client_meta: { x: 0, y: 0 },
  parent_id: "",
};
let asMarkdown: string | null = null;
const network = createNetwork(
  handleGetComments(({ request }) => {
    asMarkdown = new URL(request.url).searchParams.get("as_md");
    return HttpResponse.json({
      comments: [
        {
          ...comment,
          id: "1",
          message: "Open",
          resolved_at: null,
          client_meta: { node_id: "1:2", node_offset: { x: 0, y: 0 } },
        },
        { ...comment, id: "2", message: "Reply to open", parent_id: "1" },
        { ...comment, id: "3", message: "Done", resolved_at: "2026-11-16T01:00:00Z" },
        { ...comment, id: "4", message: "Reply to done", parent_id: "3" },
      ],
    });
  }),
);
useStoredToken("comment-list");

beforeAll(() => network.enable());
afterAll(() => network.disable());

describe("comment list command", () => {
  test("keeps unresolved threads with their replies", async () => {
    const result = await cli(["--file", "abc123", "--unresolved"], commentListCommand);
    expect(JSON.parse(String(result)).map((entry: { id: string }) => entry.id)).toEqual(["1", "2"]);
    expect(asMarkdown).toBeNull();
  });
});

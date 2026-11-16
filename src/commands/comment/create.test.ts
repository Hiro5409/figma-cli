import { afterAll, afterEach, beforeAll, describe, expect, mock, test } from "bun:test";

import { cli } from "gunshi";
import { HttpResponse } from "msw/http";

import { useStoredToken } from "../../../test/config.ts";
import { createNetwork } from "../../../test/network.ts";
import { saveCredentials } from "../../config/credentials.ts";
import { errorHints } from "../../errors.ts";
import { handlePostComment } from "../../types/figma/msw.gen.ts";
import { commentCreateCommand } from "./create.ts";

const onPost = mock();
const network = createNetwork(
  handlePostComment(async ({ request, params }) => {
    const body: unknown = await request.json();
    onPost({ fileKey: params.file_key, token: request.headers.get("X-Figma-Token"), body });
    return HttpResponse.json({
      id: "900",
      file_key: "abc123",
      message: "Align this",
      client_meta: { node_id: "1:2", node_offset: { x: 0, y: 0 } },
      user: { id: "1", handle: "Ada", img_url: "https://example.com/ada.png" },
      created_at: "2026-11-16T00:00:00Z",
      order_id: "1",
      reactions: [],
    });
  }),
);
const directory = useStoredToken("comment-create");

beforeAll(() => network.enable());
afterAll(() => network.disable());
afterEach(() => {
  onPost.mockClear();
  network.resetHandlers();
});

describe("comment create command", () => {
  test("pins a new thread to the node from the arguments", async () => {
    const result = await cli(
      ["--file", "abc123", "--node", "1-2", "--x", "8", "--message", "Align this"],
      commentCreateCommand,
    );

    expect(onPost).toHaveBeenCalledWith({
      fileKey: "abc123",
      token: "figd_test-token",
      body: {
        message: "Align this",
        client_meta: { node_id: "1:2", node_offset: { x: 8, y: 0 } },
      },
    });
    expect(JSON.parse(String(result))).toMatchObject({ id: "900" });
  });

  test("pins a new thread to the node in a --file URL", async () => {
    await cli(
      [
        "--file",
        "https://www.figma.com/design/abc123/T?node-id=3-4",
        "--y",
        "2",
        "--message",
        "Hi",
      ],
      commentCreateCommand,
    );
    expect(onPost).toHaveBeenCalledWith(
      expect.objectContaining({
        body: { message: "Hi", client_meta: { node_id: "3:4", node_offset: { x: 0, y: 2 } } },
      }),
    );
  });

  test("a reply ignores the node in a --file URL", async () => {
    await cli(
      [
        "--file",
        "https://www.figma.com/design/abc123/T?node-id=3-4",
        "--reply-to",
        "800",
        "--message",
        "Ok",
      ],
      commentCreateCommand,
    );
    expect(onPost).toHaveBeenCalledWith(
      expect.objectContaining({ body: { message: "Ok", comment_id: "800" } }),
    );
  });

  test("replies to a thread without a position", async () => {
    await cli(
      ["--file", "abc123", "--reply-to", "800", "--message", "Fixed"],
      commentCreateCommand,
    );
    expect(onPost).toHaveBeenCalledWith(
      expect.objectContaining({ body: { message: "Fixed", comment_id: "800" } }),
    );
  });

  test("dry-run shows the exact request without a token or a write", async () => {
    saveCredentials(directory, {});
    const result = await cli(
      ["--file", "abc123", "--node", "1:2", "--message", "Hi", "--dry-run"],
      commentCreateCommand,
    );

    expect(onPost).not.toHaveBeenCalled();
    expect(JSON.parse(String(result))).toEqual({
      dryRun: true,
      request: {
        method: "POST",
        path: "/v1/files/abc123/comments",
        body: { message: "Hi", client_meta: { node_id: "1:2", node_offset: { x: 0, y: 0 } } },
      },
    });
  });

  test("asks for a login without posting when no token is stored", async () => {
    saveCredentials(directory, {});
    await expect(
      cli(["--file", "abc123", "--node", "1:2", "--message", "Hi"], commentCreateCommand),
    ).rejects.toMatchObject({ code: "AUTHENTICATION", hint: errorHints.authentication });
    expect(onPost).not.toHaveBeenCalled();
  });

  test.each([
    [["--x", "4"], "--x and --y need a node from --node or the --file URL."],
    [["--node", "1:2", "--reply-to", "800"], "--node and --reply-to cannot be combined."],
  ])("rejects an ambiguous placement %p before reading credentials", async (extra, message) => {
    saveCredentials(directory, {});
    await expect(
      cli(["--file", "abc123", "--message", "Hi", ...extra], commentCreateCommand),
    ).rejects.toThrow(message);
    expect(onPost).not.toHaveBeenCalled();
  });
});

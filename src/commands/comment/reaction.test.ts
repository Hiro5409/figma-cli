import { afterAll, afterEach, beforeAll, describe, expect, mock, test } from "bun:test";

import { cli } from "gunshi";
import { HttpResponse } from "msw/http";

import { useStoredToken } from "../../../test/config.ts";
import { createNetwork } from "../../../test/network.ts";
import {
  handleDeleteCommentReaction,
  handlePostCommentReaction,
} from "../../types/figma/msw.gen.ts";
import { commentReactionAddCommand } from "./reaction-add.ts";
import { commentReactionDeleteCommand } from "./reaction-delete.ts";

const onReaction = mock();
const network = createNetwork(
  handlePostCommentReaction(async ({ request, params }) => {
    onReaction({ method: "POST", commentId: params.comment_id, body: await request.json() });
    return HttpResponse.json({ status: 200, error: false });
  }),
  handleDeleteCommentReaction(({ request, params }) => {
    const emoji = new URL(request.url).searchParams.get("emoji");
    onReaction({ method: "DELETE", commentId: params.comment_id, emoji });
    return HttpResponse.json({ status: 200, error: false });
  }),
);
useStoredToken("comment-reaction");

beforeAll(() => network.enable());
afterAll(() => network.disable());
afterEach(() => onReaction.mockClear());

describe("comment reaction commands", () => {
  test("add sends the shortcode in the body", async () => {
    await cli(
      ["--file", "abc123", "--comment-id", "900", "--emoji", ":+1::skin-tone-2:"],
      commentReactionAddCommand,
    );
    expect(onReaction).toHaveBeenCalledWith({
      method: "POST",
      commentId: "900",
      body: { emoji: ":+1::skin-tone-2:" },
    });
  });

  test("delete sends the shortcode in the query", async () => {
    await cli(
      ["--file", "abc123", "--comment-id", "900", "--emoji", ":heart:"],
      commentReactionDeleteCommand,
    );
    expect(onReaction).toHaveBeenCalledWith({
      method: "DELETE",
      commentId: "900",
      emoji: ":heart:",
    });
  });

  test("rejects a character instead of a shortcode before calling the API", async () => {
    await expect(
      cli(["--file", "abc123", "--comment-id", "900", "--emoji", "👍"], commentReactionAddCommand),
    ).rejects.toMatchObject({
      errors: [
        expect.objectContaining({
          message: expect.stringContaining('Expected an emoji shortcode such as ":heart:".'),
        }),
      ],
    });
    expect(onReaction).not.toHaveBeenCalled();
  });
});

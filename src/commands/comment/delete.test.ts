import { afterAll, afterEach, beforeAll, describe, expect, mock, test } from "bun:test";

import { cli } from "gunshi";
import { HttpResponse } from "msw/http";

import { useStoredToken } from "../../../test/config.ts";
import { createNetwork } from "../../../test/network.ts";
import { handleDeleteComment } from "../../types/figma/msw.gen.ts";
import { commentDeleteCommand } from "./delete.ts";

const onDelete = mock();
const network = createNetwork(
  handleDeleteComment(({ params }) => {
    onDelete({ fileKey: params.file_key, commentId: params.comment_id });
    return HttpResponse.json({ status: 200, error: false });
  }),
);
useStoredToken("comment-delete");

beforeAll(() => network.enable());
afterAll(() => network.disable());
afterEach(() => onDelete.mockClear());

describe("comment delete command", () => {
  test("dry-run does not delete", async () => {
    const result = await cli(
      ["--file", "abc123", "--id", "900", "--dry-run"],
      commentDeleteCommand,
    );
    expect(onDelete).not.toHaveBeenCalled();
    expect(JSON.parse(String(result)).request).toEqual({
      method: "DELETE",
      path: "/v1/files/abc123/comments/900",
    });
  });
});

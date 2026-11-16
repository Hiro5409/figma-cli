import { define } from "gunshi";
import { args, float, merge, required, string } from "gunshi/combinators";

import { nodeIdArg } from "../../cli-input.ts";
import { CliError } from "../../errors.ts";
import { dryRunArgs } from "../../global-args.ts";
import { initCommand } from "../../helpers.ts";
import { dryRunOutput } from "../../output/dry-run.ts";
import { postComment } from "../../types/figma/sdk.gen.ts";
import type { PostCommentData } from "../../types/figma/types.gen.ts";

function invalidPlacement(message: string): CliError {
  return new CliError(message, {
    code: "INVALID_INPUT",
    why: "A comment is either a new thread pinned to a node or a reply that stays in its thread.",
    hint: "Pass --node (with optional --x and --y) for a new thread, or --reply-to for a reply.",
  });
}

export const commentCreateCommand = define({
  name: "create",
  description:
    "Post a comment as the token's user, pinned to a node or replying to a thread (scope: file_comments:write)",
  args: merge(
    dryRunArgs,
    args({
      message: required(string({ description: "Comment text" })),
      node: nodeIdArg(
        "--node",
        "Pin a new thread to this node; defaults to the node in a --file URL",
      ),
      x: float({ description: "Pin offset from the node's left edge, in pixels (default 0)" }),
      y: float({ description: "Pin offset from the node's top edge, in pixels (default 0)" }),
      "reply-to": string({ description: "ID of the root comment to reply to" }),
    }),
  ),
  examples: `$ figma-api comment create --file <key> --node 1:2 --message "Align this with the grid" --dry-run
$ figma-api comment create --file <key> --reply-to 123456 --message "Fixed"`,
  run: async (ctx) => {
    const { x, y } = ctx.values;
    const replyTo = ctx.values["reply-to"];
    if (ctx.values.node !== undefined && replyTo !== undefined) {
      throw invalidPlacement("--node and --reply-to cannot be combined.");
    }
    const node = replyTo === undefined ? (ctx.values.node ?? ctx.values.file.nodeId) : undefined;
    if (node === undefined && (x !== undefined || y !== undefined)) {
      throw invalidPlacement("--x and --y need a node from --node or the --file URL.");
    }
    initCommand(ctx);

    const fileKey = ctx.values.file.fileKey;
    const body: PostCommentData["body"] = {
      message: ctx.values.message,
      ...(node === undefined
        ? {}
        : { client_meta: { node_id: node, node_offset: { x: x ?? 0, y: y ?? 0 } } }),
      ...(replyTo === undefined ? {} : { comment_id: replyTo }),
    };

    if (ctx.values["dry-run"]) {
      return dryRunOutput({ method: "POST", path: `/v1/files/${fileKey}/comments`, body });
    }

    const { data } = await postComment({ path: { file_key: fileKey }, body });
    return JSON.stringify(data);
  },
});

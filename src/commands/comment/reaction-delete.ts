import { define } from "gunshi";
import { merge } from "gunshi/combinators";

import { dryRunArgs } from "../../global-args.ts";
import { initCommand } from "../../helpers.ts";
import { dryRunOutput } from "../../output/dry-run.ts";
import { deleteCommentReaction } from "../../types/figma/sdk.gen.ts";
import { reactionArgs } from "./emoji-arg.ts";

export const commentReactionDeleteCommand = define({
  name: "delete",
  description: "Remove the token's user's reaction from a comment (scope: file_comments:write)",
  args: merge(dryRunArgs, reactionArgs),
  examples: `$ figma-api comment reaction delete --file <key> --comment-id 123456 --emoji ":+1:"`,
  run: async (ctx) => {
    initCommand(ctx);
    const fileKey = ctx.values.file.fileKey;
    const commentId = ctx.values["comment-id"];
    const emoji = ctx.values.emoji;

    if (ctx.values["dry-run"]) {
      return dryRunOutput({
        method: "DELETE",
        path: `/v1/files/${fileKey}/comments/${commentId}/reactions`,
        query: { emoji },
      });
    }

    await deleteCommentReaction({
      path: { file_key: fileKey, comment_id: commentId },
      query: { emoji },
    });
    return JSON.stringify({ comment_id: commentId, emoji, deleted: true });
  },
});

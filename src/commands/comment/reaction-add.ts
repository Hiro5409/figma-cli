import { define } from "gunshi";
import { merge } from "gunshi/combinators";

import { dryRunArgs } from "../../global-args.ts";
import { initCommand } from "../../helpers.ts";
import { dryRunOutput } from "../../output/dry-run.ts";
import { postCommentReaction } from "../../types/figma/sdk.gen.ts";
import { reactionArgs } from "./emoji-arg.ts";

export const commentReactionAddCommand = define({
  name: "add",
  description: "React to a comment as the token's user (scope: file_comments:write)",
  args: merge(dryRunArgs, reactionArgs),
  examples: `$ figma-api comment reaction add --file <key> --comment-id 123456 --emoji ":+1:"`,
  run: async (ctx) => {
    initCommand(ctx);
    const fileKey = ctx.values.file.fileKey;
    const commentId = ctx.values["comment-id"];
    const emoji = ctx.values.emoji;

    if (ctx.values["dry-run"]) {
      return dryRunOutput({
        method: "POST",
        path: `/v1/files/${fileKey}/comments/${commentId}/reactions`,
        body: { emoji },
      });
    }

    await postCommentReaction({
      path: { file_key: fileKey, comment_id: commentId },
      body: { emoji },
    });
    return JSON.stringify({ comment_id: commentId, emoji, added: true });
  },
});

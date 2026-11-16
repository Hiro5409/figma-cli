import { define } from "gunshi";
import { args, boolean, merge, withDefault } from "gunshi/combinators";

import { fileArgs } from "../../global-args.ts";
import { initCommand } from "../../helpers.ts";
import { getComments } from "../../types/figma/sdk.gen.ts";
import type { Comment } from "../../types/figma/types.gen.ts";

export const commentListCommand = define({
  name: "list",
  description: "List a file's comments and replies (scope: file_comments:read)",
  args: merge(
    fileArgs,
    args({
      unresolved: withDefault(
        boolean({ description: "Only threads that are not resolved, with their replies" }),
        false,
      ),
      markdown: withDefault(
        boolean({ description: "Return messages as Markdown instead of plain text" }),
        false,
      ),
    }),
  ),
  examples: `$ figma-api comment list --file <key> --unresolved`,
  run: async (ctx) => {
    initCommand(ctx);
    const { data } = await getComments({
      path: { file_key: ctx.values.file.fileKey },
      query: { as_md: ctx.values.markdown || undefined },
    });

    // Figma resolves only a thread's root, and a root's parent_id is "".
    const threadOf = (comment: Comment) => comment.parent_id || comment.id;
    const resolvedThreads = new Set(
      data.comments.filter((comment) => comment.resolved_at).map((comment) => comment.id),
    );
    const comments = ctx.values.unresolved
      ? data.comments.filter((comment) => !resolvedThreads.has(threadOf(comment)))
      : data.comments;

    return JSON.stringify(comments);
  },
});

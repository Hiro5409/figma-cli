import { define } from "gunshi";
import { args, merge, required, string } from "gunshi/combinators";

import { dryRunArgs } from "../../global-args.ts";
import { initCommand } from "../../helpers.ts";
import { dryRunOutput } from "../../output/dry-run.ts";
import { deleteComment } from "../../types/figma/sdk.gen.ts";

export const commentDeleteCommand = define({
  name: "delete",
  description:
    "Delete a comment the token's user wrote; deleting a root removes its thread (scope: file_comments:write)",
  args: merge(dryRunArgs, args({ id: required(string({ description: "Comment ID" })) })),
  examples: `$ figma-api comment delete --file <key> --id 123456 --dry-run`,
  run: async (ctx) => {
    initCommand(ctx);
    const fileKey = ctx.values.file.fileKey;
    const id = ctx.values.id;

    if (ctx.values["dry-run"]) {
      return dryRunOutput({ method: "DELETE", path: `/v1/files/${fileKey}/comments/${id}` });
    }

    await deleteComment({ path: { file_key: fileKey, comment_id: id } });
    return JSON.stringify({ id, deleted: true });
  },
});

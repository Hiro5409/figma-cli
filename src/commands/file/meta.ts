import { define } from "gunshi";

import { fileArgs } from "../../global-args.ts";
import { initCommand } from "../../helpers.ts";
import { getFileMeta } from "../../types/figma/sdk.gen.ts";

export const fileMetaCommand = define({
  name: "meta",
  description:
    "Read a file's name, editors, and version without its document tree (scope: file_metadata:read)",
  args: fileArgs,
  examples: `$ figma-api file meta --file <key>`,
  run: async (ctx) => {
    initCommand(ctx);
    const { data } = await getFileMeta({ path: { file_key: ctx.values.file.fileKey } });
    return JSON.stringify(data.file);
  },
});

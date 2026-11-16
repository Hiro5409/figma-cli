import { define } from "gunshi";

import { fileArgs } from "../../global-args.ts";
import { initCommand } from "../../helpers.ts";
import { getFileStyles } from "../../types/figma/sdk.gen.ts";

export const styleListCommand = define({
  name: "list",
  description:
    "List the color, text, effect, and grid styles a library file publishes (scope: library_content:read)",
  args: fileArgs,
  examples: `$ figma-api style list --file <key>`,
  run: async (ctx) => {
    initCommand(ctx);
    const { data } = await getFileStyles({ path: { file_key: ctx.values.file.fileKey } });
    return JSON.stringify(data.meta.styles);
  },
});

import { define } from "gunshi";

import { fileArgs } from "../../global-args.ts";
import { initCommand } from "../../helpers.ts";
import { getFileComponents } from "../../types/figma/sdk.gen.ts";

export const componentListCommand = define({
  name: "list",
  description:
    "List the components a library file publishes, one entry per variant (scope: library_content:read)",
  args: fileArgs,
  examples: `$ figma-api component list --file <key>`,
  run: async (ctx) => {
    initCommand(ctx);
    const { data } = await getFileComponents({ path: { file_key: ctx.values.file.fileKey } });
    return JSON.stringify(data.meta.components);
  },
});

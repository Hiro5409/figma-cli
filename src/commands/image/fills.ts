import { define } from "gunshi";

import { fileArgs } from "../../global-args.ts";
import { initCommand } from "../../helpers.ts";
import { getImageFills } from "../../types/figma/sdk.gen.ts";

export const imageFillsCommand = define({
  name: "fills",
  description:
    "List download URLs of the original images used as fills, by image reference (scope: file_content:read)",
  args: fileArgs,
  examples: `$ figma-api image fills --file <key>`,
  run: async (ctx) => {
    initCommand(ctx);
    const { data } = await getImageFills({ path: { file_key: ctx.values.file.fileKey } });
    return JSON.stringify(data.meta.images);
  },
});

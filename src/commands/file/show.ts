import { define } from "gunshi";
import { args, boolean, integer, merge, multiple, string, withDefault } from "gunshi/combinators";

import { nodeIdArg } from "../../cli-input.ts";
import { fileArgs } from "../../global-args.ts";
import { initCommand } from "../../helpers.ts";
import { getFile } from "../../types/figma/sdk.gen.ts";

export const fileShowCommand = define({
  name: "show",
  description:
    "Read a file's document tree (scope: file_content:read). Large files are large; limit them with --depth or --node",
  args: merge(
    fileArgs,
    args({
      node: multiple(
        nodeIdArg(
          "--node",
          "Return only the paths to this node (repeatable); defaults to the node in a --file URL",
        ),
      ),
      depth: integer({ min: 1, description: "Tree depth to return; 1 returns pages only" }),
      version: string({ description: "Version ID to read instead of the current version" }),
      "geometry-paths": withDefault(boolean({ description: "Include vector path data" }), false),
      "branch-data": withDefault(
        boolean({ description: "Include the main file key and branch metadata" }),
        false,
      ),
    }),
  ),
  examples: `$ figma-api file show --file "https://www.figma.com/design/<key>/<name>" --depth 1`,
  run: async (ctx) => {
    initCommand(ctx);
    const { nodeId } = ctx.values.file;
    const { data } = await getFile({
      path: { file_key: ctx.values.file.fileKey },
      query: {
        ids: (ctx.values.node ?? (nodeId === undefined ? undefined : [nodeId]))?.join(","),
        depth: ctx.values.depth,
        version: ctx.values.version,
        geometry: ctx.values["geometry-paths"] ? "paths" : undefined,
        branch_data: ctx.values["branch-data"] || undefined,
      },
    });
    return JSON.stringify(data);
  },
});

import { define } from "gunshi";
import { args, boolean, integer, merge, multiple, string, withDefault } from "gunshi/combinators";

import { nodeIdArg, selectedNodeIds } from "../../cli-input.ts";
import { fileArgs } from "../../global-args.ts";
import { initCommand } from "../../helpers.ts";
import { getFileNodes } from "../../types/figma/sdk.gen.ts";

export const fileNodesCommand = define({
  name: "nodes",
  description:
    "Read the subtrees of specific nodes; a node that does not exist reads as null (scope: file_content:read)",
  args: merge(
    fileArgs,
    args({
      node: multiple(
        nodeIdArg("--node", "Node to read (repeatable); defaults to the node in a --file URL"),
      ),
      depth: integer({ min: 1, description: "Tree depth to return below each node" }),
      version: string({ description: "Version ID to read instead of the current version" }),
      "geometry-paths": withDefault(boolean({ description: "Include vector path data" }), false),
    }),
  ),
  examples: `$ figma-api file nodes --file <key> --node 1:2 --node 3:4 --depth 2`,
  run: async (ctx) => {
    const ids = selectedNodeIds(ctx.values.file, ctx.values.node);
    initCommand(ctx);
    const { data } = await getFileNodes({
      path: { file_key: ctx.values.file.fileKey },
      query: {
        ids: ids.join(","),
        depth: ctx.values.depth,
        version: ctx.values.version,
        geometry: ctx.values["geometry-paths"] ? "paths" : undefined,
      },
    });
    return JSON.stringify(data);
  },
});

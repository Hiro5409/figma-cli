import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { define } from "gunshi";
import { args, choice, float, merge, multiple, string, withDefault } from "gunshi/combinators";

import { nodeIdArg, selectedNodeIds } from "../../cli-input.ts";
import { CliError } from "../../errors.ts";
import { fileArgs } from "../../global-args.ts";
import { initCommand } from "../../helpers.ts";
import { writeOutput } from "../../output/write.ts";
import { getImages } from "../../types/figma/sdk.gen.ts";

// Bun's fetch timeout is an idle timeout, so a slow but steady download still completes.
const DOWNLOAD_IDLE_TIMEOUT_MS = 120_000;

type Row = { node_id: string; url: string | null; path?: string; bytes?: number; error?: string };

function fileNameFor(nodeId: string, extension: string): string {
  return `${nodeId.replaceAll(":", "-").replaceAll(";", "_")}.${extension}`;
}

// The URLs point at Figma's image storage, not the API, so the request carries no token.
async function download(url: string, path: string): Promise<number> {
  const response = await fetch(url, { timeout: DOWNLOAD_IDLE_TIMEOUT_MS });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  writeFileSync(path, bytes, { flag: "wx" });
  return bytes.byteLength;
}

export const imageExportCommand = define({
  name: "export",
  description:
    "Render nodes as images (scope: file_content:read). Prints download URLs that expire, or saves the images with --output-dir",
  args: merge(
    fileArgs,
    args({
      node: multiple(
        nodeIdArg("--node", "Node to render (repeatable); defaults to the node in a --file URL"),
      ),
      "image-format": withDefault(
        choice(["png", "jpg", "svg", "pdf"] as const, { description: "Image format" }),
        "png",
      ),
      scale: float({ min: 0.01, max: 4, description: "Scale factor from 0.01 to 4" }),
      version: string({ description: "Version ID to render instead of the current version" }),
      "output-dir": string({
        description: "Directory to save the images in, named by node ID; never overwrites a file",
      }),
    }),
  ),
  examples: `$ figma-api image export --file "https://www.figma.com/design/<key>/<name>?node-id=1-2" --scale 2 --output-dir exports
$ figma-api image export --file <key> --node 1:2 --node 3:4 --image-format svg`,
  run: async (ctx) => {
    const ids = selectedNodeIds(ctx.values.file, ctx.values.node);
    const extension = ctx.values["image-format"];
    const outputDir = ctx.values["output-dir"] ? resolve(ctx.values["output-dir"]) : undefined;

    const existing = outputDir
      ? ids
          .map((id) => join(outputDir, fileNameFor(id, extension)))
          .filter((path) => existsSync(path))
      : [];
    if (existing.length > 0) {
      throw new CliError(`Output files already exist: ${existing.join(", ")}`, {
        code: "INVALID_INPUT",
        why: "figma-cli does not overwrite exported images.",
        hint: "Choose a new --output-dir, or move the existing files first.",
      });
    }
    initCommand(ctx);

    const { data } = await getImages({
      path: { file_key: ctx.values.file.fileKey },
      query: {
        ids: ids.join(","),
        format: extension,
        scale: ctx.values.scale,
        version: ctx.values.version,
      },
    });

    const rows: Row[] = ids.map((id) => {
      const url = data.images[id] ?? null;
      return url === null
        ? { node_id: id, url, error: "Figma could not render this node" }
        : { node_id: id, url };
    });

    if (outputDir) {
      mkdirSync(outputDir, { recursive: true });
      await Promise.all(
        rows.map(async (row) => {
          if (row.url === null) return;
          const path = join(outputDir, fileNameFor(row.node_id, extension));
          try {
            const bytes = await download(row.url, path);
            row.path = path;
            row.bytes = bytes;
          } catch (error) {
            row.error = `Download failed: ${error instanceof Error ? error.message : String(error)}`;
          }
        }),
      );
    }

    const output = JSON.stringify(rows);
    const failed = rows.filter((row) => row.error !== undefined).map((row) => row.node_id);
    if (failed.length === 0) return output;

    await writeOutput(output);
    const someSucceeded = failed.length < rows.length;
    throw new CliError(
      `Could not export ${failed.length} of ${rows.length} nodes: ${failed.join(", ")}`,
      {
        code: someSucceeded ? "PARTIAL_SUCCESS" : "UPSTREAM_FAILURE",
        why: "Figma returned no image for these nodes, or their download failed.",
        hint: "Check that each node exists and is a visible layer, then rerun with only the failed --node values.",
      },
    );
  },
});

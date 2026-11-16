import { define } from "gunshi";
import { args, integer, merge, withDefault } from "gunshi/combinators";

import { fileArgs } from "../../global-args.ts";
import { initCommand } from "../../helpers.ts";
import { getFileVersions } from "../../types/figma/sdk.gen.ts";
import type { Version } from "../../types/figma/types.gen.ts";

const PAGE_SIZE = 50;

export const versionListCommand = define({
  name: "list",
  description: "List a file's versions, newest first (scope: file_versions:read)",
  args: merge(
    fileArgs,
    args({
      limit: withDefault(
        integer({
          min: 1,
          max: Number.MAX_SAFE_INTEGER,
          description: "Maximum number of versions",
        }),
        PAGE_SIZE,
      ),
    }),
  ),
  examples: `$ figma-api version list --file <key> --limit 10`,
  run: async (ctx) => {
    initCommand(ctx);
    const limit = ctx.values.limit;
    const path = { file_key: ctx.values.file.fileKey };
    const versions: Version[] = [];

    let { data } = await getFileVersions({
      path,
      query: { page_size: Math.min(PAGE_SIZE, limit) },
    });
    versions.push(...data.versions);
    // Version IDs exceed Number.MAX_SAFE_INTEGER, so next_page is followed verbatim.
    while (versions.length < limit && data.pagination.next_page) {
      const nextQuery = new URL(data.pagination.next_page).searchParams.toString();
      ({ data } = await getFileVersions({ path, query: {}, querySerializer: () => nextQuery }));
      versions.push(...data.versions);
    }
    versions.splice(limit);

    return JSON.stringify(versions);
  },
});

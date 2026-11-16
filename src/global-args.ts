import { args, boolean, merge, required, string, withDefault } from "gunshi/combinators";

import { fileReferenceArg } from "./cli-input.ts";

export const globalArgs = args({
  profile: string({
    description:
      "Stored profile to use (overrides FIGMA_ACCESS_TOKEN, FIGMA_PROFILE, and the configured default)",
  }),
});

export const fileArgs = merge(
  globalArgs,
  args({
    file: required(
      fileReferenceArg("--file", "File key, or a figma.com URL copied from the file or a layer"),
    ),
  }),
);

export const dryRunArgs = merge(
  fileArgs,
  args({
    "dry-run": withDefault(
      boolean({ description: "Preview the exact write request without writing to Figma" }),
      false,
    ),
  }),
);

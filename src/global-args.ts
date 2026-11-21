import { args, string } from "gunshi/combinators";

export const globalArgs = args({
  profile: string({
    description:
      "Stored profile to use (overrides FIGMA_ACCESS_TOKEN, FIGMA_PROFILE, and the configured default)",
  }),
});

import { define } from "gunshi";

import { globalArgs } from "../../global-args.ts";
import { listProfiles } from "../../profiles.ts";

export const profileListCommand = define({
  name: "list",
  description: "List authenticated profiles and their Figma accounts",
  args: globalArgs,
  run: () => JSON.stringify(listProfiles()),
});

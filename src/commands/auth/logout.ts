import { define } from "gunshi";

import { configDir, loadConfig, saveConfig } from "../../config/config.ts";
import { updateCredentials } from "../../config/credentials.ts";
import { globalArgs } from "../../global-args.ts";
import { resolveConfiguredProfile } from "../../profiles.ts";

export const logoutCommand = define({
  name: "logout",
  description:
    "Remove a profile's stored token (Figma keeps accepting it until it expires or is revoked)",
  args: globalArgs,
  run: async (ctx) => {
    const dir = configDir();
    const profile = resolveConfiguredProfile(ctx.values.profile, dir);
    await updateCredentials(dir, (credentials) => {
      delete credentials[profile];
    });
    const config = loadConfig(dir);
    delete config.profiles[profile];
    saveConfig(dir, config);
    return JSON.stringify({ profile, loggedOut: true });
  },
});

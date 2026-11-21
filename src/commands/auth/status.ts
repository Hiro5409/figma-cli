import { define } from "gunshi";

import { configureClient, getMe } from "../../api/client.ts";
import { configDir } from "../../config/config.ts";
import { CliError, errorHints } from "../../errors.ts";
import { globalArgs } from "../../global-args.ts";
import { accessTokenFor } from "../../helpers.ts";
import { resolveConfiguredTokenSource } from "../../profiles.ts";

export const statusCommand = define({
  name: "status",
  description:
    "Check which token commands use and whether Figma accepts it (scope: current_user:read)",
  args: globalArgs,
  examples: "$ figma-api auth status",
  run: async (ctx) => {
    const dir = configDir();
    const source = resolveConfiguredTokenSource(ctx.values.profile, dir);
    configureClient(accessTokenFor(source, dir));
    const tokenSource = {
      source: source.kind,
      profile: source.kind === "profile" ? source.profile : null,
    };
    const relogin =
      source.kind === "profile"
        ? `figma-api auth login --profile ${source.profile} --replace`
        : "Replace FIGMA_ACCESS_TOKEN with a valid token.";

    const result = await getMe().then(
      ({ data }) => ({ ...tokenSource, status: "ready", handle: data.handle, email: data.email }),
      (error: unknown) => {
        const rejected = error instanceof CliError && error.code === "AUTHENTICATION";
        return {
          ...tokenSource,
          status: rejected ? "login_required" : "unavailable",
          code: error instanceof CliError ? error.code : "UNEXPECTED",
          error: error instanceof Error ? error.message : "Authentication check failed.",
          hint: rejected
            ? relogin
            : ((error instanceof CliError ? error.hint : undefined) ?? errorHints.retryLater),
        };
      },
    );

    return JSON.stringify(result);
  },
});

import { cli, define } from "gunshi";

import { apiCommands } from "./api-commands.ts";
import { commandGroup, requireSubcommand } from "./command-group.ts";
import { loginCommand } from "./commands/auth/login.ts";
import { logoutCommand } from "./commands/auth/logout.ts";
import { statusCommand } from "./commands/auth/status.ts";
import { profileListCommand } from "./commands/profile/list.ts";
import { profileSetDefaultCommand } from "./commands/profile/set-default.ts";
import { printError } from "./error-output.ts";
import { CliError } from "./errors.ts";
import { globalArgs } from "./global-args.ts";
import { writeOutput } from "./output/write.ts";
import { commands as figmaCommands } from "./types/figma/commands.gen.ts";

const generated = apiCommands(figmaCommands);

const commands = {
  auth: commandGroup("auth", "Store, check, and remove personal access tokens", {
    login: loginCommand,
    logout: logoutCommand,
    status: statusCommand,
  }),
  profile: commandGroup("profile", "List stored profiles and choose a default", {
    list: profileListCommand,
    "set-default": profileSetDefaultCommand,
  }),
};
for (const name of Object.keys(generated)) {
  if (name in commands) throw new Error(`A generated command group is named ${name}`);
}

const rootCommand = define({
  name: "figma-api",
  description: "figma-cli - Command line interface for the Figma REST API",
  args: globalArgs,
  examples: `# Store a personal access token
$ figma-api auth login

# Read the comments in a file
$ figma-api file comment list --file-key <key>

# Inspect a request body before writing
$ figma-api schema file comment create`,
  run: requireSubcommand,
});

export async function main() {
  const pkg = await import("../package.json", { with: { type: "json" } });

  await cli(process.argv.slice(2), rootCommand, {
    name: "figma-api",
    version: pkg.default.version,
    subCommands: { ...commands, ...generated },
    strict: true,
    renderHeader: null,
    usageSilent: true,
    renderValidationErrors: null,
    onBeforeCommand: (ctx) => {
      const positionalsAllowed =
        ctx.commandPath.length === 0 ||
        Object.values(ctx.args).some((arg) => arg.type === "positional");
      const extra = [
        ...(positionalsAllowed ? [] : ctx.positionals.slice(ctx.commandPath.length)),
        ...ctx.rest,
      ];
      if (extra.length > 0) {
        throw new CliError(`Unexpected positional argument (${extra.length}).`, {
          code: "INVALID_INPUT",
          why: "This command takes no further positional arguments, so a subcommand name may be misspelled.",
        });
      }
    },
    onAfterCommand: (_ctx, result) => (result ? writeOutput(result) : undefined),
    onErrorCommand: (ctx, error) => {
      printError(error, ctx.commandPath);
    },
  });
}

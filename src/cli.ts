import { cli, define } from "gunshi";
import { renderHeader } from "gunshi/renderer";

import { loginCommand } from "./commands/auth/login.ts";
import { logoutCommand } from "./commands/auth/logout.ts";
import { statusCommand } from "./commands/auth/status.ts";
import { commentCreateCommand } from "./commands/comment/create.ts";
import { commentDeleteCommand } from "./commands/comment/delete.ts";
import { commentListCommand } from "./commands/comment/list.ts";
import { commentReactionAddCommand } from "./commands/comment/reaction-add.ts";
import { commentReactionDeleteCommand } from "./commands/comment/reaction-delete.ts";
import { componentListCommand } from "./commands/component/list.ts";
import { fileMetaCommand } from "./commands/file/meta.ts";
import { fileNodesCommand } from "./commands/file/nodes.ts";
import { fileShowCommand } from "./commands/file/show.ts";
import { imageExportCommand } from "./commands/image/export.ts";
import { imageFillsCommand } from "./commands/image/fills.ts";
import { profileListCommand } from "./commands/profile/list.ts";
import { profileSetDefaultCommand } from "./commands/profile/set-default.ts";
import { styleListCommand } from "./commands/style/list.ts";
import { versionListCommand } from "./commands/version/list.ts";
import { printError } from "./error-output.ts";
import { CliError } from "./errors.ts";
import { globalArgs } from "./global-args.ts";
import { writeOutput } from "./output/write.ts";

function requireSubcommand(): never {
  throw new CliError("A subcommand is required.", {
    code: "INVALID_INPUT",
    why: "This command only groups subcommands.",
  });
}

const commands = {
  auth: define({
    name: "auth",
    description: "Store, check, and remove personal access tokens",
    subCommands: {
      login: loginCommand,
      logout: logoutCommand,
      status: statusCommand,
    },
    run: requireSubcommand,
  }),
  profile: define({
    name: "profile",
    description: "List stored profiles and choose a default",
    subCommands: {
      list: profileListCommand,
      "set-default": profileSetDefaultCommand,
    },
    run: requireSubcommand,
  }),
  file: define({
    name: "file",
    description: "Read file documents, nodes, and metadata",
    subCommands: {
      show: fileShowCommand,
      nodes: fileNodesCommand,
      meta: fileMetaCommand,
    },
    run: requireSubcommand,
  }),
  image: define({
    name: "image",
    description: "Render nodes and fetch image fills",
    subCommands: {
      export: imageExportCommand,
      fills: imageFillsCommand,
    },
    run: requireSubcommand,
  }),
  component: define({
    name: "component",
    description: "List a library file's published components",
    subCommands: {
      list: componentListCommand,
    },
    run: requireSubcommand,
  }),
  style: define({
    name: "style",
    description: "List a library file's published styles",
    subCommands: {
      list: styleListCommand,
    },
    run: requireSubcommand,
  }),
  version: define({
    name: "version",
    description: "Read a file's version history",
    subCommands: {
      list: versionListCommand,
    },
    run: requireSubcommand,
  }),
  comment: define({
    name: "comment",
    description: "Read, post, and delete comments and reactions",
    subCommands: {
      list: commentListCommand,
      create: commentCreateCommand,
      delete: commentDeleteCommand,
      reaction: define({
        name: "reaction",
        description: "Add and remove comment reactions",
        subCommands: {
          add: commentReactionAddCommand,
          delete: commentReactionDeleteCommand,
        },
        run: requireSubcommand,
      }),
    },
    run: requireSubcommand,
  }),
};

const rootCommand = define({
  name: "figma-api",
  description: "figma-cli - Command line interface for the Figma REST API",
  args: globalArgs,
  examples: `# Store a personal access token
$ figma-api auth login

# Read data for automation
$ figma-api comment list --file "https://www.figma.com/design/<key>/<name>"`,
  run: requireSubcommand,
});

export async function main() {
  const pkg = await import("../package.json", { with: { type: "json" } });

  await cli(process.argv.slice(2), rootCommand, {
    name: "figma-api",
    version: pkg.default.version,
    subCommands: commands,
    strict: true,
    renderHeader: (ctx) => {
      if (!ctx.values.help) return Promise.resolve("");
      return renderHeader(ctx);
    },
    renderValidationErrors: null,
    // gunshi has already printed --help and --version output.
    onAfterCommand: (ctx, result) => {
      if (ctx.values.help === true || ctx.values.version === true) return;
      if (result) return writeOutput(result);
    },
    onErrorCommand: (ctx, error) => {
      printError(error, ctx.commandPath);
    },
  });
}

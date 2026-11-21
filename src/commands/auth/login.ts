import * as clack from "@clack/prompts";
import { define } from "gunshi";
import { args, boolean, merge, withDefault } from "gunshi/combinators";

import { configureClient, getMe } from "../../api/client.ts";
import { configDir, loadConfig, saveConfig } from "../../config/config.ts";
import { loadCredentials, updateCredentials } from "../../config/credentials.ts";
import { CliError } from "../../errors.ts";
import { globalArgs } from "../../global-args.ts";
import {
  assertProfileWritable,
  defaultProfileAfterLogin,
  resolveConfiguredLoginProfile,
} from "../../profiles.ts";

const TOKEN_GUIDE =
  "In Figma, open Settings > Security > Personal access tokens and generate a token.\n" +
  "Grant current_user:read, which login uses to verify the token, and the scopes named in the --help of the commands you run.\n" +
  "https://developers.figma.com/docs/rest-api/authentication/";

export type TokenInput = {
  stdin(): Promise<string>;
  prompt(): Promise<string | undefined>;
  interactive: boolean;
};

const terminalTokenInput: TokenInput = {
  stdin: () => Bun.stdin.text(),
  prompt: async () => {
    clack.note(TOKEN_GUIDE, "Figma personal access token", { output: process.stderr });
    const value = await clack.password({
      output: process.stderr,
      message: "Personal access token",
      validate: (input) => tokenProblem(input ?? ""),
    });
    return clack.isCancel(value) ? undefined : value;
  },
  interactive: process.stdin.isTTY === true && process.stderr.isTTY === true,
};

function tokenProblem(token: string): string | undefined {
  if (token.length === 0) return "Paste the token.";
  if (/[\s\p{Cc}]/u.test(token)) return "Paste only the token, without spaces or line breaks.";
  return undefined;
}

async function readToken(fromStdin: boolean, input: TokenInput): Promise<string> {
  let token: string | undefined;
  if (fromStdin) {
    token = (await input.stdin()).trim();
  } else {
    if (!input.interactive) {
      throw new CliError("No terminal is available to enter the token.", {
        code: "INVALID_INPUT",
        why: "Tokens are never accepted as command arguments, which shells and process lists record.",
        hint: 'Pipe the token with "--with-token", or run "figma-api auth login" in a terminal.',
      });
    }
    token = (await input.prompt())?.trim();
    if (token === undefined) {
      throw new CliError("Login cancelled.", { code: "INVALID_INPUT" });
    }
  }

  const problem = tokenProblem(token);
  if (problem) {
    throw new CliError(`The token is invalid: ${problem}`, {
      code: "INVALID_INPUT",
      why: "The input does not look like a single Figma personal access token.",
      hint: TOKEN_GUIDE,
    });
  }
  return token;
}

type LoginValues = {
  profile?: string;
  replace: boolean;
  "set-default": boolean;
  "with-token": boolean;
};

export async function login(values: LoginValues, input = terminalTokenInput): Promise<string> {
  const dir = configDir();
  const storedProfiles = Object.keys(loadCredentials(dir));
  const profile = resolveConfiguredLoginProfile(values.profile, dir);
  assertProfileWritable(profile, storedProfiles, values.replace);

  const token = await readToken(values["with-token"], input);
  configureClient(token);
  const { data: me } = await getMe();

  await updateCredentials(dir, (credentials) => {
    // Another login may have stored this profile while this one waited for the token.
    assertProfileWritable(profile, Object.keys(credentials), values.replace);
    credentials[profile] = { accessToken: token };
  });

  const config = loadConfig(dir);
  config.profiles[profile] = { userId: me.id, handle: me.handle, email: me.email };
  config.activeProfile = defaultProfileAfterLogin(
    config.activeProfile,
    storedProfiles,
    profile,
    values["set-default"],
  );
  saveConfig(dir, config);

  return JSON.stringify({ profile, handle: me.handle, email: me.email, status: "ready" });
}

export const loginCommand = define({
  name: "login",
  description:
    "Verify a Figma personal access token and store it under a profile (scope: current_user:read)",
  args: merge(
    globalArgs,
    args({
      "with-token": withDefault(
        boolean({ description: "Read the token from standard input instead of prompting" }),
        false,
      ),
      replace: withDefault(
        boolean({ description: "Replace the token already stored under this profile name" }),
        false,
      ),
      "set-default": withDefault(
        boolean({ description: "Make this profile the persistent default after login" }),
        false,
      ),
    }),
  ),
  examples: `$ figma-api auth login --profile work
$ op read "op://Private/Figma/credential" | figma-api auth login --profile work --with-token`,
  run: (ctx) => login(ctx.values),
});

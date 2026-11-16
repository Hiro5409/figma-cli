import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import * as v from "valibot";

import { ConfigError } from "../errors.ts";

export function isErrnoException(e: unknown): e is NodeJS.ErrnoException {
  return e instanceof Error && "code" in e;
}

const ProfileSchema = v.strictObject({
  userId: v.string(),
  handle: v.string(),
  email: v.string(),
});

const ConfigSchema = v.strictObject({
  activeProfile: v.optional(v.string(), "default"),
  profiles: v.optional(v.record(v.string(), ProfileSchema), {}),
});

type Config = v.InferOutput<typeof ConfigSchema>;

export function configDir(env: NodeJS.ProcessEnv = process.env): string {
  if (env.FIGMA_CLI_CONFIG_DIR) return env.FIGMA_CLI_CONFIG_DIR;
  const home = env.HOME ?? env.USERPROFILE;
  if (!home) throw new ConfigError("HOME or USERPROFILE is required to locate figma-cli config.");
  return join(home, ".config", "figma-cli");
}

export function readConfigFile<const TSchema extends v.GenericSchema>(
  dir: string,
  name: string,
  schema: TSchema,
): v.InferOutput<TSchema> {
  try {
    const json: unknown = JSON.parse(readFileSync(join(dir, name), "utf-8"));
    return v.parse(schema, json);
  } catch (e) {
    if (isErrnoException(e) && e.code === "ENOENT") return v.parse(schema, {});
    // Parser messages quote the input, which can be a token.
    throw new ConfigError(`Failed to parse ${name}.`, {
      hint: `Fix or delete ${join(dir, name)}, then log in again.`,
    });
  }
}

export function loadConfig(dir: string): Config {
  return readConfigFile(dir, "config.json", ConfigSchema);
}

export function saveConfig(dir: string, config: Config): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "config.json"), `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
}

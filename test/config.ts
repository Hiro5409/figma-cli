import { afterEach, beforeEach } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { saveCredentials } from "../src/config/credentials.ts";
import { MOCK_TOKEN } from "./credentials.ts";

const TOKEN_VARIABLES = ["FIGMA_ACCESS_TOKEN", "FIGMA_PROFILE"] as const;

export function useStoredToken(name: string): string {
  const directory = join(tmpdir(), `figma-cli-${name}-test-${Date.now()}`);
  const saved = new Map<string, string | undefined>();

  beforeEach(() => {
    mkdirSync(directory, { recursive: true });
    saveCredentials(directory, { default: MOCK_TOKEN });
    for (const variable of ["FIGMA_CLI_CONFIG_DIR", ...TOKEN_VARIABLES]) {
      saved.set(variable, process.env[variable]);
    }
    process.env.FIGMA_CLI_CONFIG_DIR = directory;
    for (const variable of TOKEN_VARIABLES) delete process.env[variable];
  });

  afterEach(() => {
    for (const [variable, value] of saved) {
      if (value === undefined) delete process.env[variable];
      else process.env[variable] = value;
    }
    rmSync(directory, { recursive: true, force: true });
  });

  return directory;
}

import { configureClient } from "./api/client.ts";
import { configDir } from "./config/config.ts";
import { loadCredentials } from "./config/credentials.ts";
import { AuthError } from "./errors.ts";
import { resolveConfiguredTokenSource, type TokenSource } from "./profiles.ts";

export function accessTokenFor(source: TokenSource, dir: string): string {
  if (source.kind === "environment") {
    const token = process.env.FIGMA_ACCESS_TOKEN?.trim();
    if (token) return token;
    throw new AuthError("FIGMA_ACCESS_TOKEN is empty.");
  }
  const stored = loadCredentials(dir)[source.profile];
  if (stored) return stored.accessToken;
  throw new AuthError(
    `No credentials for profile "${source.profile}". Run "figma-api auth login --profile ${source.profile}" first.`,
  );
}

export function initCommand(ctx: { values: Record<string, unknown> }): void {
  if (!ctx.values["dry-run"]) {
    const dir = configDir();
    const source = resolveConfiguredTokenSource(ctx.values.profile, dir);
    configureClient(accessTokenFor(source, dir));
  }
}

import { configDir, loadConfig, saveConfig } from "./config/config.ts";
import { loadCredentials } from "./config/credentials.ts";
import { AuthError, ConfigError } from "./errors.ts";

type ProfileSelection = {
  requested?: unknown;
  environment?: string;
  defaultProfile?: string;
  storedProfiles: string[];
};

function nonEmptyString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

// Object keys that Valibot's record schema drops when it reads the stored files back.
const RESERVED_PROFILE_NAMES = new Set(["constructor", "prototype"]);

function validProfileName(value: string): string {
  if (/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(value) && !RESERVED_PROFILE_NAMES.has(value)) {
    return value;
  }
  throw new ConfigError(
    `Invalid profile name "${value}". Use 1-64 letters, numbers, underscores, or hyphens, other than "constructor" or "prototype".`,
  );
}

function selectedProfile(selection: ProfileSelection): string | undefined {
  const selected = nonEmptyString(selection.requested) ?? nonEmptyString(selection.environment);
  return selected ? validProfileName(selected) : undefined;
}

function defaultOrOnlyProfile(
  defaultProfile: string | undefined,
  storedProfiles: string[],
): string | undefined {
  const configured = nonEmptyString(defaultProfile);
  if (configured && storedProfiles.includes(configured)) return configured;
  if (storedProfiles.length === 1) return storedProfiles[0];
  return undefined;
}

function requireStoredProfile(profile: string, storedProfiles: string[]): string {
  if (storedProfiles.includes(profile)) return profile;
  throw new AuthError(
    `No credentials found for profile "${profile}". Run "figma-api auth login --profile ${profile}" first.`,
  );
}

export function resolveProfile(selection: ProfileSelection): string {
  const selected = selectedProfile(selection);
  if (selected) return requireStoredProfile(selected, selection.storedProfiles);

  const defaultProfile = defaultOrOnlyProfile(selection.defaultProfile, selection.storedProfiles);
  if (defaultProfile) return defaultProfile;

  if (selection.storedProfiles.length === 0) {
    throw new AuthError('No credentials found. Run "figma-api auth login --profile <name>" first.');
  }

  throw new ConfigError(
    'Multiple profiles are authenticated. Use --profile, set FIGMA_PROFILE, or run "figma-api profile set-default".',
  );
}

export function resolveLoginProfile(selection: ProfileSelection): string {
  const selected = selectedProfile(selection);
  if (selected) return selected;

  if (selection.storedProfiles.length === 0) return "default";

  const defaultProfile = defaultOrOnlyProfile(selection.defaultProfile, selection.storedProfiles);
  if (defaultProfile) return defaultProfile;

  throw new ConfigError(
    'Multiple profiles are authenticated. Choose the login target with "--profile <name>".',
  );
}

function configuredSelection(
  requested: unknown,
  dir: string,
  environment: string | undefined,
): ProfileSelection {
  const config = loadConfig(dir);
  return {
    requested,
    environment,
    defaultProfile: config.activeProfile,
    storedProfiles: Object.keys(loadCredentials(dir)),
  };
}

export function resolveConfiguredProfile(
  requested: unknown,
  dir: string,
  environment = process.env.FIGMA_PROFILE,
): string {
  return resolveProfile(configuredSelection(requested, dir, environment));
}

export function resolveConfiguredLoginProfile(
  requested: unknown,
  dir: string,
  environment = process.env.FIGMA_PROFILE,
): string {
  return resolveLoginProfile(configuredSelection(requested, dir, environment));
}

export type TokenSource = { kind: "environment" } | { kind: "profile"; profile: string };

export function resolveConfiguredTokenSource(
  requested: unknown,
  dir: string,
  env: NodeJS.ProcessEnv = process.env,
): TokenSource {
  if (nonEmptyString(requested) === undefined && nonEmptyString(env.FIGMA_ACCESS_TOKEN)) {
    return { kind: "environment" };
  }
  return { kind: "profile", profile: resolveConfiguredProfile(requested, dir, env.FIGMA_PROFILE) };
}

export function assertProfileWritable(
  profile: string,
  storedProfiles: string[],
  replace: boolean,
): void {
  if (!replace && storedProfiles.includes(profile)) {
    throw new AuthError(
      `Profile "${profile}" is already authenticated. Use another profile name or pass --replace to store a new token under it.`,
    );
  }
}

export function defaultProfileAfterLogin(
  currentDefault: string,
  storedProfilesBeforeLogin: string[],
  loggedInProfile: string,
  setDefault: boolean,
): string {
  if (setDefault || storedProfilesBeforeLogin.length === 0) return loggedInProfile;
  return defaultOrOnlyProfile(currentDefault, storedProfilesBeforeLogin) ?? currentDefault;
}

export function setDefaultProfile(profile: string, dir = configDir()): void {
  const storedProfiles = Object.keys(loadCredentials(dir));
  requireStoredProfile(profile, storedProfiles);

  const config = loadConfig(dir);
  config.activeProfile = profile;
  saveConfig(dir, config);
}

type ProfileSummary = {
  profile: string;
  default: boolean;
  handle: string | null;
  email: string | null;
};

export function listProfiles(dir = configDir()): ProfileSummary[] {
  const config = loadConfig(dir);
  const storedProfiles = Object.keys(loadCredentials(dir)).sort();
  const effectiveDefault = defaultOrOnlyProfile(config.activeProfile, storedProfiles);

  return storedProfiles.map((profile) => {
    const account = config.profiles[profile];
    return {
      profile,
      default: profile === effectiveDefault,
      handle: account?.handle ?? null,
      email: account?.email ?? null,
    };
  });
}

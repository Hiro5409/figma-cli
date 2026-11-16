import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { loadConfig, saveConfig } from "./config/config.ts";
import { saveCredentials } from "./config/credentials.ts";
import { AuthError, ConfigError } from "./errors.ts";
import {
  assertProfileWritable,
  defaultProfileAfterLogin,
  listProfiles,
  resolveConfiguredTokenSource,
  resolveLoginProfile,
  resolveProfile,
  setDefaultProfile,
} from "./profiles.ts";

const testDir = join(tmpdir(), `figma-cli-profiles-test-${Date.now()}`);

beforeEach(() => {
  mkdirSync(testDir, { recursive: true });
});

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true });
});

const token = { accessToken: "access" };

describe("resolveProfile", () => {
  const storedProfiles = ["personal", "work"];

  test("an explicit profile overrides the environment and default", () => {
    expect(
      resolveProfile({
        requested: "work",
        environment: "personal",
        defaultProfile: "personal",
        storedProfiles,
      }),
    ).toBe("work");
  });

  test("FIGMA_PROFILE overrides the persistent default", () => {
    expect(
      resolveProfile({ environment: "personal", defaultProfile: "work", storedProfiles }),
    ).toBe("personal");
  });

  test("uses the persistent default when it is authenticated", () => {
    expect(resolveProfile({ defaultProfile: "work", storedProfiles })).toBe("work");
  });

  test("uses the only authenticated profile when no default exists", () => {
    expect(resolveProfile({ storedProfiles: ["work"] })).toBe("work");
  });

  test("rejects an unknown explicit profile", () => {
    expect(() => resolveProfile({ requested: "missing", storedProfiles })).toThrow(AuthError);
  });

  test("rejects an ambiguous selection", () => {
    expect(() => resolveProfile({ storedProfiles })).toThrow(ConfigError);
  });
});

describe("resolveConfiguredTokenSource", () => {
  test("an explicit profile wins over FIGMA_ACCESS_TOKEN", () => {
    saveCredentials(testDir, { work: token });
    expect(
      resolveConfiguredTokenSource("work", testDir, { FIGMA_ACCESS_TOKEN: "environment-token" }),
    ).toEqual({ kind: "profile", profile: "work" });
  });

  test("FIGMA_ACCESS_TOKEN wins over FIGMA_PROFILE and the stored default", () => {
    saveCredentials(testDir, { work: token });
    expect(
      resolveConfiguredTokenSource(undefined, testDir, {
        FIGMA_ACCESS_TOKEN: "environment-token",
        FIGMA_PROFILE: "work",
      }),
    ).toEqual({ kind: "environment" });
  });

  test("a blank FIGMA_ACCESS_TOKEN falls back to stored profiles", () => {
    saveCredentials(testDir, { work: token });
    expect(resolveConfiguredTokenSource(undefined, testDir, { FIGMA_ACCESS_TOKEN: "  " })).toEqual({
      kind: "profile",
      profile: "work",
    });
  });

  test("no token anywhere asks for a login", () => {
    expect(() => resolveConfiguredTokenSource(undefined, testDir, {})).toThrow(AuthError);
  });
});

describe("resolveLoginProfile", () => {
  test("uses default for the first login", () => {
    expect(resolveLoginProfile({ storedProfiles: [] })).toBe("default");
  });

  test("uses an explicit name for a new profile", () => {
    expect(resolveLoginProfile({ requested: "work", storedProfiles: ["personal"] })).toBe("work");
  });

  test("rejects profile names that cannot be stored safely", () => {
    expect(() => resolveLoginProfile({ requested: "__proto__", storedProfiles: [] })).toThrow(
      ConfigError,
    );
    expect(() => resolveLoginProfile({ requested: "work profile", storedProfiles: [] })).toThrow(
      ConfigError,
    );
  });

  test.each(["constructor", "prototype"])(
    "rejects %p, which the stored files could not keep",
    (requested) => {
      expect(() => resolveLoginProfile({ requested, storedProfiles: [] })).toThrow(ConfigError);
    },
  );
});

describe("assertProfileWritable", () => {
  test("does not silently replace credentials", () => {
    expect(() => assertProfileWritable("default", ["default"], false)).toThrow(AuthError);
  });

  test("allows an explicit replacement", () => {
    expect(() => assertProfileWritable("default", ["default"], true)).not.toThrow();
  });
});

describe("defaultProfileAfterLogin", () => {
  test("the first profile becomes the default", () => {
    expect(defaultProfileAfterLogin("default", [], "work", false)).toBe("work");
  });

  test("adding a profile preserves the existing default", () => {
    expect(defaultProfileAfterLogin("work", ["work"], "personal", false)).toBe("work");
  });

  test("set-default intentionally changes the default", () => {
    expect(defaultProfileAfterLogin("work", ["work"], "personal", true)).toBe("personal");
  });

  test("preserves the only usable profile when the configured default is stale", () => {
    expect(defaultProfileAfterLogin("missing", ["work"], "personal", false)).toBe("work");
  });
});

describe("stored profile configuration", () => {
  test("lists every authenticated profile with its Figma account", () => {
    saveCredentials(testDir, {
      work: token,
      personal: { accessToken: "other" },
    });
    saveConfig(testDir, {
      activeProfile: "work",
      profiles: {
        work: { userId: "1234567890", handle: "Ada", email: "ada@example.com" },
      },
    });

    expect(listProfiles(testDir)).toEqual([
      { profile: "personal", default: false, handle: null, email: null },
      { profile: "work", default: true, handle: "Ada", email: "ada@example.com" },
    ]);
  });

  test("sets the default only to an authenticated profile", () => {
    saveCredentials(testDir, { work: token });

    setDefaultProfile("work", testDir);
    expect(loadConfig(testDir).activeProfile).toBe("work");
    expect(() => setDefaultProfile("missing", testDir)).toThrow(AuthError);
  });
});

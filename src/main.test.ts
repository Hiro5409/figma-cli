import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

type Result = { stdout: string; stderr: string; exitCode: number };

async function runCli(
  args: string[],
  env: Record<string, string | undefined> = {},
): Promise<Result> {
  const proc = Bun.spawn(["bun", "src/main.ts", ...args], {
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, FIGMA_ACCESS_TOKEN: undefined, FIGMA_PROFILE: undefined, ...env },
  });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const exitCode = await proc.exited;
  return { stdout, stderr, exitCode };
}

async function runCliWithEmptyConfig(args: string[]): Promise<Result> {
  const dir = mkdtempSync(join(tmpdir(), "figma-cli-test-"));
  try {
    return await runCli(args, { FIGMA_CLI_CONFIG_DIR: dir });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("CLI integration", () => {
  test("figma-api --help shows usage with subcommands", async () => {
    const { stdout } = await runCli(["--help"]);
    expect(stdout.split("USAGE:").length - 1).toBe(1);
    expect(stdout).toContain("figma-api");
    expect(stdout).toContain("auth");
    expect(stdout).toContain("comment");
    expect(stdout).toContain("figma-api auth login");
  });

  test("figma-api --version prints the version once", async () => {
    const { stdout } = await runCli(["--version"]);
    expect(stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);
  });

  test("a command group without a subcommand reports a JSON error", async () => {
    for (const args of [[], ["file"], ["comment", "reaction"]]) {
      const { stdout, stderr, exitCode } = await runCliWithEmptyConfig(args);
      expect(exitCode).toBe(1);
      expect(stdout).toBe("");
      const payload = JSON.parse(stderr);
      expect(payload.code).toBe("INVALID_INPUT");
      expect(payload.hint).toContain(["figma-api", ...args, "--help"].join(" "));
    }
  });

  test("every command names the token scope it needs", async () => {
    for (const args of [
      ["auth", "login"],
      ["auth", "status"],
      ["file", "show"],
      ["file", "nodes"],
      ["file", "meta"],
      ["image", "export"],
      ["image", "fills"],
      ["component", "list"],
      ["style", "list"],
      ["version", "list"],
      ["comment", "list"],
      ["comment", "create"],
      ["comment", "delete"],
      ["comment", "reaction", "add"],
      ["comment", "reaction", "delete"],
    ]) {
      const result = await runCli([...args, "--help"]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toMatch(/scope: \w+:(read|write)/);
    }
  });

  test("a read without a token emits a JSON error to stderr", async () => {
    const { stdout, stderr, exitCode } = await runCliWithEmptyConfig(["auth", "status"]);

    expect(exitCode).toBe(2);
    expect(stdout).toBe("");
    const payload = JSON.parse(stderr);
    expect(payload.code).toBe("AUTHENTICATION");
    expect(payload.error).toContain("No credentials found");
    expect(payload.exitCode).toBe(2);
    expect(payload.why).toBe("Authentication credentials are missing or invalid.");
    expect(payload.hint).toContain("figma-api auth login --profile <name>");
    expect(payload.hint).toContain("FIGMA_ACCESS_TOKEN");
  });

  test("a dry run prints its preview to stdout without a token", async () => {
    const { stdout, exitCode } = await runCliWithEmptyConfig([
      "comment",
      "delete",
      "--file",
      "abc123",
      "--id",
      "42",
      "--dry-run",
    ]);

    expect(exitCode).toBe(0);
    expect(JSON.parse(stdout)).toEqual({
      dryRun: true,
      request: { method: "DELETE", path: "/v1/files/abc123/comments/42" },
    });
  });

  test("unknown commands report one error without an internal stack trace", async () => {
    const { stderr, exitCode } = await runCliWithEmptyConfig(["no-such-command"]);

    expect(exitCode).toBe(1);
    expect(stderr.match(/Command not found: no-such-command/g)).toHaveLength(1);
    expect(stderr).not.toContain("TypeError");
    expect(stderr).not.toContain("Bun v");
  });

  test("missing required arguments report one error without an internal stack trace", async () => {
    const { stdout, stderr, exitCode } = await runCliWithEmptyConfig(["comment", "list"]);

    expect(exitCode).toBe(1);
    expect(stdout).toBe("");
    const payload = JSON.parse(stderr);
    expect(payload.error).toContain("Argument '--file' is required");
    expect(payload.why).toContain("command interface");
    expect(payload.hint).toContain("figma-api comment list --help");
    expect(stderr.match(/Argument '--file' is required/g)).toHaveLength(1);
    expect(stderr).not.toContain("TypeError");
  });

  test("unknown options fail before a write command can run", async () => {
    const { stdout, stderr, exitCode } = await runCliWithEmptyConfig([
      "comment",
      "create",
      "--file",
      "abc123",
      "--message",
      "hi",
      "--dryrun",
    ]);

    expect(exitCode).toBe(1);
    expect(stdout).toBe("");
    const payload = JSON.parse(stderr);
    expect(payload.error).toContain("Unknown option: --dryrun");
    expect(stderr).not.toContain("No credentials found");
  });

  test("a file reference that is neither a key nor a Figma URL reports one validation issue", async () => {
    const { stdout, stderr, exitCode } = await runCliWithEmptyConfig([
      "file",
      "meta",
      "--file",
      "https://example.com/design/abc123",
    ]);

    expect(exitCode).toBe(1);
    expect(stdout).toBe("");
    const payload = JSON.parse(stderr);
    expect(payload.error).toContain("--file is invalid");
    expect(payload.error.match(/Expected a Figma file key/g)).toHaveLength(1);
  });
});

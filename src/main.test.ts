import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

type Result = { stdout: string; stderr: string; exitCode: number };

async function runCli(
  args: string[],
  env: Record<string, string | undefined> = {},
  stdin?: string,
): Promise<Result> {
  const proc = Bun.spawn(["bun", "src/main.ts", ...args], {
    stdin: stdin === undefined ? "ignore" : new TextEncoder().encode(stdin),
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

async function runCliWithEmptyConfig(args: string[], stdin?: string): Promise<Result> {
  const dir = mkdtempSync(join(tmpdir(), "figma-cli-test-"));
  try {
    return await runCli(args, { FIGMA_CLI_CONFIG_DIR: dir }, stdin);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("CLI integration", () => {
  test("figma-api --help shows usage with subcommands", async () => {
    const { stdout } = await runCli(["--help"]);
    expect(stdout.split("USAGE:").length - 1).toBe(1);
    for (const name of ["auth", "profile", "file", "image", "webhook", "schema"]) {
      expect(stdout).toContain(name);
    }
    expect(stdout).toContain("figma-api auth login");
  });

  test("figma-api --version prints the version once", async () => {
    const { stdout } = await runCli(["--version"]);
    expect(stdout.trim().split("\n")).toHaveLength(1);
    expect(stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);
  });

  test("a command's help names the token scope it needs", async () => {
    for (const [args, scope] of [
      [["auth", "login"], "scope: current_user:read"],
      [["file", "comment", "create"], "scope: file_comments:write"],
      [["activity-log", "list"], "plan access token; scope: org:activity_log_read"],
    ] as const) {
      const result = await runCli([...args, "--help"]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain(scope);
    }
  });

  test("a command group without a subcommand reports a JSON error", async () => {
    for (const args of [[], ["file"], ["file", "comment", "reaction"]]) {
      const { stdout, stderr, exitCode } = await runCliWithEmptyConfig(args);
      expect(exitCode).toBe(1);
      expect(stdout).toBe("");
      const payload = JSON.parse(stderr);
      expect(payload.code).toBe("INVALID_INPUT");
      expect(payload.error).toBe("A subcommand is required.");
      expect(payload.hint).toContain(["figma-api", ...args, "--help"].join(" "));
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

  test("a dry run prints its preview to stdout as one line of JSON without a token", async () => {
    const { stdout, exitCode } = await runCliWithEmptyConfig([
      "file",
      "comment",
      "delete",
      "--file-key",
      "abc123",
      "--comment-id",
      "42",
      "--dry-run",
    ]);

    expect(exitCode).toBe(0);
    expect(stdout).toBe(
      '{"dryRun":true,"request":{"method":"DELETE","url":"https://api.figma.com/v1/files/abc123/comments/42"}}\n',
    );
  });

  test("--body - reads the request body from standard input", async () => {
    const { stdout, exitCode } = await runCliWithEmptyConfig(
      ["file", "comment", "create", "--file-key", "abc123", "--body", "-", "--dry-run"],
      '{"message":"From stdin"}',
    );

    expect(exitCode).toBe(0);
    expect(JSON.parse(stdout).request.body).toEqual({ message: "From stdin" });
  });

  test("a stray argument stops the command without echoing it", async () => {
    const write = ["file", "comment", "delete", "--file-key", "abc123", "--comment-id", "42"];
    for (const args of [
      [...write, "--dry-run", '{"token":"secret-value"}'],
      [...write, "--", "--dry-run"],
      [...write, "--dry-run", "--", "secret-value"],
    ]) {
      const { stdout, stderr, exitCode } = await runCliWithEmptyConfig(args);

      expect(exitCode).toBe(1);
      expect(stdout).toBe("");
      expect(JSON.parse(stderr).error).toBe("Unexpected positional argument (1).");
      expect(stderr).not.toContain("secret-value");
    }
  });

  test("a misspelled subcommand points to the group's help", async () => {
    const { stderr, exitCode } = await runCliWithEmptyConfig(["file", "coment", "list"]);

    expect(exitCode).toBe(1);
    expect(JSON.parse(stderr).hint).toContain('Run "figma-api file --help"');
  });

  test("a numeric flag must be finite, and an integer within ±(2^53 - 1)", async () => {
    for (const args of [
      ["file", "show", "--file-key", "abc123", "--depth", "Infinity"],
      ["file", "show", "--file-key", "abc123", "--depth", "9007199254740993"],
      ["oembed", "show", "--url", "https://www.figma.com/file/abc123", "--maxwidth", "1e300"],
    ]) {
      const { stdout, stderr, exitCode } = await runCliWithEmptyConfig([...args, "--dry-run"]);

      expect(exitCode).toBe(1);
      expect(stdout).toBe("");
      expect(JSON.parse(stderr).error).toContain("2^53 - 1");
    }
  });

  test("unknown commands report one error without an internal stack trace", async () => {
    const { stderr, exitCode } = await runCliWithEmptyConfig(["no-such-command"]);

    expect(exitCode).toBe(1);
    expect(stderr.match(/Command not found: no-such-command/g)).toHaveLength(1);
    expect(stderr).not.toContain("TypeError");
    expect(stderr).not.toContain("Bun v");
  });

  test("missing required arguments report one error without an internal stack trace", async () => {
    const { stdout, stderr, exitCode } = await runCliWithEmptyConfig(["file", "comment", "list"]);

    expect(exitCode).toBe(1);
    expect(stdout).toBe("");
    const payload = JSON.parse(stderr);
    expect(payload.error).toContain("Argument '--file-key' is required");
    expect(payload.why).toContain("command interface");
    expect(payload.hint).toContain("figma-api file comment list --help");
    expect(stderr.match(/Argument '--file-key' is required/g)).toHaveLength(1);
    expect(stderr).not.toContain("TypeError");
  });

  test("unknown options fail before a write command can run", async () => {
    const { stdout, stderr, exitCode } = await runCliWithEmptyConfig([
      "file",
      "comment",
      "create",
      "--file-key",
      "abc123",
      "--body",
      '{"message":"hi"}',
      "--dryrun",
    ]);

    expect(exitCode).toBe(1);
    expect(stdout).toBe("");
    const payload = JSON.parse(stderr);
    expect(payload.error).toContain("Unknown option: --dryrun");
    expect(stderr).not.toContain("No credentials found");
  });

  test("a request that breaks the API schema reports one validation issue", async () => {
    const { stdout, stderr, exitCode } = await runCliWithEmptyConfig([
      "file",
      "comment",
      "reaction",
      "create",
      "--file-key",
      "abc123",
      "--comment-id",
      "42",
      "--body",
      '{"emoji":1}',
      "--dry-run",
    ]);

    expect(exitCode).toBe(1);
    expect(stdout).toBe("");
    const payload = JSON.parse(stderr);
    expect(payload.code).toBe("INVALID_INPUT");
    expect(payload.error).toBe("Invalid request: body.emoji: expected string");
  });
});

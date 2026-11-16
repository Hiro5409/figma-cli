export const errorHints = {
  authentication:
    'Run "figma-api auth login --profile <name>" with a Figma personal access token, then retry with --profile <name>. Alternatively, set FIGMA_ACCESS_TOKEN.',
  access:
    "Confirm that the token's account can open the file and that the token has the scope listed in the command's --help. Personal access tokens expire; run \"figma-api auth login --profile <name> --replace\" with a new token if this one has.",
  invalidValue: "Correct the value shown in the error and retry the command.",
  notFound:
    "Check the file key or URL, and the node and comment IDs, with a read command such as file meta or comment list, then retry.",
  retryLater:
    "Wait before retrying the same command. Keep the request unchanged until it succeeds.",
} as const;

export type CliErrorCode =
  | "ACCESS_DENIED"
  | "AUTHENTICATION"
  | "CONFIGURATION"
  | "INVALID_INPUT"
  | "NOT_FOUND"
  | "OUTCOME_UNKNOWN"
  | "PARTIAL_SUCCESS"
  | "RATE_LIMITED"
  | "UNEXPECTED"
  | "UPSTREAM_FAILURE";

type CliErrorOptions = {
  cause?: unknown;
  code: CliErrorCode;
  exitCode?: number;
  hint?: string;
  why?: string;
};

export class CliError extends Error {
  readonly code: CliErrorCode;
  readonly exitCode: number;
  readonly why?: string;
  readonly hint?: string;

  constructor(message: string, options: CliErrorOptions) {
    super(message, "cause" in options ? { cause: options.cause } : undefined);
    this.name = "CliError";
    this.code = options.code;
    this.exitCode = options.exitCode ?? 1;
    this.why = options.why;
    this.hint = options.hint;
  }
}

export class AuthError extends CliError {
  constructor(message: string) {
    super(message, {
      code: "AUTHENTICATION",
      exitCode: 2,
      why: "Authentication credentials are missing or invalid.",
      hint: errorHints.authentication,
    });
    this.name = "AuthError";
  }
}

export class ConfigError extends CliError {
  constructor(message: string, options: { hint?: string } = {}) {
    super(message, { code: "CONFIGURATION", exitCode: 3, hint: options.hint });
    this.name = "ConfigError";
  }
}

export class OutcomeUnknownError extends CliError {
  constructor(message: string, options: { cause?: unknown } = {}) {
    super(message, {
      code: "OUTCOME_UNKNOWN",
      cause: options.cause,
      why: "Figma may have accepted the write before figma-cli lost confirmation.",
      hint: "Inspect the affected comment or reaction in Figma before retrying. Do not retry automatically.",
    });
    this.name = "OutcomeUnknownError";
  }
}

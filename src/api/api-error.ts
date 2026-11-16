import { CliError, type CliErrorCode, errorHints } from "../errors.ts";

type FigmaApiErrorContext = {
  headers?: Headers;
  status?: number;
};

type Guidance = {
  code: CliErrorCode;
  exitCode?: number;
  hint: string;
  why: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function messageFrom(error: unknown): string | undefined {
  if (!isRecord(error)) return error instanceof Error ? error.message : undefined;
  for (const key of ["err", "message"]) {
    const value = error[key];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return undefined;
}

function stringifyUnknown(value: unknown): string {
  try {
    const serialized: unknown = JSON.stringify(value);
    return typeof serialized === "string" ? serialized : String(value);
  } catch {
    return String(value);
  }
}

export function retryAfterSeconds(
  headers: Headers | undefined,
  now = Date.now(),
): number | undefined {
  const value = headers?.get("retry-after")?.trim();
  if (!value) return undefined;
  if (/^\d+$/.test(value)) return Number(value);
  const date = Date.parse(value);
  return Number.isNaN(date) ? undefined : Math.max(0, Math.ceil((date - now) / 1000));
}

function rateLimitGuidance(headers: Headers | undefined): Guidance {
  const wait = retryAfterSeconds(headers);
  const tier = headers?.get("x-figma-plan-tier");
  const limitType = headers?.get("x-figma-rate-limit-type");
  const scope = [tier && `plan tier ${tier}`, limitType && `${limitType} rate limit`]
    .filter(Boolean)
    .join(", ");
  return {
    code: "RATE_LIMITED",
    why: `Figma rate-limited the request${scope ? ` (${scope})` : ""}.`,
    hint:
      wait === undefined
        ? errorHints.retryLater
        : `Wait ${wait} seconds before retrying the same command. Keep the request unchanged until it succeeds.`,
  };
}

function guidance(status: number, message: string | undefined, headers?: Headers): Guidance {
  // Figma reports a missing, malformed, or expired token as 403 rather than 401.
  if (status === 401 || (status === 403 && /\btoken\b/i.test(message ?? ""))) {
    return {
      code: "AUTHENTICATION",
      exitCode: 2,
      why: "Figma rejected the access token.",
      hint: errorHints.authentication,
    };
  }
  if (status === 403) {
    return {
      code: "ACCESS_DENIED",
      exitCode: 2,
      why: "The token cannot access this file or lacks the scope this request needs.",
      hint: errorHints.access,
    };
  }
  if (status === 404) {
    return {
      code: "NOT_FOUND",
      why: "Figma could not find the requested file, node, or comment.",
      hint: errorHints.notFound,
    };
  }
  if (status === 429) return rateLimitGuidance(headers);
  if (status < 400) {
    return {
      code: "UPSTREAM_FAILURE",
      why: "Figma answered with a response figma-cli could not read.",
      hint: errorHints.retryLater,
    };
  }
  if (status >= 500) {
    return {
      code: "UPSTREAM_FAILURE",
      why: "Figma could not complete the request.",
      hint: errorHints.retryLater,
    };
  }
  return {
    code: "INVALID_INPUT",
    why: "Figma rejected the request parameters.",
    hint: errorHints.invalidValue,
  };
}

export function figmaApiError(error: unknown, context: FigmaApiErrorContext = {}): CliError {
  if (error instanceof CliError) return error;

  const message = messageFrom(error);
  const detail = message ?? stringifyUnknown(error);
  if (context.status === undefined) {
    return new CliError(`Figma API request failed: ${detail}`, {
      cause: error,
      ...guidance(503, message),
    });
  }

  return new CliError(`Figma API error (${context.status}): ${detail}`, {
    cause: error,
    ...guidance(context.status, message, context.headers),
  });
}

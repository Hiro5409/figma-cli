import ky, { isHTTPError } from "ky";

import { OutcomeUnknownError } from "../errors.ts";
import { client } from "../types/figma/client.gen.ts";
import { figmaApiError, retryAfterSeconds } from "./api-error.ts";

export { client };

const MAX_RETRY_AFTER_SECONDS = 60;
const REQUEST_TIMEOUT_MS = 120_000;

// Only reads are safe to retry automatically; a retried write can post a comment twice.
const apiFetch = Object.assign(
  async (request: Parameters<typeof fetch>[0]) => {
    try {
      return await ky(request, {
        retry: {
          methods: ["get", "head"],
          shouldRetry: ({ error }) => {
            if (!isHTTPError(error) || error.response.status !== 429) return undefined;
            const wait = retryAfterSeconds(error.response.headers);
            return wait !== undefined && wait > MAX_RETRY_AFTER_SECONDS ? false : undefined;
          },
        },
        timeout: REQUEST_TIMEOUT_MS,
      });
    } catch (error) {
      if (
        request instanceof Request &&
        isWrite(request) &&
        (!isHTTPError(error) || error.response.status === 408 || error.response.status >= 500)
      ) {
        const detail = isHTTPError(error)
          ? figmaApiError(error.data ?? error, { status: error.response.status }).message
          : error instanceof Error
            ? error.name
            : "Transport error";
        throw new OutcomeUnknownError(`Could not confirm the Figma API write: ${detail}`, {
          cause: error,
        });
      }
      throw error;
    }
  },
  { preconnect: fetch.preconnect },
);

function isWrite(request: Request): boolean {
  return request.method !== "GET" && request.method !== "HEAD";
}

export function configureClient(accessToken: string): void {
  client.setConfig({ fetch: apiFetch, headers: { "X-Figma-Token": accessToken } });
  client.interceptors.error.clear();
  client.interceptors.error.use((error, response, request) => {
    if (request && isWrite(request) && response?.ok) {
      return new OutcomeUnknownError("Could not read the Figma API write response.", {
        cause: error,
      });
    }
    if (isHTTPError(error)) {
      return figmaApiError(error.data ?? error, {
        status: error.response.status,
        headers: error.response.headers,
      });
    }
    return figmaApiError(error, { status: response?.status, headers: response?.headers });
  });
}

import ky, { isHTTPError } from "ky";

import { OutcomeUnknownError } from "../errors.ts";
import { client } from "../types/figma/client.gen.ts";
import type { GetMeErrors, GetMeResponses } from "../types/figma/types.gen.ts";
import { figmaApiError, retryAfterSeconds } from "./api-error.ts";

export { client };

export const getMe = () => client.get<GetMeResponses, GetMeErrors, true>({ url: "/v1/me" });

const MAX_RETRY_AFTER_SECONDS = 60;
const REQUEST_TIMEOUT_MS = 120_000;

// Only reads are retried: a retried write can apply twice, such as posting a comment twice.
const apiFetch = Object.assign(
  async (request: Parameters<typeof fetch>[0]) => {
    try {
      return await ky(request, {
        retry: {
          methods:
            request instanceof Request && !isWrite(request) ? [request.method.toLowerCase()] : [],
          shouldRetry: ({ error }) => {
            if (!isHTTPError(error) || error.response.status !== 429) return undefined;
            const wait = retryAfterSeconds(error.response.headers);
            return wait !== undefined && wait > MAX_RETRY_AFTER_SECONDS ? false : undefined;
          },
        },
        timeout: REQUEST_TIMEOUT_MS,
        // A cross-origin redirect would forward X-Figma-Token, which fetch does not strip.
        redirect: "error",
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

// Figma searches developer logs with POST.
const READS_SENT_AS_POST = new Set(["/v1/developer_logs"]);

function isWrite(request: Request): boolean {
  if (request.method === "GET" || request.method === "HEAD") return false;
  return !(request.method === "POST" && READS_SENT_AS_POST.has(new URL(request.url).pathname));
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

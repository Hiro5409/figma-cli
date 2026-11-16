import { describe, expect, test } from "bun:test";
import { fileURLToPath } from "node:url";

import {
  classifyChanges,
  collectUsedEndpoints,
  extractImportedSdkOperations,
  extractPinnedRevision,
  extractSdkEndpoints,
  parseOasChanges,
} from "./check-api-schema.ts";

describe("extractPinnedRevision", () => {
  test("extracts the Figma schema commit from the raw GitHub URL", () => {
    expect(
      extractPinnedRevision(`
        const figmaApiSchemaUrl =
          "https://raw.githubusercontent.com/figma/rest-api-spec/0123456789abcdef0123456789abcdef01234567/openapi/openapi.yaml";
      `),
    ).toBe("0123456789abcdef0123456789abcdef01234567");
  });

  test("rejects a config without a pinned commit", () => {
    expect(() =>
      extractPinnedRevision(
        'const url = "https://raw.githubusercontent.com/figma/rest-api-spec/main/openapi/openapi.yaml";',
      ),
    ).toThrow("Cannot find the pinned Figma API schema commit");
  });
});

describe("extractSdkEndpoints", () => {
  test("maps generated SDK functions to their HTTP method and path", () => {
    expect(
      extractSdkEndpoints(`
        export const getThing = <ThrowOnError extends boolean = true>(
          options: Options<GetThingData, ThrowOnError>,
        ) =>
          (options.client ?? client).get({
            url: "/v1/things/{id}",
            ...options,
          });

        export const createThing = <ThrowOnError extends boolean = true>(options: {}) =>
          (options.client ?? client).post({
            url: "/v1/things",
          });

        export const listCompanies = <ThrowOnError extends boolean = true>(
          options?: Options<ListCompaniesData, ThrowOnError>,
        ) =>
          (options?.client ?? client).get({
            url: "/v1/companies",
          });
      `),
    ).toEqual(
      new Map([
        ["getThing", { method: "GET", path: "/v1/things/{id}" }],
        ["createThing", { method: "POST", path: "/v1/things" }],
        ["listCompanies", { method: "GET", path: "/v1/companies" }],
      ]),
    );
  });
});

describe("extractImportedSdkOperations", () => {
  test("finds generated SDK functions used by production source", () => {
    expect(
      extractImportedSdkOperations(`
        import { define } from "gunshi";

        import {
          getThing,
          updateThing as saveThing,
        } from "../../types/figma/sdk.gen.ts";
        import { postComment } from '../../types/figma/sdk.gen.ts';
      `),
    ).toEqual(["getThing", "updateThing", "postComment"]);
  });

  test("maps every generated SDK function imported by production source", async () => {
    const repoRoot = fileURLToPath(new URL("..", import.meta.url));
    const usedEndpoints = await collectUsedEndpoints(repoRoot);

    expect(usedEndpoints).toContain("POST /v1/files/{file_key}/comments");
  });

  test("rejects SDK module references that it cannot classify", () => {
    expect(() =>
      extractImportedSdkOperations(`
        import { getThing } from "../../types/figma/sdk.gen.ts";
        import * as sdk from "../../types/figma/sdk.gen.ts";
      `),
    ).toThrow("Unsupported generated SDK import or export");

    expect(() =>
      extractImportedSdkOperations(`
        export { getThing } from "../../types/figma/sdk.gen.ts";
      `),
    ).toThrow("Unsupported generated SDK import or export");
  });
});

describe("classifyChanges", () => {
  test("reports every new endpoint as a feature opportunity", () => {
    const result = classifyChanges(
      [
        {
          id: "endpoint-added",
          text: "endpoint added",
          level: 1,
          operation: "POST",
          path: "/v1/new-things",
        },
      ],
      new Set(),
    );

    expect(result.opportunities).toHaveLength(1);
    expect(result.apiWideChanges).toEqual([]);
    expect(result.usedOperationChanges).toEqual([]);
  });

  test("reports WARN and ERR changes only for endpoints used by the CLI", () => {
    const result = classifyChanges(
      [
        {
          id: "request-property-became-required",
          text: "required request property added",
          level: 3,
          operation: "PUT",
          path: "/v1/used/{id}",
        },
        {
          id: "response-property-max-increased",
          text: "response maximum increased",
          level: 1,
          operation: "PUT",
          path: "/v1/used/{id}",
        },
        {
          id: "response-property-max-increased",
          text: "response maximum increased",
          level: 3,
          operation: "GET",
          path: "/v1/unused",
        },
      ],
      new Set(["PUT /v1/used/{id}"]),
    );

    expect(result.opportunities).toEqual([]);
    expect(result.apiWideChanges).toEqual([]);
    expect(result.usedOperationChanges).toEqual([
      expect.objectContaining({ path: "/v1/used/{id}" }),
    ]);
  });

  test("reports API-wide changes when the CLI uses that API", () => {
    const globalSecurityChange = {
      id: "api-global-security-added",
      text: "security scheme added",
      level: 1,
    };

    expect(classifyChanges([globalSecurityChange], new Set(["GET /v1/used"]))).toEqual({
      opportunities: [],
      apiWideChanges: [globalSecurityChange],
      usedOperationChanges: [],
    });
    expect(classifyChanges([globalSecurityChange], new Set()).apiWideChanges).toEqual([]);
  });

  test("detects a method or path replacement even when the operation ID stays the same", () => {
    const result = classifyChanges(
      [
        {
          id: "api-path-removed-without-deprecation",
          text: "endpoint removed",
          level: 3,
          operation: "GET",
          operationId: "get_thing",
          path: "/v1/old",
        },
        {
          id: "endpoint-added",
          text: "endpoint added",
          level: 1,
          operation: "POST",
          operationId: "get_thing",
          path: "/v1/new",
        },
      ],
      new Set(["GET /v1/old"]),
    );

    expect(result.usedOperationChanges).toHaveLength(1);
    expect(result.opportunities).toHaveLength(1);
    expect(result.apiWideChanges).toEqual([]);
  });
});

describe("parseOasChanges", () => {
  test("rejects JSON that does not match the oasdiff changelog contract", () => {
    expect(() => parseOasChanges('{"id":"endpoint-added"}')).toThrow(
      "Cannot parse the oasdiff changelog JSON",
    );
  });
});

import { describe, expect, test } from "bun:test";

import { extractPinnedRevision, parseOasChanges } from "./check-api-schema.ts";

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

describe("parseOasChanges", () => {
  test("rejects JSON that does not match the oasdiff changelog contract", () => {
    expect(() => parseOasChanges('{"id":"endpoint-added"}')).toThrow(
      "Cannot parse the oasdiff changelog JSON",
    );
  });
});

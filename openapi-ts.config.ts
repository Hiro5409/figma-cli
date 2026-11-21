import { defineConfig } from "@hey-api/openapi-ts";

import { defineConfig as commands } from "./codegen/commands-plugin.ts";

const figmaApiSchemaUrl =
  "https://raw.githubusercontent.com/figma/rest-api-spec/af027cd20aca8326a41115e4d15bbdf875158e81/openapi/openapi.yaml";

const tokenSchemes = ["PersonalAccessToken", "PlanAccessToken"];

export default defineConfig({
  input: figmaApiSchemaUrl,
  output: {
    path: "src/types/figma",
    postProcess: [{ command: "bun", args: ["fmt", "{{path}}"] }],
  },
  parser: {
    filters: { deprecated: false },
    patch: {
      operations: (method, path, operation) => {
        // figma-cli sends X-Figma-Token, which cannot call an operation that accepts only OAuth.
        const security = "security" in operation ? operation.security : undefined;
        if (!security?.some((scheme) => tokenSchemes.some((name) => name in scheme))) {
          operation.deprecated = true;
        }
        // Figma documents every field of a webhook update as optional; the schema requires four.
        if (method === "put" && path === "/v2/webhooks/{webhook_id}") {
          const body = "requestBody" in operation ? operation.requestBody : undefined;
          const schema =
            body && !("$ref" in body) ? body.content["application/json"]?.schema : undefined;
          if (
            !schema ||
            typeof schema !== "object" ||
            "$ref" in schema ||
            schema.required?.join() !== "event_type,team_id,endpoint,passcode"
          ) {
            throw new Error("Review the request body of PUT /v2/webhooks/{webhook_id}");
          }
          delete schema.required;
        }
        // Version IDs exceed 2^53, but the schema types the version cursors as numbers.
        if (method === "get" && path === "/v1/files/{file_key}/versions") {
          const parameters = "parameters" in operation ? (operation.parameters ?? []) : [];
          for (const name of ["before", "after"]) {
            const parameter = parameters.find((item) => "name" in item && item.name === name);
            const schema = parameter && "schema" in parameter ? parameter.schema : undefined;
            if (!schema || "$ref" in schema || schema.type !== "number") {
              throw new Error(`Review the ${name} parameter of GET /v1/files/{file_key}/versions`);
            }
            schema.type = "string";
          }
        }
      },
    },
  },
  plugins: [
    { name: "@hey-api/typescript", comments: false },
    { name: "@hey-api/client-fetch", throwOnError: true },
    { name: "msw", comments: false },
    { name: "valibot", comments: false, requests: { shouldExtract: true } },
    commands(),
  ],
});

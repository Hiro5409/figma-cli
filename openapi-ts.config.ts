import { defineConfig } from "@hey-api/openapi-ts";

const figmaApiSchemaUrl =
  "https://raw.githubusercontent.com/figma/rest-api-spec/af027cd20aca8326a41115e4d15bbdf875158e81/openapi/openapi.yaml";

export default defineConfig({
  input: figmaApiSchemaUrl,
  output: {
    path: "src/types/figma",
    postProcess: [{ name: "Vite+ format", command: "vp", args: ["fmt", "{{path}}"] }],
  },
  parser: {
    filters: {
      deprecated: false,
    },
  },
  plugins: [
    "@hey-api/typescript",
    { name: "@hey-api/client-fetch", throwOnError: true },
    "@hey-api/sdk",
    "msw",
  ],
});

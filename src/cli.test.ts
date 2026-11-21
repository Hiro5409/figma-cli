import { afterAll, afterEach, beforeAll, describe, expect, spyOn, test } from "bun:test";

import { HttpResponse } from "msw/http";

import { useStoredToken } from "../test/config.ts";
import { createNetwork } from "../test/network.ts";
import { main } from "./cli.ts";
import { handleGetFile } from "./types/figma/msw.gen.ts";

const network = createNetwork(
  handleGetFile(({ request }) =>
    HttpResponse.json({ version: new URL(request.url).searchParams.get("version") } as never),
  ),
);
useStoredToken("cli");

const argv = process.argv;
const stdout = spyOn(process.stdout, "write").mockImplementation(
  (_chunk: unknown, callback?: unknown) => {
    if (typeof callback === "function") callback();
    return true;
  },
);

beforeAll(() => network.enable());
afterAll(() => {
  network.disable();
  stdout.mockRestore();
});
afterEach(() => {
  process.argv = argv;
  stdout.mockClear();
});

describe("figma-api", () => {
  test("--version on a command is the API parameter, not the CLI version", async () => {
    process.argv = [
      argv[0] ?? "bun",
      "figma-api",
      "file",
      "show",
      "--file-key",
      "K",
      "--version",
      "42",
    ];
    await main();
    const output = stdout.mock.calls.map(([chunk]) => String(chunk)).join("");
    expect(JSON.parse(output)).toEqual({ version: "42" });
  });
});

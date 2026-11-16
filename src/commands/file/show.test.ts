import { afterAll, afterEach, beforeAll, describe, expect, mock, test } from "bun:test";

import { cli } from "gunshi";
import { HttpResponse } from "msw/http";

import { useStoredToken } from "../../../test/config.ts";
import { figmaFile } from "../../../test/figma-file.ts";
import { createNetwork } from "../../../test/network.ts";
import { handleGetFile } from "../../types/figma/msw.gen.ts";
import { fileShowCommand } from "./show.ts";

const onFile = mock();
const network = createNetwork(
  handleGetFile(({ request }) => {
    onFile(new URL(request.url).searchParams.get("ids"));
    return HttpResponse.json(figmaFile());
  }),
);
useStoredToken("file-show");

beforeAll(() => network.enable());
afterAll(() => network.disable());
afterEach(() => onFile.mockClear());

describe("file show command", () => {
  test("reads only the paths to the node in a copied link", async () => {
    await cli(["--file", "https://www.figma.com/design/abc123/T?node-id=1-2"], fileShowCommand);
    expect(onFile).toHaveBeenCalledWith("1:2");
  });

  test("reads the whole file from a bare key", async () => {
    await cli(["--file", "abc123"], fileShowCommand);
    expect(onFile).toHaveBeenCalledWith(null);
  });
});

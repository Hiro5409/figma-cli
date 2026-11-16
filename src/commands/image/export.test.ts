import { afterAll, afterEach, beforeAll, describe, expect, mock, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { cli } from "gunshi";
import { HttpResponse, http } from "msw/http";

import { useStoredToken } from "../../../test/config.ts";
import { createNetwork } from "../../../test/network.ts";
import { handleGetImages } from "../../types/figma/msw.gen.ts";
import { imageExportCommand } from "./export.ts";

const STORAGE = "https://figma-alpha-api.s3.us-west-2.amazonaws.com/images";
const onRender = mock();
const onDownload = mock();
const network = createNetwork(
  handleGetImages(({ request }) => {
    const query = new URL(request.url).searchParams;
    onRender({ ids: query.get("ids"), format: query.get("format"), scale: query.get("scale") });
    return HttpResponse.json({
      err: null,
      images: { "1:2": `${STORAGE}/one`, "I3:4;5:6": `${STORAGE}/two`, "7:8": null },
    });
  }),
  http.get(`${STORAGE}/:name`, ({ request, params }) => {
    onDownload({ name: params.name, token: request.headers.get("X-Figma-Token") });
    return HttpResponse.arrayBuffer(new TextEncoder().encode(`png ${String(params.name)}`).buffer);
  }),
);
const directory = useStoredToken("image-export");

beforeAll(() => network.enable());
afterAll(() => network.disable());
afterEach(() => {
  onRender.mockClear();
  onDownload.mockClear();
});

describe("image export command", () => {
  test("renders the node in a copied link and prints its URL", async () => {
    const result = await cli(
      ["--file", "https://www.figma.com/design/abc123/T?node-id=1-2", "--scale", "2"],
      imageExportCommand,
    );
    expect(onRender).toHaveBeenCalledWith({ ids: "1:2", format: "png", scale: "2" });
    expect(JSON.parse(String(result))).toEqual([{ node_id: "1:2", url: `${STORAGE}/one` }]);
    expect(onDownload).not.toHaveBeenCalled();
  });

  test("saves each image under its node ID without sending the token to storage", async () => {
    const outputDir = join(directory, "exports");
    const result = await cli(
      ["--file", "abc123", "--node", "1:2", "--node", "I3:4;5:6", "--output-dir", outputDir],
      imageExportCommand,
    );

    expect(onDownload.mock.calls.map(([call]) => call.token)).toEqual([null, null]);
    expect(readFileSync(join(outputDir, "1-2.png"), "utf8")).toBe("png one");
    expect(readFileSync(join(outputDir, "I3-4_5-6.png"), "utf8")).toBe("png two");
    expect(JSON.parse(String(result))).toEqual([
      { node_id: "1:2", url: `${STORAGE}/one`, path: join(outputDir, "1-2.png"), bytes: 7 },
      {
        node_id: "I3:4;5:6",
        url: `${STORAGE}/two`,
        path: join(outputDir, "I3-4_5-6.png"),
        bytes: 7,
      },
    ]);
  });

  test("refuses to overwrite an image before asking Figma to render", async () => {
    const outputDir = join(directory, "existing");
    mkdirSync(outputDir, { recursive: true });
    writeFileSync(join(outputDir, "1-2.png"), "keep");

    await expect(
      cli(["--file", "abc123", "--node", "1:2", "--output-dir", outputDir], imageExportCommand),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(onRender).not.toHaveBeenCalled();
    expect(readFileSync(join(outputDir, "1-2.png"), "utf8")).toBe("keep");
  });

  test("reports nodes Figma could not render after saving the others", async () => {
    const outputDir = join(directory, "partial");
    await expect(
      cli(
        ["--file", "abc123", "--node", "1:2", "--node", "7:8", "--output-dir", outputDir],
        imageExportCommand,
      ),
    ).rejects.toMatchObject({ code: "PARTIAL_SUCCESS", message: expect.stringContaining("7:8") });
    expect(existsSync(join(outputDir, "1-2.png"))).toBe(true);
  });

  test("fails without claiming partial success when no node renders", async () => {
    await expect(
      cli(["--file", "abc123", "--node", "7:8"], imageExportCommand),
    ).rejects.toMatchObject({
      code: "UPSTREAM_FAILURE",
      message: expect.stringContaining("1 of 1 nodes: 7:8"),
    });
  });
});

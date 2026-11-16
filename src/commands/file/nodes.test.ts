import { afterAll, afterEach, beforeAll, describe, expect, mock, test } from "bun:test";

import { cli } from "gunshi";
import { HttpResponse } from "msw/http";

import { useStoredToken } from "../../../test/config.ts";
import { createNetwork } from "../../../test/network.ts";
import { handleGetFileNodes } from "../../types/figma/msw.gen.ts";
import { fileNodesCommand } from "./nodes.ts";

const onNodes = mock();
const network = createNetwork(
  handleGetFileNodes(({ request }) => {
    const query = new URL(request.url).searchParams;
    onNodes({ ids: query.get("ids"), depth: query.get("depth") });
    return HttpResponse.json({
      name: "Test",
      role: "owner",
      lastModified: "2026-11-16T00:00:00Z",
      editorType: "figma",
      thumbnailUrl: "https://example.com/thumb.png",
      version: "1",
      nodes: {
        "1:2": {
          document: { id: "1:2", name: "Hero", type: "FRAME" },
          components: {},
          componentSets: {},
          schemaVersion: 0,
          styles: {},
        },
      },
    });
  }),
);
useStoredToken("file-nodes");

beforeAll(() => network.enable());
afterAll(() => network.disable());
afterEach(() => onNodes.mockClear());

describe("file nodes command", () => {
  test("reads the node named by a copied link", async () => {
    await cli(
      ["--file", "https://www.figma.com/design/abc123/T?node-id=1-2", "--depth", "1"],
      fileNodesCommand,
    );
    expect(onNodes).toHaveBeenCalledWith({ ids: "1:2", depth: "1" });
  });

  test("needs a node before reading credentials", async () => {
    await expect(cli(["--file", "abc123"], fileNodesCommand)).rejects.toThrow("No node selected.");
    expect(onNodes).not.toHaveBeenCalled();
  });
});

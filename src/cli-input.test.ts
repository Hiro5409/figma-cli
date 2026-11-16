import { describe, expect, test } from "bun:test";

import { fileReferenceArg, nodeIdArg, selectedNodeIds } from "./cli-input.ts";
import { CliError } from "./errors.ts";

const file = fileReferenceArg("--file", "File");
const node = nodeIdArg("--node", "Node");

describe("file references", () => {
  test("accepts a bare file key", () => {
    expect(file.parse("abc123")).toEqual({ fileKey: "abc123" });
  });

  test("reads the file key and node from a copied link", () => {
    expect(file.parse("https://www.figma.com/design/abc123/Test?node-id=12-345&t=x-1")).toEqual({
      fileKey: "abc123",
      nodeId: "12:345",
    });
  });

  test("addresses a branch by its own key", () => {
    expect(file.parse("https://figma.com/design/mainKey123/branch/branchKey456/Test")).toEqual({
      fileKey: "branchKey456",
    });
  });

  test("keeps the node of a layer inside an instance", () => {
    expect(file.parse("https://www.figma.com/board/abc123/Board?node-id=I1-2;3-4")).toEqual({
      fileKey: "abc123",
      nodeId: "I1:2;3:4",
    });
  });

  test.each([
    "https://evil.example/design/abc123/Test",
    "http://www.figma.com/design/abc123/Test",
    "https://www.figma.com/community/file/abc123",
    "https://www.figma.com/design/abc123/Test?node-id=frame",
    "abc/123",
    "",
  ])("rejects %p before calling the API", (value) => {
    expect(() => file.parse(value)).toThrow(CliError);
  });
});

describe("node IDs", () => {
  test("accepts API and URL spellings", () => {
    expect(node.parse("1:2")).toBe("1:2");
    expect(node.parse("1-2")).toBe("1:2");
    expect(node.parse("I1:2;3:4")).toBe("I1:2;3:4");
  });

  test("rejects other text with the expected form", () => {
    expect(() => node.parse("Frame 1")).toThrow('Expected a node ID such as "1:2" or "1-2".');
  });

  test("uses explicit nodes before the URL's node and removes duplicates", () => {
    const reference = { fileKey: "abc123", nodeId: "9:9" };
    expect(selectedNodeIds(reference, ["1:2", "1:2", "3:4"])).toEqual(["1:2", "3:4"]);
    expect(selectedNodeIds(reference, undefined)).toEqual(["9:9"]);
    expect(() => selectedNodeIds({ fileKey: "abc123" }, [])).toThrow("No node selected.");
  });
});

import { combinator } from "gunshi/combinators";
import * as v from "valibot";

import { CliError, errorHints } from "./errors.ts";

export type FileReference = {
  fileKey: string;
  nodeId?: string;
};

const FILE_KEY_TEXT = /^[A-Za-z0-9]+$/;
// A node ID such as 1:2, or I1:2;3:4 for a layer inside an instance. URLs write ":" as "-".
const NODE_ID_TEXT = /^I?\d+:\d+(?:;\d+:\d+)*$/;
const URL_NODE_ID_TEXT = /^I?\d+-\d+(?:;\d+-\d+)*$/;
const FILE_URL_KINDS = new Set(["design", "file", "board", "slides", "proto"]);
const FILE_REFERENCE_MESSAGE =
  "Expected a Figma file key or a figma.com design, board, slides, or prototype URL.";
const NODE_ID_MESSAGE = 'Expected a node ID such as "1:2" or "1-2".';

function normalizeNodeId(text: string): string | undefined {
  if (NODE_ID_TEXT.test(text)) return text;
  if (URL_NODE_ID_TEXT.test(text)) return text.replaceAll("-", ":");
  return undefined;
}

function parseFileUrl(text: string): FileReference | undefined {
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return undefined;
  }
  if (url.protocol !== "https:" || !["figma.com", "www.figma.com"].includes(url.hostname)) {
    return undefined;
  }

  const [kind, fileKey, branch, branchKey] = url.pathname.split("/").filter(Boolean);
  if (!kind || !FILE_URL_KINDS.has(kind) || !fileKey || !FILE_KEY_TEXT.test(fileKey)) {
    return undefined;
  }
  // A branch URL names the main file first; the REST API addresses the branch by its own key.
  const key =
    branch === "branch" && branchKey && FILE_KEY_TEXT.test(branchKey) ? branchKey : fileKey;

  const nodeIdText = url.searchParams.get("node-id");
  if (nodeIdText === null) return { fileKey: key };
  const nodeId = normalizeNodeId(nodeIdText);
  return nodeId === undefined ? undefined : { fileKey: key, nodeId };
}

const FileReferenceSchema = v.pipe(
  v.string(FILE_REFERENCE_MESSAGE),
  v.trim(),
  v.rawTransform(({ dataset, addIssue, NEVER }) => {
    const text = dataset.value;
    const reference = FILE_KEY_TEXT.test(text) ? { fileKey: text } : parseFileUrl(text);
    if (reference) return reference;
    addIssue({ message: FILE_REFERENCE_MESSAGE });
    return NEVER;
  }),
);

const NodeIdSchema = v.pipe(
  v.string(NODE_ID_MESSAGE),
  v.trim(),
  v.rawTransform(({ dataset, addIssue, NEVER }) => {
    const nodeId = normalizeNodeId(dataset.value);
    if (nodeId !== undefined) return nodeId;
    addIssue({ message: NODE_ID_MESSAGE });
    return NEVER;
  }),
);

type CliInputContext = {
  label: string;
  why?: string;
  hint?: string;
};

export function parseCliInput<
  const TSchema extends v.BaseSchema<unknown, unknown, v.BaseIssue<unknown>>,
>(schema: TSchema, input: unknown, context: CliInputContext): v.InferOutput<TSchema> {
  const result = v.safeParse(schema, input);
  if (result.success) return result.output;

  throw new CliError(`${context.label} is invalid: ${v.summarize(result.issues)}`, {
    code: "INVALID_INPUT",
    why: context.why ?? "The value does not satisfy this command's input requirements.",
    hint: context.hint ?? errorHints.invalidValue,
  });
}

function validatedArg<const TSchema extends v.BaseSchema<string, unknown, v.BaseIssue<unknown>>>(
  schema: TSchema,
  label: string,
  description: string,
) {
  return combinator({
    description,
    parse: (value) => parseCliInput(schema, value, { label }),
  });
}

export function fileReferenceArg(label: string, description: string) {
  return validatedArg(FileReferenceSchema, label, description);
}

export function nodeIdArg(label: string, description: string) {
  return validatedArg(NodeIdSchema, label, description);
}

export function selectedNodeIds(
  file: FileReference,
  nodes: readonly string[] | undefined,
): string[] {
  if (nodes && nodes.length > 0) return [...new Set(nodes)];
  if (file.nodeId !== undefined) return [file.nodeId];
  throw new CliError("No node selected.", {
    code: "INVALID_INPUT",
    why: "This command acts on specific nodes.",
    hint: "Pass --node <id> (repeatable), or pass --file a URL that has a node-id.",
  });
}

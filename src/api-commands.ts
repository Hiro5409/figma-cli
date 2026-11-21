import { resolve } from "node:path";

import { toJsonSchema } from "@valibot/to-json-schema";
import { define, type SubCommandable } from "gunshi";
import {
  args as defineArgs,
  boolean,
  choice,
  combinator,
  map,
  merge,
  multiple,
  positional,
  required,
  string,
  withDefault,
} from "gunshi/combinators";
import * as v from "valibot";

import { client } from "./api/client.ts";
import { commandGroup } from "./command-group.ts";
import { CliError, errorHints } from "./errors.ts";
import { globalArgs } from "./global-args.ts";
import { initCommand } from "./helpers.ts";

type Parameter = {
  name: string;
  location: string;
  required: boolean;
  type: string;
  choices?: ReadonlyArray<number | string>;
  description: string;
};

type BodyField = { name: string; required: boolean };

type Path = ReadonlyArray<string>;

type Paging = {
  items: Path;
  next: Path;
  more?: Path;
  url?: boolean;
  cursor?: { name: string; location: string };
  flags: ReadonlyArray<string>;
};

type RequestOptions = {
  path?: Record<string, unknown>;
  query?: Record<string, unknown>;
  body?: Record<string, unknown>;
  querySerializer?: () => string;
};

export type ApiCommand = {
  request: v.GenericSchema;
  command: Path;
  summary: string;
  method: NonNullable<Parameters<typeof client.request>[0]["method"]>;
  path: string;
  parameters: ReadonlyArray<Parameter>;
  body?: { required: boolean; fields: ReadonlyArray<BodyField> };
  paging?: Paging;
};

const send = (command: ApiCommand, options: RequestOptions) =>
  client.request<unknown, unknown, true>({ method: command.method, url: command.path, ...options });

const RESERVED = new Set(["profile", "dry-run", "body", "all", "help"]);

const flag = (name: string) => name.replace(/[_[\]]+/g, "-").replace(/-+$/, "");

function numberArg(description: string, integer: boolean) {
  return combinator({
    description,
    metavar: integer ? "integer" : "number",
    parse: (text) => {
      const value = Number(text);
      if ((integer ? !/^-?\d+$/.test(text) : text.trim() === "") || isInexact(value)) {
        throw new Error(
          integer
            ? "Expected an integer between -(2^53 - 1) and 2^53 - 1."
            : "Expected a number; integers must lie between -(2^53 - 1) and 2^53 - 1.",
        );
      }
      return value;
    },
  });
}

function parameterArg(parameter: Parameter) {
  const { choices, description } = parameter;
  const base = choices
    ? map(choice(choices.map(String), { description }), (text) =>
        choices.find((value) => String(value) === text),
      )
    : parameter.type === "integer" || parameter.type === "number"
      ? numberArg(description, parameter.type === "integer")
      : parameter.type === "boolean"
        ? boolean({ description })
        : string({ description });
  return parameter.required ? required(base) : base;
}

function invalidRequestError(issues: ReadonlyArray<v.BaseIssue<unknown>>) {
  const details = issues.map((issue) => {
    const at = issue.path?.map((item) => String(item.key)).join(".") || "request";
    return issue.input === undefined
      ? `${at}: required`
      : `${at}: expected ${issue.expected ?? issue.kind}`;
  });
  return new CliError(`Invalid request: ${details.join("; ")}`, {
    code: "INVALID_INPUT",
    why: "The request does not match the Figma API schema.",
    hint: errorHints.invalidValue,
  });
}

function bodyDescription(fields: ReadonlyArray<BodyField>): string {
  const listed = fields.map((field) => `${field.name}${field.required ? "*" : ""}`).join(", ");
  return `Request body as JSON, @<path>, or - for standard input (* required): ${listed}. See "figma-api schema" for the full shape.`;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isInexact = (value: number) =>
  !Number.isFinite(value) || (Number.isInteger(value) && !Number.isSafeInteger(value));

function hasInexactNumber(value: unknown): boolean {
  if (typeof value === "number") return isInexact(value);
  if (Array.isArray(value)) return value.some(hasInexactNumber);
  return isRecord(value) && Object.values(value).some(hasInexactNumber);
}

async function readBody(source: unknown): Promise<Record<string, unknown> | undefined> {
  if (typeof source !== "string") return undefined;
  const fromFile = source.startsWith("@") ? Bun.file(resolve(source.slice(1))) : undefined;
  if (fromFile && !(await fromFile.exists())) {
    throw new CliError(`File not found: ${source.slice(1)}`, {
      code: "INVALID_INPUT",
      hint: "Pass --body @<path> with an existing JSON file.",
    });
  }
  const text = source === "-" ? await Bun.stdin.text() : fromFile ? await fromFile.text() : source;
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {}
  if (isRecord(value)) {
    if (hasInexactNumber(value)) {
      throw new CliError(
        "--body has a number that Figma would not receive exactly: an integer beyond 2^53 - 1, or one too large for a number.",
        {
          code: "INVALID_INPUT",
          hint: "Pass finite numbers, and integers between -(2^53 - 1) and 2^53 - 1.",
        },
      );
    }
    return value;
  }
  throw new CliError("--body must be a JSON object.", {
    code: "INVALID_INPUT",
    why: "The request body is sent to Figma as a JSON object.",
    hint: "Pass --body as a JSON object, @<path> to a JSON file, or - to read standard input.",
  });
}

const at = (value: unknown, path: Path): unknown =>
  path.reduce<unknown>((node, key) => (isRecord(node) ? node[key] : undefined), value);

function withList(value: unknown, path: Path, list: ReadonlyArray<unknown>): unknown {
  const [key, ...rest] = path;
  if (key === undefined) return list;
  const node = isRecord(value) ? value : {};
  return { ...node, [key]: withList(node[key], rest, list) };
}

function nextPage(options: RequestOptions, paging: Paging, next: unknown): RequestOptions {
  if (typeof next === "number" && isInexact(next)) {
    throw new CliError(
      "Figma returned a next-page cursor that a JSON number cannot hold exactly.",
      {
        code: "UPSTREAM_FAILURE",
      },
    );
  }
  const url = paging.url && typeof next === "string" ? URL.parse(next) : null;
  if (url) return { ...options, query: {}, querySerializer: () => url.search.slice(1) };
  if (paging.cursor?.location === "query") {
    return { ...options, query: { ...options.query, [paging.cursor.name]: next } };
  }
  if (paging.cursor?.location === "body") {
    return { ...options, body: { ...options.body, [paging.cursor.name]: next } };
  }
  throw new CliError("Figma returned a next page that is not a URL.", {
    code: "UPSTREAM_FAILURE",
  });
}

async function fetchAllPages(command: ApiCommand, options: RequestOptions, paging: Paging) {
  const items: Array<unknown> = [];
  const followed = new Set<string>();
  let request = options;
  for (;;) {
    const { data } = await send(command, request);
    const page = at(data, paging.items);
    if (!Array.isArray(page)) {
      throw new CliError("Figma returned a page without a list.", { code: "UPSTREAM_FAILURE" });
    }
    items.push(...(page as ReadonlyArray<unknown>));
    const next = at(data, paging.next);
    const missing = next === undefined || next === null || next === "";
    // A team library's cursor has no end marker, so an empty page ends it.
    const done = paging.more
      ? at(data, paging.more) === false
      : missing || (!paging.url && page.length === 0);
    if (done) {
      return withList(data, paging.items, items);
    }
    if (missing) {
      throw new CliError("Figma reported another page without saying where it is.", {
        code: "UPSTREAM_FAILURE",
      });
    }
    const key = JSON.stringify(next);
    if (followed.has(key)) {
      throw new CliError("Figma returned the same next page twice.", { code: "UPSTREAM_FAILURE" });
    }
    followed.add(key);
    request = nextPage(options, paging, next);
  }
}

const dryRunFlag = defineArgs({
  "dry-run": withDefault(
    boolean({ description: "Print the request without sending it to Figma" }),
    false,
  ),
});

function leaf(command: ApiCommand) {
  const parameters = command.parameters.map((parameter) => ({
    ...parameter,
    flag: flag(parameter.name),
  }));
  const argDefinitions: Record<string, ReturnType<typeof parameterArg>> = {};
  for (const { flag: name, ...parameter } of parameters) {
    if (RESERVED.has(name) || name in argDefinitions) {
      throw new Error(
        `${command.method} ${command.path}: parameter --${name} collides with another flag`,
      );
    }
    argDefinitions[name] = parameterArg(parameter);
  }
  const bodyArg = string({ description: bodyDescription(command.body?.fields ?? []) });
  const extra = defineArgs({
    ...argDefinitions,
    ...(command.body ? { body: command.body.required ? required(bodyArg) : bodyArg } : {}),
    ...(command.paging
      ? { all: withDefault(boolean({ description: "Fetch every page" }), false) }
      : {}),
  });

  return define({
    name: command.command.at(-1) ?? "",
    description: command.summary,
    args: merge(globalArgs, dryRunFlag, extra),
    run: async (ctx) => {
      const values = ctx.values as Record<string, unknown>;
      initCommand(ctx);
      const pick = (location: string) =>
        Object.fromEntries(
          parameters
            .filter(
              (parameter) =>
                parameter.location === location && values[parameter.flag] !== undefined,
            )
            .map((parameter) => [parameter.name, values[parameter.flag]]),
        );
      const path = pick("path");
      for (const [name, value] of Object.entries(path)) {
        if (value === "." || value === "..") {
          throw new CliError(`--${flag(name)} cannot be "${value}".`, {
            code: "INVALID_INPUT",
            why: "A dot segment would change the request path.",
          });
        }
      }
      const query = pick("query");
      const body = await readBody(values.body);
      const paging = values.all === true ? command.paging : undefined;
      const owned = paging
        ? [
            ...paging.flags.filter((name) => query[name] !== undefined).map((name) => `--${name}`),
            ...(paging.cursor?.location === "body" && body?.[paging.cursor.name] !== undefined
              ? [`"${paging.cursor.name}" in --body`]
              : []),
          ]
        : [];
      if (owned.length > 0) {
        throw new CliError(
          `--all reads every page, so it cannot be combined with ${owned.join(", ")}.`,
          {
            code: "INVALID_INPUT",
            hint: `Remove ${owned.join(", ")}, or remove --all.`,
          },
        );
      }
      const options: RequestOptions = {
        ...(Object.keys(path).length ? { path } : {}),
        ...(Object.keys(query).length ? { query } : {}),
        ...(body === undefined ? {} : { body }),
      };

      const validation = await v.safeParseAsync(command.request, options);
      if (!validation.success) throw invalidRequestError(validation.issues);

      if (values["dry-run"]) {
        return JSON.stringify({
          dryRun: true,
          request: {
            method: command.method,
            url: client.buildUrl({ url: command.path, path, query }),
            ...(body === undefined ? {} : { body }),
          },
        });
      }
      if (paging) return JSON.stringify(await fetchAllPages(command, options, paging));
      const { data } = await send(command, options);
      return JSON.stringify(data ?? {});
    },
  });
}

function commandTree(
  commands: ReadonlyArray<ApiCommand>,
  depth = 0,
): Record<string, SubCommandable> {
  const byName = Object.groupBy(commands, (command) => command.command[depth] ?? "");
  return Object.fromEntries(
    Object.entries(byName).map(([name, members = []]): [string, SubCommandable] => {
      const [only, ...others] = members;
      if (only && members.some((command) => command.command.length === depth + 1)) {
        if (others.length > 0) {
          throw new Error(`Commands collide at ${only.command.slice(0, depth + 1).join(" ")}`);
        }
        return [name, leaf(only)];
      }
      const subCommands = commandTree(members, depth + 1);
      return [name, commandGroup(name, Object.keys(subCommands).join(", "), subCommands)];
    }),
  );
}

function schemaCommand(commands: ReadonlyArray<ApiCommand>) {
  const byPath = new Map(commands.map((command) => [command.command.join(" "), command] as const));
  return define({
    name: "schema",
    description: "Print the JSON Schema of an API command's request",
    args: defineArgs({
      command: positional(multiple(string({ description: "Command path, such as file show" }))),
    }),
    examples: "$ figma-api schema file comment create",
    run: (ctx) => {
      const path = (ctx.values.command ?? []).join(" ");
      const command = byPath.get(path);
      if (!command) {
        throw new CliError(`Unknown API command: ${path || "(none)"}`, {
          code: "INVALID_INPUT",
          why: "The schema command describes one generated API command.",
          hint: 'Pass the command path, for example "figma-api schema file comment create".',
        });
      }
      return JSON.stringify({
        command: path,
        method: command.method,
        path: command.path,
        request: toJsonSchema(command.request, { typeMode: "input" }),
      });
    },
  });
}

export function apiCommands(commands: ReadonlyArray<ApiCommand>): Record<string, SubCommandable> {
  const tree = commandTree(commands);
  if ("schema" in tree) throw new Error("A generated command group is named schema");
  return { ...tree, schema: schemaCommand(commands) };
}

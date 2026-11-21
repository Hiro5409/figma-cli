import {
  $,
  type DefinePlugin,
  definePluginConfig,
  type IR,
  type Plugin,
} from "@hey-api/openapi-ts";

type CommandsPlugin = DefinePlugin<{ name: "commands" } & Plugin.Hooks & Plugin.Exports>;

type ParamType = "boolean" | "integer" | "number" | "string";

type Path = Array<string>;

function resolve(plugin: CommandsPlugin["Instance"], schema: IR.SchemaObject): IR.SchemaObject {
  let current = schema;
  while (current.$ref) current = plugin.context.resolveIrRef<IR.SchemaObject>(current.$ref);
  return current;
}

function types(plugin: CommandsPlugin["Instance"], schema: IR.SchemaObject): Set<string> {
  const resolved = resolve(plugin, schema);
  if (resolved.logicalOperator && resolved.items) {
    return new Set(resolved.items.flatMap((item) => [...types(plugin, item)]));
  }
  return new Set(resolved.type ? [resolved.type] : []);
}

function property(
  plugin: CommandsPlugin["Instance"],
  schema: IR.SchemaObject | undefined,
  name: string,
): IR.SchemaObject | undefined {
  const field = schema ? resolve(plugin, schema).properties?.[name] : undefined;
  return field ? resolve(plugin, field) : undefined;
}

function scalarType(schema: IR.SchemaObject): ParamType {
  if (schema.type === "integer" || schema.type === "number" || schema.type === "boolean") {
    return schema.type;
  }
  return "string";
}

function firstLine(text: string | undefined): string {
  return (
    (text ?? "")
      .replace(/<[^>]+>/g, " ")
      .split("\n")
      .map((line) => line.trim())
      .find(Boolean) ?? ""
  );
}

const kebab = (word: string) => word.replace(/_/g, "-");
const singular = (word: string) =>
  word === "analytics"
    ? word
    : word
        .replace(/ies$/, "y")
        .replace(/(ss|x|ch|sh|us)es$/, "$1")
        .replace(/([^su])s$/, "$1");

// Path-derived names that would mislead: a read sent as POST, a render named "show", image fills
// named like rendered images, subfolders named "folder folder", a batch of changes named "create",
// and one record named "list".
const NAMES: Record<string, Path> = {
  "POST /v1/developer_logs": ["developer-log", "list"],
  "GET /v2/folders/{folder_id}/folders": ["folder", "subfolder", "list"],
  "GET /v1/images/{file_key}": ["image", "render"],
  "GET /v1/files/{file_key}/images": ["file", "image-fill", "list"],
  "POST /v1/files/{file_key}/variables": ["file", "variable", "apply"],
  "GET /v1/payments": ["payment", "show"],
};

function commandPath(path: string, method: string, paged: boolean): Path {
  const named = NAMES[`${method.toUpperCase()} ${path}`];
  if (named) return named;
  const segments = path
    .replace(/^\/v\d+\//, "/")
    .split("/")
    .filter(Boolean);
  const isParam = (segment: string | undefined) => segment?.startsWith("{") ?? false;
  const last = segments.at(-1);
  const groups = segments.filter((segment) => !isParam(segment)).map((s) => kebab(singular(s)));
  const action =
    method === "get"
      ? !paged && (isParam(last) || singular(last ?? "") === last)
        ? "show"
        : "list"
      : method === "post"
        ? "create"
        : method === "delete"
          ? "delete"
          : "update";
  return [...groups, action];
}

function parameterValue(plugin: CommandsPlugin["Instance"], parameter: IR.ParameterObject) {
  const schema = resolve(plugin, parameter.schema);
  if (schema.type === "array" || schema.type === "object") {
    throw new Error(`Review the ${schema.type} parameter ${parameter.name}`);
  }
  const choices = (schema.type === "enum" ? schema.items : undefined)
    ?.map((member) => member.const)
    .filter((value) => typeof value === "string" || typeof value === "number");
  return {
    name: parameter.name,
    location: parameter.location,
    required: parameter.required ?? false,
    type: scalarType(schema),
    ...(choices?.length ? { choices } : {}),
    description: firstLine(parameter.description) || parameter.name,
  };
}

function objectBranches(
  plugin: CommandsPlugin["Instance"],
  schema: IR.SchemaObject,
): Array<IR.SchemaObject> {
  const resolved = resolve(plugin, schema);
  if (resolved.logicalOperator && resolved.items) {
    return resolved.items.flatMap((item) => objectBranches(plugin, item));
  }
  return resolved.properties ? [resolved] : [];
}

function bodyFields(branches: ReadonlyArray<IR.SchemaObject>) {
  const fields = new Map<string, { name: string; required: boolean }>();
  for (const branch of branches) {
    for (const name of Object.keys(branch.properties ?? {})) {
      if (fields.has(name)) continue;
      fields.set(name, {
        name,
        required: branches.length === 1 && (branch.required?.includes(name) ?? false),
      });
    }
  }
  return [...fields.values()];
}

function successResponse(operation: IR.OperationObject) {
  return Object.entries(operation.responses ?? {}).find(([code]) => code.startsWith("2"))?.[1];
}

function assertJson(operation: IR.OperationObject) {
  const response = successResponse(operation)?.mediaType;
  if (
    (operation.body && operation.body.type !== "json") ||
    (response !== undefined && !response.includes("json"))
  ) {
    throw new Error(`Review ${operation.method} ${operation.path}: it is not a JSON operation`);
  }
}

function paging(
  plugin: CommandsPlugin["Instance"],
  operation: IR.OperationObject,
  branches: ReadonlyArray<IR.SchemaObject>,
) {
  const success = successResponse(operation);
  const response = success ? resolve(plugin, success.schema) : undefined;
  const query = operation.parameters?.query ?? {};
  const bodyCursor = branches.some((branch) => branch.properties?.cursor);
  const where = `${operation.method} ${operation.path}`;
  const meta = property(plugin, response, "meta");

  let container: [Path, IR.SchemaObject | undefined];
  let next: Path;
  let url = false;
  let cursor: { name: string; location: "query" | "body" } | undefined;
  if (property(plugin, property(plugin, response, "pagination"), "next_page")) {
    container = [[], response];
    next = ["pagination", "next_page"];
    url = true;
    if (query.cursor) cursor = { name: "cursor", location: "query" };
  } else if (query.cursor || bodyCursor) {
    const found = (
      [
        [[], response],
        [["meta"], meta],
      ] as const
    ).flatMap(([at, schema]) =>
      ["next_cursor", "cursor"]
        .filter((name) => types(plugin, property(plugin, schema, name) ?? {}).has("string"))
        .map((name) => ({ at: [...at], schema, name })),
    )[0];
    if (!found) throw new Error(`Cannot find the next cursor of ${where}`);
    container = [found.at, found.schema];
    next = [...found.at, found.name];
    cursor = { name: "cursor", location: query.cursor ? "query" : "body" };
  } else if (query.after && property(plugin, property(plugin, meta, "cursor"), "after")) {
    container = [["meta"], meta];
    next = ["meta", "cursor", "after"];
    cursor = { name: "after", location: "query" };
  } else {
    return undefined;
  }

  const [at, schema] = container;
  const fields = Object.entries(resolve(plugin, schema ?? {}).properties ?? {});
  const lists = fields.filter(([, field]) => types(plugin, field).has("array"));
  const list = lists.length === 1 ? lists[0]?.[0] : undefined;
  if (!list) throw new Error(`Cannot find the list in ${where}`);
  const more = fields.find(
    ([name, field]) =>
      ["has_more", "has_next_page", "next_page"].includes(name) &&
      types(plugin, field).has("boolean"),
  )?.[0];
  return {
    items: [...at, list],
    next,
    ...(more ? { more: [...at, more] } : {}),
    ...(url ? { url } : {}),
    ...(cursor ? { cursor } : {}),
    flags: ["cursor", "after", "before"].filter((name) => query[name]),
  };
}

function lookup(value: unknown, key: string): unknown {
  if (typeof value !== "object" || value === null) return undefined;
  const result: unknown = Reflect.get(value, key);
  return result;
}

function access(plugin: CommandsPlugin["Instance"], operation: IR.OperationObject): string {
  const spec: unknown = plugin.context.spec;
  const security = lookup(
    lookup(lookup(lookup(spec, "paths"), operation.path), operation.method),
    "security",
  );
  const schemes = (Array.isArray(security) ? security : []).flatMap((requirement: unknown) =>
    typeof requirement === "object" && requirement !== null ? Object.entries(requirement) : [],
  );
  // Figma deprecates files:read in favor of the narrower scopes listed beside it.
  const scopes = new Set(
    schemes.flatMap(([name, list]: [string, unknown]) =>
      name.includes("OAuth") && Array.isArray(list)
        ? list.filter(
            (scope): scope is string => typeof scope === "string" && scope !== "files:read",
          )
        : [],
    ),
  );
  const notes = [
    ...(schemes.some(([name]) => name === "PersonalAccessToken") ? [] : ["plan access token"]),
    ...(scopes.size ? [`scope: ${[...scopes].join(", ")}`] : []),
  ];
  return notes.length ? ` (${notes.join("; ")})` : "";
}

const handler: CommandsPlugin["Handler"] = ({ plugin }) => {
  const commands: Array<ReturnType<typeof $.object>> = [];
  const named = new Set<string>();
  plugin.forEach("operation", ({ operation }) => {
    assertJson(operation);
    for (const location of ["header", "cookie"] as const) {
      if (Object.keys(operation.parameters?.[location] ?? {}).length > 0) {
        throw new Error(
          `Review the ${location} parameters of ${operation.method} ${operation.path}`,
        );
      }
    }
    const parameters = [
      ...Object.values(operation.parameters?.path ?? {}),
      ...Object.values(operation.parameters?.query ?? {}),
    ];
    const branches = operation.body ? objectBranches(plugin, operation.body.schema) : [];
    const paged = paging(plugin, operation, branches);
    const key = `${operation.method.toUpperCase()} ${operation.path}`;
    if (key in NAMES) named.add(key);
    const metadata = {
      command: commandPath(operation.path, operation.method, paged !== undefined),
      summary:
        firstLine(operation.summary ?? operation.description).replace(/\.$/, "") +
        access(plugin, operation),
      method: operation.method.toUpperCase(),
      path: operation.path,
      parameters: parameters.map((parameter) => parameterValue(plugin, parameter)),
      ...(operation.body
        ? {
            body: {
              required: operation.body.required ?? false,
              fields: bodyFields(branches),
            },
          }
        : {}),
      ...(paged ? { paging: paged } : {}),
    };
    const valibot = plugin.getPluginOrThrow("valibot");
    const request = valibot.api.createRequestSchema({ operation, plugin: valibot });
    if (!request || !("id" in request)) {
      throw new Error(`No request schema for ${operation.method} ${operation.path}`);
    }
    const entry = $.object().prop("request", $(request));
    for (const [name, value] of Object.entries(metadata)) entry.prop(name, $.fromValue(value));
    commands.push(entry);
  });
  const stale = Object.keys(NAMES).filter((key) => !named.has(key));
  if (stale.length) throw new Error(`Command names for missing operations: ${stale.join(", ")}`);
  const symbol = plugin.symbol("commands");
  plugin.node(
    $.const(symbol)
      .export()
      .assign($.array(...commands).as("const")),
  );
};

const defaultConfig: CommandsPlugin["Config"] = {
  config: { includeInEntry: false },
  dependencies: ["valibot"],
  handler,
  name: "commands",
  symbolMeta: () => ({ artifact: "commands" }),
};

export const defineConfig = definePluginConfig(defaultConfig);

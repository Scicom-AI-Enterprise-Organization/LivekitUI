/**
 * Turns an OpenAPI document into HTTP tool definitions.
 *
 * Deliberately forgiving: real-world specs are large and often partly invalid,
 * and one unusable operation shouldn't sink the import. Anything that can't be
 * understood is skipped and reported, rather than throwing.
 *
 * Supports OpenAPI 3.x and Swagger 2.0, JSON or YAML.
 */

import type { HttpTool, ToolParam } from "./tools";

const METHODS = ["get", "post", "put", "patch", "delete"] as const;

interface ParsedSpec {
  title: string;
  version: string;
  baseUrl: string;
  tools: HttpTool[];
  /** Operations that were skipped, with the reason — surfaced in the UI. */
  skipped: { operation: string; reason: string }[];
}

type Json = Record<string, unknown>;

const asObject = (v: unknown): Json | null =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : null;

const asArray = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

const asString = (v: unknown): string => (typeof v === "string" ? v : "");

/**
 * Makes an identifier the model can call: snake_case, no punctuation.
 * `GET /pets/{petId}/toys` becomes `get_pets_pet_id_toys`.
 */
export function toToolName(operationId: string, method: string, path: string): string {
  const source =
    operationId ||
    `${method}_${path.replace(/[{}]/g, "").replace(/[^a-zA-Z0-9]+/g, "_")}`;

  const snake = source
    // camelCase / PascalCase -> snake_case
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "")
    .toLowerCase();

  // Tool names must start with a letter or underscore.
  return /^[a-z_]/.test(snake) ? snake : `op_${snake}`;
}

/** Resolves a local $ref such as "#/components/schemas/Pet". */
function resolveRef(root: Json, node: unknown, depth = 0): unknown {
  const obj = asObject(node);
  if (!obj || depth > 10) return node;

  const ref = asString(obj.$ref);
  if (!ref.startsWith("#/")) return node;

  let target: unknown = root;
  for (const segment of ref.slice(2).split("/")) {
    const t = asObject(target);
    if (!t) return node;
    target = t[segment.replace(/~1/g, "/").replace(/~0/g, "~")];
  }
  // The target may itself be a $ref.
  return resolveRef(root, target, depth + 1);
}

function schemaType(schema: unknown): string {
  const s = asObject(schema);
  if (!s) return "string";
  const type = asString(s.type);
  if (type) return type;
  if (s.properties) return "object";
  if (s.items) return "array";
  if (Array.isArray(s.enum) && s.enum.length) return typeof s.enum[0] === "number" ? "number" : "string";
  return "string";
}

/** The first server URL, with template variables filled from their defaults. */
function resolveBaseUrl(root: Json): string {
  // OpenAPI 3.x
  const server = asObject(asArray(root.servers)[0]);
  if (server) {
    let url = asString(server.url);
    const vars = asObject(server.variables);
    if (vars) {
      for (const [name, def] of Object.entries(vars)) {
        const d = asObject(def);
        url = url.replace(`{${name}}`, asString(d?.default) || `{${name}}`);
      }
    }
    return url.replace(/\/$/, "");
  }

  // Swagger 2.0
  const host = asString(root.host);
  if (host) {
    const scheme = asString(asArray(root.schemes)[0]) || "https";
    const basePath = asString(root.basePath);
    return `${scheme}://${host}${basePath}`.replace(/\/$/, "");
  }

  return "";
}

/**
 * Flattens a request body schema into individual parameters, so the model
 * fills named fields rather than composing raw JSON. Only top-level properties
 * are taken — nested objects are passed through as an "object" parameter.
 */
function paramsFromBody(root: Json, operation: Json): ToolParam[] {
  // OpenAPI 3.x
  const requestBody = asObject(resolveRef(root, operation.requestBody));
  const content = asObject(requestBody?.content);
  const jsonBody = asObject(content?.["application/json"]);
  let schema = asObject(resolveRef(root, jsonBody?.schema));

  // Swagger 2.0 keeps the body in `parameters` with in: "body".
  if (!schema) {
    const bodyParam = asArray(operation.parameters)
      .map((p) => asObject(resolveRef(root, p)))
      .find((p) => p && asString(p.in) === "body");
    schema = asObject(resolveRef(root, bodyParam?.schema));
  }
  if (!schema) return [];

  const properties = asObject(schema.properties);
  if (!properties) return [];

  const required = asArray(schema.required).map(asString);
  return Object.entries(properties).map(([name, raw]) => {
    const prop = asObject(resolveRef(root, raw));
    return {
      name,
      type: schemaType(prop),
      description: asString(prop?.description) || `${name} (request body)`,
      required: required.includes(name),
    };
  });
}

export function parseOpenApi(document: unknown): ParsedSpec {
  const root = asObject(document);
  if (!root) throw new Error("The spec must be a JSON or YAML object");

  const isOpenApi = !!root.openapi || !!root.swagger;
  if (!isOpenApi) {
    throw new Error('Not an OpenAPI document — no "openapi" or "swagger" field');
  }

  const info = asObject(root.info);
  const paths = asObject(root.paths);
  if (!paths) throw new Error('The spec has no "paths" section');

  const baseUrl = resolveBaseUrl(root);
  const tools: HttpTool[] = [];
  const skipped: { operation: string; reason: string }[] = [];
  const usedNames = new Set<string>();

  for (const [path, rawItem] of Object.entries(paths)) {
    const pathItem = asObject(resolveRef(root, rawItem));
    if (!pathItem) continue;

    // Parameters may be declared once for every method on the path.
    const sharedParams = asArray(pathItem.parameters);

    for (const method of METHODS) {
      const operation = asObject(pathItem[method]);
      if (!operation) continue;

      const label = `${method.toUpperCase()} ${path}`;

      if (operation.deprecated === true) {
        skipped.push({ operation: label, reason: "deprecated" });
        continue;
      }

      let name = toToolName(asString(operation.operationId), method, path);
      if (usedNames.has(name)) {
        // Two operations can share an operationId in a sloppy spec.
        let suffix = 2;
        while (usedNames.has(`${name}_${suffix}`)) suffix++;
        name = `${name}_${suffix}`;
      }
      usedNames.add(name);

      const params: ToolParam[] = [];
      const headers: { name: string; value: string }[] = [];

      for (const raw of [...sharedParams, ...asArray(operation.parameters)]) {
        const p = asObject(resolveRef(root, raw));
        if (!p) continue;
        const location = asString(p.in);
        const pName = asString(p.name);
        if (!pName) continue;

        if (location === "header") {
          // A header is a fixed value the caller configures, not something the
          // model should invent.
          headers.push({ name: pName, value: "" });
          continue;
        }
        if (location === "query" || location === "path") {
          params.push({
            name: pName,
            type: schemaType(resolveRef(root, p.schema) ?? p),
            description: asString(p.description) || `${pName} (${location} parameter)`,
            required: p.required === true || location === "path",
          });
        }
      }

      params.push(...paramsFromBody(root, operation));

      tools.push({
        name,
        description:
          asString(operation.summary) ||
          asString(operation.description).split("\n")[0] ||
          label,
        method: method.toUpperCase(),
        url: `${baseUrl}${path}`,
        params,
        headers,
      });
    }
  }

  if (tools.length === 0 && skipped.length === 0) {
    throw new Error("No operations found in the spec");
  }

  return {
    title: asString(info?.title) || "Untitled API",
    version: asString(info?.version),
    baseUrl,
    tools,
    skipped,
  };
}

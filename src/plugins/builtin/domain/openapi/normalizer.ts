import { readFileSync, writeFileSync } from "node:fs";

type JsonObject = Record<string, unknown>;

function isJsonObject(val: unknown): val is JsonObject {
  return val !== null && typeof val === "object" && !Array.isArray(val);
}

const SUPPORTED_METHODS: ReadonlySet<string> = new Set(["get", "post", "put", "patch", "delete"]);

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function toPascalCase(s: string): string {
  return s
    .replace(/-/g, "_")
    .split("_")
    .map((p) => capitalize(p))
    .join("");
}

/**
 * Generate a schema name from an API path and method.
 * Strips version prefixes (e.g., /v1/, /v2/) for cleaner names.
 */
function schemaNameFromPath(
  path: string,
  method: string,
  statusCode: string,
  registeredNames: Set<string>,
): string {
  const parts = path
    .replace(/^\/v\d+\//, "")
    .split("/")
    .filter((p) => !p.startsWith("{"));

  const base = parts.map((p) => toPascalCase(p)).join("");
  const methodPrefix = capitalize(method);
  const code = Number(statusCode);
  const suffix = code >= 200 && code < 300 ? "Response" : `Error${statusCode}`;

  return registerName(`${methodPrefix}${base}${suffix}`, registeredNames);
}

function registerName(name: string, registeredNames: Set<string>): string {
  if (!registeredNames.has(name)) {
    registeredNames.add(name);
    return name;
  }
  let i = 2;
  while (registeredNames.has(`${name}${i}`)) {
    i++;
  }
  const unique = `${name}${i}`;
  registeredNames.add(unique);
  return unique;
}

/**
 * Recursively convert tuple-style `items` arrays to `items: { type: 'number' }`.
 * OpenAPI 3.0 tuples use `items: [schema, schema]` but many codegen tools
 * expect `items: { ... }` (a single schema object).
 */
function fixTupleItems(obj: unknown): void {
  if (Array.isArray(obj)) {
    for (const item of obj) {
      fixTupleItems(item);
    }
    return;
  }

  if (!isJsonObject(obj)) {
    return;
  }

  if (obj["type"] === "array" && Array.isArray(obj["items"])) {
    obj["items"] = { type: "number" };
  }

  for (const value of Object.values(obj)) {
    fixTupleItems(value);
  }
}

/**
 * Recursively extract inline object schemas from a schema and register them
 * as named components. Replaces inline objects with $ref pointers.
 */
function extractNestedSchemas(
  schema: JsonObject,
  parentName: string,
  components: JsonObject,
  registeredNames: Set<string>,
): void {
  const properties = schema["properties"];
  if (!isJsonObject(properties)) {
    return;
  }

  for (const [propName, propSchema] of Object.entries(properties)) {
    if (!isJsonObject(propSchema)) {
      continue;
    }

    // Enums → extract to named component
    if (Array.isArray(propSchema["enum"]) && propSchema["enum"].length > 1) {
      const enumName = registerName(`${parentName}${toPascalCase(propName)}`, registeredNames);
      components[enumName] = propSchema;
      properties[propName] = { $ref: `#/components/schemas/${enumName}` };
      continue;
    }

    // Nested objects → extract recursively
    if (propSchema["type"] === "object" && propSchema["properties"]) {
      const childName = registerName(`${parentName}${toPascalCase(propName)}`, registeredNames);
      extractNestedSchemas(propSchema, childName, components, registeredNames);
      components[childName] = propSchema;
      properties[propName] = { $ref: `#/components/schemas/${childName}` };
    }

    // Arrays of objects → extract item schema
    if (propSchema["type"] === "array") {
      const items = propSchema["items"];
      if (isJsonObject(items) && items["type"] === "object" && items["properties"]) {
        const childName = registerName(
          `${parentName}${toPascalCase(propName)}Item`,
          registeredNames,
        );
        extractNestedSchemas(items, childName, components, registeredNames);
        components[childName] = items;
        propSchema["items"] = { $ref: `#/components/schemas/${childName}` };
      }
    }

    // anyOf / oneOf variants → extract each object variant
    const anyOf = propSchema["anyOf"] ?? propSchema["oneOf"];
    if (Array.isArray(anyOf)) {
      for (let i = 0; i < anyOf.length; i++) {
        const variant = anyOf[i];
        if (isJsonObject(variant) && variant["type"] === "object" && variant["properties"]) {
          const childName = registerName(
            `${parentName}${toPascalCase(propName)}Variant${i}`,
            registeredNames,
          );
          extractNestedSchemas(variant, childName, components, registeredNames);
          components[childName] = variant;
          anyOf[i] = { $ref: `#/components/schemas/${childName}` };
        }
      }
    }
  }
}

const EMPTY_JSON_RESPONSE = {
  "application/json": {
    schema: { type: "object", properties: {} },
  },
};

const API_ERROR_SCHEMA = {
  type: "object",
  required: ["code", "message"],
  properties: {
    code: { type: "string" },
    message: { type: "string" },
  },
};

const API_ERROR_REF = "#/components/schemas/ApiError";

function isApiErrorSchema(schema: JsonObject): boolean {
  const props = schema["properties"];
  if (!isJsonObject(props)) {
    return false;
  }

  const keys = Object.keys(props);
  if (keys.length !== 2 || !keys.includes("code") || !keys.includes("message")) {
    return false;
  }

  const code = props["code"];
  const message = props["message"];

  return (
    isJsonObject(code) &&
    code["type"] === "string" &&
    isJsonObject(message) &&
    message["type"] === "string"
  );
}

function ensureResponseContent(response: JsonObject): void {
  if (!response["content"]) {
    response["content"] = { ...EMPTY_JSON_RESPONSE };
  }
}

function extractResponseSchema(
  response: JsonObject,
  path: string,
  method: string,
  statusCode: string,
  components: JsonObject,
  registeredNames: Set<string>,
): void {
  const content = response["content"];
  if (!isJsonObject(content)) {
    return;
  }

  const jsonContent = content["application/json"];
  if (!isJsonObject(jsonContent)) {
    return;
  }

  const schema = jsonContent["schema"];
  if (!isJsonObject(schema) || "$ref" in schema) {
    return;
  }

  if (isApiErrorSchema(schema)) {
    jsonContent["schema"] = { $ref: API_ERROR_REF };
    return;
  }

  const name = schemaNameFromPath(path, method, statusCode, registeredNames);
  extractNestedSchemas(schema, name, components, registeredNames);
  components[name] = schema;
  jsonContent["schema"] = { $ref: `#/components/schemas/${name}` };
}

function extractRequestBodySchema(
  detail: JsonObject,
  path: string,
  method: string,
  components: JsonObject,
  registeredNames: Set<string>,
): void {
  const requestBody = detail["requestBody"];
  if (!isJsonObject(requestBody)) {
    return;
  }

  const content = requestBody["content"];
  if (!isJsonObject(content)) {
    return;
  }

  for (const [, mediaType] of Object.entries(content)) {
    if (!isJsonObject(mediaType)) {
      continue;
    }

    const schema = mediaType["schema"];
    if (!isJsonObject(schema) || "$ref" in schema) {
      continue;
    }

    const parts = path
      .replace(/^\/v\d+\//, "")
      .split("/")
      .filter((p) => !p.startsWith("{"));
    const base = parts.map((p) => toPascalCase(p)).join("");
    const name = registerName(`${capitalize(method)}${base}Body`, registeredNames);

    extractNestedSchemas(schema, name, components, registeredNames);
    components[name] = schema;
    mediaType["schema"] = { $ref: `#/components/schemas/${name}` };

    // Remove duplicate content types (keep application/json)
    for (const otherCt of Object.keys(content)) {
      if (otherCt !== "application/json") {
        delete content[otherCt];
      }
    }
    break;
  }
}

function extractParameterEnums(
  detail: JsonObject,
  path: string,
  components: JsonObject,
  registeredNames: Set<string>,
): void {
  const parameters = detail["parameters"];
  if (!Array.isArray(parameters)) {
    return;
  }

  for (const param of parameters) {
    if (!isJsonObject(param)) {
      continue;
    }
    const paramSchema = param["schema"];
    if (
      isJsonObject(paramSchema) &&
      Array.isArray(paramSchema["enum"]) &&
      paramSchema["enum"].length > 1 &&
      typeof param["name"] === "string"
    ) {
      const parts = path
        .replace(/^\/v\d+\//, "")
        .split("/")
        .filter((p) => !p.startsWith("{"));
      const base = parts.map((p) => toPascalCase(p)).join("");
      const enumName = registerName(`${base}${toPascalCase(param["name"])}`, registeredNames);
      components[enumName] = paramSchema;
      param["schema"] = { $ref: `#/components/schemas/${enumName}` };
    }
  }
}

export interface NormalizeOptions {
  /** Path prefixes to exclude from the spec */
  readonly excludePrefixes?: readonly string[];
}

/**
 * Normalize an OpenAPI spec for downstream code generation.
 *
 * Performs:
 * - Remove wildcard paths and unsupported HTTP methods
 * - Remove paths matching exclude prefixes
 * - Fix tuple-style array items
 * - Extract inline schemas into named $ref components
 * - Deduplicate common API error schemas
 * - Ensure all responses have content blocks
 * - Extract request body and parameter enum schemas
 *
 * Reads from `inputPath`, writes normalized spec to `outputPath`.
 * Returns the number of schemas extracted and paths removed.
 */
export function normalizeSpec(
  inputPath: string,
  outputPath: string,
  options: NormalizeOptions = {},
): { readonly schemaCount: number; readonly removedCount: number } {
  const raw: unknown = JSON.parse(readFileSync(inputPath, "utf-8"));

  if (!isJsonObject(raw) || !isJsonObject(raw["paths"])) {
    writeFileSync(outputPath, JSON.stringify(raw, null, 2), "utf-8");
    return { schemaCount: 0, removedCount: 0 };
  }

  const spec = raw;
  const paths = spec["paths"] as JsonObject;
  const excludePrefixes = options.excludePrefixes ?? [];

  // Ensure components.schemas exists
  if (!isJsonObject(spec["components"])) {
    spec["components"] = { schemas: {} };
  }
  const components = spec["components"] as JsonObject;
  if (!isJsonObject(components["schemas"])) {
    components["schemas"] = {};
  }
  const schemas = components["schemas"] as JsonObject;

  const registeredNames = new Set<string>();

  // Register existing schema names
  for (const name of Object.keys(schemas)) {
    registeredNames.add(name);
  }

  // Fix tuple items globally
  fixTupleItems(spec);

  // Register common API error schema
  schemas["ApiError"] = API_ERROR_SCHEMA;
  registeredNames.add("ApiError");

  const pathsToRemove: string[] = [];

  for (const [path, methods] of Object.entries(paths)) {
    // Remove wildcard paths
    if (path.includes("*")) {
      pathsToRemove.push(path);
      continue;
    }

    // Remove excluded paths
    if (excludePrefixes.some((prefix) => path.startsWith(prefix))) {
      pathsToRemove.push(path);
      continue;
    }

    if (!isJsonObject(methods)) {
      continue;
    }

    const methodsToRemove: string[] = [];

    for (const [method, detail] of Object.entries(methods)) {
      if (!SUPPORTED_METHODS.has(method)) {
        methodsToRemove.push(method);
        continue;
      }

      if (!isJsonObject(detail)) {
        continue;
      }

      const responses = detail["responses"];

      if (!isJsonObject(responses)) {
        detail["responses"] = {
          "200": {
            description: "Success",
            content: { ...EMPTY_JSON_RESPONSE },
          },
        };
        continue;
      }

      for (const [statusCode, response] of Object.entries(responses)) {
        if (!isJsonObject(response)) {
          responses[statusCode] = {
            description: `Response for status ${statusCode}`,
            content: { ...EMPTY_JSON_RESPONSE },
          };
          continue;
        }

        ensureResponseContent(response);
        extractResponseSchema(response, path, method, statusCode, schemas, registeredNames);
      }

      extractRequestBodySchema(detail, path, method, schemas, registeredNames);
      extractParameterEnums(detail, path, schemas, registeredNames);
    }

    for (const m of methodsToRemove) {
      delete methods[m];
    }
  }

  for (const p of pathsToRemove) {
    delete paths[p];
  }

  writeFileSync(outputPath, JSON.stringify(spec, null, 2), "utf-8");

  return {
    schemaCount: Object.keys(schemas).length,
    removedCount: pathsToRemove.length,
  };
}

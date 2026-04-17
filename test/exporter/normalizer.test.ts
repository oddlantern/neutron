import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { normalizeSpec } from "@/plugins/builtin/domain/openapi/normalizer";

// normalizeSpec is the heart of the OpenAPI bridge pipeline — the
// shape of what it produces is what downstream code generators
// actually consume. A regression here silently corrupts every
// generated client. Every transformation here is worth a test.

let tmpDir: string;
beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "neutron-normalizer-"));
});
afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

interface JsonObject {
  readonly [key: string]: unknown;
}

function writeSpec(spec: JsonObject): { readonly input: string; readonly output: string } {
  const input = join(tmpDir, "input.json");
  const output = join(tmpDir, "output.json");
  writeFileSync(input, JSON.stringify(spec), "utf-8");
  return { input, output };
}

function readSpec(path: string): JsonObject {
  return JSON.parse(readFileSync(path, "utf-8")) as JsonObject;
}

describe("normalizeSpec — path filtering", () => {
  test("removes wildcard paths entirely", () => {
    const { input, output } = writeSpec({
      paths: {
        "/users": { get: { responses: { 200: { description: "ok" } } } },
        "/static/*": { get: { responses: { 200: { description: "ok" } } } },
      },
    });
    const result = normalizeSpec(input, output);
    expect(result.removedCount).toBe(1);
    const spec = readSpec(output);
    const paths = spec["paths"] as JsonObject;
    expect("/users" in paths).toBe(true);
    expect("/static/*" in paths).toBe(false);
  });

  test("removes paths matching excludePrefixes", () => {
    const { input, output } = writeSpec({
      paths: {
        "/api/users": { get: { responses: { 200: { description: "ok" } } } },
        "/internal/metrics": { get: { responses: { 200: { description: "ok" } } } },
        "/internal/admin": { get: { responses: { 200: { description: "ok" } } } },
      },
    });
    const result = normalizeSpec(input, output, { excludePrefixes: ["/internal/"] });
    expect(result.removedCount).toBe(2);
    const paths = readSpec(output)["paths"] as JsonObject;
    expect("/api/users" in paths).toBe(true);
    expect("/internal/metrics" in paths).toBe(false);
    expect("/internal/admin" in paths).toBe(false);
  });

  test("removes unsupported HTTP methods but keeps the path", () => {
    const { input, output } = writeSpec({
      paths: {
        "/users": {
          get: { responses: { 200: { description: "ok" } } },
          options: { responses: { 200: { description: "ok" } } },
          trace: { responses: { 200: { description: "ok" } } },
        },
      },
    });
    normalizeSpec(input, output);
    const methods = (readSpec(output)["paths"] as JsonObject)["/users"] as JsonObject;
    expect("get" in methods).toBe(true);
    expect("options" in methods).toBe(false);
    expect("trace" in methods).toBe(false);
  });
});

describe("normalizeSpec — schema extraction", () => {
  test("extracts inline response object schemas into named $refs", () => {
    const { input, output } = writeSpec({
      paths: {
        "/users": {
          get: {
            responses: {
              200: {
                content: {
                  "application/json": {
                    schema: {
                      type: "object",
                      properties: { id: { type: "string" }, name: { type: "string" } },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });
    normalizeSpec(input, output);
    const spec = readSpec(output);
    const schemas = ((spec["components"] as JsonObject)["schemas"]) as JsonObject;
    // Name derives from method + path: GetUsersResponse
    expect("GetUsersResponse" in schemas).toBe(true);
    const respSchema = ((((spec["paths"] as JsonObject)["/users"] as JsonObject)["get"] as JsonObject)["responses"] as JsonObject)["200"] as JsonObject;
    const inlined = ((respSchema["content"] as JsonObject)["application/json"] as JsonObject)["schema"] as JsonObject;
    expect(inlined["$ref"]).toBe("#/components/schemas/GetUsersResponse");
  });

  test("strips /v1/ version prefix from generated schema names", () => {
    const { input, output } = writeSpec({
      paths: {
        "/v2/items": {
          get: {
            responses: {
              200: {
                content: {
                  "application/json": {
                    schema: { type: "object", properties: { id: { type: "string" } } },
                  },
                },
              },
            },
          },
        },
      },
    });
    normalizeSpec(input, output);
    const schemas = ((readSpec(output)["components"] as JsonObject)["schemas"]) as JsonObject;
    // Name should NOT include "V2" — version prefixes are noise
    expect("GetItemsResponse" in schemas).toBe(true);
    expect("GetV2ItemsResponse" in schemas).toBe(false);
  });

  test("leaves existing $refs alone — doesn't re-extract", () => {
    const { input, output } = writeSpec({
      paths: {
        "/users": {
          get: {
            responses: {
              200: {
                content: {
                  "application/json": { schema: { $ref: "#/components/schemas/User" } },
                },
              },
            },
          },
        },
      },
      components: {
        schemas: {
          User: { type: "object", properties: { id: { type: "string" } } },
        },
      },
    });
    normalizeSpec(input, output);
    const schemas = ((readSpec(output)["components"] as JsonObject)["schemas"]) as JsonObject;
    // Only User + ApiError (added automatically) should exist. No
    // re-extracted schema for the path.
    const names = Object.keys(schemas).sort();
    expect(names).toEqual(["ApiError", "User"]);
  });

  test("extracts nested object schemas recursively", () => {
    const { input, output } = writeSpec({
      paths: {
        "/orders": {
          get: {
            responses: {
              200: {
                content: {
                  "application/json": {
                    schema: {
                      type: "object",
                      properties: {
                        id: { type: "string" },
                        customer: {
                          type: "object",
                          properties: {
                            name: { type: "string" },
                            address: { type: "string" },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });
    normalizeSpec(input, output);
    const schemas = ((readSpec(output)["components"] as JsonObject)["schemas"]) as JsonObject;
    expect("GetOrdersResponse" in schemas).toBe(true);
    expect("GetOrdersResponseCustomer" in schemas).toBe(true);
  });

  test("extracts enum schemas into named components", () => {
    const { input, output } = writeSpec({
      paths: {
        "/items": {
          get: {
            responses: {
              200: {
                content: {
                  "application/json": {
                    schema: {
                      type: "object",
                      properties: {
                        status: { type: "string", enum: ["active", "archived", "deleted"] },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });
    normalizeSpec(input, output);
    const schemas = ((readSpec(output)["components"] as JsonObject)["schemas"]) as JsonObject;
    // Enum extracted with parent + property name
    expect("GetItemsResponseStatus" in schemas).toBe(true);
    const enumSchema = schemas["GetItemsResponseStatus"] as JsonObject;
    expect(enumSchema["enum"]).toEqual(["active", "archived", "deleted"]);
  });
});

describe("normalizeSpec — ApiError deduplication", () => {
  test("response schemas matching {code, message} are replaced with ApiError $ref", () => {
    const { input, output } = writeSpec({
      paths: {
        "/a": {
          get: {
            responses: {
              400: {
                content: {
                  "application/json": {
                    schema: {
                      type: "object",
                      required: ["code", "message"],
                      properties: {
                        code: { type: "string" },
                        message: { type: "string" },
                      },
                    },
                  },
                },
              },
            },
          },
        },
        "/b": {
          get: {
            responses: {
              500: {
                content: {
                  "application/json": {
                    schema: {
                      type: "object",
                      properties: {
                        code: { type: "string" },
                        message: { type: "string" },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });
    normalizeSpec(input, output);
    const spec = readSpec(output);
    const schemas = ((spec["components"] as JsonObject)["schemas"]) as JsonObject;
    expect("ApiError" in schemas).toBe(true);

    // Both path-specific error responses should reuse ApiError rather
    // than creating per-path ErrorXxx schemas.
    const paths = spec["paths"] as JsonObject;
    const aErr = (((((paths["/a"] as JsonObject)["get"] as JsonObject)["responses"] as JsonObject)["400"] as JsonObject)["content"] as JsonObject)["application/json"] as JsonObject;
    const bErr = (((((paths["/b"] as JsonObject)["get"] as JsonObject)["responses"] as JsonObject)["500"] as JsonObject)["content"] as JsonObject)["application/json"] as JsonObject;
    expect((aErr["schema"] as JsonObject)["$ref"]).toBe("#/components/schemas/ApiError");
    expect((bErr["schema"] as JsonObject)["$ref"]).toBe("#/components/schemas/ApiError");
    // No path-specific error schema should have been created.
    const names = Object.keys(schemas);
    expect(names.some((n) => n.startsWith("GetAError") || n.startsWith("GetBError"))).toBe(false);
  });
});

describe("normalizeSpec — name collisions", () => {
  test("appends numeric suffix when the natural name collides with an existing schema", () => {
    const { input, output } = writeSpec({
      paths: {
        "/users": {
          get: {
            responses: {
              200: {
                content: {
                  "application/json": {
                    schema: { type: "object", properties: { id: { type: "string" } } },
                  },
                },
              },
            },
          },
        },
      },
      components: {
        // A pre-existing schema whose name collides with what the
        // path-derived name would produce.
        schemas: {
          GetUsersResponse: { type: "object", properties: { existing: { type: "string" } } },
        },
      },
    });
    normalizeSpec(input, output);
    const schemas = ((readSpec(output)["components"] as JsonObject)["schemas"]) as JsonObject;
    // Original is preserved; the newly-extracted one gets a -2 suffix.
    expect("GetUsersResponse" in schemas).toBe(true);
    expect("GetUsersResponse2" in schemas).toBe(true);
  });
});

describe("normalizeSpec — tuple items normalization", () => {
  test("array with items as tuple becomes items object", () => {
    const { input, output } = writeSpec({
      paths: {
        "/coords": {
          get: {
            responses: {
              200: {
                content: {
                  "application/json": {
                    schema: {
                      type: "array",
                      items: [{ type: "number" }, { type: "number" }],
                    },
                  },
                },
              },
            },
          },
        },
      },
    });
    normalizeSpec(input, output);
    // Response schema gets extracted; the tuple items get normalized.
    const spec = readSpec(output);
    const schemas = ((spec["components"] as JsonObject)["schemas"]) as JsonObject;
    const extracted = schemas["GetCoordsResponse"] as JsonObject | undefined;
    // Some specs have the array at the root of the schema and won't be
    // object-extracted, so the fix can also apply in-place. Either way,
    // no tuple `items: []` should remain anywhere under `paths`.
    const pathsStr = JSON.stringify(spec["paths"]);
    const schemasStr = JSON.stringify(schemas);
    expect(pathsStr).not.toContain('"items":[');
    expect(schemasStr).not.toContain('"items":[');
    if (extracted) expect(extracted).toBeDefined();
  });
});

describe("normalizeSpec — responses shape guarantees", () => {
  test("response without content block gets an empty json schema scaffold", () => {
    const { input, output } = writeSpec({
      paths: {
        "/ping": {
          get: {
            responses: {
              200: { description: "ok" },
            },
          },
        },
      },
    });
    normalizeSpec(input, output);
    const resp = ((((readSpec(output)["paths"] as JsonObject)["/ping"] as JsonObject)["get"] as JsonObject)["responses"] as JsonObject)["200"] as JsonObject;
    expect(resp["content"]).toBeDefined();
    const content = resp["content"] as JsonObject;
    expect("application/json" in content).toBe(true);
  });

  test("operation without responses gets a default 200 response", () => {
    const { input, output } = writeSpec({
      paths: {
        "/noop": {
          get: { summary: "nothing" },
        },
      },
    });
    normalizeSpec(input, output);
    const op = (((readSpec(output)["paths"] as JsonObject)["/noop"] as JsonObject)["get"]) as JsonObject;
    const responses = op["responses"] as JsonObject;
    expect("200" in responses).toBe(true);
    const r = responses["200"] as JsonObject;
    expect(r["content"]).toBeDefined();
  });
});

describe("normalizeSpec — request body and parameter extraction", () => {
  test("extracts inline request body schema into a $ref named <Method><Path>Body", () => {
    const { input, output } = writeSpec({
      paths: {
        "/users": {
          post: {
            requestBody: {
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: { name: { type: "string" }, email: { type: "string" } },
                  },
                },
              },
            },
            responses: { 201: { description: "Created" } },
          },
        },
      },
    });
    normalizeSpec(input, output);
    const schemas = ((readSpec(output)["components"] as JsonObject)["schemas"]) as JsonObject;
    expect("PostUsersBody" in schemas).toBe(true);
  });

  test("drops duplicate content types in request body, keeps application/json", () => {
    const { input, output } = writeSpec({
      paths: {
        "/users": {
          post: {
            requestBody: {
              content: {
                "application/json": {
                  schema: { type: "object", properties: { id: { type: "string" } } },
                },
                "application/xml": {
                  schema: { type: "object", properties: { id: { type: "string" } } },
                },
                "text/plain": { schema: { type: "string" } },
              },
            },
            responses: { 200: { description: "ok" } },
          },
        },
      },
    });
    normalizeSpec(input, output);
    const content = ((((((readSpec(output)["paths"] as JsonObject)["/users"] as JsonObject)["post"] as JsonObject)["requestBody"] as JsonObject)["content"]) as JsonObject);
    expect(Object.keys(content)).toEqual(["application/json"]);
  });

  test("extracts parameter enums into named component schemas", () => {
    const { input, output } = writeSpec({
      paths: {
        "/items": {
          get: {
            parameters: [
              {
                name: "sort",
                in: "query",
                schema: { type: "string", enum: ["asc", "desc"] },
              },
            ],
            responses: { 200: { description: "ok" } },
          },
        },
      },
    });
    normalizeSpec(input, output);
    const spec = readSpec(output);
    const schemas = ((spec["components"] as JsonObject)["schemas"]) as JsonObject;
    expect("ItemsSort" in schemas).toBe(true);
    const param = ((((spec["paths"] as JsonObject)["/items"] as JsonObject)["get"] as JsonObject)["parameters"] as readonly unknown[])[0] as JsonObject;
    expect((param["schema"] as JsonObject)["$ref"]).toBe("#/components/schemas/ItemsSort");
  });
});

describe("normalizeSpec — degenerate inputs", () => {
  test("spec without paths is written through with only a schemaCount=0 signal", () => {
    const { input, output } = writeSpec({ openapi: "3.0.0", info: { title: "x" } });
    const result = normalizeSpec(input, output);
    expect(result.schemaCount).toBe(0);
    expect(result.removedCount).toBe(0);
    // Output must still be valid JSON.
    expect(() => readSpec(output)).not.toThrow();
  });
});

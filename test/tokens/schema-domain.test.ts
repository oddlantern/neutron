import { describe, expect, test } from "bun:test";

import { validateSchema } from "../../src/plugins/builtin/domain/schema/plugin.js";
import { generateTypeScript } from "../../src/plugins/builtin/ecosystem/typescript/schema-codegen.js";
import { generateDart } from "../../src/plugins/builtin/ecosystem/dart/schema-codegen.js";
import { generatePython } from "../../src/plugins/builtin/ecosystem/python/schema-codegen.js";
import { generateRust } from "../../src/plugins/builtin/ecosystem/rust/schema-codegen.js";
import { generateGo } from "../../src/plugins/builtin/ecosystem/go/schema-codegen.js";
import { generatePhp } from "../../src/plugins/builtin/ecosystem/php/schema-codegen.js";

// ─── Test fixtures ───────────────────────────────────────────────────────────

const SIMPLE_SCHEMA = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  title: "User",
  type: "object",
  properties: {
    id: { type: "integer", description: "Unique identifier" },
    name: { type: "string" },
    email: { type: "string", format: "email" },
    active: { type: "boolean" },
  },
  required: ["id", "name", "email"],
};

const SCHEMA_WITH_DEFS = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $defs: {
    Address: {
      type: "object",
      properties: {
        street: { type: "string" },
        city: { type: "string" },
        zip: { type: "string" },
      },
      required: ["street", "city"],
    },
    Order: {
      type: "object",
      description: "A customer order",
      properties: {
        orderId: { type: "string" },
        total: { type: "number" },
        items: { type: "array", items: { type: "string" } },
        status: { type: "string", enum: ["pending", "shipped", "delivered"] },
      },
      required: ["orderId", "total"],
    },
  },
};

const NULLABLE_SCHEMA = {
  title: "Profile",
  type: "object",
  properties: {
    name: { type: "string" },
    bio: { anyOf: [{ type: "string" }, { type: "null" }] },
    age: { oneOf: [{ type: "integer" }, { type: "null" }] },
  },
  required: ["name"],
};

const REF_SCHEMA = {
  title: "Company",
  type: "object",
  properties: {
    name: { type: "string" },
    headquarters: { $ref: "#/$defs/Address" },
    employees: { type: "array", items: { $ref: "#/$defs/Employee" } },
  },
  required: ["name"],
  $defs: {
    Address: {
      type: "object",
      properties: {
        city: { type: "string" },
      },
      required: ["city"],
    },
    Employee: {
      type: "object",
      properties: {
        name: { type: "string" },
      },
      required: ["name"],
    },
  },
};

// ─── validateSchema ──────────────────────────────────────────────────────────

describe("validateSchema", () => {
  test("validates simple schema with root properties", () => {
    const result = validateSchema(SIMPLE_SCHEMA);
    expect(result.success).toBe(true);
    expect(result.data?.definitions).toHaveLength(1);
    expect(result.data?.definitions[0]?.name).toBe("User");
    expect(result.data?.definitions[0]?.properties).toHaveLength(4);
  });

  test("validates schema with $defs", () => {
    const result = validateSchema(SCHEMA_WITH_DEFS);
    expect(result.success).toBe(true);
    expect(result.data?.definitions).toHaveLength(2);
    const names = result.data?.definitions.map((d) => d.name) ?? [];
    expect(names).toContain("Address");
    expect(names).toContain("Order");
  });

  test("marks required fields correctly", () => {
    const result = validateSchema(SIMPLE_SCHEMA);
    const user = result.data?.definitions[0];
    const idProp = user?.properties.find((p) => p.name === "id");
    const activeProp = user?.properties.find((p) => p.name === "active");
    expect(idProp?.required).toBe(true);
    expect(activeProp?.required).toBe(false);
  });

  test("handles nullable properties via anyOf/oneOf", () => {
    const result = validateSchema(NULLABLE_SCHEMA);
    expect(result.success).toBe(true);
    const profile = result.data?.definitions[0];
    const bio = profile?.properties.find((p) => p.name === "bio");
    const age = profile?.properties.find((p) => p.name === "age");
    expect(bio?.nullable).toBe(true);
    expect(bio?.type).toBe("string");
    expect(age?.nullable).toBe(true);
    expect(age?.type).toBe("integer");
  });

  test("resolves $ref to type names", () => {
    const result = validateSchema(REF_SCHEMA);
    expect(result.success).toBe(true);
    const company = result.data?.definitions.find((d) => d.name === "Company");
    const hq = company?.properties.find((p) => p.name === "headquarters");
    expect(hq?.ref).toBe("Address");
    const employees = company?.properties.find((p) => p.name === "employees");
    expect(employees?.items).toBe("Employee");
  });

  test("detects enum values", () => {
    const result = validateSchema(SCHEMA_WITH_DEFS);
    const order = result.data?.definitions.find((d) => d.name === "Order");
    const status = order?.properties.find((p) => p.name === "status");
    expect(status?.enumValues).toEqual(["pending", "shipped", "delivered"]);
  });

  test("fails on non-object input", () => {
    const result = validateSchema("not an object");
    expect(result.success).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  test("fails on empty schema with no properties or defs", () => {
    const result = validateSchema({});
    expect(result.success).toBe(false);
  });
});

// ─── Code generation ─────────────────────────────────────────────────────────

describe("schema codegen", () => {
  const result = validateSchema(SIMPLE_SCHEMA);
  const schema = result.data!;

  test("generates TypeScript interfaces", () => {
    const ts = generateTypeScript(schema);
    expect(ts).toContain("export interface User");
    expect(ts).toContain("readonly id: number");
    expect(ts).toContain("readonly name: string");
    expect(ts).toContain("readonly email: string");
    expect(ts).toContain("readonly active?: boolean");
    expect(ts).toContain("GENERATED");
  });

  test("generates Dart classes", () => {
    const dart = generateDart(schema);
    expect(dart).toContain("class User");
    expect(dart).toContain("final int id");
    expect(dart).toContain("final String name");
    expect(dart).toContain("final bool? active");
    expect(dart).toContain("GENERATED");
  });

  test("generates Python dataclasses", () => {
    const py = generatePython(schema);
    expect(py).toContain("@dataclass");
    expect(py).toContain("class User:");
    expect(py).toContain("id: int");
    expect(py).toContain("name: str");
    expect(py).toContain("active: Optional[bool]");
    expect(py).toContain("GENERATED");
  });

  test("generates Rust structs", () => {
    const rs = generateRust(schema);
    expect(rs).toContain("pub struct User");
    expect(rs).toContain("pub id: i64");
    expect(rs).toContain("pub name: String");
    expect(rs).toContain("pub active: Option<bool>");
    expect(rs).toContain("Serialize, Deserialize");
    expect(rs).toContain("GENERATED");
  });

  test("generates Go structs", () => {
    const go = generateGo(schema);
    expect(go).toContain("type User struct");
    expect(go).toContain("Id int64");
    expect(go).toContain("Name string");
    expect(go).toContain("Active *bool");
    expect(go).toContain(`json:"id"`);
    expect(go).toContain("GENERATED");
  });

  test("generates PHP classes", () => {
    const php = generatePhp(schema);
    expect(php).toContain("final class User");
    expect(php).toContain("public readonly int $id");
    expect(php).toContain("public readonly string $name");
    expect(php).toContain("public readonly ?bool $active");
    expect(php).toContain("GENERATED");
  });
});

// ─── Enum codegen ────────────────────────────────────────────────────────────

describe("schema codegen — enums", () => {
  const result = validateSchema(SCHEMA_WITH_DEFS);
  const schema = result.data!;

  test("TypeScript generates union type for enums", () => {
    const ts = generateTypeScript(schema);
    expect(ts).toContain('"pending" | "shipped" | "delivered"');
  });

  test("Dart generates enum for enum properties", () => {
    const dart = generateDart(schema);
    expect(dart).toContain("enum Status");
  });

  test("Python generates Enum class", () => {
    const py = generatePython(schema);
    expect(py).toContain("class Status(str, Enum):");
  });

  test("Rust generates enum", () => {
    const rs = generateRust(schema);
    expect(rs).toContain("pub enum Status");
  });
});

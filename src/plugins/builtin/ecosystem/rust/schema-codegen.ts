import { writeFileSync } from "node:fs";
import { join } from "node:path";

import type { WorkspacePackage } from "@/graph/types";
import type { ExecuteResult, ExecutionContext } from "@/plugins/types";
import type {
  SchemaDefinition,
  SchemaProperty,
  ValidatedSchema,
} from "@/plugins/builtin/domain/schema/types";

const HEADER =
  "// GENERATED — DO NOT EDIT. Changes will be overwritten.\n\nuse serde::{Deserialize, Serialize};\n";

function rustType(prop: SchemaProperty): string {
  if (prop.enumValues) {
    return `${prop.name[0]!.toUpperCase()}${prop.name.slice(1)}`;
  }
  if (prop.ref) {
    return prop.ref;
  }

  switch (prop.type) {
    case "string":
      return "String";
    case "number":
      return "f64";
    case "integer":
      return "i64";
    case "boolean":
      return "bool";
    case "array":
      return `Vec<${rustItemType(prop.items)}>`;
    case "object":
      return "serde_json::Value";
    default:
      return "serde_json::Value";
  }
}

function rustItemType(items: string | undefined): string {
  switch (items) {
    case "string":
      return "String";
    case "number":
      return "f64";
    case "integer":
      return "i64";
    case "boolean":
      return "bool";
    case undefined:
      return "serde_json::Value";
    default:
      return items;
  }
}

function snakeCase(str: string): string {
  return str.replace(/[A-Z]/g, (letter, index) =>
    index > 0 ? `_${letter.toLowerCase()}` : letter.toLowerCase(),
  );
}

function generateEnum(prop: SchemaProperty): string {
  const enumName = `${prop.name[0]!.toUpperCase()}${prop.name.slice(1)}`;
  const variants = (prop.enumValues ?? [])
    .map((v) => `    ${v[0]!.toUpperCase()}${v.slice(1)}`)
    .join(",\n");
  return `\n#[derive(Debug, Clone, Serialize, Deserialize)]\npub enum ${enumName} {\n${variants},\n}`;
}

function generateStruct(def: SchemaDefinition): string {
  const lines: string[] = [];
  const enums: string[] = [];

  if (def.description) {
    lines.push(`/// ${def.description}`);
  }
  lines.push("#[derive(Debug, Clone, Serialize, Deserialize)]");
  lines.push(`pub struct ${def.name} {`);

  for (const prop of def.properties) {
    if (prop.enumValues) {
      enums.push(generateEnum(prop));
    }
    let type = rustType(prop);
    if (prop.nullable || !prop.required) {
      type = `Option<${type}>`;
    }
    if (prop.description) {
      lines.push(`    /// ${prop.description}`);
    }
    lines.push(`    pub ${snakeCase(prop.name)}: ${type},`);
  }

  lines.push("}");
  return [...enums, "", ...lines].join("\n");
}

export function generateRust(schema: ValidatedSchema): string {
  const sections = [HEADER];
  for (const def of schema.definitions) {
    sections.push(generateStruct(def));
  }
  return sections.join("\n\n") + "\n";
}

export async function executeSchemaGeneration(
  _pkg: WorkspacePackage,
  _root: string,
  context: ExecutionContext,
): Promise<ExecuteResult> {
  const start = performance.now();
  const schema = context.domainData as ValidatedSchema;
  const outDir = context.outputDir!;

  const content = generateRust(schema);
  writeFileSync(join(outDir, "schema.rs"), content);

  return {
    success: true,
    duration: Math.round(performance.now() - start),
    summary: `${schema.definitions.length} Rust struct(s) generated`,
  };
}

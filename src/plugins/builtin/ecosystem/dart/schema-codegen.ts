import { writeFileSync } from "node:fs";
import { join } from "node:path";

import type { WorkspacePackage } from "@/graph/types";
import type { ExecuteResult, ExecutionContext } from "@/plugins/types";
import type { SchemaDefinition, SchemaProperty, ValidatedSchema } from "@/plugins/builtin/domain/schema/types";

const HEADER = "// GENERATED — DO NOT EDIT. Changes will be overwritten.\n";

function dartType(prop: SchemaProperty): string {
  if (prop.enumValues) {
    // Dart enums are generated separately; reference by name
    return `${prop.name[0]!.toUpperCase()}${prop.name.slice(1)}`;
  }
  if (prop.ref) {
    return prop.ref;
  }

  switch (prop.type) {
    case "string": return "String";
    case "number": return "double";
    case "integer": return "int";
    case "boolean": return "bool";
    case "array": return `List<${dartItemType(prop.items)}>`;
    case "object": return "Map<String, dynamic>";
    default: return "dynamic";
  }
}

function dartItemType(items: string | undefined): string {
  switch (items) {
    case "string": return "String";
    case "number": return "double";
    case "integer": return "int";
    case "boolean": return "bool";
    case undefined: return "dynamic";
    default: return items;
  }
}

function snakeCase(str: string): string {
  return str.replace(/[A-Z]/g, (letter, index) =>
    index > 0 ? `_${letter.toLowerCase()}` : letter.toLowerCase(),
  );
}

function generateEnum(prop: SchemaProperty): string {
  const enumName = `${prop.name[0]!.toUpperCase()}${prop.name.slice(1)}`;
  const values = (prop.enumValues ?? []).map((v) => `  ${snakeCase(v)}`).join(",\n");
  return `enum ${enumName} {\n${values}\n}`;
}

function generateClass(def: SchemaDefinition): string {
  const lines: string[] = [];
  const enums: string[] = [];

  if (def.description) {
    lines.push(`/// ${def.description}`);
  }
  lines.push(`class ${def.name} {`);

  // Fields
  for (const prop of def.properties) {
    if (prop.enumValues) {
      enums.push(generateEnum(prop));
    }
    const type = dartType(prop);
    const nullable = prop.nullable || !prop.required ? "?" : "";
    if (prop.description) {
      lines.push(`  /// ${prop.description}`);
    }
    lines.push(`  final ${type}${nullable} ${snakeCase(prop.name)};`);
  }

  lines.push("");

  // Constructor
  const params = def.properties.map((prop) => {
    const required = prop.required && !prop.nullable ? "required " : "";
    return `    ${required}this.${snakeCase(prop.name)},`;
  });
  lines.push(`  const ${def.name}({`);
  lines.push(...params);
  lines.push("  });");

  lines.push("}");

  return [...enums, "", ...lines].join("\n");
}

export function generateDart(schema: ValidatedSchema): string {
  const sections = [HEADER];
  for (const def of schema.definitions) {
    sections.push(generateClass(def));
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

  const content = generateDart(schema);
  writeFileSync(join(outDir, "schema.dart"), content);

  return {
    success: true,
    duration: Math.round(performance.now() - start),
    summary: `${schema.definitions.length} Dart class(es) generated`,
  };
}

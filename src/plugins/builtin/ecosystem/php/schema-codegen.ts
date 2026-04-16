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
  "<?php\n\n// GENERATED — DO NOT EDIT. Changes will be overwritten.\n\ndeclare(strict_types=1);\n";

function phpType(prop: SchemaProperty): string {
  if (prop.ref) {
    return prop.ref;
  }

  switch (prop.type) {
    case "string":
      return "string";
    case "number":
    case "integer":
      return prop.type === "integer" ? "int" : "float";
    case "boolean":
      return "bool";
    case "array":
      return "array";
    case "object":
      return "array";
    default:
      return "mixed";
  }
}

function generateClass(def: SchemaDefinition): string {
  const lines: string[] = [];

  if (def.description) {
    lines.push(`/**`);
    lines.push(` * ${def.description}`);
    lines.push(` */`);
  }
  lines.push(`final class ${def.name}`);
  lines.push("{");

  // Constructor with promoted properties
  const params: string[] = [];
  for (const prop of def.properties) {
    let type = phpType(prop);
    const nullable = prop.nullable || !prop.required ? "?" : "";
    const defaultVal = !prop.required ? " = null" : "";
    if (prop.description) {
      params.push(`        /** ${prop.description} */`);
    }
    params.push(`        public readonly ${nullable}${type} $${prop.name}${defaultVal},`);
  }

  lines.push("    public function __construct(");
  lines.push(...params);
  lines.push("    ) {}");
  lines.push("}");

  return lines.join("\n");
}

export function generatePhp(schema: ValidatedSchema): string {
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

  const content = generatePhp(schema);
  writeFileSync(join(outDir, "schema.php"), content);

  return {
    success: true,
    duration: Math.round(performance.now() - start),
    summary: `${schema.definitions.length} PHP class(es) generated`,
  };
}

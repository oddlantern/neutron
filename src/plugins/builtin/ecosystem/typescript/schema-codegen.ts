import { writeFileSync } from "node:fs";
import { join } from "node:path";

import type { WorkspacePackage } from "@/graph/types";
import type { ExecuteResult, ExecutionContext } from "@/plugins/types";
import type {
  SchemaDefinition,
  SchemaProperty,
  ValidatedSchema,
} from "@/plugins/builtin/domain/schema/types";

const HEADER = "/* GENERATED — DO NOT EDIT. Changes will be overwritten. */\n";

function tsType(prop: SchemaProperty): string {
  if (prop.enumValues) {
    return prop.enumValues.map((v) => `"${v}"`).join(" | ");
  }
  if (prop.ref) {
    return prop.ref;
  }

  switch (prop.type) {
    case "string":
      return "string";
    case "number":
    case "integer":
      return "number";
    case "boolean":
      return "boolean";
    case "array":
      return `readonly ${prop.items ?? "unknown"}[]`;
    case "object":
      return "Record<string, unknown>";
    default:
      return "unknown";
  }
}

function generateInterface(def: SchemaDefinition): string {
  const lines: string[] = [];
  if (def.description) {
    lines.push(`/** ${def.description} */`);
  }
  lines.push(`export interface ${def.name} {`);

  for (const prop of def.properties) {
    const optional = !prop.required ? "?" : "";
    const nullable = prop.nullable ? " | null" : "";
    if (prop.description) {
      lines.push(`  /** ${prop.description} */`);
    }
    lines.push(`  readonly ${prop.name}${optional}: ${tsType(prop)}${nullable};`);
  }

  lines.push("}");
  return lines.join("\n");
}

export function generateTypeScript(schema: ValidatedSchema): string {
  const sections = [HEADER];
  for (const def of schema.definitions) {
    sections.push(generateInterface(def));
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

  const content = generateTypeScript(schema);
  writeFileSync(join(outDir, "schema.ts"), content);

  return {
    success: true,
    duration: Math.round(performance.now() - start),
    summary: `${schema.definitions.length} TypeScript interface(s) generated`,
  };
}

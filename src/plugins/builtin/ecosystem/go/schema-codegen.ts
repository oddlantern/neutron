import { writeFileSync } from "node:fs";
import { join } from "node:path";

import type { WorkspacePackage } from "@/graph/types";
import type { ExecuteResult, ExecutionContext } from "@/plugins/types";
import type { SchemaDefinition, SchemaProperty, ValidatedSchema } from "@/plugins/builtin/domain/schema/types";

const HEADER = "// GENERATED — DO NOT EDIT. Changes will be overwritten.\n\npackage schema\n";

function goType(prop: SchemaProperty): string {
  if (prop.ref) {
    return prop.ref;
  }

  switch (prop.type) {
    case "string": return "string";
    case "number": return "float64";
    case "integer": return "int64";
    case "boolean": return "bool";
    case "array": return `[]${goItemType(prop.items)}`;
    case "object": return "map[string]interface{}";
    default: return "interface{}";
  }
}

function goItemType(items: string | undefined): string {
  switch (items) {
    case "string": return "string";
    case "number": return "float64";
    case "integer": return "int64";
    case "boolean": return "bool";
    case undefined: return "interface{}";
    default: return items;
  }
}

function pascalCase(str: string): string {
  return str[0]!.toUpperCase() + str.slice(1);
}

function generateStruct(def: SchemaDefinition): string {
  const lines: string[] = [];

  if (def.description) {
    lines.push(`// ${def.name} — ${def.description}`);
  }
  lines.push(`type ${def.name} struct {`);

  for (const prop of def.properties) {
    let type = goType(prop);
    const pointer = (prop.nullable || !prop.required) ? "*" : "";
    const jsonTag = `\`json:"${prop.name}${!prop.required ? ",omitempty" : ""}"\``;

    if (prop.description) {
      lines.push(`\t// ${prop.description}`);
    }
    lines.push(`\t${pascalCase(prop.name)} ${pointer}${type} ${jsonTag}`);
  }

  lines.push("}");
  return lines.join("\n");
}

export function generateGo(schema: ValidatedSchema): string {
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

  const content = generateGo(schema);
  writeFileSync(join(outDir, "schema.go"), content);

  return {
    success: true,
    duration: Math.round(performance.now() - start),
    summary: `${schema.definitions.length} Go struct(s) generated`,
  };
}

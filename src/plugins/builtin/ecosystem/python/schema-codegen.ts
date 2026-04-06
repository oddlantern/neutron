import { writeFileSync } from "node:fs";
import { join } from "node:path";

import type { WorkspacePackage } from "@/graph/types";
import type { ExecuteResult, ExecutionContext } from "@/plugins/types";
import type { SchemaDefinition, SchemaProperty, ValidatedSchema } from "@/plugins/builtin/domain/schema/types";

const HEADER = '"""GENERATED — DO NOT EDIT. Changes will be overwritten."""\n\nfrom __future__ import annotations\n\nfrom dataclasses import dataclass\nfrom enum import Enum\nfrom typing import Optional\n';

function pyType(prop: SchemaProperty): string {
  if (prop.enumValues) {
    return `${prop.name[0]!.toUpperCase()}${prop.name.slice(1)}`;
  }
  if (prop.ref) {
    return prop.ref;
  }

  switch (prop.type) {
    case "string": return "str";
    case "number": return "float";
    case "integer": return "int";
    case "boolean": return "bool";
    case "array": return `list[${pyItemType(prop.items)}]`;
    case "object": return "dict[str, object]";
    default: return "object";
  }
}

function pyItemType(items: string | undefined): string {
  switch (items) {
    case "string": return "str";
    case "number": return "float";
    case "integer": return "int";
    case "boolean": return "bool";
    case undefined: return "object";
    default: return items;
  }
}

function snakeCase(str: string): string {
  return str.replace(/[A-Z]/g, (letter, index) =>
    index > 0 ? `_${letter.toLowerCase()}` : letter.toLowerCase(),
  );
}

function generateEnum(prop: SchemaProperty): string {
  const className = `${prop.name[0]!.toUpperCase()}${prop.name.slice(1)}`;
  const values = (prop.enumValues ?? [])
    .map((v) => `    ${snakeCase(v).toUpperCase()} = "${v}"`)
    .join("\n");
  return `\nclass ${className}(str, Enum):\n${values}\n`;
}

function generateDataclass(def: SchemaDefinition): string {
  const lines: string[] = [];
  const enums: string[] = [];

  if (def.description) {
    lines.push(`    """${def.description}"""\n`);
  }

  for (const prop of def.properties) {
    if (prop.enumValues) {
      enums.push(generateEnum(prop));
    }
    let type = pyType(prop);
    if (prop.nullable || !prop.required) {
      type = `Optional[${type}]`;
    }
    const defaultVal = !prop.required ? " = None" : "";
    lines.push(`    ${snakeCase(prop.name)}: ${type}${defaultVal}`);
  }

  // Put required fields first, then optional
  const required = lines.filter((l) => !l.includes("= None"));
  const optional = lines.filter((l) => l.includes("= None"));
  const orderedFields = [...required, ...optional];

  const classLines = [
    ...enums,
    "",
    `@dataclass(frozen=True)`,
    `class ${def.name}:`,
  ];
  if (def.description) {
    classLines.push(`    """${def.description}"""\n`);
  }
  classLines.push(...orderedFields);

  return classLines.join("\n");
}

export function generatePython(schema: ValidatedSchema): string {
  const sections = [HEADER];
  for (const def of schema.definitions) {
    sections.push(generateDataclass(def));
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

  const content = generatePython(schema);
  writeFileSync(join(outDir, "schema.py"), content);

  return {
    success: true,
    duration: Math.round(performance.now() - start),
    summary: `${schema.definitions.length} Python dataclass(es) generated`,
  };
}

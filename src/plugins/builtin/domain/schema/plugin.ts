import { mkdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import type { WorkspacePackage } from "@/graph/types";
import { RED, RESET } from "@/output";
import type {
  DomainPlugin,
  ExecutablePipelineStep,
  ExecuteResult,
  ExecutionContext,
} from "@/plugins/types";
import type {
  SchemaDefinition,
  SchemaProperty,
  SchemaValidationError,
  SchemaValidationResult,
  ValidatedSchema,
} from "@/plugins/builtin/domain/schema/types";
import { isRecord } from "@/guards";

const DOMAIN_NAME = "schema";

/** JSON Schema type keyword → our normalized type */
const TYPE_MAP: Readonly<Record<string, SchemaProperty["type"]>> = {
  string: "string",
  number: "number",
  integer: "integer",
  boolean: "boolean",
  array: "array",
  object: "object",
};

/**
 * Parse a JSON Schema properties object into SchemaProperty[].
 */
function parseProperties(
  properties: Record<string, unknown>,
  requiredFields: ReadonlySet<string>,
): SchemaProperty[] {
  const result: SchemaProperty[] = [];

  for (const [name, rawProp] of Object.entries(properties)) {
    if (!isRecord(rawProp)) {
      continue;
    }

    // Handle nullable via anyOf/oneOf with null
    let actualProp = rawProp;
    let nullable = false;

    const anyOf = rawProp["anyOf"];
    const oneOf = rawProp["oneOf"];
    const variants = Array.isArray(anyOf) ? anyOf : Array.isArray(oneOf) ? oneOf : null;
    if (variants) {
      const nonNull = variants.filter((v) => isRecord(v) && v["type"] !== "null");
      const hasNull = variants.some((v) => isRecord(v) && v["type"] === "null");
      if (hasNull && nonNull.length === 1 && isRecord(nonNull[0])) {
        nullable = true;
        actualProp = nonNull[0];
      }
    }

    const rawType = typeof actualProp["type"] === "string" ? actualProp["type"] : "string";
    const type = TYPE_MAP[rawType] ?? "string";

    const enumValues = Array.isArray(actualProp["enum"])
      ? actualProp["enum"].filter((v): v is string => typeof v === "string")
      : undefined;

    const format = typeof actualProp["format"] === "string" ? actualProp["format"] : undefined;
    const description =
      typeof actualProp["description"] === "string" ? actualProp["description"] : undefined;

    // Array items
    let items: string | undefined;
    if (type === "array" && isRecord(actualProp["items"])) {
      const itemsObj = actualProp["items"];
      if (typeof itemsObj["$ref"] === "string") {
        items = refToName(itemsObj["$ref"]);
      } else if (typeof itemsObj["type"] === "string") {
        items = itemsObj["type"];
      }
    }

    // Object $ref
    let ref: string | undefined;
    if (typeof actualProp["$ref"] === "string") {
      ref = refToName(actualProp["$ref"]);
    }

    result.push({
      name,
      type: ref ? "object" : type,
      description,
      items,
      ref,
      required: requiredFields.has(name),
      nullable,
      enumValues: enumValues && enumValues.length > 0 ? enumValues : undefined,
      format,
    });
  }

  return result;
}

/** Extract type name from a JSON Schema $ref like "#/$defs/Address" */
function refToName(ref: string): string {
  const parts = ref.split("/");
  return parts[parts.length - 1] ?? ref;
}

/**
 * Validate and parse a JSON Schema file into SchemaDefinition[].
 *
 * Supports:
 * - Single schema with top-level properties → one definition
 * - Schema with $defs/definitions → multiple definitions
 * - Array of schemas (non-standard but practical)
 */
export function validateSchema(raw: unknown): SchemaValidationResult {
  if (!isRecord(raw)) {
    return {
      success: false,
      data: undefined,
      errors: [{ path: "$", message: "Schema must be a JSON object" }],
    };
  }

  const errors: SchemaValidationError[] = [];
  const definitions: SchemaDefinition[] = [];

  // Extract $defs or definitions (JSON Schema draft-07 vs draft-2020-12)
  const defs = isRecord(raw["$defs"])
    ? raw["$defs"]
    : isRecord(raw["definitions"])
      ? raw["definitions"]
      : null;

  if (defs) {
    for (const [name, defRaw] of Object.entries(defs)) {
      if (!isRecord(defRaw)) {
        errors.push({ path: `$defs.${name}`, message: "Definition must be an object" });
        continue;
      }
      const def = parseDefinition(name, defRaw, errors);
      if (def) {
        definitions.push(def);
      }
    }
  }

  // Also parse the root if it has properties (it's itself a type definition)
  if (isRecord(raw["properties"])) {
    const rootName =
      typeof raw["title"] === "string"
        ? raw["title"]
        : typeof raw["$id"] === "string"
          ? idToName(raw["$id"])
          : "Root";
    const def = parseDefinition(rootName, raw, errors);
    if (def) {
      definitions.push(def);
    }
  }

  if (definitions.length === 0 && errors.length === 0) {
    errors.push({
      path: "$",
      message: "No type definitions found. Schema must have properties or $defs.",
    });
  }

  return {
    success: errors.length === 0,
    data: errors.length === 0 ? { definitions } : undefined,
    errors,
  };
}

function parseDefinition(
  name: string,
  raw: Record<string, unknown>,
  errors: SchemaValidationError[],
): SchemaDefinition | null {
  const props = raw["properties"];
  if (!isRecord(props)) {
    errors.push({ path: name, message: "Definition has no properties" });
    return null;
  }

  const requiredRaw = raw["required"];
  const requiredFields = new Set(
    Array.isArray(requiredRaw) ? requiredRaw.filter((r): r is string => typeof r === "string") : [],
  );

  const description = typeof raw["description"] === "string" ? raw["description"] : undefined;
  const properties = parseProperties(props, requiredFields);

  return { name, description, properties };
}

/** Extract a type name from a $id URL like "https://example.com/user.schema.json" */
function idToName(id: string): string {
  const last = id.split("/").pop() ?? id;
  return last.replace(/\.schema\.json$/, "").replace(/\.json$/, "");
}

// ─── Plugin ──────────────────────────────────────────────────────────────────

export const schemaPlugin: DomainPlugin = {
  type: "domain",
  name: "schema",

  async detectBridge(artifact: string, root: string): Promise<boolean> {
    if (!artifact.endsWith(".schema.json")) {
      return false;
    }
    try {
      const absPath = join(root, artifact);
      const content = await readFile(absPath, "utf-8");
      const raw: unknown = JSON.parse(content);
      return (
        isRecord(raw) &&
        (isRecord(raw["properties"]) || isRecord(raw["$defs"]) || isRecord(raw["definitions"]))
      );
    } catch {
      return false;
    }
  },

  async exportArtifact(
    _source: WorkspacePackage,
    artifact: string,
    root: string,
  ): Promise<ExecuteResult> {
    const start = performance.now();
    try {
      const absPath = join(root, artifact);
      const content = await readFile(absPath, "utf-8");
      const raw: unknown = JSON.parse(content);
      const result = validateSchema(raw);

      if (!result.success) {
        const output = result.errors
          .map((e) => `  ${RED}${e.path}: ${e.message}${RESET}`)
          .join("\n");
        return {
          success: false,
          duration: Math.round(performance.now() - start),
          summary: `Schema validation failed (${result.errors.length} error(s))`,
          output,
        };
      }

      return {
        success: true,
        duration: Math.round(performance.now() - start),
        summary: `${result.data!.definitions.length} type(s) validated`,
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        duration: Math.round(performance.now() - start),
        summary: `Failed to read schema: ${msg}`,
      };
    }
  },

  async generateDownstream(
    artifact: string,
    targets: readonly WorkspacePackage[],
    root: string,
    context: ExecutionContext,
  ): Promise<readonly ExecuteResult[]> {
    const absPath = join(root, artifact);
    const content = await readFile(absPath, "utf-8");
    const raw: unknown = JSON.parse(content);
    const validation = validateSchema(raw);

    if (!validation.success || !validation.data) {
      return [
        {
          success: false,
          duration: 0,
          summary: "Schema validation failed — cannot generate downstream",
        },
      ];
    }

    const handlers = await context.findEcosystemHandlers(DOMAIN_NAME, artifact);
    const targetPaths = new Set(targets.map((t) => t.path));
    const relevantHandlers = handlers.filter((h) => targetPaths.has(h.pkg.path));

    if (relevantHandlers.length === 0) {
      return [];
    }

    const sourcePath = artifact.split("/").slice(0, -1).join("/") || ".";
    const sourcePkg = context.graph.packages.get(sourcePath);
    const sourceName = sourcePkg?.name ?? sourcePath.split("/").pop() ?? "generated";

    const results: ExecuteResult[] = [];
    for (const handler of relevantHandlers) {
      const outputDir = join(root, sourcePath, "generated", handler.plugin.name);
      mkdirSync(outputDir, { recursive: true });

      const ctxWithSchema: ExecutionContext = {
        ...context,
        sourceName,
        artifactPath: artifact,
        domainData: validation.data,
        outputDir,
      };

      const result = await handler.plugin.execute(
        handler.capability.action,
        handler.pkg,
        root,
        ctxWithSchema,
      );
      results.push(result);
    }

    return results;
  },

  async buildPipeline(
    source: WorkspacePackage,
    artifact: string,
    targets: readonly WorkspacePackage[],
    root: string,
    context: ExecutionContext,
  ): Promise<readonly ExecutablePipelineStep[]> {
    const steps: ExecutablePipelineStep[] = [];
    const shared: { data: ValidatedSchema | undefined } = { data: undefined };

    // Step 1: Validate schema
    steps.push({
      name: "validate-schema",
      plugin: "schema",
      description: "validating schema...",
      outputPaths: [artifact],
      execute: async (): Promise<ExecuteResult> => {
        const start = performance.now();
        try {
          const absPath = join(root, artifact);
          const content = await readFile(absPath, "utf-8");
          const raw: unknown = JSON.parse(content);
          const result = validateSchema(raw);

          if (!result.success) {
            const output = result.errors
              .map((e) => `  ${RED}${e.path}: ${e.message}${RESET}`)
              .join("\n");
            return {
              success: false,
              duration: Math.round(performance.now() - start),
              summary: "Schema validation failed",
              output,
            };
          }

          shared.data = result.data;
          return {
            success: true,
            duration: Math.round(performance.now() - start),
            summary: `${result.data!.definitions.length} type(s) validated`,
          };
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          return {
            success: false,
            duration: Math.round(performance.now() - start),
            summary: `Failed to read schema: ${msg}`,
          };
        }
      },
    });

    // Steps 2+: Generate per ecosystem
    const handlers = await context.findEcosystemHandlers(DOMAIN_NAME, artifact);
    const targetPaths = new Set(targets.map((t) => t.path));
    const relevantHandlers = handlers.filter((h) => targetPaths.has(h.pkg.path));

    const seenEcosystems = new Set<string>();
    for (const handler of relevantHandlers) {
      if (seenEcosystems.has(handler.plugin.name)) {
        continue;
      }
      seenEcosystems.add(handler.plugin.name);
      const outputDir = join(root, source.path, "generated", handler.plugin.name);

      steps.push({
        name: `generate-${handler.plugin.name}`,
        plugin: handler.plugin.name,
        description: `${handler.capability.description}...`,
        execute: async (): Promise<ExecuteResult> => {
          if (!shared.data) {
            return {
              success: false,
              duration: 0,
              summary: "Cannot generate — schema validation did not run",
            };
          }

          mkdirSync(outputDir, { recursive: true });

          const ctxWithSchema: ExecutionContext = {
            ...context,
            sourceName: source.name,
            artifactPath: artifact,
            domainData: shared.data,
            outputDir,
          };

          return handler.plugin.execute(
            handler.capability.action,
            handler.pkg,
            root,
            ctxWithSchema,
          );
        },
      });
    }

    return steps;
  },
};

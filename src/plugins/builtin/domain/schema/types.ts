/**
 * A single property within a schema definition.
 */
export interface SchemaProperty {
  readonly name: string;
  readonly type: "string" | "number" | "integer" | "boolean" | "array" | "object";
  readonly description?: string | undefined;
  /** For array types, the item type */
  readonly items?: string | undefined;
  /** For object types, the nested type reference */
  readonly ref?: string | undefined;
  readonly required: boolean;
  readonly nullable: boolean;
  /** Enum values if this is an enum property */
  readonly enumValues?: readonly string[] | undefined;
  /** Format hint (e.g., "date-time", "email", "uri") */
  readonly format?: string | undefined;
}

/**
 * A parsed and validated schema definition (one type/struct/class).
 */
export interface SchemaDefinition {
  readonly name: string;
  readonly description?: string | undefined;
  readonly properties: readonly SchemaProperty[];
}

/**
 * The validated output of the schema domain plugin, passed as domainData.
 */
export interface ValidatedSchema {
  readonly definitions: readonly SchemaDefinition[];
}

export interface SchemaValidationError {
  readonly path: string;
  readonly message: string;
}

export interface SchemaValidationResult {
  readonly success: boolean;
  readonly data: ValidatedSchema | undefined;
  readonly errors: readonly SchemaValidationError[];
}

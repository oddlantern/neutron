import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, test, beforeEach, afterEach } from "bun:test";

import {
  extractTypescriptExports,
  extractDartExports,
  diffExports,
  findUsedSymbols,
} from "@/outdated/api-diff";

describe("extractTypescriptExports", () => {
  test("extracts exported functions", () => {
    const content = `
export function foo(): void;
export function bar(x: number): string;
`;
    const exports = extractTypescriptExports(content);
    expect(exports).toEqual(["bar", "foo"]);
  });

  test("extracts exported declare statements", () => {
    const content = `
export declare function create(): Instance;
export declare const VERSION: string;
export declare class Client {}
export declare interface Options {}
export declare type Config = {};
export declare enum Status { Active, Inactive }
`;
    const exports = extractTypescriptExports(content);
    expect(exports).toEqual(["Client", "Config", "Options", "Status", "VERSION", "create"]);
  });

  test("extracts re-export lists", () => {
    const content = `
export { Foo, Bar, Baz };
export { Alpha as Beta };
`;
    const exports = extractTypescriptExports(content);
    expect(exports).toEqual(["Bar", "Baz", "Beta", "Foo"]);
  });

  test("extracts export default with name", () => {
    const content = `export default class MyClass {}`;
    const exports = extractTypescriptExports(content);
    expect(exports).toContain("MyClass");
  });

  test("extracts abstract class", () => {
    const content = `export declare abstract class Base {}`;
    const exports = extractTypescriptExports(content);
    expect(exports).toContain("Base");
  });

  test("handles complex .d.ts content", () => {
    const content = `
export declare function z(): ZodType;
export declare const string: ZodString;
export declare class ZodObject<T> {}
export declare interface ZodType {}
export { ZodError, ZodIssue };
`;
    const exports = extractTypescriptExports(content);
    expect(exports).toContain("z");
    expect(exports).toContain("string");
    expect(exports).toContain("ZodObject");
    expect(exports).toContain("ZodType");
    expect(exports).toContain("ZodError");
    expect(exports).toContain("ZodIssue");
  });

  test("returns empty for no exports", () => {
    const content = `const internal = 42;`;
    const exports = extractTypescriptExports(content);
    expect(exports).toEqual([]);
  });
});

describe("extractDartExports", () => {
  test("extracts classes", () => {
    const content = `
class MyWidget extends StatelessWidget {}
abstract class BaseService {}
`;
    const exports = extractDartExports(content);
    expect(exports).toContain("MyWidget");
    expect(exports).toContain("BaseService");
  });

  test("extracts enums", () => {
    const content = `enum Status { active, inactive }`;
    const exports = extractDartExports(content);
    expect(exports).toContain("Status");
  });

  test("excludes private names (underscore prefix)", () => {
    const content = `
class _PrivateClass {}
class PublicClass {}
`;
    const exports = extractDartExports(content);
    expect(exports).not.toContain("_PrivateClass");
    expect(exports).toContain("PublicClass");
  });

  test("extracts sealed and final classes", () => {
    const content = `
sealed class Shape {}
final class Circle extends Shape {}
`;
    const exports = extractDartExports(content);
    expect(exports).toContain("Shape");
    expect(exports).toContain("Circle");
  });

  test("extracts extensions", () => {
    const content = `extension StringX on String {}`;
    const exports = extractDartExports(content);
    expect(exports).toContain("StringX");
  });

  test("extracts typedefs", () => {
    const content = `typedef Callback = void Function(int);`;
    const exports = extractDartExports(content);
    expect(exports).toContain("Callback");
  });

  test("returns empty for no public API", () => {
    const content = `class _Internal {} // private only`;
    const exports = extractDartExports(content);
    expect(exports).toEqual([]);
  });
});

describe("diffExports", () => {
  test("detects added exports", () => {
    const diff = diffExports(["foo", "bar"], ["foo", "bar", "baz"]);
    expect(diff.added).toEqual(["baz"]);
    expect(diff.removed).toEqual([]);
  });

  test("detects removed exports", () => {
    const diff = diffExports(["foo", "bar", "baz"], ["foo", "bar"]);
    expect(diff.removed).toEqual(["baz"]);
    expect(diff.added).toEqual([]);
  });

  test("detects both added and removed", () => {
    const diff = diffExports(["foo", "bar"], ["foo", "baz"]);
    expect(diff.added).toEqual(["baz"]);
    expect(diff.removed).toEqual(["bar"]);
  });

  test("returns empty diff when identical", () => {
    const diff = diffExports(["foo", "bar"], ["foo", "bar"]);
    expect(diff.added).toEqual([]);
    expect(diff.removed).toEqual([]);
    expect(diff.changed).toEqual([]);
  });

  test("handles empty inputs", () => {
    const diff = diffExports([], ["foo"]);
    expect(diff.added).toEqual(["foo"]);
    expect(diff.removed).toEqual([]);
  });
});

describe("findUsedSymbols", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "mido-find-symbols-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  test("finds named TS imports", async () => {
    await writeFile(join(tmpDir, "app.ts"), `import { Foo, Bar } from "my-pkg";\n`);

    const symbols = await findUsedSymbols(tmpDir, "my-pkg", "typescript", ["app.ts"]);
    expect(symbols).toEqual(["Bar", "Foo"]);
  });

  test("handles aliased imports (returns original name)", async () => {
    await writeFile(join(tmpDir, "app.ts"), `import { Foo as MyFoo } from "my-pkg";\n`);

    const symbols = await findUsedSymbols(tmpDir, "my-pkg", "typescript", ["app.ts"]);
    expect(symbols).toEqual(["Foo"]);
  });

  test("finds deep path imports", async () => {
    await writeFile(join(tmpDir, "app.ts"), `import { X } from "my-pkg/sub/path";\n`);

    const symbols = await findUsedSymbols(tmpDir, "my-pkg", "typescript", ["app.ts"]);
    expect(symbols).toEqual(["X"]);
  });

  test("finds Dart show imports", async () => {
    await writeFile(
      join(tmpDir, "main.dart"),
      `import 'package:my_pkg/my_pkg.dart' show MyClass;\n`,
    );

    const symbols = await findUsedSymbols(tmpDir, "my_pkg", "dart", ["main.dart"]);
    expect(symbols).toEqual(["MyClass"]);
  });

  test("returns empty array for no matching imports", async () => {
    await writeFile(join(tmpDir, "app.ts"), `import { Foo } from "other-pkg";\n`);

    const symbols = await findUsedSymbols(tmpDir, "my-pkg", "typescript", ["app.ts"]);
    expect(symbols).toEqual([]);
  });

  test("skips unreadable files gracefully", async () => {
    const symbols = await findUsedSymbols(tmpDir, "my-pkg", "typescript", ["nonexistent.ts"]);
    expect(symbols).toEqual([]);
  });
});

import { describe, expect, test } from "bun:test";
import { gzipSync } from "node:zlib";

import { extractFromTarGz } from "@/outdated/tarball";

/**
 * Create a minimal tar archive in memory.
 * Tar format: 512-byte header + file content (padded to 512 blocks).
 */
function createTarBuffer(files: readonly { name: string; content: string }[]): Buffer {
  const blocks: Buffer[] = [];

  for (const file of files) {
    // Create header (512 bytes)
    const header = Buffer.alloc(512);

    // Name (bytes 0-99)
    const fullName = `package/${file.name}`;
    header.write(fullName, 0, Math.min(fullName.length, 100), "ascii");

    // Size in octal (bytes 124-135)
    const sizeOctal = file.content.length.toString(8).padStart(11, "0");
    header.write(sizeOctal, 124, 11, "ascii");

    // Typeflag (byte 156) - '0' for regular file
    header.write("0", 156, 1, "ascii");

    // Checksum placeholder (bytes 148-155) - fill with spaces first
    header.fill(0x20, 148, 156);

    // Calculate checksum (sum of all bytes in header, treating checksum field as spaces)
    let checksum = 0;
    for (let i = 0; i < 512; i++) {
      checksum += header[i] ?? 0;
    }
    const checksumOctal = checksum.toString(8).padStart(6, "0") + "\0 ";
    header.write(checksumOctal, 148, 8, "ascii");

    blocks.push(header);

    // File content + padding to 512-byte boundary
    const content = Buffer.from(file.content, "utf-8");
    const paddedSize = Math.ceil(content.length / 512) * 512;
    const contentBlock = Buffer.alloc(paddedSize);
    content.copy(contentBlock);
    blocks.push(contentBlock);
  }

  // End-of-archive: two 512-byte zero blocks
  blocks.push(Buffer.alloc(1024));

  return Buffer.concat(blocks);
}

describe("extractFromTarGz", () => {
  test("extracts files matching filter", () => {
    const tar = createTarBuffer([
      { name: "index.d.ts", content: "export declare function foo(): void;" },
      { name: "utils.d.ts", content: "export declare const bar: string;" },
      { name: "README.md", content: "# Hello" },
    ]);

    const gzipped = gzipSync(tar);
    const result = extractFromTarGz(Buffer.from(gzipped), (path) => path.endsWith(".d.ts"));

    expect(result.size).toBe(2);
    expect(result.get("index.d.ts")).toBe("export declare function foo(): void;");
    expect(result.get("utils.d.ts")).toBe("export declare const bar: string;");
    expect(result.has("README.md")).toBe(false);
  });

  test("strips package/ prefix from npm tarballs", () => {
    const tar = createTarBuffer([
      { name: "dist/index.d.ts", content: "export type X = string;" },
    ]);

    const gzipped = gzipSync(tar);
    const result = extractFromTarGz(Buffer.from(gzipped), (path) => path.endsWith(".d.ts"));

    expect(result.has("dist/index.d.ts")).toBe(true);
  });

  test("returns empty map when no files match filter", () => {
    const tar = createTarBuffer([
      { name: "index.js", content: "module.exports = {};" },
    ]);

    const gzipped = gzipSync(tar);
    const result = extractFromTarGz(Buffer.from(gzipped), (path) => path.endsWith(".d.ts"));

    expect(result.size).toBe(0);
  });

  test("handles empty archive", () => {
    const tar = Buffer.alloc(1024); // Just the end-of-archive marker
    const gzipped = gzipSync(tar);
    const result = extractFromTarGz(Buffer.from(gzipped), () => true);

    expect(result.size).toBe(0);
  });

  test("handles multi-line file content", () => {
    const content = [
      "export declare function a(): void;",
      "export declare function b(): string;",
      "export declare class C {}",
    ].join("\n");

    const tar = createTarBuffer([
      { name: "types.d.ts", content },
    ]);

    const gzipped = gzipSync(tar);
    const result = extractFromTarGz(Buffer.from(gzipped), () => true);

    expect(result.get("types.d.ts")).toBe(content);
  });
});

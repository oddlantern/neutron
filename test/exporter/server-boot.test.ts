import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import {
  detectEntryFile,
  fetchSpec,
  findFreePort,
  formatAttempts,
  waitForServer,
} from "@/plugins/builtin/domain/openapi/server-boot";

// These helpers are the core of the OpenAPI bridge — if detectEntryFile
// picks the wrong file, every bridge silently boots the wrong process;
// if fetchSpec's path fallback is off, zero-config export breaks for
// any framework whose spec lives off the default path. Testing them as
// standalone units is much cheaper than round-tripping through a full
// exporter spawn.

let tmpDir: string;
beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "neutron-server-boot-"));
});
afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

function writeFile(relPath: string, content: string): void {
  const full = join(tmpDir, relPath);
  mkdirSync(join(full, ".."), { recursive: true });
  writeFileSync(full, content, "utf-8");
}

describe("findFreePort", () => {
  test("returns a port number in the ephemeral range", async () => {
    const port = await findFreePort();
    // Ephemeral range is typically 32768+ on Linux / 49152+ on BSD/mac.
    // Anywhere above 1024 (non-privileged) is fine for our purposes.
    expect(port).toBeGreaterThan(1024);
    expect(port).toBeLessThan(65536);
  });

  test("successive calls return distinct ports (no deterministic collision)", async () => {
    const [a, b, c] = await Promise.all([findFreePort(), findFreePort(), findFreePort()]);
    // Three calls should give at least two distinct ports. Even if two
    // happen to collide (possible under load), all three matching is a
    // bug in our allocator.
    const unique = new Set([a, b, c]).size;
    expect(unique).toBeGreaterThanOrEqual(2);
  });
});

describe("detectEntryFile — TypeScript", () => {
  test("prefers the package.json main field when it points to an existing file", async () => {
    writeFile("package.json", JSON.stringify({ main: "dist/server.js" }));
    writeFile("dist/server.js", "// compiled");
    writeFile("src/index.ts", "// source"); // would be a well-known fallback
    expect(await detectEntryFile(tmpDir)).toBe("dist/server.js");
  });

  test("ignores the main field when the target doesn't exist", async () => {
    writeFile("package.json", JSON.stringify({ main: "dist/nonexistent.js" }));
    writeFile("src/index.ts", "// source");
    // Skips the dead main field, falls through to the well-known path
    expect(await detectEntryFile(tmpDir)).toBe("src/index.ts");
  });

  test("parses the entry from a dev script when there's no main field", async () => {
    writeFile("package.json", JSON.stringify({ scripts: { dev: "bun run --watch src/main.ts" } }));
    writeFile("src/main.ts", "// source");
    expect(await detectEntryFile(tmpDir)).toBe("src/main.ts");
  });

  test("dev script takes priority over start script", async () => {
    writeFile(
      "package.json",
      JSON.stringify({
        scripts: {
          dev: "tsx src/dev.ts",
          start: "node dist/prod.js",
        },
      }),
    );
    writeFile("src/dev.ts", "// dev");
    writeFile("dist/prod.js", "// prod");
    expect(await detectEntryFile(tmpDir)).toBe("src/dev.ts");
  });

  test("falls back to well-known paths when no manifest is found", async () => {
    // No package.json at all — should scan well-known candidates.
    writeFile("src/index.ts", "// source");
    expect(await detectEntryFile(tmpDir)).toBe("src/index.ts");
  });

  test("returns null when nothing matches", async () => {
    writeFile("package.json", JSON.stringify({}));
    // No src/index.ts, no main.ts, no app.ts, no Python/Rust files.
    expect(await detectEntryFile(tmpDir)).toBe(null);
  });

  test("ignores dev script referring to a file that doesn't exist", async () => {
    writeFile(
      "package.json",
      JSON.stringify({ scripts: { dev: "tsx src/ghost.ts" } }),
    );
    writeFile("src/index.ts", "// real source");
    // Dev script points to a missing file — shouldn't claim it.
    // Falls through to the well-known path.
    expect(await detectEntryFile(tmpDir)).toBe("src/index.ts");
  });
});

describe("detectEntryFile — Python fallthrough", () => {
  test("finds main.py when no package.json exists", async () => {
    writeFile("main.py", "from fastapi import FastAPI\napp = FastAPI()");
    expect(await detectEntryFile(tmpDir)).toBe("main.py");
  });

  test("prefers src/main.py over main.py (scanning order)", async () => {
    writeFile("src/main.py", "app = FastAPI()");
    writeFile("main.py", "app = FastAPI()");
    expect(await detectEntryFile(tmpDir)).toBe("src/main.py");
  });

  test("finds app.py when main.py is absent", async () => {
    writeFile("app.py", "app = FastAPI()");
    expect(await detectEntryFile(tmpDir)).toBe("app.py");
  });
});

describe("detectEntryFile — Rust fallthrough", () => {
  test("finds src/main.rs", async () => {
    writeFile("src/main.rs", "fn main() {}");
    expect(await detectEntryFile(tmpDir)).toBe("src/main.rs");
  });

  test("finds src/bin/server.rs when no src/main.rs", async () => {
    writeFile("src/bin/server.rs", "fn main() {}");
    expect(await detectEntryFile(tmpDir)).toBe("src/bin/server.rs");
  });

  test("src/main.rs takes priority over src/bin/main.rs", async () => {
    writeFile("src/main.rs", "fn main() {}");
    writeFile("src/bin/main.rs", "fn main() {}");
    expect(await detectEntryFile(tmpDir)).toBe("src/main.rs");
  });
});

describe("fetchSpec — path fallback", () => {
  let server: Server;
  let port: number;

  beforeEach(async () => {
    port = await findFreePort();
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server?.close(() => resolve()));
  });

  function startServer(
    handler: (path: string) => { readonly status: number; readonly body: string } | null,
  ): Promise<void> {
    return new Promise((resolve) => {
      server = createServer((req, res) => {
        const response = handler(req.url ?? "/");
        if (!response) {
          res.writeHead(404);
          res.end();
          return;
        }
        res.writeHead(response.status, { "content-type": "application/json" });
        res.end(response.body);
      });
      server.listen(port, "127.0.0.1", () => resolve());
    });
  }

  test("returns the spec from the first path that responds with valid OpenAPI JSON", async () => {
    await startServer((path) => {
      if (path === "/openapi.json") {
        return { status: 200, body: JSON.stringify({ openapi: "3.1.0", paths: {} }) };
      }
      return null;
    });

    const result = await fetchSpec(port, ["/api-docs/openapi.json", "/openapi.json"]);
    expect(result.spec).not.toBeNull();
    expect(result.path).toBe("/openapi.json");
    // First path failed — attempts recorded it.
    expect(result.attempts.length).toBeGreaterThanOrEqual(1);
    const firstAttempt = result.attempts[0];
    expect(firstAttempt?.path).toBe("/api-docs/openapi.json");
    expect(firstAttempt?.status).toBe(404);
  });

  test("skips non-2xx responses and records the status in attempts", async () => {
    await startServer((path) => {
      if (path === "/openapi.json") return { status: 500, body: "server error" };
      if (path === "/docs/openapi.json") {
        return { status: 200, body: JSON.stringify({ openapi: "3.1.0" }) };
      }
      return null;
    });

    const result = await fetchSpec(port, ["/openapi.json", "/docs/openapi.json"]);
    expect(result.spec).not.toBeNull();
    expect(result.path).toBe("/docs/openapi.json");
    expect(result.attempts[0]?.status).toBe(500);
  });

  test("rejects JSON responses missing openapi/swagger keys", async () => {
    await startServer(() => {
      return { status: 200, body: JSON.stringify({ message: "hello" }) };
    });

    const result = await fetchSpec(port, ["/something"]);
    expect(result.spec).toBeNull();
    const attempt = result.attempts[0];
    expect(attempt?.error).toContain("missing openapi/swagger key");
  });

  test("rejects responses that aren't valid JSON", async () => {
    await startServer(() => {
      return { status: 200, body: "not json at all" };
    });

    const result = await fetchSpec(port, ["/spec"]);
    expect(result.spec).toBeNull();
    const attempt = result.attempts[0];
    expect(attempt?.error).toContain("invalid JSON");
  });

  test("returns spec:null and path:null when no path works", async () => {
    await startServer(() => null);
    const result = await fetchSpec(port, ["/a", "/b", "/c"]);
    expect(result.spec).toBeNull();
    expect(result.path).toBeNull();
    expect(result.attempts).toHaveLength(3);
  });
});

describe("waitForServer", () => {
  test("returns true once the server starts responding", async () => {
    const port = await findFreePort();
    // Start a server after a delay — waitForServer should see it.
    const server = createServer((_req, res) => {
      res.writeHead(200);
      res.end();
    });
    setTimeout(() => server.listen(port, "127.0.0.1"), 200);

    try {
      const ready = await waitForServer(port, 5_000);
      expect(ready).toBe(true);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }, 10_000);

  test("returns false when nothing is listening within the timeout", async () => {
    const port = await findFreePort();
    const started = Date.now();
    const ready = await waitForServer(port, 1_200);
    const elapsed = Date.now() - started;
    expect(ready).toBe(false);
    // Should honor the timeout roughly (not exit early, not hang way past).
    expect(elapsed).toBeGreaterThanOrEqual(1_000);
    expect(elapsed).toBeLessThan(5_000);
  }, 10_000);
});

describe("formatAttempts", () => {
  test("formats attempts with status codes", () => {
    const out = formatAttempts([
      { path: "/openapi.json", status: 404, error: null },
      { path: "/swagger/json", status: 200, error: "invalid JSON" },
    ]);
    expect(out).toContain("/openapi.json → 404");
    expect(out).toContain("/swagger/json → 200");
    expect(out).toContain("(invalid JSON)");
  });

  test("formats attempts without a status (network error)", () => {
    const out = formatAttempts([
      { path: "/openapi.json", status: null, error: "ECONNREFUSED" },
    ]);
    expect(out).toContain("/openapi.json → ECONNREFUSED");
  });

  test("returns empty string for empty attempts", () => {
    expect(formatAttempts([])).toBe("");
  });
});

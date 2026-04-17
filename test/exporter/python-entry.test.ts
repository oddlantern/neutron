import { describe, expect, test } from "bun:test";

import { pythonEntryToModule } from "@/plugins/builtin/domain/openapi/server-boot";

// pythonEntryToModule converts entry-file paths into (module, app) pairs
// that uvicorn understands: `uvicorn <module>:<app> --port <port>`.
// Get the mapping wrong and the server never starts.

describe("pythonEntryToModule", () => {
  test("bare main.py maps to main:app", () => {
    expect(pythonEntryToModule("main.py")).toEqual({ module: "main", app: "app" });
  });

  test("src/main.py maps to src.main:app", () => {
    expect(pythonEntryToModule("src/main.py")).toEqual({ module: "src.main", app: "app" });
  });

  test("deeply nested paths convert slashes to dots", () => {
    expect(pythonEntryToModule("apps/api/server.py")).toEqual({
      module: "apps.api.server",
      app: "app",
    });
  });

  test("explicit :app override takes the provided variable name", () => {
    expect(pythonEntryToModule("main.py:myapp")).toEqual({ module: "main", app: "myapp" });
  });

  test("override works with nested paths", () => {
    expect(pythonEntryToModule("src/server.py:api")).toEqual({
      module: "src.server",
      app: "api",
    });
  });

  test("entry without .py extension is accepted (module-style input)", () => {
    // Callers may pass something like "src.app" directly; handle it
    // without doubling dots or stripping nothing.
    expect(pythonEntryToModule("src.app")).toEqual({ module: "src.app", app: "app" });
  });

  test("app name with dots is preserved as-is", () => {
    // uvicorn supports factory functions like `main:create_app` — we
    // don't interpret the app portion beyond splitting on `:`.
    expect(pythonEntryToModule("main.py:create_app")).toEqual({
      module: "main",
      app: "create_app",
    });
  });
});

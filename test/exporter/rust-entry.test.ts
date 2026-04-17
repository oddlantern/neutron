import { describe, expect, test } from "bun:test";

import { rustEntryToCargoArgs } from "@/plugins/builtin/domain/openapi/server-boot";

// rustEntryToCargoArgs drives the cargo invocation used to boot a Rust
// server for OpenAPI export. Getting the binary name wrong means
// `cargo run` either picks the wrong binary or fails outright when the
// crate has multiple binaries.

describe("rustEntryToCargoArgs", () => {
  test("src/main.rs runs the default binary (no --bin)", () => {
    // Cargo's default binary needs no --bin flag; adding one with the
    // wrong name would error even though the path is correct.
    expect(rustEntryToCargoArgs("src/main.rs")).toEqual(["run", "--release"]);
  });

  test("src/bin/<name>.rs passes --bin <name>", () => {
    expect(rustEntryToCargoArgs("src/bin/server.rs")).toEqual([
      "run",
      "--release",
      "--bin",
      "server",
    ]);
    expect(rustEntryToCargoArgs("src/bin/api.rs")).toEqual([
      "run",
      "--release",
      "--bin",
      "api",
    ]);
  });

  test("hyphenated bin names are passed through verbatim", () => {
    // Cargo accepts kebab-case bin names; the regex shouldn't mangle them.
    expect(rustEntryToCargoArgs("src/bin/payment-worker.rs")).toEqual([
      "run",
      "--release",
      "--bin",
      "payment-worker",
    ]);
  });

  test("non-bin paths (e.g. nested lib files) fall through to default binary", () => {
    // Users who hand-set an entry outside the conventional locations
    // get the default-binary command — their choice of entry has to
    // make sense for their Cargo.toml.
    expect(rustEntryToCargoArgs("lib/main.rs")).toEqual(["run", "--release"]);
    expect(rustEntryToCargoArgs("something-else.rs")).toEqual(["run", "--release"]);
  });
});

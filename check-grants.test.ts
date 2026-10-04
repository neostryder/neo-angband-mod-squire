import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * tools/check-grants.mjs is the CI lint that keeps Squire to what the character knows. These tests run it as CI does, on the real manifest and on schema 2 documents that ask for too much.
 */

const script = fileURLToPath(new URL("./tools/check-grants.mjs", import.meta.url));

/** Run the lint on a manifest object and return whether it passed and what it printed. */
function check(manifest: unknown): { passed: boolean; output: string } {
  const dir = mkdtempSync(join(tmpdir(), "squire-grants-"));
  try {
    const path = join(dir, "manifest.json");
    writeFileSync(path, JSON.stringify(manifest));
    try {
      execFileSync(process.execPath, [script, path], { stdio: "pipe" });
      return { passed: true, output: "" };
    } catch (error) {
      const stderr = (error as { stderr?: Buffer }).stderr;
      return { passed: false, output: stderr?.toString() ?? "" };
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** A schema 2 document holding the given grants. */
const v2 = (capabilities: readonly string[]): unknown => ({
  format: "neo-angband/mod/manifest",
  schemaVersion: 2,
  data: { id: "squire", capabilities },
});

describe("check-grants", () => {
  it("passes the real manifest", () => {
    expect(() => execFileSync(process.execPath, [script], { stdio: "pipe" })).not.toThrow();
  });

  it("passes named domain reads and the command host", () => {
    expect(check(v2(["state:player.read", "state:map.read", "registry:command", "profiles:manage"])).passed).toBe(true);
  });

  it.each([
    "state:map-actual.read",
    "state:*.read",
    "state:player.write",
    "state:raw",
    "truth",
    "truth:map",
    "core",
    "core:engine",
    "registries",
    "registry:*",
    "registry:monster",
  ])("fails a schema 2 manifest that asks for %s", (grant) => {
    const result = check(v2(["state:player.read", grant]));
    expect(result.passed).toBe(false);
    expect(result.output).toContain(grant);
  });

  it("still reads a bare schema 1 manifest", () => {
    expect(check({ id: "squire", capabilities: ["state:map-actual.read"] }).passed).toBe(false);
    expect(check({ id: "squire", capabilities: ["state:map.read"] }).passed).toBe(true);
  });
});

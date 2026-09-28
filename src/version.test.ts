import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { MOD_VERSION } from "./runtime.js";

describe("version", () => {
  it("reports the version the manifest installs", () => {
    const root = join(dirname(fileURLToPath(import.meta.url)), "..");
    const manifest = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8")) as { version: string };
    expect(MOD_VERSION).toBe(manifest.version);
  });
});

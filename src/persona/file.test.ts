import { describe, expect, it } from "vitest";
import { exportPersona, importPersona } from "./file.js";
import { defaultPersona } from "./persona.js";

describe("persona file", () => {
  it("round trips a formatted version one file", () => {
    const persona = defaultPersona("Nia");
    const text = exportPersona(persona);
    expect(text.endsWith("\n")).toBe(true);
    expect(text).toContain('  "schemaVersion": 1');
    expect(importPersona(text)).toEqual({ ok: true, persona });
  });

  it("explains malformed and newer files", () => {
    expect(importPersona("{")).toEqual({ ok: false, problem: "This file is not valid JSON." });
    expect(importPersona("{} ")).toEqual({ ok: false, problem: "This file is not a Squire persona." });
    expect(importPersona('{"format":"neo-angband/squire/persona","schemaVersion":2,"data":{}}'))
      .toEqual({ ok: false, problem: "This file is from a newer Squire." });
    expect(importPersona('{"format":"neo-angband/squire/persona","schemaVersion":1,"data":null}').ok).toBe(false);
  });
});

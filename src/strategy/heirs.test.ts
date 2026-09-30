import { describe, expect, it } from "vitest";
import { defaultPersona, type Persona } from "../persona/persona.js";
import type { Aim } from "./aims.js";
import { depthCeiling, inheritAims, passableAims, withInherited, type InheritedAim } from "./heirs.js";

function aim(kind: Aim["kind"], depth: number | null = null): Aim {
  return { kind, label: kind, detail: "", how: kind === "depth" ? "dive" : "hunt", price: null, depth };
}

function pair(inheritance: number, ambition: number): { parent: Persona; heir: Persona } {
  const parent = defaultPersona("Ada");
  parent.sliders.inheritance = inheritance;
  const heir = defaultPersona("Bea");
  heir.sliders.ambition = ambition;
  return { parent, heir };
}

const LINE: readonly InheritedAim[] = [{ kind: "depth", depth: 10 }, { kind: "weapon", depth: null }];

describe("which aims can pass to an heir", () => {
  it("keeps a depth target and a weapon and drops the kit and class aims", () => {
    const ranked = ["spellbook", "lantern", "armour", "weapon", "free-action", "see-invisible", "depth"].map((k) => aim(k as Aim["kind"], k === "depth" ? 12 : null));
    expect(passableAims(ranked)).toEqual([{ kind: "weapon", depth: null }, { kind: "depth", depth: 12 }]);
  });

  it("ignores a stored kit aim when an heir is born", () => {
    const { parent, heir } = pair(100, 100);
    const stored = [{ kind: "lantern", depth: null }, { kind: "spellbook", depth: null }] as unknown as InheritedAim[];
    expect(inheritAims(stored, parent, heir)).toEqual([]);
  });
});

describe("the Inheritance slider", () => {
  it("passes every aim at 100 and the depth at full strength", () => {
    const { parent, heir } = pair(100, 100);
    expect(inheritAims(LINE, parent, heir)).toEqual(LINE);
  });

  it("passes nothing at 0", () => {
    const { parent, heir } = pair(0, 100);
    expect(inheritAims(LINE, parent, heir)).toEqual([]);
  });

  it("passes only the best-ranked aim at 50, with the depth halved", () => {
    const { parent, heir } = pair(50, 100);
    expect(inheritAims(LINE, parent, heir)).toEqual([{ kind: "depth", depth: 5 }]);
    expect(inheritAims([...LINE].reverse(), parent, heir)).toEqual([{ kind: "weapon", depth: null }]);
  });

  it("reads the parent's slider, not the heir's", () => {
    const { parent, heir } = pair(0, 100);
    heir.sliders.inheritance = 100;
    expect(inheritAims(LINE, parent, heir)).toEqual([]);
  });
});

describe("an heir's persona and an inherited aim", () => {
  it("drops a depth target deeper than the heir's ambition allows, and keeps the weapon", () => {
    const { parent, heir } = pair(100, 20);
    expect(depthCeiling(20)).toBe(10);
    expect(inheritAims([{ kind: "depth", depth: 14 }, { kind: "weapon", depth: null }], parent, heir)).toEqual([{ kind: "weapon", depth: null }]);
  });

  it("keeps a depth target within the ceiling", () => {
    const { parent, heir } = pair(100, 20);
    expect(inheritAims([{ kind: "depth", depth: 10 }], parent, heir)).toEqual([{ kind: "depth", depth: 10 }]);
  });

  it("lets an ambitious heir keep a deep target", () => {
    const { parent, heir } = pair(100, 100);
    expect(inheritAims([{ kind: "depth", depth: 25 }], parent, heir)).toEqual([{ kind: "depth", depth: 25 }]);
  });
});

describe("folding inherited aims into the first candidates", () => {
  it("raises a shallower depth target and adds a missing weapon aim", () => {
    const out = withInherited([aim("depth", 1)], LINE);
    expect(out.find((a) => a.kind === "depth")?.depth).toBe(10);
    expect(out.find((a) => a.kind === "weapon")?.how).toBe("hunt");
  });

  it("leaves a deeper own target and an own weapon aim alone", () => {
    const own = [{ ...aim("weapon"), how: "save" as const, price: 300 }, aim("depth", 12)];
    expect(withInherited(own, LINE)).toEqual(own);
  });
});
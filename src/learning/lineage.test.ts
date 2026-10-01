import { describe, expect, it } from "vitest";
import { defaultPersona } from "../persona/persona.js";
import { lessonFrom } from "./lessons.js";
import { inherit, type Lineage } from "./lineage.js";
import { signatureOf } from "./signature.js";

const signature = signatureOf({ depth: 10, classId: "mage", level: 10, races: ["orc"], hp: 50, maxHp: 100, resources: [] });

describe("lineage", () => {
  it("passes lore and grudges through three generations", () => {
    const founder = defaultPersona("Ada");
    founder.sliders.inheritance = 100;
    founder.sliders.resemblance = 50;
    founder.sliders.boldness = 90;
    const base: Lineage = { name: "Ada", race: "Elf", cls: "Mage", generation: 1, ancestors: [], lore: [lessonFrom("died", signature, "fight", 20)], grudges: [], died: { depth: 10, cause: "cave troll", turn: 30 } };
    const child = defaultPersona("Bea");
    const second = inherit(base, founder, child, () => 0.5);
    expect(second.lineage.generation).toBe(2);
    expect(second.lineage.ancestors[0]).toMatchObject({ name: "Ada", race: "Elf", cls: "Mage" });
    expect(second.lineage.lore[0]?.weight).toBe(0.5);
    expect(second.lineage.grudges[0]).toEqual({ race: "cave troll", family: "troll", generation: 1 });
    expect(second.persona.sliders.boldness).toBe(70);
    expect(second.persona.lists.hated).toEqual(["troll"]);
    const parentLineage: Lineage = { ...second.lineage, race: "Human", cls: "Warrior", died: { depth: 20, cause: "young dragon", turn: 90 } };
    second.persona.sliders.inheritance = 100;
    second.persona.sliders.resemblance = 100;
    const third = inherit(parentLineage, second.persona, defaultPersona("Cia"), () => 0.5);
    expect(third.lineage.generation).toBe(3);
    expect(third.lineage.ancestors.map((a) => a.name)).toEqual(["Ada", "Bea"]);
    expect(third.lineage.lore[0]?.weight).toBe(0.25);
    expect(third.persona.lists.hated).toEqual(["dragon"]);
  });

  it("honors zero inheritance and fearful grudges without duplicates", () => {
    const parent = defaultPersona("Ada");
    parent.sliders.inheritance = 0;
    const heir = defaultPersona("Bea");
    heir.sliders.boldness = 30;
    heir.lists.feared = ["orc"];
    const base: Lineage = { name: "Ada", generation: 1, ancestors: [], lore: [lessonFrom("loss", signature, "fight", 1)], grudges: [], died: { depth: 1, cause: "orc", turn: 2 } };
    const result = inherit(base, parent, heir, () => 0);
    expect(result.lineage.lore).toEqual([]);
    expect(result.persona.lists.feared).toEqual(["orc"]);
    expect(heir.lists.feared).toEqual(["orc"]);
  });

  it.each(["inheritance", "parent", "heir"])("keeps killer history without passing grudges when %s disables them", (setting) => {
    const parent = defaultPersona("Ada");
    parent.sliders.inheritance = setting === "inheritance" ? 0 : 100;
    parent.toggles.grudges = setting !== "parent";
    const heir = defaultPersona("Bea");
    heir.toggles.grudges = setting !== "heir";
    heir.lists.hated = ["dragon"];
    const killers = [{ name: "cave troll", unique: false, deaths: [{ generation: 1, depth: 10, turn: 30 }] }];
    const base: Lineage = { name: "Ada", generation: 1, ancestors: [], lore: [], grudges: [], killers, died: { depth: 10, cause: "cave troll", turn: 30 } };
    const result = inherit(base, parent, heir, () => 0.5);
    expect(result.lineage.killers).toEqual(killers);
    expect(result.lineage.feelings).toEqual([]);
    expect(result.lineage.grudges).toEqual([]);
    expect(result.persona.lists.hated).toEqual(["dragon"]);
    expect(result.persona.lists.feared).toEqual([]);
  });

  it("passes named feelings and the killer family when both toggles permit inheritance", () => {
    const parent = defaultPersona("Ada");
    parent.sliders.inheritance = 100;
    const killers = [{ name: "cave troll", unique: false, deaths: [{ generation: 1, depth: 10, turn: 30 }] }];
    const result = inherit({ name: "Ada", generation: 1, ancestors: [], lore: [], grudges: [], killers, died: { depth: 10, cause: "cave troll", turn: 30 } }, parent, defaultPersona("Bea"), () => 0.5);
    expect(result.lineage.feelings).toHaveLength(1);
    expect(result.lineage.feelings?.[0]?.name).toBe("cave troll");
    expect([...result.persona.lists.hated, ...result.persona.lists.feared]).toContain("troll");
  });
});

describe("inherited aims", () => {
  const base: Lineage = { name: "Ada", generation: 1, ancestors: [], lore: [], grudges: [], aims: [{ kind: "depth", depth: 20 }, { kind: "weapon", depth: null }] };

  it("carries them by the parent's Inheritance slider and the heir's ambition", () => {
    const parent = defaultPersona("Ada");
    parent.sliders.inheritance = 100;
    const bold = defaultPersona("Bea");
    bold.sliders.ambition = 100;
    expect(inherit(base, parent, bold, () => 0.5).lineage.aims).toEqual(base.aims);
    const meek = defaultPersona("Cia");
    meek.sliders.ambition = 10;
    const meekAims = inherit(base, parent, meek, () => 0.5).lineage.aims ?? [];
    expect(meekAims.map((aim) => aim.kind)).toEqual(["depth", "weapon"]);
    expect(meekAims[0]?.depth ?? 0).toBeLessThan(base.aims?.[0]?.depth ?? 0);
    parent.sliders.inheritance = 0;
    expect(inherit(base, parent, bold, () => 0.5).lineage.aims).toEqual([]);
  });

  it("starts an heir of an old line with none", () => {
    const { lineage } = inherit({ name: "Ada", generation: 1, ancestors: [], lore: [], grudges: [] }, defaultPersona("Ada"), defaultPersona("Bea"), () => 0.5);
    expect(lineage.aims).toEqual([]);
  });
});
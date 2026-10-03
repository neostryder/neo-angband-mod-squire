import { describe, expect, it } from "vitest";
import { PARAMETERS } from "../persona/catalog.js";
import { defaultPersona } from "../persona/persona.js";
import { lessonFrom } from "./lessons.js";
import { FAMILY_LEVERS, heirTreatment, inherit, type HeirTreatment, type Lineage } from "./lineage.js";
import { signatureOf } from "./signature.js";

const signature = signatureOf({ depth: 10, classId: "mage", level: 10, races: ["orc"], hp: 50, maxHp: 100, resources: [] });

describe("lineage", () => {
  it("passes lore and grudges through three generations", () => {
    const founder = defaultPersona("Ada");
    founder.sliders.inheritance = 100;
    founder.sliders.resemblance = 50;
    founder.sliders.boldness = 90;
    founder.sliders.mercy = 90;
    const base: Lineage = { name: "Ada", race: "Elf", cls: "Mage", generation: 1, ancestors: [], lore: [lessonFrom("died", signature, "fight", 20)], grudges: [], died: { depth: 10, cause: "cave troll", turn: 30 } };
    const child = defaultPersona("Bea");
    const second = inherit(base, founder, child, () => 0.5);
    expect(second.lineage.generation).toBe(2);
    expect(second.lineage.ancestors[0]).toMatchObject({ name: "Ada", race: "Elf", cls: "Mage" });
    expect(second.lineage.lore[0]?.weight).toBe(0.5);
    expect(second.lineage.grudges[0]).toEqual({ race: "cave troll", family: "troll", generation: 1 });
    /* Boldness is rolled (here at the middle); Mercy is pulled halfway to the founder's. */
    expect(second.persona.sliders.boldness).toBe(50);
    expect(second.persona.sliders.mercy).toBe(70);
    expect(second.persona.lists.hated).toEqual(["troll"]);
    const parentLineage: Lineage = { ...second.lineage, race: "Human", cls: "Warrior", died: { depth: 20, cause: "young dragon", turn: 90 } };
    second.persona.sliders.inheritance = 100;
    second.persona.sliders.resemblance = 100;
    const third = inherit(parentLineage, second.persona, defaultPersona("Cia"), () => 0.5);
    expect(third.lineage.generation).toBe(3);
    expect(third.lineage.ancestors.map((a) => a.name)).toEqual(["Ada", "Bea"]);
    expect(third.lineage.lore[0]?.weight).toBe(0.25);
    expect(third.persona.lists.hated).toEqual(["troll", "dragon"]);
  });

  it("honors zero inheritance and fearful grudges without duplicates", () => {
    const parent = defaultPersona("Ada");
    parent.sliders.inheritance = 0;
    const base: Lineage = { name: "Ada", generation: 1, ancestors: [], lore: [lessonFrom("loss", signature, "fight", 1)], grudges: [], died: { depth: 1, cause: "orc", turn: 2 } };
    expect(inherit(base, parent, defaultPersona("Bea"), () => 0).lineage.lore).toEqual([]);
    /* At rng 0 the heir rolls timid, so it fears the orc its parent already feared. */
    parent.sliders.inheritance = 100;
    parent.sliders.resemblance = 100;
    parent.lists.feared = ["orc"];
    const result = inherit(base, parent, defaultPersona("Bea"), () => 0);
    expect(result.persona.sliders.boldness).toBe(20);
    expect(result.persona.lists.feared).toEqual(["orc"]);
    expect(parent.lists.feared).toEqual(["orc"]);
  });

  it.each(["inheritance", "parent", "heir"])("keeps killer history without passing grudges when %s disables them", (setting) => {
    const parent = defaultPersona("Ada");
    parent.sliders.inheritance = setting === "inheritance" ? 0 : 100;
    parent.toggles.grudges = setting !== "parent";
    parent.sliders.resemblance = 100;
    parent.lists.hated = ["dragon"];
    const heir = defaultPersona("Bea");
    heir.toggles.grudges = setting !== "heir";
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
    /* Ambition is a family lever, so at full resemblance the heir takes the parent's. */
    const parent = defaultPersona("Ada");
    parent.sliders.inheritance = 100;
    parent.sliders.resemblance = 100;
    parent.sliders.ambition = 100;
    const bold = inherit(base, parent, defaultPersona("Bea"), () => 0.5);
    expect(bold.persona.sliders.ambition).toBe(100);
    expect(bold.lineage.aims).toEqual(base.aims);
    parent.sliders.ambition = 10;
    const meekAims = inherit(base, parent, defaultPersona("Cia"), () => 0.5).lineage.aims ?? [];
    expect(meekAims.map((aim) => aim.kind)).toEqual(["depth", "weapon"]);
    expect(meekAims[0]?.depth ?? 0).toBeLessThan(base.aims?.[0]?.depth ?? 0);
    parent.sliders.inheritance = 0;
    expect(inherit(base, parent, defaultPersona("Bea"), () => 0.5).lineage.aims).toEqual([]);
  });

  it("starts an heir of an old line with none", () => {
    const { lineage } = inherit({ name: "Ada", generation: 1, ancestors: [], lore: [], grudges: [] }, defaultPersona("Ada"), defaultPersona("Bea"), () => 0.5);
    expect(lineage.aims).toEqual([]);
  });
});

/**
 * Every catalog lever and how an heir gets it. A lever added to the catalog
 * fails the first test below until it is classified here.
 */
const TREATMENT: Readonly<Record<string, HeirTreatment>> = {
  boldness: "rolled", impulsiveness: "rolled", patience: "rolled", composure: "rolled", stubbornness: "rolled",
  curiosity: "rolled", paranoia: "rolled", optimism: "rolled", volatility: "rolled", pride: "rolled", lawchaos: "inherited",
  selfpreservation: "rolled", greed: "inherited", ambition: "inherited", honour: "inherited", mercy: "inherited", glory: "inherited", goodevil: "inherited",
  hated: "inherited", feared: "inherited", weapons: "rolled", distrusted: "inherited", elements: "rolled", superstitions: "inherited",
  hoarding: "inherited", tidiness: "rolled", home: "inherited", towntrips: "rolled", detection: "rolled", levelfeel: "rolled",
  range: "rolled", escapes: "rolled", healat: "rolled", retreatat: "rolled", targets: "rolled", consumables: "rolled", corridors: "rolled",
  pricesense: "rolled", savings: "rolled", selling: "rolled",
  forgetful: "rolled", delusional: "rolled", compulsive: "rolled", pyromaniac: "rolled", deathwish: "rolled", cowardice: "rolled",
  inheritance: "kept", grudges: "kept", epitaphs: "kept", milestones: "kept", namesakes: "kept", inheritedSuperstitions: "kept",
  darkLessons: "kept", trophies: "kept", favouredGrounds: "kept", familyMotto: "kept", favouredWeapons: "kept", cursedGround: "kept",
  celebrations: "kept", firstKillBoasts: "kept", heirlooms: "kept", resemblance: "kept",
  devotion: "inherited", gratitude: "inherited", resentment: "inherited",
  strength: "kept", backstory: "kept", backstorycap: "kept", learning: "kept", drift: "kept", confidence: "kept", depth: "kept", chronicle: "kept",
};

describe("what an heir inherits and what it rolls", () => {
  it("classifies every lever in the catalog", () => {
    expect(Object.keys(TREATMENT).sort()).toEqual(PARAMETERS.map((p) => p.id).sort());
    for (const parameter of PARAMETERS) expect(heirTreatment(parameter), parameter.id).toBe(TREATMENT[parameter.id]);
  });

  it("inherits exactly the sixteen family levers", () => {
    expect(FAMILY_LEVERS).toHaveLength(16);
    expect(PARAMETERS.filter((p) => heirTreatment(p) === "inherited").map((p) => p.id).sort()).toEqual([...FAMILY_LEVERS].sort());
  });

  /** A parent at 0 on every slider with a list entry each, and a starting persona at 100 with every quirk on. */
  function family(resemblance: number) {
    const parent = defaultPersona("Ada");
    for (const parameter of PARAMETERS) {
      if (parameter.kind === "slider") parent.sliders[parameter.id] = 0;
      if (parameter.kind === "list") parent.lists[parameter.id] = [`parent ${parameter.id}`];
    }
    parent.sliders.resemblance = resemblance;
    const start = defaultPersona("Bea");
    for (const parameter of PARAMETERS) {
      if (parameter.kind === "slider") start.sliders[parameter.id] = 100;
      if (parameter.kind === "list") start.lists[parameter.id] = [`start ${parameter.id}`];
      if (parameter.kind === "quirk") start.quirks[parameter.id] = { on: true, strength: 90 };
      if (parameter.kind === "toggle") start.toggles[parameter.id] = !parameter.default;
    }
    start.backstoryCap = 1234;
    start.backstory = "Born under a bad sign.";
    start.preset = "diver";
    const line: Lineage = { name: "Ada", generation: 1, ancestors: [], lore: [], grudges: [] };
    return { parent, start, line };
  }

  it("pulls family levers to the parent, rolls the rest, and keeps the player's settings", () => {
    const { parent, start, line } = family(100);
    /* At rng 0.999 every roll is 80, and the quirk roll turns on Craven and Pyromaniac. */
    const heir = inherit(line, parent, start, () => 0.999).persona;
    for (const parameter of PARAMETERS) {
      const treatment = heirTreatment(parameter);
      if (parameter.kind === "slider") {
        const expected = treatment === "inherited" ? 0 : treatment === "rolled" ? 80 : 100;
        expect(heir.sliders[parameter.id], parameter.id).toBe(expected);
      } else if (parameter.kind === "list") {
        expect(heir.lists[parameter.id], parameter.id).toEqual(treatment === "inherited" ? [`parent ${parameter.id}`] : []);
      } else if (parameter.kind === "quirk") {
        expect(heir.quirks[parameter.id].on, parameter.id).toBe(parameter.id === "cowardice" || parameter.id === "pyromaniac");
      } else if (parameter.kind === "toggle") {
        expect(heir.toggles[parameter.id], parameter.id).toBe(!parameter.default);
      }
    }
    expect(heir.name).toBe("Bea");
    expect(heir.backstoryCap).toBe(1234);
    expect(heir.backstory).toBe("Born under a bad sign.");
    expect(heir.preset).toBeNull();
  });

  it("leaves family levers at the heir's own roll when the parent sets no resemblance", () => {
    const { parent, start, line } = family(0);
    const heir = inherit(line, parent, start, () => 0.999).persona;
    for (const id of FAMILY_LEVERS) {
      if (id in heir.sliders) expect(heir.sliders[id as keyof typeof heir.sliders], id).toBe(80);
      else expect(heir.lists[id as keyof typeof heir.lists], id).toEqual([]);
    }
  });

  it("pulls part of the way at partial resemblance and rolls differently for different heirs", () => {
    const { parent, start, line } = family(50);
    const a = inherit(line, parent, start, () => 0.999).persona;
    expect(a.sliders.goodevil).toBe(40);
    expect(a.sliders.lawchaos).toBe(40);
    expect(a.lists.hated).toEqual(["parent hated"]);
    const b = inherit(line, parent, start, () => 0).persona;
    expect(b.sliders.boldness).toBe(20);
    expect(b.sliders.goodevil).toBe(10);
    expect(a.sliders.boldness).not.toBe(b.sliders.boldness);
  });
});

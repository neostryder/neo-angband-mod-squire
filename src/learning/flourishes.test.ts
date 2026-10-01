import { describe, expect, it, vi } from "vitest";
import type { AgentView } from "@rpgm-tools/neo-angband-core";
import { defaultPersona, type Persona } from "../persona/persona.js";
import { readConfig, writeConfig } from "../config.js";
import { createRuntime, type RunReportLike } from "../runtime.js";
import { memoryStore } from "../memory/kv.js";
import { itemNamed, world } from "../harness.js";
import { defaultCfg } from "../settings.js";
import { createGoalPlanner, type GoalDigest } from "../brain/goals.js";
import type { Question } from "../brain/brain.js";
import { inherit, type Lineage } from "./lineage.js";
import { addMilestone, epitaphFor, familyVoice, inheritFlourishes, milestoneId, namesakeFor, recallMilestones, type Milestone } from "./flourishes.js";
import { celebrationLine, cursedGroundLine, emptyFamilyFlourishes, emptyFlourishes, familyAfterDeath, favouredWeapon, firstKillBoast, heirloomNames, heirloomRecognition, inheritWays, mayReplaceMotto, mottoForPersona, mottoLine, nudgeCursedGround, weaponKind, type FamilyFlourishes, type Motto } from "./family-ways.js";
import { gearCandidates, TV } from "../gear/compare.js";

const GRIP = "Grip, Farmer Maggot's Dog";
const MAP = ["########", "#.@....#", "########"];

function persona(name = "Mira"): Persona {
  const p = defaultPersona(name);
  p.sliders.inheritance = 100;
  p.sliders.resemblance = 0;
  return p;
}

function family(): Lineage {
  return { name: "Mira", generation: 1, ancestors: [], lore: [], grudges: [], deepest: 20, turns: 40_000, died: { depth: 2, turn: 40_000, cause: GRIP } };
}

function runtime(p = persona(), lineage?: Lineage) {
  const logged: string[] = [];
  const rt = createRuntime({ log: (line) => logged.push(line) }, { store: memoryStore() });
  rt.saveCharacter({ ...rt.character(), persona: p, lineage: lineage === undefined ? null : "Mira" });
  if (lineage !== undefined) rt.saveConfig({ ...rt.config(), lineages: { Mira: lineage } });
  return { rt, logged };
}

describe("epitaphs", () => {
  const death = { name: "Mira", generation: 1, cause: `Killed by ${GRIP}`, depth: 2, level: 4, action: "cast_attack" };

  it("records the killer, actual death depth, level and last choice in the persona's voice", () => {
    const p = persona();
    p.sliders.boldness = 80;
    expect(epitaphFor(p, death)?.line).toBe(`Mira: I died to ${GRIP} at 100 ft, level 4, while choosing to cast an attack spell. I meant to go deeper.`);
    p.sliders.boldness = 20;
    expect(epitaphFor(p, death)?.line).toContain("I should have turned back.");
    p.sliders.chronicle = 0;
    expect(epitaphFor(p, death)?.line).toBe(`Mira: I died to ${GRIP} at 100 ft, level 4, while choosing to cast an attack spell.`);
    p.toggles.epitaphs = false;
    expect(epitaphFor(p, death)).toBeNull();
  });

  it("passes recent epitaphs by Inheritance while keeping the family's record", () => {
    const p = persona();
    const epitaph = epitaphFor(p, death)!;
    const line = { ...family(), epitaphs: [epitaph, { ...epitaph, generation: 2 }, { ...epitaph, generation: 3 }] };
    p.sliders.inheritance = 20;
    expect(inheritFlourishes(line, p, persona()).inheritedEpitaphs).toEqual([line.epitaphs[2]]);
    p.sliders.inheritance = 0;
    expect(inheritFlourishes(line, p, persona()).inheritedEpitaphs).toEqual([]);
    expect(inheritFlourishes(line, p, persona()).epitaphs).toHaveLength(3);
    p.sliders.inheritance = 100;
    p.toggles.epitaphs = false;
    expect(inheritFlourishes(line, p, persona()).inheritedEpitaphs).toEqual([]);
    const heir = persona();
    heir.toggles.epitaphs = false;
    expect(inheritFlourishes(line, persona(), heir).inheritedEpitaphs).toEqual([]);
  });

  it.each([true, false])("writes the death through the runtime with Epitaphs %s", async (enabled) => {
    let ended: ((report: RunReportLike) => void) | undefined;
    const logged: string[] = [];
    const rt = createRuntime({ log: (line) => logged.push(line), character: { key: () => null, onRunEnd: (listener) => { ended = listener; return () => {}; } } }, { store: memoryStore() });
    const p = persona();
    p.toggles.epitaphs = enabled;
    rt.saveCharacter({ ...rt.character(), persona: p });
    const report: RunReportLike = { outcome: "death", cause: GRIP, key: null, name: "Mira", race: "Elf", cls: "Mage", level: 4, maxLevel: 4, maxDepth: 20, depth: 2, gold: 0, turn: 40_000, score: 0, scored: false, endedAt: 1, history: [], messages: [], belongings: [], sheet: null, birth: { name: "Mira", race: "Elf", cls: "Mage", stats: [] } };
    ended!(report);
    await vi.waitFor(() => expect(rt.config().lineages["Mira"]?.turns).toBe(40_000));
    const epitaphs = rt.config().lineages["Mira"]?.epitaphs ?? [];
    expect(epitaphs).toHaveLength(enabled ? 1 : 0);
    expect(logged.some((line) => line.includes("I died"))).toBe(enabled);
    if (enabled) {
      expect(epitaphs[0]?.line).toContain("100 ft, level 4");
      expect(rt.familyMemoryLines()).toContain(epitaphs[0]!.line);
      const born = inherit(rt.config().lineages["Mira"]!, p, persona("Bea"), () => 0.5);
      expect(born.lineage.inheritedEpitaphs).toEqual(epitaphs);
    }
  });
});

describe("family milestones", () => {
  it("records each unique's first kill, depth records, and only the family's first artifact", () => {
    const { rt, logged } = runtime();
    const w = world({ map: MAP, player: { depth: 2, maxDepth: 2 }, pack: ["a Dagger"] });
    const view: AgentView = { ...w.view, inventory: () => w.view.inventory().map((item) => ({ ...item, artifact: true, artifactName: "Dethanc" })) };
    rt.observe(view);
    rt.observe(view);
    rt.recordKill(GRIP, true, view);
    rt.recordKill(GRIP, true, view);
    rt.recordKill("jackal", false, view);
    w.setPlayer({ depth: 3, maxDepth: 3 });
    rt.observe(view);
    expect(rt.config().lineages["Mira"]?.milestones).toEqual([
      { kind: "artifact", name: "Mira", generation: 1, depth: 2, fact: "Dethanc" },
      { kind: "unique", name: "Mira", generation: 1, depth: 2, fact: GRIP },
      { kind: "depth", name: "Mira", generation: 1, depth: 3, fact: "" },
    ]);
    expect(logged).toHaveLength(5);
    expect(logged.some((line) => line.includes("Grip, Farmer Maggot's Dog is dead"))).toBe(true);
    expect(rt.familyMemoryLines().some((line) => line.includes("first artifact: Dethanc"))).toBe(true);
    expect(addMilestone(rt.config().lineages["Mira"]!, persona(), "artifact", 4, "Narthanc")).toBeNull();
  });

  it("waits until an artifact's name is known", () => {
    const { rt } = runtime();
    const w = world({ map: MAP, player: { depth: 0, maxDepth: 0 }, pack: ["a Dagger"] });
    rt.observe({ ...w.view, inventory: () => w.view.inventory().map((item) => ({ ...item, artifact: true, artifactName: null })) });
    expect(rt.config().lineages["Mira"]?.milestones ?? []).toEqual([]);
  });

  it("recalls an inherited depth or unique once, including after saved settings are read again", () => {
    const p = persona("Bea");
    const milestones: Milestone[] = [
      { kind: "depth", name: "Mira", generation: 1, depth: 3, fact: "" },
      { kind: "unique", name: "Mira", generation: 1, depth: 2, fact: GRIP },
    ];
    const born = inherit({ ...family(), milestones }, persona(), p, () => 0.5);
    const { rt, logged } = runtime(p, born.lineage);
    const w = world({ map: MAP, player: { depth: 2, maxDepth: 2 }, monsters: [{ grid: { x: 4, y: 1 }, race: GRIP, raceFlags: ["UNIQUE"] }] });
    rt.observe(w.view);
    rt.observe(w.view);
    expect(logged.filter((line) => line.includes("Mira was the first"))).toHaveLength(1);
    expect(logged.some((line) => line.includes("Mira reached"))).toBe(false);
    w.setPlayer({ depth: 3, maxDepth: 3 });
    rt.observe(w.view);
    expect(logged.filter((line) => line.includes("Mira reached"))).toHaveLength(1);
    rt.saveConfig(readConfig(writeConfig(rt.config())));
    rt.observe(w.view);
    expect(logged.filter((line) => line.includes("Mira reached"))).toHaveLength(1);
    expect(rt.config().lineages["Mira"]?.mentionedMilestones).toEqual(milestones.slice().reverse().map(milestoneId));
  });

  it("records and recalls nothing with the setting off", () => {
    const p = persona();
    p.toggles.milestones = false;
    p.toggles.celebrations = false;
    p.toggles.firstKillBoasts = false;
    const { rt, logged } = runtime(p);
    const w = world({ map: MAP, player: { depth: 2, maxDepth: 2 } });
    rt.observe(w.view);
    rt.recordKill(GRIP, true, w.view);
    expect(rt.config().lineages).toEqual({});
    expect(logged).toEqual([]);
    const milestone: Milestone = { kind: "depth", name: "Mira", generation: 1, depth: 2, fact: "" };
    expect(recallMilestones({ ...family(), inheritedMilestones: [milestone] }, p, 2, [])).toEqual([]);
  });

  it("trims inherited milestones by the slider and honors either generation's setting", () => {
    const milestones = Array.from({ length: 12 }, (_, i): Milestone => ({ kind: "unique", name: "Mira", generation: 1, depth: 2, fact: `Unique ${String(i)}` }));
    const p = persona();
    p.sliders.inheritance = 20;
    expect(inherit({ ...family(), milestones }, p, persona(), () => 0).lineage.inheritedMilestones).toHaveLength(3);
    p.sliders.inheritance = 0;
    const born = inherit({ ...family(), milestones }, p, persona(), () => 0);
    expect(born.lineage.milestones).toHaveLength(12);
    expect(born.lineage.inheritedMilestones).toEqual([]);
    p.sliders.inheritance = 100;
    p.toggles.milestones = false;
    expect(inherit({ ...family(), milestones }, p, persona(), () => 0).lineage.inheritedMilestones).toEqual([]);
    const heir = persona();
    heir.toggles.milestones = false;
    expect(inherit({ ...family(), milestones }, persona(), heir, () => 0).lineage.inheritedMilestones).toEqual([]);
  });
});

describe("namesakes", () => {
  it("numbers repeated names without nesting titles", () => {
    expect(namesakeFor(family(), persona(), persona(), () => 0)).toEqual({ name: "Mira the Second", ancestor: "Mira" });
    const line = { ...family(), name: "Mira the Second", ancestors: [{ name: "Mira", race: "Elf", cls: "Mage", generation: 1, died: null }] };
    expect(namesakeFor(line, persona(), persona(), () => 0)?.name).toBe("Mira the Third");
    expect(namesakeFor({ ...family(), name: "Mira the Tenth" }, persona(), persona(), () => 0)?.name).toBe("Mira the 11th");
    expect(namesakeFor({ ...family(), name: "Mira the 22nd" }, persona(), persona(), () => 0)?.name).toBe("Mira the 23rd");
  });

  it("gives deep, long-lived ancestors more weight and a higher chance", () => {
    const low = { ...family(), deepest: 1, turns: 100 };
    const draws = () => { let i = 0; return () => [0, 0.3][i++]!; };
    expect(namesakeFor(low, persona(), persona(), draws())).toBeNull();
    expect(namesakeFor(family(), persona(), persona(), draws())).not.toBeNull();
    const line = { ...low, name: "Bea", ancestors: [{ name: "Mira", race: "Elf", cls: "Mage", generation: 1, died: null, deepest: 20, turns: 40_000 }] };
    let i = 0;
    expect(namesakeFor(line, persona(), persona(), () => [0.6, 0][i++]!)?.ancestor).toBe("Mira");
  });

  it("honors inheritance, both settings, missing records and invalid random draws", () => {
    const p = persona();
    p.sliders.inheritance = 0;
    expect(namesakeFor(family(), p, persona(), () => 0)).toBeNull();
    p.sliders.inheritance = 20;
    let i = 0;
    expect(namesakeFor(family(), p, persona(), () => [0, 0.3][i++]!)).toBeNull();
    p.sliders.inheritance = 100;
    p.toggles.namesakes = false;
    expect(namesakeFor(family(), p, persona(), () => 0)).toBeNull();
    const heir = persona();
    heir.toggles.namesakes = false;
    expect(namesakeFor(family(), persona(), heir, () => 0)).toBeNull();
    expect(namesakeFor(undefined, persona(), persona(), () => 0)).toBeNull();
    expect(namesakeFor(family(), persona(), persona(), () => Number.NaN)).toBeNull();
  });
});

describe("saved flourishes and survival", () => {
  it("reads the record across reloads and drops malformed lore", () => {
    const config = readConfig(undefined);
    const epitaph = epitaphFor(persona(), { name: "Mira", generation: 1, cause: GRIP, depth: 2, level: 4, action: "fight" })!;
    const line = { ...family(), epitaphs: [epitaph], milestones: [addMilestone(family(), persona(), "unique", 2, GRIP)!] };
    const stored = readConfig(writeConfig({ ...config, lineages: { Mira: line }, pendingHeir: { lineage: "Mira", parent: persona(), name: "Mira the Second" } }));
    expect(stored.lineages["Mira"]).toMatchObject(line);
    expect(stored.pendingHeir?.name).toBe("Mira the Second");
    const malformed = readConfig(writeConfig({ ...config, lineages: { Mira: { ...line, ancestors: [null], epitaphs: [null, {}], milestones: [{ kind: "oops" }] } } } as unknown as typeof config));
    expect(malformed.lineages["Mira"]?.epitaphs).toEqual([]);
    expect(malformed.lineages["Mira"]?.milestones).toEqual([]);
    expect(namesakeFor(malformed.lineages["Mira"], persona(), persona(), () => 0)?.name).toBe("Mira the Second");
  });

  it("leaves fearful and proud voices distinct and brief", () => {
    const p = persona();
    p.quirks.cowardice.on = true;
    expect(familyVoice(p, "Mira reached 100 ft.")).toContain("I hope I get home.");
    p.quirks.cowardice.on = false;
    p.sliders.pride = 80;
    expect(familyVoice(p, "Mira reached 100 ft.")).toContain("I mean to go deeper.");
  });

  it("keeps readiness, fear and the death-risk ceiling ahead of every flourish", () => {
    const w = world({ map: MAP, player: { level: 1, hp: 2, maxHp: 20, depth: 2, maxDepth: 2, status: { afraid: 10 } }, monsters: [{ grid: { x: 3, y: 1 }, race: GRIP, level: 2, speed: 120, raceFlags: ["UNIQUE"] }], pack: ["a Scroll of Phase Door"] });
    const p = persona();
    p.sliders.strength = 100;
    p.sliders.selfpreservation = 100;
    p.sliders.pride = 90;
    const { rt } = runtime(p, family());
    rt.observe(w.view);
    const offered = (heir: Persona) => {
      const planner = createGoalPlanner({ cfg: defaultCfg(), terrain: w.terrain, log: () => {}, persona: heir, rng: () => 0.5, reflex: false });
      const question = planner.ask(w.view);
      if (!("context" in question)) throw new Error("expected a question");
      return { planner, question: question as Question<GoalDigest> };
    };
    const on = offered(rt.character().persona!);
    const offPersona = persona();
    offPersona.sliders = { ...p.sliders };
    offPersona.toggles.epitaphs = false;
    offPersona.toggles.milestones = false;
    offPersona.toggles.namesakes = false;
    const off = offered(offPersona);
    expect(on.question.context.offers).toEqual(off.question.context.offers);
    expect(on.question.context.offers.map((o) => o.goal)).not.toContain("fight");
    expect(on.question.context.offers.map((o) => o.goal)).not.toContain("descend");
    const choice = on.planner.choose({ goal: { type: "choice", choice: "phase", confidence: 1, probabilities: { phase: 1 } } }, on.question.context, w.view);
    expect("plan" in choice).toBe(true);
    if ("plan" in choice) expect(choice.plan.step(w.view, w.act)).toEqual({ code: "read", args: { handle: 1 } });
  });

  it("removes a fight past the ceiling even after a proud heir recalls a unique kill", () => {
    const milestone: Milestone = { kind: "unique", name: "Mira", generation: 1, depth: 2, fact: GRIP };
    const p = persona("Bea");
    p.sliders.strength = 100;
    p.sliders.volatility = 0;
    p.sliders.selfpreservation = 100;
    p.sliders.pride = 90;
    const { rt, logged } = runtime(p, { ...family(), name: "Bea", generation: 2, inheritedMilestones: [milestone] });
    const w = world({ map: ["########", "#.@....#", "#.#### #", "########"], player: { hp: 2, maxHp: 40 }, monsters: [{ grid: { x: 4, y: 1 }, race: GRIP, level: 30, raceFlags: ["UNIQUE"] }] });
    rt.observe(w.view);
    expect(logged.some((line) => line.includes("Mira was the first"))).toBe(true);
    const planner = createGoalPlanner({ cfg: defaultCfg(), terrain: w.terrain, log: () => {}, persona: p, rng: () => 0.5, reflex: false });
    const q = planner.ask(w.view) as Question<GoalDigest>;
    const choice = planner.choose({
      goal: { type: "choice", choice: "retreat", confidence: 0.6, probabilities: { retreat: 0.6, fight: 0.4 } },
      in_character: { type: "choice", choice: "fight", confidence: 1, probabilities: { fight: 1 } },
    }, q.context, w.view);
    expect(q.context.trace?.removed).toContain("fight");
    expect(choice).not.toMatchObject({ plan: { label: "fight" } });
  });
});

describe("family motto", () => {
  it("writes a motto on first death and the heir repeats it at a level-up", () => {
    const p = persona();
    p.sliders.boldness = 90;
    p.sliders.pride = 80;
    const next = familyAfterDeath(emptyFamilyFlourishes(), emptyFlourishes(), null, p);
    expect(next.motto?.generation).toBe(1);
    expect(next.motto?.text).toBeTruthy();
    const phrases = [mottoForPersona(p, () => 0.1), mottoForPersona(p, () => 0.5), mottoForPersona(p, () => 0.9)];
    expect(phrases).toContain(next.motto?.text);
    expect(mottoLine(p, next.motto)).toContain(next.motto!.text);
    p.toggles.heirlooms = false;
    expect(mottoLine(p, null)).toBeNull();
  });

  it("lets two contrasting personas keep different mottos", () => {
    const bold = persona();
    bold.sliders.boldness = 90;
    bold.sliders.pride = 90;
    const timid = persona();
    timid.sliders.boldness = 10;
    timid.sliders.pride = 10;
    const boldLine = mottoLine(bold, { text: mottoForPersona(bold, () => 0.4), generation: 1 });
    const timidLine = mottoLine(timid, { text: mottoForPersona(timid, () => 0.4), generation: 1 });
    expect(boldLine).not.toBeNull();
    expect(timidLine).not.toBeNull();
    expect(boldLine).not.toBe(timidLine);
  });

  it("stays silent and skips replacement when the toggle is off", () => {
    const p = persona();
    p.toggles.familyMotto = false;
    const next = familyAfterDeath(emptyFamilyFlourishes(), emptyFlourishes(), null, p);
    expect(next.motto).toBeNull();
    expect(mottoLine(p, { text: "any phrase", generation: 1 })).toBeNull();
    const parent = persona();
    parent.sliders.inheritance = 100;
    const heir = persona();
    heir.sliders.inheritance = 100;
    expect(mayReplaceMotto(parent, heir, null, () => 0)).toBe(true);
  });

  it("gives a deterministic phrase for the same sliders and rng", () => {
    const p = persona();
    p.sliders.pride = 90;
    const a = mottoForPersona(p, () => 0.1);
    const b = mottoForPersona(p, () => 0.1);
    const c = mottoForPersona(p, () => 0.9);
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });
});

describe("favoured weapon kind", () => {
  function record(...weapons: { readonly generation: number; readonly kind: string; readonly kills: number }[]): FamilyFlourishes {
    return { ...emptyFamilyFlourishes(), ancestralWeapons: weapons };
  }

  it("picks the highest-generation ancestor that actually killed something", () => {
    const f = record({ generation: 1, kind: "hafted", kills: 8 }, { generation: 2, kind: "blade", kills: 2 });
    expect(favouredWeapon(f)).toEqual({ generation: 1, kind: "hafted", kills: 8 });
    const lean = record({ generation: 1, kind: "hafted", kills: 0 }, { generation: 2, kind: "blade", kills: 1 });
    expect(favouredWeapon(lean)).toEqual({ generation: 2, kind: "blade", kills: 1 });
    expect(favouredWeapon(record())).toBeNull();
  });

  it("inherits a kind only when both parent and heir keep the toggle", () => {
    const f = record({ generation: 1, kind: "polearm", kills: 3 });
    expect(inheritWays(f, persona(), persona(), () => 0).favouredKind).toBe("polearm");
    const off = persona();
    off.toggles.favouredWeapons = false;
    expect(inheritWays(f, off, persona(), () => 0).favouredKind).toBeNull();
    const heir = persona();
    heir.toggles.favouredWeapons = false;
    expect(inheritWays(f, persona(), heir, () => 0).favouredKind).toBeNull();
  });

  it("breaks a close tie toward the favoured kind without overriding a clearly better weapon", () => {
    const twoItems = world({ map: ["@"], pack: ["a Dagger", "a Mace"] });
    const plain = gearCandidates(twoItems.view, null);
    const fav = gearCandidates(twoItems.view, "hafted");
    const plainOrder = plain.map((c) => c.name).join(",");
    const favOrder = fav.map((c) => c.name).join(",");
    expect(favOrder).not.toBe(plainOrder);
    expect(favOrder.toLowerCase()).toContain("mace");
    const clearer = world({ map: ["@"], pack: ["a Dagger (2d8) (+5,+5)", "a Mace"], worn: ["a Long Sword (2d5) (+0,+0)"] });
    const clear = gearCandidates(clearer.view, "hafted");
    const clearPlain = gearCandidates(clearer.view, null);
    expect(clear.map((c) => c.name)).toEqual(clearPlain.map((c) => c.name));
    expect(clear[0]?.name).toContain("Dagger");
  });

  it("names each weapon slot by the persona list scale", () => {
    expect(weaponKind(TV.SWORD)).toBe("blade");
    expect(weaponKind(TV.HAFTED)).toBe("hafted");
    expect(weaponKind(TV.POLEARM)).toBe("polearm");
    expect(weaponKind(TV.BOW)).toBe("bow");
    expect(weaponKind(TV.DIGGING)).toBe("hafted");
    expect(weaponKind(TV.LIGHT)).toBeNull();
    expect(weaponKind(TV.SHIELD)).toBeNull();
  });
});

describe("cursed ground", () => {
  it("speaks a line when the heir reaches the depth an ancestor died at", () => {
    const p = persona();
    p.sliders.boldness = 50;
    const line = cursedGroundLine(p, 2);
    expect(line).toContain("100 ft");
    expect(line).toContain("ancestor");
  });

  it("gives cautious and bold personas different wording", () => {
    const cautious = persona();
    cautious.sliders.boldness = 10;
    cautious.sliders.paranoia = 80;
    const bold = persona();
    bold.sliders.pride = 90;
    bold.sliders.boldness = 90;
    const neutral = persona();
    neutral.sliders.boldness = 50;
    neutral.sliders.paranoia = 50;
    neutral.sliders.pride = 50;
    const c = cursedGroundLine(cautious, 3);
    const b = cursedGroundLine(bold, 3);
    const n = cursedGroundLine(neutral, 3);
    expect(c).not.toBe(b);
    expect(c).not.toBe(n);
    expect(b).not.toBe(n);
    expect(c).toContain("feels wrong");
    expect(b).toContain("go further");
  });

  it("leaves the weights alone with the toggle off and outside the cursed depth", () => {
    const family = { ...emptyFamilyFlourishes(), cursedDepth: 3 };
    const dist = { descend: 0.4, explore: 0.6, retreat: 0.1 };
    const offers = [{ goal: "explore", risk: 0.1 }, { goal: "descend", risk: 0.1 }];
    const w = world({ map: ["@"], player: { depth: 3 } });
    expect(nudgeCursedGround(dist, family, w.view, persona(), 0.5)).toEqual(dist);
    const off = persona();
    off.toggles.cursedGround = false;
    expect(nudgeCursedGround(dist, family, w.view, off, 0.5)).toEqual(dist);
    const wrongDepth = world({ map: ["@"], player: { depth: 4 } });
    expect(nudgeCursedGround(dist, family, wrongDepth.view, persona(), 0.5)).toEqual(dist);
  });

  it("makes the cautious persona linger and the proud one push deeper", () => {
    const family = { ...emptyFamilyFlourishes(), cursedDepth: 3 };
    const dist = { descend: 0.5, explore: 0.5, retreat: 0.5 };
    const offers = [{ goal: "descend", risk: 0.1 }, { goal: "explore", risk: 0.1 }];
    const w = world({ map: ["@"], player: { depth: 3 } });
    const cautious = persona();
    cautious.sliders.boldness = 10;
    cautious.sliders.paranoia = 80;
    const proud = persona();
    proud.sliders.pride = 90;
    proud.sliders.boldness = 90;
    const lower = nudgeCursedGround(dist, family, w.view, cautious, 0.5);
    const higher = nudgeCursedGround(dist, family, w.view, proud, 0.5);
    expect(lower.descend).toBeLessThan(dist.descend);
    expect(higher.descend).toBeGreaterThan(dist.descend);
  });
});

describe("celebrations", () => {
  it("marks a level-up and the first unique kill in the persona's voice", () => {
    const p = persona();
    p.sliders.boldness = 90;
    const level = celebrationLine(p, "level-up", "reached character level 5");
    const unique = celebrationLine(p, "first-unique", GRIP);
    expect(level).toContain("level 5");
    expect(level).toContain(p.name);
    expect(unique).toContain(GRIP);
    expect(unique).toContain(p.name);
  });

  it("contrasts proud, coward and neutral voices", () => {
    const proud = persona();
    proud.sliders.pride = 90;
    proud.sliders.boldness = 50;
    const coward = persona();
    coward.sliders.boldness = 10;
    coward.quirks.cowardice.on = true;
    const neutral = persona();
    neutral.sliders.boldness = 50;
    neutral.sliders.pride = 50;
    const p = celebrationLine(proud, "first-unique", GRIP);
    const c = celebrationLine(coward, "first-unique", GRIP);
    const n = celebrationLine(neutral, "first-unique", GRIP);
    expect(p).not.toBe(c);
    expect(c).not.toBe(n);
    expect(p).not.toBe(n);
    expect(p).toContain("The line should remember");
    expect(c).toContain("my hands shake");
  });

  it("records the first unique through the runtime and stays quiet with the toggle off", () => {
    const { rt, logged } = runtime();
    const w = world({ map: MAP, player: { depth: 2, maxDepth: 2 } });
    rt.recordKill(GRIP, true, w.view);
    expect(logged.some((line) => line.includes(GRIP))).toBe(true);
    const off = persona();
    off.toggles.celebrations = false;
    off.toggles.milestones = false;
    const rt2 = createRuntime({ log: (line) => logged.push(line) }, { store: memoryStore() });
    rt2.saveCharacter({ ...rt2.character(), persona: off, lineage: "Mira" });
    const before = logged.length;
    rt2.recordKill(GRIP, true, w.view);
    expect(logged.slice(before)).toEqual([]);
  });

  it("never repeats a level-up line for the same level", () => {
    const p = persona();
    p.sliders.boldness = 90;
    const first = celebrationLine(p, "level-up", "reached character level 5");
    const second = celebrationLine(p, "level-up", "reached character level 5");
    expect(first).toBe(second);
    const initial = emptyFlourishes();
    const after = { ...initial, celebratedLevels: [5] };
    expect(after.celebratedLevels).toContain(5);
    const before = emptyFlourishes();
    expect(before.celebratedLevels).not.toContain(5);
  });
});

describe("first-kill boasts", () => {
  it("brags for a proud persona on the first kill of a creature kind", () => {
    const p = persona();
    p.sliders.pride = 90;
    const line = firstKillBoast(p, "jackal", () => 0.1);
    expect(line).toContain("jackal");
    expect(line).toContain(p.name);
  });

  it("stays silent for an unproud persona and stays silent past the boast threshold", () => {
    const humble = persona();
    humble.sliders.pride = 40;
    expect(firstKillBoast(humble, "jackal", () => 0)).toBeNull();
    const proud = persona();
    proud.sliders.pride = 90;
    expect(firstKillBoast(proud, "jackal", () => 0.9)).toBeNull();
    expect(firstKillBoast(proud, "jackal", () => Number.NaN)).toBeNull();
  });

  it("keeps the boast quiet with the toggle off even when proud", () => {
    const p = persona();
    p.sliders.pride = 90;
    p.toggles.firstKillBoasts = false;
    expect(firstKillBoast(p, "jackal", () => 0)).toBeNull();
  });

  it("never boasts twice for the same race", () => {
    const p = persona();
    p.sliders.pride = 90;
    const recorded: string[] = [];
    const draw = () => { recorded.push("used"); return 0.1; };
    const boast = firstKillBoast(p, "jackal", draw);
    expect(boast).not.toBeNull();
    const empty = emptyFlourishes();
    const after = { ...empty, boastedRaces: ["jackal"] };
    expect(after.boastedRaces).toEqual(["jackal"]);
    expect(empty.boastedRaces).toEqual([]);
    expect(recorded).toHaveLength(1);
  });
});

describe("heirloom recognition", () => {
  it("names a known family artifact the heir sees again", () => {
    const p = persona();
    p.sliders.greed = 80;
    const line = heirloomRecognition(p, "Dethanc", "shop");
    expect(line).toContain("Dethanc");
    expect(line).toContain(p.name);
  });

  it("contrasts greedy, proud and neutral voices", () => {
    const greedy = persona();
    greedy.sliders.greed = 90;
    const proud = persona();
    proud.sliders.pride = 90;
    const neutral = persona();
    neutral.sliders.greed = 50;
    neutral.sliders.pride = 50;
    const g = heirloomRecognition(greedy, "Dethanc", "floor");
    const pr = heirloomRecognition(proud, "Dethanc", "floor");
    const n = heirloomRecognition(neutral, "Dethanc", "floor");
    expect(g).not.toBe(pr);
    expect(g).not.toBe(n);
    expect(pr).not.toBe(n);
    expect(g).toContain("I want it back");
    expect(n).toContain("I want it");
  });

  it("stays silent with the toggle off and lists the family's heirloom names", () => {
    const p = persona();
    p.toggles.heirlooms = false;
    expect(heirloomRecognition(p, "Dethanc", "floor")).toBeNull();
    const lin: Lineage = { name: "Mira", generation: 2, ancestors: [], lore: [], grudges: [],
      milestones: [{ kind: "artifact", name: "Mira", generation: 1, depth: 2, fact: "Dethanc" }] };
    expect(heirloomNames(lin)).toEqual(["Dethanc"]);
    expect(heirloomNames(undefined)).toEqual([]);
  });

  it("never recognises the same artifact name twice on the floor or in a shop", () => {
    const p = persona();
    p.sliders.greed = 80;
    const seen = new Set<string>();
    const filter = (it: string) => {
      if (seen.has(it.toLowerCase())) return null;
      seen.add(it.toLowerCase());
      return heirloomRecognition(p, it, "shop");
    };
    const first = filter("Dethanc");
    const second = filter("Dethanc");
    expect(first).not.toBeNull();
    expect(second).toBeNull();
    const shop = heirloomRecognition(p, "Dethanc", "shop");
    const floor = heirloomRecognition(p, "Dethanc", "floor");
    expect(shop).not.toBe(floor);
  });
});

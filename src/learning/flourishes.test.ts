import { describe, expect, it, vi } from "vitest";
import type { AgentView } from "@rpgm-tools/neo-angband-core";
import { defaultPersona, type Persona } from "../persona/persona.js";
import { readConfig, writeConfig } from "../config.js";
import { createRuntime, type RunReportLike } from "../runtime.js";
import { memoryStore } from "../memory/kv.js";
import { world } from "../harness.js";
import { defaultCfg } from "../settings.js";
import { createGoalPlanner, type GoalDigest } from "../brain/goals.js";
import type { Question } from "../brain/brain.js";
import { inherit, type Lineage } from "./lineage.js";
import { addMilestone, epitaphFor, familyVoice, inheritFlourishes, milestoneId, namesakeFor, recallMilestones, type Milestone } from "./flourishes.js";

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
    expect(logged).toHaveLength(4);
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

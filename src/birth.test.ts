import { describe, expect, it } from "vitest";
import { writeConfig, readConfig } from "./config.js";
import { HEIR_KEY, markRollOn, rollOnPresenter, ROLL_ON_WINDOW_MS, takeRollOn, type BirthSessionLike, type MarkStore } from "./birth.js";
import { defaultPersona } from "./persona/persona.js";
import type { Lineage } from "./learning/lineage.js";

function marks(): MarkStore {
  const data = new Map<string, string>();
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
    removeItem: (key) => void data.delete(key),
  };
}

function session(previous: boolean, refuse: string | null = null, previousName = "Amram") {
  const calls: string[] = [];
  const ok = { ok: true };
  let current = "";
  const s: BirthSessionLike = {
    catalogue: () => ({
      races: [{ name: "Human" }, { name: "Dwarf" }],
      classes: [{ name: "Warrior" }, { name: "Mage" }],
      previous: previous ? { race: "Human", cls: "Mage", name: previousName } : null,
      namePinned: false,
    }),
    setName: (name) => (calls.push(`name ${name}`), (current = name), ok),
    draft: () => ({ name: current }),
    usePrevious: () => (calls.push("usePrevious"), ok),
    chooseRace: (name) => (calls.push(`race ${name}`), ok),
    chooseClass: (name) => (calls.push(`class ${name}`), ok),
    roll: () => (calls.push("roll"), refuse === "roll" ? { ok: false, reason: "no" } : ok),
    randomName: () => (calls.push("randomName"), (current = "Rolled"), ok),
    accept: () => (calls.push("accept"), ok),
  };
  return { s, calls };
}

function host(rollOn: "wait" | "like" | "random") {
  const logged: string[] = [];
  const stored = writeConfig({ ...readConfig(undefined), rollOn });
  return { host: { prefs: { get: () => stored }, log: (m: string) => logged.push(m) }, logged };
}

describe("roll-on birth", () => {
  it("uses a mark once, and only while it is fresh", () => {
    const store = marks();
    markRollOn(store, 1_000);
    expect(takeRollOn(store, 1_000 + ROLL_ON_WINDOW_MS)).toBe(true);
    expect(takeRollOn(store, 1_000 + ROLL_ON_WINDOW_MS)).toBe(false);
    markRollOn(store, 1_000);
    expect(takeRollOn(store, 1_001 + ROLL_ON_WINDOW_MS)).toBe(false);
  });

  it("declines a creation Squire did not ask for", () => {
    const { s, calls } = session(true);
    expect(rollOnPresenter(host("like").host, marks(), () => 5).show(s)).toBeUndefined();
    expect(calls).toEqual([]);
  });

  it("copies the dead character and accepts it for like", () => {
    const store = marks();
    markRollOn(store, 0);
    const { s, calls } = session(true);
    expect(rollOnPresenter(host("like").host, store, () => 5).show(s)).toBe(true);
    expect(calls).toEqual(["usePrevious", "name Amram", "accept"]);
    expect(takeRollOn(store, 5, HEIR_KEY)).toBe(true);
  });

  it("rolls a name when the last character had none", () => {
    const store = marks();
    markRollOn(store, 0);
    const { s, calls } = session(true, null, "");
    expect(rollOnPresenter(host("like").host, store, () => 5).show(s)).toBe(true);
    expect(calls).toEqual(["usePrevious", "randomName", "accept"]);
  });

  it("rolls a random race and class for random", () => {
    const store = marks();
    markRollOn(store, 0);
    const { s, calls } = session(true);
    expect(rollOnPresenter(host("random").host, store, () => 5, () => 0.99).show(s)).toBe(true);
    expect(calls).toEqual(["race Dwarf", "class Mage", "roll", "randomName", "accept"]);
  });

  it("hands creation back to the game when a step is refused", () => {
    const store = marks();
    markRollOn(store, 0);
    const { s, calls } = session(false, "roll");
    const { host: h, logged } = host("like");
    expect(rollOnPresenter(h, store, () => 5, () => 0).show(s)).toBeUndefined();
    expect(calls).not.toContain("accept");
    expect(logged.join(" ")).toContain("left the next character to you");
  });

  it("declines when roll-on is off, even with a mark", () => {
    const store = marks();
    markRollOn(store, 0);
    const { s } = session(true);
    expect(rollOnPresenter(host("wait").host, store, () => 5).show(s)).toBeUndefined();
  });
});

describe("namesake births", () => {
  function waiting(options: { mode?: "like" | "random"; enabled?: boolean; inheritance?: number } = {}) {
    const parent = defaultPersona("Mira");
    parent.sliders.inheritance = options.inheritance ?? 100;
    parent.toggles.namesakes = options.enabled ?? true;
    const line: Lineage = { name: "Mira", generation: 1, ancestors: [], lore: [], grudges: [], deepest: 20, turns: 40_000, died: { depth: 2, cause: "Grip", turn: 40_000 } };
    let saved = writeConfig({ ...readConfig(undefined), rollOn: options.mode ?? "like", lineages: { Mira: line }, pendingHeir: { lineage: "Mira", parent } });
    const logged: string[] = [];
    return { host: { prefs: { get: () => saved, set: (value: unknown) => { saved = value; } }, log: (line: string) => logged.push(line) }, logged, config: () => readConfig(saved) };
  }

  it.each(["like", "random"] as const)("accepts a numbered ancestor name for %s and keeps the persona name across reload", (mode) => {
    const h = waiting({ mode });
    const store = marks();
    markRollOn(store, 0);
    const { s, calls } = session(true);
    expect(rollOnPresenter(h.host, store, () => 5, () => 0).show(s)).toBe(true);
    expect(calls).toContain("name Mira the Second");
    expect(h.config().pendingHeir?.name).toBe("Mira the Second");
    expect(h.logged.some((line) => line.includes("Mira the Second: I bear Mira's name."))).toBe(true);
  });

  it.each([{ enabled: false }, { inheritance: 0 }])("keeps the usual name when namesakes cannot pass: %j", (options) => {
    const h = waiting(options);
    const store = marks();
    markRollOn(store, 0);
    const { s, calls } = session(true);
    expect(rollOnPresenter(h.host, store, () => 5, () => 0).show(s)).toBe(true);
    expect(calls).toEqual(["usePrevious", "name Amram", "accept"]);
    expect(h.logged).toEqual([]);
  });

  it("keeps a pinned name and writes no namesake line", () => {
    const h = waiting();
    const store = marks();
    markRollOn(store, 0);
    const { s, calls } = session(true);
    const pinned: BirthSessionLike = { ...s, catalogue: () => ({ ...s.catalogue(), namePinned: true }), draft: () => ({ name: "Patron" }) };
    expect(rollOnPresenter(h.host, store, () => 5, () => 0).show(pinned)).toBe(true);
    expect(calls).toEqual(["usePrevious", "accept"]);
    expect(h.config().pendingHeir?.name).toBe("Patron");
    expect(h.logged).toEqual([]);
  });

  it("keeps the usual name when the game refuses the numbered name", () => {
    const h = waiting();
    const store = marks();
    markRollOn(store, 0);
    const { s } = session(true);
    const refusing: BirthSessionLike = { ...s, setName: (name) => name === "Mira the Second" ? { ok: false, reason: "too long" } : s.setName(name) };
    expect(rollOnPresenter(h.host, store, () => 5, () => 0).show(refusing)).toBe(true);
    expect(h.config().pendingHeir?.name).toBe("Amram");
    expect(h.logged).toEqual([]);
  });
});

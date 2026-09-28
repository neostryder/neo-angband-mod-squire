import { describe, expect, it } from "vitest";
import { writeConfig, readConfig } from "./config.js";
import { markRollOn, rollOnPresenter, ROLL_ON_WINDOW_MS, takeRollOn, type BirthSessionLike, type MarkStore } from "./birth.js";

function marks(): MarkStore {
  const data = new Map<string, string>();
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
    removeItem: (key) => void data.delete(key),
  };
}

function session(previous: boolean, refuse: string | null = null) {
  const calls: string[] = [];
  const ok = { ok: true };
  const s: BirthSessionLike = {
    catalogue: () => ({
      races: [{ name: "Human" }, { name: "Dwarf" }],
      classes: [{ name: "Warrior" }, { name: "Mage" }],
      previous: previous ? { race: "Human", cls: "Mage", name: "Amram" } : null,
      namePinned: false,
    }),
    setName: (name) => (calls.push(`name ${name}`), ok),
    usePrevious: () => (calls.push("usePrevious"), ok),
    chooseRace: (name) => (calls.push(`race ${name}`), ok),
    chooseClass: (name) => (calls.push(`class ${name}`), ok),
    roll: () => (calls.push("roll"), refuse === "roll" ? { ok: false, reason: "no" } : ok),
    randomName: () => (calls.push("randomName"), ok),
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

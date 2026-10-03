import { describe, expect, it } from "vitest";
import { world } from "../harness.js";
import { defaultCfg } from "../settings.js";
import { createGoalPlanner } from "./goals.js";
import { birthConstraints, birthOf, createManual, mechanicsOf } from "./manual.js";

const ROOM = ["######", "#.@..#", "######"];

describe("the manual", () => {
  it("states a class's casting and flags and a race's abilities", () => {
    expect(mechanicsOf("High-Elf", "Mage", ["ZERO_FAIL", "BEAM", "CHOOSE_SPELLS"])).toBe("A Mage casts arcane spells with Intelligence and often casts bolt spells as beams that hit every creature in the line. A High-Elf sees invisible creatures and resists light.");
    expect(mechanicsOf("Human", "Warrior", ["BRAVERY_30", "NO_MANA", "SHIELD_BASH"])).toBe("A Warrior casts no spells, cannot be frightened from character level 30 and may bash a visible creature with a worn shield before its blows.");
    expect(mechanicsOf("Dwarf", "Necromancer", ["UNLIGHT", "EVIL"])).toContain("fails spells more often while standing on a lit grid");
    expect(mechanicsOf("Half-Orc", "Blackguard", ["COMBAT_REGEN"])).toContain("resting drains mana into hit points");
  });

  it("adds nothing for a race and class it has no data for", () => {
    expect(mechanicsOf("Ent", "Bard", [])).toBeUndefined();
    expect(mechanicsOf("Human", "Bard", [])).toBeUndefined();
  });

  it("states only birth options that change play, and selling either way", () => {
    expect(birthOf([])).toBeUndefined();
    expect(birthOf([{ name: "birth_connect_stairs", value: true }, { name: "birth_no_selling", value: true }])).toBe("Stores pay nothing for goods, and the dungeon drops more gold instead.");
    expect(birthOf([{ name: "birth_force_descend", value: true }, { name: "birth_connect_stairs", value: false }, { name: "birth_no_selling", value: false }])).toBe("Up staircases are never made, so stairs lead only down. Taking a staircase does not leave one under the character. Stores buy goods for gold.");
  });

  it("names the birth rules that limit an option, only when they are set the limiting way", () => {
    expect(birthConstraints([]).size).toBe(0);
    expect(birthConstraints([{ name: "birth_connect_stairs", value: true }, { name: "birth_no_recall", value: false }]).size).toBe(0);
    const rules = birthConstraints([{ name: "birth_connect_stairs", value: false }, { name: "birth_force_descend", value: true }, { name: "birth_no_recall", value: true }, { name: "birth_no_selling", value: true }]);
    expect([...rules.keys()]).toEqual(["connect_stairs", "force_descend", "no_recall", "no_selling"]);
    expect(rules.get("force_descend")).toBe("forced descent is on, so there is no way back up afterwards");
  });

  it("compiles once per character and survives a failed options read", () => {
    const w = world({ map: ROOM, player: { cls: "Mage" } });
    let reads = 0;
    const manual = createManual(() => { reads += 1; if (reads === 2) throw new Error("options unavailable"); return [{ name: "birth_no_recall", value: true }]; });
    const first = manual(w.view);
    expect(first).toEqual({ mechanics: "A Mage casts arcane spells with Intelligence.", birth: "Word of Recall does nothing." });
    expect(manual(w.view).birth).toBeUndefined();
    expect(manual(w.view)).toEqual(first);
  });

  it("files the character and birth facts under the manual layer of the goal request", () => {
    const w = world({ map: ROOM, player: { depth: 1, cls: "Mage" } });
    const planner = createGoalPlanner({ cfg: defaultCfg(), terrain: w.terrain, log: () => {}, reflex: false, rng: () => 0.5, birthOptions: () => [{ name: "birth_force_descend", value: true }] });
    const q = planner.ask(w.view);
    if ("handBack" in q || "reflex" in q) throw new Error("expected a question");
    expect(q.context.layers?.entries.filter((entry) => entry.layer === "manual").map((entry) => entry.key)).toEqual(["mechanics", "birth", "rules"]);
    expect(q.request.state["birth"]).toBe("Up staircases are never made, so stairs lead only down.");
  });
});

import { describe, expect, it } from "vitest";
import { familyOf, signatureOf, similarity } from "./signature.js";

describe("situation signatures", () => {
  it("recognizes common families and defaults unknown names", () => {
    for (const [race, family] of [
      ["cave orc", "orc"], ["large kobold", "kobold"], ["wild jackal", "dog"],
      ["Zephyr hound", "hound"], ["giant spider", "spider"], ["snake", "snake"],
      ["rat", "rat"], ["worm", "worm"], ["blue jelly", "jelly"], ["black mold", "jelly"],
      ["ghost", "ghost"], ["zombie", "undead"], ["skeleton", "undead"],
      ["dragon", "dragon"], ["giant", "giant"], ["troll", "troll"], ["ogre", "ogre"],
      ["bat", "bat"], ["bird", "bird"], ["insect", "insect"], ["human", "human"],
      ["elf", "elf"], ["dwarf", "dwarf"], ["hobbit", "hobbit"], ["yeek", "yeek"],
      ["golem", "golem"], ["demon", "demon"], ["vortex", "vortex"], ["eye", "eye"],
      ["nameless thing", "other"],
    ]) expect(familyOf(race!)).toBe(family);
  });

  it("bands and sorts an encounter, then scores similar encounters higher", () => {
    const first = signatureOf({ depth: 19, classId: "mage", level: 11, races: ["orc", "cave troll", "orc"], hp: 24, maxHp: 100, resources: ["teleport", "heal", "heal"] });
    expect(first).toEqual({ depthBand: 3, classId: "mage", levelBand: 2, families: ["orc", "troll"], hpBand: 3, resources: ["heal", "teleport"] });
    const same = signatureOf({ depth: 15, classId: "mage", level: 10, races: ["cave troll", "orc"], hp: 20, maxHp: 100, resources: ["heal", "teleport"] });
    const far = signatureOf({ depth: 90, classId: "warrior", level: 50, races: ["dragon"], hp: 100, maxHp: 100, resources: [] });
    expect(similarity(first, same)).toBe(1);
    expect(similarity(first, far)).toBeLessThan(0.3);
    expect(similarity(first, far)).toBeGreaterThanOrEqual(0);
    expect(similarity(first, first)).toBe(1);
  });

  it("handles empty families and unavailable maximum health", () => {
    expect(signatureOf({ depth: 0, classId: "", level: 0, races: [], hp: 0, maxHp: 0, resources: [] }).hpBand).toBe(0);
  });
});

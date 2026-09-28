import { describe, expect, it } from "vitest";
import { inferPersona, rankFor, RANKS } from "./ranks.js";
import type { PlayerCommand } from "./ranks.js";

describe("Knight's Lessons ranks", () => {
  it("uses exact example and agreement thresholds", () => {
    expect(RANKS).toEqual(["Page", "Squire", "Knight-Errant"]);
    expect(rankFor(1, 39)).toBe("Page");
    expect(rankFor(0.549, 40)).toBe("Page");
    expect(rankFor(0.55, 40)).toBe("Squire");
    expect(rankFor(0.749, 150)).toBe("Squire");
    expect(rankFor(0.75, 149)).toBe("Squire");
    expect(rankFor(0.75, 150)).toBe("Knight-Errant");
  });

  it("estimates observed sliders and leaves others neutral", () => {
    const commands: PlayerCommand[] = [
      { kind: "fight", turn: 0, dangerousNear: true },
      { kind: "retreat", turn: 10, dangerousNear: true, hpShare: 0.6 },
      { kind: "rest", turn: 20, restedToFull: true },
      { kind: "heal", turn: 30, hpShare: 0.4 },
      { kind: "consumable", turn: 40 },
      { kind: "descend", turn: 50, exploredShare: 0.8 },
      { kind: "ranged", turn: 60 },
      { kind: "melee", turn: 100 },
    ];
    const { persona, confidence } = inferPersona([], commands);
    expect(persona.sliders.boldness).toBe(50);
    expect(persona.sliders.patience).toBe(100);
    expect(persona.sliders.healat).toBe(40);
    expect(persona.sliders.retreatat).toBe(60);
    expect(persona.sliders.consumables).toBe(100);
    expect(persona.sliders.levelfeel).toBe(80);
    expect(persona.sliders.range).toBe(50);
    expect(persona.sliders.selfpreservation).toBe(50);
    expect(confidence.healat).toBe(0.05);
    expect(confidence.greed).toBe(0);
    expect(inferPersona([], []).persona.sliders.boldness).toBe(50);
  });
});

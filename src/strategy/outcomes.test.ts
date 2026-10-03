import { describe, expect, it } from "vitest";
import { goalSentence, outcomeSentence, type GoalOutcome } from "./outcomes.js";

const met: GoalOutcome = {
  level: "mid", goal: "lantern over torch", end: "met", reason: "the aim was satisfied",
  held: 12, startDepth: 1, endDepth: 1, reward: "Use a Lantern instead of a wooden torch",
};

describe("goal sentences", () => {
  it("states the goal, a progress number when there is one, and the trigger", () => {
    expect(goalSentence("explore this level", null, "on reaching a new level")).toBe("Explore this level. Chosen on reaching a new level.");
    expect(goalSentence("rest to full", "10 of 40 hit points", "on reaching a new level")).toBe("Rest to full. 10 of 40 hit points. Chosen on reaching a new level.");
  });

  it("states how a goal ended, and adds the aim's detail when it was met", () => {
    expect(outcomeSentence(met)).toBe("The mid-term goal lantern over torch was met after 12 turns, from dungeon level 1 to dungeon level 1, because the aim was satisfied. Use a Lantern instead of a wooden torch.");
    expect(outcomeSentence({ ...met, reward: "Already finished." })).toContain("Already finished.");
    expect(outcomeSentence({ ...met, reward: "Already finished." })).not.toContain("..");
    expect(outcomeSentence({ ...met, end: "failed", reward: "unused" })).toBe("The mid-term goal lantern over torch failed after 12 turns, from dungeon level 1 to dungeon level 1, because the aim was satisfied.");
    expect(outcomeSentence({ ...met, level: "near", end: "abandoned", reward: null, goal: "explore this level", reason: "the character left the level" })).toBe("The near-term goal explore this level was abandoned after 12 turns, from dungeon level 1 to dungeon level 1, because the character left the level.");
    expect(outcomeSentence({ ...met, level: "long", end: "abandoned", reward: null })).toContain("The long-term goal");
  });
});

import { describe, expect, it } from "vitest";
import { world } from "../harness.js";
import { defaultCfg } from "../settings.js";
import { defaultPersona } from "../persona/persona.js";
import { createGoalPlanner } from "../brain/goals.js";
import type { Answer } from "../brain/systemone.js";
import type { Aim } from "./aims.js";
import { HOLD_SHARE, holdDescent } from "./hold.js";

const ROOM = ["########", "#@....>#", "########"];

function dive(depth: number): Aim {
  return { kind: "depth", label: "depth target", detail: "", how: "dive", price: null, depth };
}

describe("holding back past the depth target", () => {
  const dist = { descend: 0.6, explore: 0.4 };

  it("cuts descend at or below the target, and leaves it alone above it", () => {
    const deep = world({ map: ROOM, player: { depth: 5, maxDepth: 5 } });
    expect(holdDescent(dist, [dive(5)], deep.view, false)).toEqual({ descend: 0.6 * HOLD_SHARE, explore: 0.4 });
    const shallow = world({ map: ROOM, player: { depth: 3, maxDepth: 3 } });
    expect(holdDescent(dist, [dive(5)], shallow.view, false)).toEqual(dist);
    expect(holdDescent(dist, [], deep.view, false)).toEqual(dist);
  });

  it("leaves descend alone when it is an escape", () => {
    const hunted = world({ map: ROOM, player: { depth: 5 }, monsters: [{ grid: { x: 3, y: 1 }, race: "cave orc", level: 7 }] });
    expect(holdDescent(dist, [dive(5)], hunted.view, false)).toEqual(dist);
    const hurt = world({ map: ROOM, player: { depth: 5, hp: 10, maxHp: 40 } });
    expect(holdDescent(dist, [dive(5)], hurt.view, false)).toEqual(dist);
    const quiet = world({ map: ROOM, player: { depth: 5 } });
    expect(holdDescent(dist, [dive(5)], quiet.view, true)).toEqual(dist);
  });

  it("turns the planner's pick from descend to explore past the target", () => {
    const choose = (aims: readonly Aim[]): string | undefined => {
      const w = world({ map: ["##########", "#@......>#", "#.........  ", "##########"], player: { depth: 6, maxDepth: 6 } });
      const persona = defaultPersona("Steady");
      persona.sliders.strength = 100;
      persona.sliders.volatility = 0;
      const p = createGoalPlanner({ cfg: defaultCfg(), terrain: w.terrain, log: () => {}, reflex: false, persona, rng: () => 0.5, strategy: () => ({ aims, tripAllowed: () => false }) });
      const q = p.ask(w.view);
      if (!("request" in q)) throw new Error("expected a question");
      const offered = q.context.offers.map((o) => o.goal as string);
      expect(offered).toContain("descend");
      expect(offered).toContain("explore");
      const answer: Answer = { type: "choice", choice: "descend", confidence: 0.55, probabilities: { descend: 0.55, explore: 0.45 } };
      const choice = p.choose({ goal: answer, in_character: answer }, q.context, w.view);
      return "plan" in choice ? choice.plan.label : undefined;
    };
    expect(choose([dive(10)])).toBe("take the stairs down");
    expect(choose([dive(5)])).toBe("explore");
  });
});

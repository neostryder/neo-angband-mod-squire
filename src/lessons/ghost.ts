import type { AgentView } from "@rpgm-tools/neo-angband-core";
import type { Goal } from "../brain/goals.js";
import { steps } from "../grid.js";
import { goalLabel } from "../knight.js";

/** A new match removes the previous hint; a disagreement names the current pick. */
export function ghostHint(squire: Goal, knight: Goal, view: AgentView): string | null {
  if (squire === knight) return null;
  const attack = ["fight", "shoot", "throw_oil", "aim_wand", "cast_attack"].includes(squire);
  const target = attack ? view.monsters().filter((monster) => monster.visible)
    .sort((a, b) => steps(view.player().grid, a.grid) - steps(view.player().grid, b.grid))[0] : undefined;
  return `Squire would: ${goalLabel(squire)}${target === undefined ? "" : ` at the ${target.race}`}`;
}

export function ghostAfterCommand(hint: string | null, previousGoal: Goal | null, knight: Goal | null): string | null {
  return previousGoal !== null && previousGoal === knight ? null : hint;
}

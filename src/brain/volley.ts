/**
 * Volleys: keep a ranged attack on one target instead of asking again after
 * every shot.
 *
 * A missile, a thrown flask, a wand zap and an attack spell are each one
 * decision, so a fight at range costs a model call per shot. The target was
 * chosen once and the shots that follow change nothing the model needs to weigh,
 * so the plan holds the target and fires again until something that does matter
 * changes.
 *
 * WHAT ENDS A VOLLEY. The target dies or steps out of sight; the line of fire
 * closes, which the view's own projection answers when it can; the ammunition,
 * flasks, wand charges or mana run out; or the watcher reports news (a new
 * creature, a blow, a status effect). The watcher belongs to the plan and checks
 * before every step, so those stops are the caller's and not repeated here.
 *
 * WHY projectionPath IS THE GATE. The line of fire is the one thing a volley
 * needs that a single shot does not, and the view exposes it only in newer
 * games. A view without it keeps the single shot: firing blind through a wall is
 * worse than asking again.
 */

import type { AgentCommand, AgentView } from "@rpgm-tools/neo-angband-core";
import type { SquireContext } from "../context.js";
import type { Loc } from "../grid.js";
import { inspecting } from "./threat-model.js";
import { attackOptions, type AttackContext } from "./combat-kit.js";

/** A ranged attack that can be repeated. */
export type RangedGoal = "shoot" | "throw_oil" | "aim_wand" | "cast_attack";

/** Whether this view can report the line of fire, so a volley is safe to run. */
export function volleyAvailable(view: AgentView): boolean {
  return typeof inspecting(view).projectionPath === "function";
}

/**
 * Whether the shot reaches the target over the remembered map. A view without
 * the read answers true, since the caller only volleys when it has one.
 */
export function lineOfFire(view: AgentView, target: Loc): boolean {
  const path = inspecting(view).projectionPath?.({ x: target.x, y: target.y });
  if (path === undefined) return true;
  const grids = path.grids;
  const last = grids[grids.length - 1];
  return last !== undefined && last.x === target.x && last.y === target.y;
}

/**
 * The step function of a volley plan: one shot at the held target, or null when
 * the volley is over. The target id is held from the decision, so a different
 * creature wandering into range is not fired at without being weighed.
 */
export function volleySteps(goal: RangedGoal, targetId: number, spellSidx?: number, safety?: (view: AgentView) => AttackContext): (ctx: SquireContext) => AgentCommand | null {
  return (ctx) => {
    const view = ctx.view;
    const target = view.monsters().find((monster) => monster.id === targetId && monster.visible);
    if (target === undefined) return null;
    if (!lineOfFire(view, target.grid)) return null;
    const outcome = attackOptions(view, target, goal, safety?.(view)).find((attack) => spellSidx === undefined || attack.source !== null && "sidx" in attack.source && attack.source.sidx === spellSidx);
    const source = outcome?.source;
    if (source === null || source === undefined) return null;
    if (!ctx.act.setTargetMonster(target.id)) return null;
    if ("sidx" in source) return ctx.act.cast(source.sidx);
    if (goal === "shoot") return readLauncher(view) ? ctx.act.fire(source.handle) : null;
    return goal === "throw_oil" ? ctx.act.throw(source.handle) : ctx.act.aimWand(source.handle);
  };
}

function readLauncher(view: AgentView): boolean {
  return view.equipment().some((item) => item?.tval === 5);
}

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
import { readPack, type Pack } from "./pack.js";
import { inspecting } from "./threat-model.js";

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
export function volleySteps(goal: RangedGoal, targetId: number, spellSidx?: number): (ctx: SquireContext) => AgentCommand | null {
  return (ctx) => {
    const view = ctx.view;
    const target = view.monsters().find((monster) => monster.id === targetId && monster.visible);
    if (target === undefined) return null;
    if (!lineOfFire(view, target.grid)) return null;
    const command = shot(goal, ctx, readPack(view), spellSidx);
    if (command === null) return null;
    if (!ctx.act.setTargetMonster(target.id)) return null;
    return command;
  };
}

/** One shot with the current ammunition, or null when that resource is gone. */
function shot(goal: RangedGoal, ctx: SquireContext, pack: Pack, spellSidx?: number): AgentCommand | null {
  switch (goal) {
    case "shoot": {
      const ammo = pack.ammo[0];
      return pack.launcher && ammo !== undefined ? ctx.act.fire(ammo.handle) : null;
    }
    case "throw_oil": {
      const oil = pack.oil[0];
      return oil === undefined ? null : ctx.act.throw(oil.handle);
    }
    case "aim_wand": {
      const wand = pack.attackWand[0];
      return wand === undefined ? null : ctx.act.aimWand(wand.handle);
    }
    case "cast_attack": {
      /* The spell the decision picked, while it is still castable. */
      const spell = spellSidx === undefined ? pack.attackSpell[0] : pack.attackSpell.find((s) => s.sidx === spellSidx);
      return spell === undefined ? null : ctx.act.cast(spell.sidx);
    }
  }
}

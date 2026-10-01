/** Preparation and return limits apply before judgment and again before each planned command. */

import type { AgentCommand, AgentView, MonsterView } from "@rpgm-tools/neo-angband-core";
import type { SquireContext } from "../context.js";
import type { Goal, Offer } from "../brain/goals.js";
import type { Plan } from "../brain/brain.js";
import { floorTarget } from "../brain/items.js";
import { canRead } from "../brain/pack.js";
import { arrivalFeeling } from "../brain/level-feel.js";
import { pickTarget } from "../threat.js";
import { AUTOFIGHT_REACH } from "../missions/autofight.js";
import { DIRECTIONS, key, steps, type Loc } from "../grid.js";
import { flowFrom, stepDown, type FlowField } from "../flow.js";
import { frontiers, hasFloorObject, isRoutable, isWalkable, knownStairs, standingOnHarm } from "../map.js";
import type { Persona } from "../persona/persona.js";
import type { Terrain } from "../terrain.js";
import { recallItem } from "../town/needs.js";
import { createDeparture, EARNING_LEASH, EARNING_TURNS } from "../town/departure.js";
import { createLevelPacing, stairLeash } from "./pacing.js";
import { missingPreparation, supplies, supplyMargin } from "./readiness.js";

const OPTIONAL: ReadonlySet<Goal> = new Set(["explore", "fetch", "pick_up", "tunnel"]);

export function createJourney(terrain: Terrain, unseenDanger?: (view: AgentView) => boolean) {
  const pacing = createLevelPacing();
  const departure = createDeparture();
  let returnReason: string | null = null;
  let previousHp: number | null = null;
  let unseenUntil = -1;
  let lastTurn = -1;
  const remembered = new Map<number, { monster: MonsterView; until: number }>();
  let town = { ready: true, earning: false, reason: "", target: null as number | null };
  let expired = false;
  let footOffered = false;
  let recallActive = false;
  let anchor: Loc = { x: 0, y: 0 };
  let leashField: FlowField | null = null;
  let breederLevel = false;
  let breederDepth = -1;
  let breederTurn = -1;
  let breederArrival: string | null = null;

  function breederExit(view: AgentView): boolean {
    const player = view.player();
    const arrival = view.messages().find((message) => arrivalFeeling([message])) ?? null;
    if (breederDepth !== player.depth || view.turn() < breederTurn || arrival !== null && arrival !== breederArrival) breederLevel = false;
    breederDepth = player.depth;
    breederTurn = view.turn();
    breederArrival = arrival;
    if (player.depth > 0 && player.level <= 5 && view.monsters().filter((monster) => monster.visible && !monster.asleep && monster.raceFlags.includes("MULTIPLY")).length >= 3) breederLevel = true;
    return breederLevel;
  }

  function observe(view: AgentView): void {
    const player = view.player();
    const turn = view.turn();
    const state = pacing.observe(view, terrain);
    breederExit(view);
    leashField = null;
    if (state.fresh) {
      if (player.depth === 0 || turn < lastTurn) returnReason = null;
      previousHp = null;
      unseenUntil = -1;
      remembered.clear();
    }
    for (const monster of view.monsters()) if (monster.visible && !monster.asleep) remembered.set(monster.id, { monster, until: turn + 100 });
    const live = new Set(view.monsters().map((monster) => monster.id));
    for (const [id, entry] of remembered) if (!live.has(id) || entry.until < turn) remembered.delete(id);
    if (previousHp !== null && player.hp < previousHp && !view.monsters().some((monster) => monster.visible && !monster.asleep)) unseenUntil = turn + 100;
    previousHp = player.hp;
    lastTurn = turn;
    departure.observe(view, terrain);
    if (player.depth > 0) {
      if (!departure.active()) returnReason ??= supplyMargin(view);
      else if (departure.finished(view) || supplies(view).food === 0 || !supplies(view).workingLight && !supplies(view).lastingLight || checkedRoute(view, upStairs(view)) === null) returnReason ??= "the earning trip's limit or return route";
    }
    expired = state.expired;
    anchor = state.anchor;
  }

  function safeDelay(view: AgentView): boolean {
    const player = view.player();
    if (standingOnHarm(view, terrain, player.grid)) return false;
    if (player.status.poisoned > 0 || player.status.cut > 0 || player.status.blind > 0 || player.status.confused > 0 || (unseenDanger?.(view) ?? view.turn() <= unseenUntil)) return false;
    if (view.monsters().some((monster) => monster.visible && (monster.raceFlags.includes("MULTIPLY") && steps(monster.grid, player.grid) <= 10 || !monster.asleep || steps(monster.grid, player.grid) <= 8))) return false;
    return ![...remembered.values()].some((entry) => entry.until >= view.turn());
  }

  function checkedRoute(view: AgentView, goals: readonly Loc[]): Loc[] | null {
    const player = view.player();
    if (goals.some((grid) => key(grid) === key(player.grid))) return [];
    if (player.status.poisoned > 0 || player.status.cut > 0 || player.status.blind > 0 || player.status.confused > 0 || (unseenDanger?.(view) ?? view.turn() <= unseenUntil)) return null;
    const threats = [...remembered.values()].filter((entry) => entry.until >= view.turn()).map((entry) => entry.monster);
    const enter = (grid: Loc) => isRoutable(view, terrain, grid) && !terrain.isClosedDoor(view.cell(grid.x, grid.y)?.feat ?? -1) && !view.cell(grid.x, grid.y)?.trap;
    const field = flowFrom({ goals, canEnter: enter });
    if (!Number.isFinite(field.distance(player.grid))) return null;
    const route: Loc[] = [];
    let here = player.grid;
    while (field.distance(here) > 0 && route.length < 250) {
      const direction = stepDown(field, here, (grid) => enter(grid) && isWalkable(view, terrain, grid));
      if (direction === null) return null;
      here = { x: here.x + direction.dx, y: here.y + direction.dy };
      route.push(here);
    }
    if (field.distance(here) !== 0) return null;
    if (view.monsters().some((monster) => monster.visible && monster.asleep && route.some((grid) => steps(grid, monster.grid) <= (monster.raceFlags.includes("MULTIPLY") ? 10 : 2)))) return null;
    /* An unknown ranged attack cannot be priced as zero during a walking return. */
    if (threats.length > 0) return null;
    return route;
  }

  function upStairs(view: AgentView): Loc[] {
    return knownStairs(view, terrain).filter((grid) => terrain.isUpStair(view.cell(grid.x, grid.y)?.feat ?? -1));
  }

  function leashed(view: AgentView, at: Loc): boolean {
    if (view.player().depth === 0 || view.player().level >= 20 && !departure.active()) return true;
    const stairs = upStairs(view);
    /* With no remembered exit, only a three-step search near arrival is justified. */
    const sources = stairs.length > 0 ? stairs : [anchor];
    const limit = stairs.length === 0 ? 3 : departure.active() ? EARNING_LEASH : stairLeash(view.player().level);
    leashField ??= flowFrom({ goals: sources, canEnter: (grid) => {
      const cell = view.cell(grid.x, grid.y);
      if (cell === null || !cell.known) return false;
      return isRoutable(view, terrain, grid) && !terrain.isClosedDoor(cell.feat) && !cell.trap;
    } });
    const field = leashField;
    if (view.cell(at.x, at.y)?.known === false) return DIRECTIONS.some((dir) => field.distance({ x: at.x + dir.dx, y: at.y + dir.dy }) + 1 <= limit);
    return field.distance(at) <= limit;
  }

  function exitTargets(view: AgentView): Loc[] {
    if (returnReason !== null || missingPreparation(view, view.player().depth + 1).length > 0) return upStairs(view);
    return knownStairs(view, terrain);
  }

  function apply(offers: readonly Offer[], view: AgentView, persona: Persona | null, visited: ReadonlySet<number>, recalling: boolean): Offer[] {
    footOffered = false;
    recallActive = recalling;
    observe(view);
    const player = view.player();
    if (player.depth === 0) town = departure.status(view, terrain, persona, visited);
    const home = returnReason !== null;
    const target = pickTarget(view.monsters(), player.grid, { wakeSleepers: true, reach: AUTOFIGHT_REACH });
    let out = offers.filter((offer) => {
      if (breederLevel && (OPTIONAL.has(offer.goal) || offer.goal === "rest" || offer.goal === "descend")) return false;
      if (breederLevel && ["fight", "shoot", "throw_oil", "cast_attack", "aim_wand"].includes(offer.goal) && (target === null || steps(target.grid, player.grid) > 1)) return false;
      if (offer.goal === "wait" && recalling && !safeDelay(view)) return false;
      if (offer.goal === "rest" && recalling && !safeDelay(view)) return false;
      if (offer.goal === "recall_town" && !safeDelay(view) && !offer.criteria.includes("cannot stop the next blow")) return false;
      if (offer.goal === "recall_dungeon") return !recalling && town.ready && missingPreparation(view, player.maxDepth).length === 0;
      if (offer.goal === "descend") return !recalling && (player.depth === 0 ? town.ready || town.earning : !home && !departure.active() && missingPreparation(view, player.depth + 1).length === 0);
      /* The tactical planner prices a route through unseen danger; this return check cannot replace it. */
      if (offer.goal === "leave_level" && !unseenDanger?.(view) && !view.monsters().some((monster) => monster.visible && !monster.asleep)) return checkedRoute(view, exitTargets(view)) !== null;
      if (OPTIONAL.has(offer.goal) && (home || expired)) return false;
      if (offer.goal === "explore" && player.depth > 0) return frontiers(view, terrain).some((grid) => leashed(view, grid));
      if (offer.goal === "fetch") {
        const loot = floorTarget(view, terrain, false);
        return loot !== null && leashed(view, loot.at);
      }
      if (offer.goal === "pick_up") return leashed(view, player.grid);
      return true;
    });
    if (player.depth === 0 && !town.ready) out = out.map((offer) => offer.goal === "descend" ? { ...offer, criteria: `Earn gold on dungeon level 1 for the missing ${town.reason}. The trip lasts at most ${String(EARNING_TURNS)} game turns and stays within ${String(EARNING_LEASH)} path steps of the up stairs.` } : offer);
    const reason = home ? `The character's ${returnReason ?? "supplies"} margin calls for town now.` : "This level has used its game-turn budget without enough progress.";
    if (player.depth > 0 && (home || expired)) {
      if (!recalling && safeDelay(view) && canRead(view) && recallItem(view) !== null && !out.some((offer) => offer.goal === "recall_town")) out.push({ goal: "recall_town", criteria: `Read Word of Recall to return to town while waiting is safe. ${reason}`, risk: 0.02 });
      if (checkedRoute(view, exitTargets(view)) !== null) {
        footOffered = true;
        out = out.filter((offer) => offer.goal !== "leave_level");
        out.push({ goal: "leave_level", criteria: home ? `Take the checked route to the up stairs and continue toward town. ${reason}` : `Take a checked staircase to a fresh or safer level. ${reason}`, risk: 0.02, survival: player.hp });
      }
    }
    if (breederLevel && !out.some((offer) => offer.goal === "leave_level") && checkedRoute(view, exitTargets(view)) !== null) {
      footOffered = true;
      out.push({ goal: "leave_level", criteria: "Leave this breeder level by the checked staircase. The exit objective lasts until the level changes.", risk: 0.02, survival: player.hp });
    }
    if (breederLevel && !recalling && safeDelay(view) && canRead(view) && recallItem(view) !== null && !out.some((offer) => offer.goal === "recall_town")) out.push({ goal: "recall_town", criteria: "Read Word of Recall to leave this breeder level while waiting is safe.", risk: 0.02, survival: player.hp });
    if (!footOffered && !view.monsters().some((monster) => monster.visible && !monster.asleep)) {
      const missing = missingPreparation(view, player.depth + 1)[0];
      if (missing !== undefined) out = out.map((offer) => offer.goal === "leave_level" ? { ...offer, criteria: `Take a checked up staircase to a safer level. The next depth needs ${missing.reason}.${offer.criteria.includes("the game says") ? ` ${offer.criteria}` : ""}` } : offer);
    }
    return out;
  }

  function guarded(goal: Goal | null, plan: Plan): Plan {
    const foot = goal === "leave_level" && footOffered;
    const recalling = recallActive;
    return { ...plan, step(view, act) {
      observe(view);
      const player = view.player();
      if (breederLevel && (goal === "rest" || goal === "descend" || goal !== null && OPTIONAL.has(goal))) return null;
      if (breederLevel && goal !== null && ["fight", "shoot", "throw_oil", "cast_attack", "aim_wand"].includes(goal)) {
        const target = pickTarget(view.monsters(), player.grid, { wakeSleepers: true, reach: AUTOFIGHT_REACH });
        if (target === null || steps(target.grid, player.grid) > 1) return null;
      }
      if (goal === "wait" && !safeDelay(view)) return null;
      if (goal === "rest" && recalling && !safeDelay(view)) return null;
      if (goal === "recall_dungeon" && (!town.ready || missingPreparation(view, player.maxDepth).length > 0)) return null;
      if (goal === "recall_town" && !safeDelay(view) && player.hp >= player.maxHp * 0.35 && !view.monsters().some((monster) => monster.visible && monster.raceFlags.includes("UNIQUE") && monster.speed > player.speed && player.level <= 3)) return null;
      if (goal === "descend") {
        if (player.depth === 0 && !town.ready && !town.earning || player.depth > 0 && missingPreparation(view, player.depth + 1).length > 0) return null;
        if (player.depth === 0 && town.earning && !departure.active()) departure.begin(view, town.target);
      }
      if (goal === null) {
        /* A rejected judgment cannot let the errand ladder bypass the guards. */
        const command = plan.step(view, act);
        if (command === null) return null;
        if (command.code === "descend") return !breederLevel && !expired && returnReason === null && (player.depth === 0 ? town.ready : missingPreparation(view, player.depth + 1).length === 0) ? command : null;
        if (command.code === "walk") {
          const direction = DIRECTIONS.find((entry) => entry.key === command.dir);
          const at = direction === undefined ? null : { x: player.grid.x + direction.dx, y: player.grid.y + direction.dy };
          return at !== null && !breederLevel && !expired && returnReason === null && leashed(view, at) && !view.monsters().some((monster) => monster.visible && !monster.asleep && steps(monster.grid, at) <= 1) ? command : null;
        }
        return command.code === "pickup" && !breederLevel && leashed(view, player.grid) && !expired && returnReason === null ? command : null;
      }
      if (OPTIONAL.has(goal) && (expired || returnReason !== null || departure.finished(view))) return null;
      if (goal === "fetch") {
        const loot = floorTarget(view, terrain, false);
        if (loot === null ? !hasFloorObject(view, player.grid) || !leashed(view, player.grid) : !leashed(view, loot.at)) return null;
        /* Engine runs can cross the leash before the next planner observation. */
        const single = { ...view, travelPath: undefined };
        const command = plan.step(single, act);
        if (command?.code === "walk" || command?.code === "open") {
          const dir = DIRECTIONS.find((entry) => entry.key === command.dir);
          if (dir === undefined || !leashed(view, { x: player.grid.x + dir.dx, y: player.grid.y + dir.dy })) return null;
        }
        return command;
      }
      if (goal === "leave_level" && !unseenDanger?.(view) && (foot || !view.monsters().some((monster) => monster.visible && !monster.asleep))) {
        const goals = exitTargets(view);
        const route = checkedRoute(view, goals);
        if (route === null) return null;
        const at = player.grid;
        const cell = view.cell(at.x, at.y);
        if (route.length === 0) return cell !== null && terrain.isUpStair(cell.feat) ? act.ascend() : act.descend();
        const next = route[0];
        const dir = next === undefined ? undefined : DIRECTIONS.find((direction) => at.x + direction.dx === next.x && at.y + direction.dy === next.y);
        return dir === undefined ? null : act.move(dir.key);
      }
      return plan.step(view, act);
    } };
  }

  function explore(ctx: SquireContext): AgentCommand | null {
    observe(ctx.view);
    if (expired || returnReason !== null || departure.finished(ctx.view)) return null;
    const goals = frontiers(ctx.view, terrain).filter((grid) => leashed(ctx.view, grid));
    const at = ctx.view.player().grid;
    if (!goals.some((grid) => key(grid) === key(at))) {
      const field = flowFrom({ goals, canEnter: (grid) => isRoutable(ctx.view, terrain, grid) && leashed(ctx.view, grid) });
      const direction = stepDown(field, at, (grid) => isWalkable(ctx.view, terrain, grid) && leashed(ctx.view, grid));
      return direction === null ? null : ctx.act.move(direction.key);
    }
    /* An unknown square has no proved stair distance, so it stays inside the leash's remaining margin. */
    const direction = DIRECTIONS.find((dir) => {
      const next = { x: at.x + dir.dx, y: at.y + dir.dy };
      const cell = ctx.view.cell(next.x, next.y);
      return cell !== null && !cell.known && leashed(ctx.view, next);
    });
    return direction === undefined ? null : ctx.act.move(direction.key);
  }

  function blocked(view: AgentView): string | null {
    if (breederLevel) return "Squire must leave this breeder level, but it has no checked exit or safe Recall wait.";
    if (view.player().depth === 0 && !town.ready) return `Squire cannot leave town ready: it still needs ${town.reason}, and no bounded earning trip is safe.`;
    if (returnReason !== null) return `Squire needs town for ${returnReason}, but it has no checked return or safe Recall wait.`;
    const missing = missingPreparation(view, view.player().depth + 1)[0];
    return missing === undefined ? null : `Squire cannot descend yet: it needs ${missing.reason}.`;
  }

  return { apply, guarded, explore, safeDelay, checkedRoute, leashed, blocked, breederExit };
}

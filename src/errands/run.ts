/**
 * The eight errands as missions: what each one does on the way to its own end.
 *
 * An errand here does only its own work. Staying alive is the driver's job: it
 * hands the decision to the goal planner's safety floor, reflexes and escapes
 * whenever something is dangerous, and calls these only when nothing is. So an
 * errand that meets a creature does not end; it waits while the fight or the
 * escape runs, and picks up where it was.
 *
 * The existing missions are reused where they fit. Exploring is the exploring
 * errand, and clearing a level is the fighting errand aimed at one creature at
 * a time. They run with the creature and hit point stops switched off, because
 * the driver owns those now, and a disturbance that ends one only starts a
 * fresh one on the next decision.
 */

import type { AgentView } from "@rpgm-tools/neo-angband-core";
import type { SquireContext } from "../context.js";
import type { Decision, Mission, Stop, StopReason } from "../mission.js";
import { isStop, issue, stop } from "../mission.js";
import type { Plan } from "../brain/brain.js";
import type { Persona } from "../persona/persona.js";
import type { Loc } from "../grid.js";
import { key } from "../grid.js";
import { advance, alreadyCollected, markCollected, newProgress, type Progress } from "../progress.js";
import { cellAt, frontiers, hasFloorObject, knownStairs } from "../map.js";
import { travelTo } from "../travel.js";
import { floorTarget, junkInPack, packFull, stillWorthIt, type FloorTarget } from "../brain/items.js";
import { recallItem } from "../town/needs.js";
import { recallPending } from "../brain/goals.js";
import { pickTarget } from "../threat.js";
import { autoexplore } from "../missions/autoexplore.js";
import { autofight } from "../missions/autofight.js";
import type { ErrandId } from "./catalog.js";
import { ERRAND_DONE, ERRAND_TEXT } from "./text.js";

/** What an errand reads beyond the decision context. */
export interface ErrandEnv {
  /** The persona when it may colour errands, or null for the plain way. */
  persona(): Persona | null;
  /** Grids to route around, when the persona is a cautious one. */
  avoid(view: AgentView): ((grid: Loc) => boolean) | undefined;
  /** A fresh shopping trip for the restock errand. */
  shopping(): Plan;
}

/** The plain way: no persona, no detours. */
export function plainEnv(shopping: () => Plan): ErrandEnv {
  return { persona: () => null, avoid: () => undefined, shopping };
}

/** Farthest a creature may be for the clearing errand to go after it. */
const CLEAR_REACH = 200;

/** Game turns to wait on a Word of Recall before walking the stairs instead. Recall takes 15 to 35 player turns. */
const RECALL_WAIT_TURNS = 600;

/** Stops from a reused mission that only mean something interrupted it, so the work goes on with a fresh one. */
const INTERRUPTIONS: ReadonlySet<StopReason> = new Set(["hurt", "creature-appeared", "afflicted", "unsafe", "target-gone"]);

/** A reused mission, with its own progress, restarted after an interruption. */
interface Inner {
  mission: Mission;
  progress: Progress;
}

interface Slot {
  inner: Inner | null;
}

function innerContext(ctx: SquireContext, inner: Inner): SquireContext {
  /* The driver watches creatures and hit points for every errand, so the reused
   * missions are not asked to stop for them, and the driver's own budget bounds
   * the errand as a whole. */
  return { ...ctx, progress: inner.progress, cfg: { ...ctx.cfg, stopOnNewCreature: false, stopOnLowHealth: false, errandSteps: Number.MAX_SAFE_INTEGER } };
}

/** Run a reused mission one decision, starting a fresh one after an interruption. */
function runInner(ctx: SquireContext, slot: Slot, make: () => Mission): Decision {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (slot.inner === null) {
      const inner: Inner = { mission: make(), progress: newProgress(ctx.view.player().depth) };
      const declined = inner.mission.begin(innerContext(ctx, inner));
      if (declined !== null) {
        if (INTERRUPTIONS.has(declined.reason)) continue;
        return { stop: declined };
      }
      slot.inner = inner;
    }
    const decision = slot.inner.mission.step(innerContext(ctx, slot.inner));
    if (!isStop(decision)) return decision;
    slot.inner = null;
    if (!INTERRUPTIONS.has(decision.stop.reason)) return decision;
  }
  return stop("blocked", "The errand keeps being interrupted.");
}

function onFeature(ctx: SquireContext, test: (feat: number) => boolean): boolean {
  const cell = cellAt(ctx.view, ctx.view.player().grid);
  return cell !== null && test(cell.feat);
}

function stairsOf(ctx: SquireContext, test: (feat: number) => boolean): Loc[] {
  return knownStairs(ctx.view, ctx.terrain).filter((grid) => {
    const cell = cellAt(ctx.view, grid);
    return cell !== null && test(cell.feat);
  });
}

/**
 * Walk to the nearest of these grids, exploring until one is known. Arriving
 * returns null so the caller decides what standing there means.
 */
function reach(ctx: SquireContext, env: ErrandEnv, goals: () => Loc[], explore: Slot, notFound: string): Decision | null {
  const known = goals();
  if (known.length > 0) {
    const travel = travelTo(ctx, known, env.avoid(ctx.view));
    switch (travel.kind) {
      case "arrived": return null;
      case "step": return issue(travel.command);
      case "blocked": return stop("blocked", "The way to the staircase is blocked.");
      case "unreachable": break;
    }
  }
  const walked = runInner(ctx, explore, () => autoexplore({ allowAwake: true }));
  if (isStop(walked) && walked.stop.reason === "done") return stop("nothing-to-do", notFound);
  return walked;
}

function done(id: ErrandId): { readonly stop: Stop } {
  return stop("done", ERRAND_DONE[id]);
}

function lootErrand(env: ErrandEnv): Mission {
  let target: FloorTarget | null = null;
  const skipped = new Set<string>();
  const dropped = new Set<number>();
  return {
    id: "errand-loot",
    label: ERRAND_TEXT.labels.loot,
    begin: () => null,
    step(ctx) {
      const { view, act } = ctx;
      const at = view.player().grid;
      advance(ctx.progress, at);
      const persona = env.persona();
      const here: FloorTarget = { at, name: "", away: 0, gold: false, sellable: false, useful: false, value: null, known: true };
      if (hasFloorObject(view, at) && !alreadyCollected(ctx.progress, at) && !skipped.has(key(at)) && stillWorthIt(view, here, false, persona)) {
        if (!packFull(view)) {
          markCollected(ctx.progress, at);
          return issue(act.pickup());
        }
        /* Triage: a full pack makes room by dropping what has no use and no
         * sale value, one thing at a time, and then picks up. With nothing to
         * drop, the pile is left. */
        const junk = junkInPack(view);
        if (junk !== null && !dropped.has(junk.handle)) {
          dropped.add(junk.handle);
          ctx.log(`errand: the pack is full, so Squire drops the ${junk.name} to make room`);
          return issue(act.drop(junk.handle));
        }
        ctx.log("errand: the pack is full and holds nothing worth less, so the pile is left");
        skipped.add(key(at));
      }
      for (let attempt = 0; attempt < 3; attempt += 1) {
        if (target !== null && (skipped.has(key(target.at)) || !stillWorthIt(view, target, false, persona))) target = null;
        target ??= floorTarget(view, ctx.terrain, false, persona);
        if (target === null) return done("loot");
        if (skipped.has(key(target.at))) return stop("done", "The rest of the loot cannot be taken.");
        if (ctx.progress.idle >= ctx.cfg.idleSteps) return stop("blocked", "The way to the loot is blocked.");
        const travel = travelTo(ctx, [target.at], env.avoid(view));
        if (travel.kind === "step") return issue(travel.command);
        if (travel.kind === "blocked") return stop("blocked", "The way to the loot is blocked.");
        /* Arrived at a pile that turned out not to be worth taking, or found it
         * cannot be reached: leave it and look at the next one. */
        skipped.add(key(target.at));
        target = null;
      }
      return stop("done", "The rest of the loot cannot be taken.");
    },
  };
}

function townErrand(env: ErrandEnv): Mission {
  const explore: Slot = { inner: null };
  let read: { readonly depth: number; readonly turn: number } | null = null;
  let depth: number | null = null;
  return {
    id: "errand-town",
    label: ERRAND_TEXT.labels.town,
    begin: () => null,
    step(ctx) {
      const { view, act, terrain } = ctx;
      const player = view.player();
      advance(ctx.progress, player.grid);
      if (player.depth === 0) return done("town");
      if (depth !== player.depth) explore.inner = null;
      depth = player.depth;
      const turn = view.turn();
      if (read === null) {
        const scroll = recallItem(view);
        /* A recall the player already read is left to run: a second reading
         * would cancel it. */
        if (scroll !== null && !recallPending(player, null, turn)) {
          read = { depth: player.depth, turn };
          ctx.log("errand: Squire reads Word of Recall to go back to town");
          return issue(act.read(scroll.handle));
        }
      }
      const waited = read === null ? 0 : turn - read.turn;
      if (recallPending(player, read, turn) && waited <= RECALL_WAIT_TURNS) return issue(act.hold());
      /* No scroll, or a recall that has not taken: walk up. */
      if (onFeature(ctx, terrain.isUpStair)) return issue(act.ascend());
      const walk = reach(ctx, env, () => stairsOf(ctx, terrain.isUpStair), explore, "No up staircase can be found on this level.");
      return walk ?? issue(act.ascend());
    },
  };
}

function stairErrand(id: "down" | "up", env: ErrandEnv): Mission {
  const explore: Slot = { inner: null };
  return {
    id: `errand-${id}`,
    label: ERRAND_TEXT.labels[id],
    begin: () => null,
    step(ctx) {
      advance(ctx.progress, ctx.view.player().grid);
      const test = id === "down" ? ctx.terrain.isDownStair : ctx.terrain.isUpStair;
      if (onFeature(ctx, test)) return done(id);
      const walk = reach(ctx, env, () => stairsOf(ctx, test), explore, id === "down" ? "No down staircase can be found on this level." : "No up staircase can be found on this level.");
      return walk ?? done(id);
    },
  };
}

function leaveErrand(env: ErrandEnv): Mission {
  const explore: Slot = { inner: null };
  let start: number | null = null;
  return {
    id: "errand-leave",
    label: ERRAND_TEXT.labels.leave,
    begin(ctx) {
      start = ctx.view.player().depth;
      return null;
    },
    step(ctx) {
      const { view, act, terrain } = ctx;
      advance(ctx.progress, view.player().grid);
      if (start !== null && view.player().depth !== start) return done("leave");
      if (onFeature(ctx, terrain.isDownStair)) return issue(act.descend());
      if (onFeature(ctx, terrain.isUpStair)) return issue(act.ascend());
      const walk = reach(ctx, env, () => knownStairs(view, terrain), explore, "No staircase can be found on this level.");
      return walk ?? stop("blocked", "The staircase cannot be taken.");
    },
  };
}

function exploreErrand(): Mission {
  const explore: Slot = { inner: null };
  return {
    id: "errand-explore",
    label: ERRAND_TEXT.labels.explore,
    begin: () => null,
    step(ctx) {
      advance(ctx.progress, ctx.view.player().grid);
      if (frontiers(ctx.view, ctx.terrain).length === 0) return done("explore");
      const walked = runInner(ctx, explore, () => autoexplore({ allowAwake: true }));
      return isStop(walked) && walked.stop.reason === "done" ? done("explore") : walked;
    },
  };
}

function clearErrand(): Mission {
  const fight: Slot = { inner: null };
  const explore: Slot = { inner: null };
  /* Creatures the fighting errand gave up on: out of reach, or behind something. */
  const passed = new Set<number>();
  let targetId: number | null = null;
  const next = (ctx: SquireContext) => pickTarget(ctx.view.monsters().filter((m) => !passed.has(m.id)), ctx.view.player().grid, { wakeSleepers: true, reach: CLEAR_REACH });
  return {
    id: "errand-clear",
    label: ERRAND_TEXT.labels.clear,
    begin: () => null,
    step(ctx) {
      advance(ctx.progress, ctx.view.player().grid);
      if (fight.inner === null) targetId = next(ctx)?.id ?? null;
      if (targetId !== null) {
        const id = targetId;
        const fought = runInner(ctx, fight, () => autofight(id));
        if (!isStop(fought)) return fought;
        if (fought.stop.reason !== "done") passed.add(id);
        targetId = null;
      }
      const walked = runInner(ctx, explore, () => autoexplore({ allowAwake: true }));
      if (isStop(walked) && walked.stop.reason === "done") {
        return next(ctx) === null ? done("clear") : stop("blocked", "A creature in sight cannot be reached.");
      }
      return walked;
    },
  };
}

function restockErrand(env: ErrandEnv): Mission {
  let trip: Plan | null = null;
  return {
    id: "errand-restock",
    label: ERRAND_TEXT.labels.restock,
    begin(ctx) {
      if (ctx.view.player().depth !== 0) return { reason: "nothing-to-do", detail: ERRAND_TEXT.reasons.notInTown };
      trip = env.shopping();
      return null;
    },
    step(ctx) {
      advance(ctx.progress, ctx.view.player().grid);
      if (trip === null || ctx.view.player().depth !== 0) return stop("level-changed", "The character left town.");
      const command = trip.step(ctx.view, ctx.act);
      return command === null ? done("restock") : issue(command);
    },
  };
}

/** The mission for one errand. One per start: it holds the errand's progress. */
export function errandMission(id: ErrandId, env: ErrandEnv): Mission {
  switch (id) {
    case "loot": return lootErrand(env);
    case "town": return townErrand(env);
    case "down": return stairErrand("down", env);
    case "up": return stairErrand("up", env);
    case "leave": return leaveErrand(env);
    case "explore": return exploreErrand();
    case "clear": return clearErrand();
    case "restock": return restockErrand(env);
  }
}

/** Whether a change of depth ends this errand. Going up is the town errand's work, and leaving is the other's. */
export function endsOnNewLevel(id: ErrandId): boolean {
  return id !== "town" && id !== "leave";
}

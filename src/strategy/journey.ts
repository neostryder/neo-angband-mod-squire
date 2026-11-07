import { playerSnapshot, monsterSnapshot, snapshotEpoch, snapshotIdentity } from "../map.js";
/** Preparation and return limits apply before judgment and again before each planned command. */

import type { AgentActions, AgentCommand, AgentView, MonsterView } from "../host-adapter.js";
import type { SquireContext } from "../context.js";
import type { Goal, Offer } from "../brain/goals.js";
import type { Plan } from "../brain/brain.js";
import { floorTarget } from "../brain/items.js";
import { canRead, hungry, readPack, unknownFlavours } from "../brain/pack.js";
import { arrivalFeeling, dangerousLevelFeeling } from "../brain/level-feel.js";
import { forecastFight, forecastPhase, forecastWalk, tacticalFrame } from "../brain/forecast.js";
import { attackOptions } from "../brain/combat-kit.js";
import { canMakeContact, damageField, forecastExposure, monsterActions, riskQuantile, threatMemoryTurns, rememberedCleared, assessThreat, incomingDamage, turnsPerAction } from "../brain/threat-model.js";
import { pickTarget } from "../threat.js";
import { AUTOFIGHT_REACH } from "../missions/autofight.js";
import { stuckThresholds } from "../brain/decision-memory.js";
import { DIRECTIONS, key, steps, type Loc } from "../grid.js";
import { travelTo } from "../travel.js";
import { flowFrom, stepDown, type FlowField } from "../flow.js";
import { besideStationaryThreat, besideParalysingGazer, frontiers, hasFloorObject, isClosedDoor, isRoutable, isWalkable, knownDownStairs, knownStairs, neverMoves, paralysingGazer, standingOnHarm } from "../map.js";
import type { Persona } from "../persona/persona.js";
import type { Terrain } from "../terrain.js";
import { recallItem, RECALL_FROM_DEPTH, shownName } from "../town/needs.js";
import { createDeparture, EARNING_LEASH, EARNING_TURNS } from "../town/departure.js";
import { createExplorationPressure, createLevelPacing, diveSchedule, stairLeash, type ExplorationPressure } from "./pacing.js";
import { descentGaps as gapsAt, missingPreparation as preparationAt, poisonRecovery, descentPolicy, supplies, supplyMargin, tripLight, shallowDiveChecks, shallowDiveReady } from "./readiness.js";
import { stepsBand, turnsBand } from "../brain/bands.js";

const OPTIONAL: ReadonlySet<Goal> = new Set(["explore", "fetch", "pick_up", "tunnel"]);

/** Below this share of maximum hit points, a stair search falls back to the leash and a hurt character is not sent farther out. */
export const SEARCH_HP_FRACTION = 0.35;
const breederForecasts = new WeakMap<AgentView, Map<string, boolean>>();

/** Breeding matters when the forecasted clearing cost spends the persona's loss budget. */
export function breedersOverwhelm(view: AgentView, terrain: Terrain, persona: Persona | null, observedDamage: ReadonlyMap<string, number> = new Map()): boolean {
  const breeders = monsterSnapshot(view).filter((monster) => monster.visible && !monster.asleep && monster.raceFlags.includes("MULTIPLY"));
  if (breeders.length < 2) return false;
  const stamp = JSON.stringify([view.turn(), snapshotEpoch(), persona, [...observedDamage]]);
  let cache = breederForecasts.get(view);
  if (cache === undefined) { cache = new Map(); breederForecasts.set(view, cache); }
  const cached = cache.get(stamp);
  if (cached !== undefined) return cached;
  const policy = descentPolicy(persona);
  const cleared = new Set<number>();
  let at = view.player().grid;
  let loss = 0;
  let uncertainty = 0;
  for (const monster of [...breeders].sort((a, b) => steps(at, a.grid) - steps(at, b.grid))) {
    const remaining = monsterSnapshot(view).filter((other) => !cleared.has(other.id));
    if (steps(at, monster.grid) > 1) {
      const contact = DIRECTIONS.map((dir) => ({ x: monster.grid.x + dir.dx, y: monster.grid.y + dir.dy }))
        .filter((grid) => isRoutable(view, terrain, grid) && !remaining.some((other) => key(other.grid) === key(grid)))
        .sort((a, b) => steps(at, a) - steps(at, b))[0];
      if (contact === undefined) { cache.set(stamp, true); return true; }
      at = contact;
    }
    const player = { ...view.player(), grid: at };
    const contactView: AgentView = { ...view, player: () => player, monsters: () => remaining, cell: (x, y) => {
      const cell = view.cell(x, y);
      return cell !== null && cleared.has(cell.monster) ? { ...cell, monster: 0 } : cell;
    } };
    const context = { terrain, facts: { observedDamage, quantile: riskQuantile(persona), monsters: remaining } };
    const frame = tacticalFrame(contactView, context);
    const fights = attackOptions(contactView, monster, "fight", context).map((attack) => forecastFight(frame, monster, attack));
    const fight = fights.sort((a, b) => a.loss.upper - b.loss.upper)[0];
    if (fight === undefined || !Number.isFinite(fight.actions)) { cache.set(stamp, true); return true; }
    loss += fight.loss.mean;
    uncertainty = Math.max(uncertainty, fight.loss.upper - fight.loss.mean);
    if (loss + uncertainty * (1 - policy.appetite) > view.player().hp * policy.risk) { cache.set(stamp, true); return true; }
    cleared.add(monster.id);
  }
  const overwhelmed = loss + uncertainty * (1 - policy.appetite) > view.player().hp * policy.risk;
  cache.set(stamp, overwhelmed);
  return overwhelmed;
}

export function createJourney(terrain: Terrain, unseenDanger?: (view: AgentView) => boolean, levelsPersist: () => boolean = () => false, now: () => number = Date.now, log: (message: string) => void = () => {}, observedDamage: ReadonlyMap<string, number> = new Map(), immediateDive = true) {
  const pacing = createLevelPacing();
  const exploration = createExplorationPressure();
  let pressure: ExplorationPressure | null = null;
  const departure = createDeparture();
  let returnReason: string | null = null;
  let returnStock: ReturnType<typeof supplies> | null = null;
  let returnDepth = -1;
  /* Set when the persona chose the trip home; the margin did not force it. */
  let chosenReturn = false;
  let previousHp: number | null = null;
  let unseenUntil = -1;
  let lastTurn = -1;
  const remembered = new Map<number, { monster: MonsterView; until: number; activeUntil: number; distance: number }>();
  let town = { ready: true, earning: false, reason: "", target: null as number | null };
  let expired = false;
  let footOffered = false;
  let recallActive = false;
  let lastPersona: Persona | null = null;
  let widened = false;
  let anchor: Loc = { x: 0, y: 0 };
  let leashField: FlowField | null = null;
  let leashView: AgentView | null = null;
  let leashVersion = "";
  let leashHasUp = false;
  let leashAt = now();
  let leashGrowth = 0;
  let dangerousFeeling = false;
  let breederLevel = false;
  let breederDepth = -1;
  let breederLevelId: number | undefined;
  let breederTurn = -1;
  let breederArrival: string | null = null;
  let exitTarget: Loc | null = null;
  let routeFailure: string | null = null;
  let depthAt: number | null = null;
  let deepest = 0;
  let clockTurn = -1;
  let journeyAt = now();
  const relaxed = new Set<string>();
  const blockedDark = new Set<string>();
  const gazers = new Map<number, MonsterView>();
  let refresh: { depth: number; arrived: boolean } | null = null;
  const blockedObstacles = new Set<string>();
  const obstacleAttempts = new Map<string, number>();
  const jammed = new Set<string>();
  let obstacle: { grid: Loc; turn: number; code: string } | null = null;
  let darkStep: { from: Loc; to: Loc; turn: number } | null = null;
  const exploredFrom = new Map<string, { surroundings: string; visits: number }>();
  let explorationAt: { turn: number; grid: string } | null = null;
  let explorationKnown = 0;
  let explorationGoal: Loc | null = null;
  const abandonedFrontiers = new Set<string>();
  let diveSince: { depth: number; time: number; turn: number } | null = null;
  const quietRefreshes = new Map<number, number>();
  let stalledAt = now();
  let stalledDecisions = 0;
  let watchdogTurn = -1;
  let watchdogDepth = -1;
  let turnAt = now();
  let turnDecisions = 0;
  let bestDepth = -1;
  let bestXp = 0;
  let bestGold = 0;
  const bestKnown = new Map<number, number>();
  const bestItems = new Map<string, number>();
  let recoveryAt = -Infinity;
  let recoveryDecision = -Infinity;
  let recoveryStage = 0;
  let reserveSince: number | null = null;
  let reserveDecisions = 0;
  const refusedStairs = new Map<string, { turn: number; time: number }>();
  const triedFlavours = new Set<string>();
  let stairAttempt: { turn: number; depth: number; from: string; target: string } | null = null;
  let pendingStair: { depth: number; down: boolean } | null = null;
  let arrivalStair: { depth: number; from: number; grid: string; turn: number } | null = null;
  let crossed: { from: number; to: number } | null = null;
  const flips: number[] = [];

  function stairAllowed(view: AgentView, down: boolean): boolean {
    const player = playerSnapshot(view);
    const destination = player.depth + (down ? 1 : -1);
    /* A tactical exit must not send an untrained character into another lethal fight. */
    if (down && player.depth > 0 && player.depth < 10) {
      const checks = shallowDiveChecks(view, lastPersona);
      const trapped = besideStationaryThreat(view, player.grid) && !knownStairs(view, terrain).some((at) => terrain.isUpStair(view.cell(at.x, at.y)?.feat ?? -1));
      if (!trapped && (player.maxLevel < checks.levelFloor || player.maxHp < checks.maxHpFloor)) return false;
    }
    while (flips.length > 0 && now() - flips[0]! >= 60000 * descentPolicy(lastPersona).scale) flips.shift();
    if (crossed?.from === destination && crossed.to === player.depth && flips.length >= descentPolicy(lastPersona).reversals) return false;
    if (arrivalStair === null || arrivalStair.depth !== player.depth || arrivalStair.from !== destination ||
      arrivalStair.grid !== key(player.grid) || view.turn() > arrivalStair.turn) return true;
    const visible = monsterSnapshot(view).filter((monster) => monster.visible && !monster.asleep);
    const danger = incomingDamage(view, player.grid, 2, terrain, { monsters: visible, creaturesOnly: true, observedDamage });
    return danger.damage > 0 || danger.status > 0;
  }

  function stairCommand(view: AgentView, command: AgentCommand | null): AgentCommand | null {
    if (command?.code !== "ascend" && command?.code !== "descend") return command;
    observe(view);
    const down = command.code === "descend";
    if (!stairAllowed(view, down)) return null;
    pendingStair = { depth: playerSnapshot(view).depth, down };
    return command;
  }

  function reserveExpired(view: AgentView): boolean {
    return playerSnapshot(view).depth > 0 && playerSnapshot(view).depth < 10 && reserveSince !== null &&
      (now() - reserveSince >= 60000 * descentPolicy(lastPersona).scale || reserveDecisions >= 120 * descentPolicy(lastPersona).scale);
  }

  function recoveryHealthy(view: AgentView, full = false): boolean {
    const player = playerSnapshot(view);
    const checks = shallowDiveChecks(view, lastPersona);
    return player.depth < 10 && player.hp >= player.maxHp * (full ? descentPolicy(lastPersona).recoveryShare : descentPolicy(lastPersona).hpShare) && checks.statusReady && checks.casterAttack &&
      player.maxLevel >= checks.levelFloor && player.maxHp >= checks.maxHpFloor && checks.tripLight && checks.food >= descentPolicy(lastPersona).food && !checks.hungry &&
      !standingOnHarm(view, terrain, player.grid);
  }

  function scheduledRecovery(view: AgentView): boolean {
    const pressure = schedule(view).stage;
    if (pressure === 0) return false;
    const stock = supplies(view);
    return recoveryHealthy(view, true) && stock.cures >= descentPolicy(lastPersona).reserve && stock.phase + stock.escapes >= descentPolicy(lastPersona).reserve;
  }

  function recoverySafe(view: AgentView, urgent = false): boolean {
    observe(view);
    const player = playerSnapshot(view);
    if (standingOnHarm(view, terrain, player.grid) || unseenDanger?.(view) || view.turn() <= unseenUntil ||
      [player.status.poisoned, player.status.cut, player.status.blind, player.status.confused, player.status.afraid, player.status.stun].some((value) => value > 0)) return false;
    const damage = incomingDamage(view, player.grid, urgent ? 1 : 2, terrain, { observedDamage, quantile: riskQuantile(lastPersona) });
    return damage.status === 0 && damage.damage < (urgent ? player.hp - Math.max(2, player.maxHp * 0.1) : player.hp * 0.25);
  }

  /** Walking and stair reversals cannot renew the deadline without a useful gain. */
  function watchdog(view: AgentView, decision: boolean): Plan | null {
    const player = playerSnapshot(view);
    const turn = view.turn();
    if (stairAttempt !== null) {
      if (turn === stairAttempt.turn && player.depth === stairAttempt.depth && key(player.grid) === stairAttempt.from) refusedStairs.set(stairAttempt.target, { turn, time: now() });
      stairAttempt = null;
    }
    if (turn < watchdogTurn) {
      bestDepth = -1;
      bestXp = 0;
      bestGold = 0;
      bestKnown.clear();
      bestItems.clear();
      quietRefreshes.clear();
      reserveSince = null;
      reserveDecisions = 0;
      refusedStairs.clear();
      triedFlavours.clear();
    }
    const changed = turn !== watchdogTurn || player.depth !== watchdogDepth;
    let progress = bestDepth < 0 || player.depth > bestDepth;
    if (changed) {
      turnAt = now();
      turnDecisions = 0;
    }
    if (changed || decision) {
      const bounds = view.mapBounds();
      let known = 0;
      for (let y = 0; y < bounds.height; y += 1) {
        for (let x = 0; x < bounds.width; x += 1) if (view.cell(x, y)?.known === true) known += 1;
      }
      /* A fresh floor can expose fewer cells than the previous visit while still making useful progress. */
      const previous = player.depth !== watchdogDepth ? known : bestKnown.get(player.depth) ?? 0;
      if (known >= previous + 8) progress = true;
      if (!bestKnown.has(player.depth) || player.depth !== watchdogDepth || known >= previous + 8) bestKnown.set(player.depth, known);
      const counts = new Map<string, number>();
      for (const item of view.inventory()) {
        const name = (shownName(item) ?? "").replace(/^\d+\s+|^an?\s+/i, "");
        counts.set(name, (counts.get(name) ?? 0) + item.number);
      }
      for (const [name, count] of counts) {
        if (count > (bestItems.get(name) ?? 0)) progress = true;
        bestItems.set(name, Math.max(count, bestItems.get(name) ?? 0));
      }
      progress ||= player.exp > bestXp || player.gold > bestGold;
      bestXp = Math.max(bestXp, player.exp);
      bestGold = Math.max(bestGold, player.gold);
      bestDepth = Math.max(bestDepth, player.depth);
    }
    watchdogTurn = turn;
    watchdogDepth = player.depth;
    if (progress) {
      stalledAt = now();
      stalledDecisions = 0;
      turnAt = now();
      turnDecisions = 0;
      recoveryStage = 0;
    }
    if (decision) {
      stalledDecisions += 1;
      turnDecisions += 1;
      reserveDecisions += 1;
    }
    const elapsed = now() - stalledAt;
    const stage = Math.max(elapsed >= 90000 || stalledDecisions >= 180 ? 4 : elapsed >= 75000 || stalledDecisions >= 150 ? 3 : elapsed >= 60000 || stalledDecisions >= 120 ? 2 : elapsed >= 45000 || stalledDecisions >= 90 ? 1 : 0, recoveryStage);
    const frozen = turnDecisions >= 3 || now() - turnAt >= 10000;
    if (stage === 0 && !frozen || stage <= recoveryStage && now() - recoveryAt < 5000 && stalledDecisions - recoveryDecision < 12) return null;
    recoveryAt = now();
    recoveryDecision = stalledDecisions;
    recoveryStage = stage;
    if (stage === 1 && !frozen) return { label: "watchdog: re-plan", step: () => null };
    const startDepth = player.depth;
    let commands = 0;
    const started = now();
    const recovery: Plan = { label: `watchdog: recover at stage ${String(stage)}`, step(current, act) {
      if (current.player().depth !== startDepth || commands >= 24 || now() - started >= 8000) return null;
      commands += 1;
      if (hungry(current)) return emergency(current, act);
      if (!recoverySafe(current, stage >= 4)) return emergency(current, act);
      if (stage >= 2 && recoveryHealthy(current, true) && recoverySafe(current, stage >= 4) && !recallActive) {
        const command = recoveryStair(current, act, knownDownStairs(current, terrain));
        if (command !== null) return command;
      }
      const unexplored = current.player().depth > 0 && returnReason === null && !breederLevel && !dangerousFeeling && explorationStep(current, true) !== null;
      if (stage >= 1 && unexplored && (safeDelay(current) || stage >= 4 && recoverySafe(current, true)) && current.player().hp >= current.player().maxHp * descentPolicy(lastPersona).hpShare) {
        const command = explore({ view: current, act } as SquireContext, true);
        if (command !== null) return command;
      }
      if (stage >= 3 && current.player().hp >= current.player().maxHp * descentPolicy(lastPersona).hpShare && recoverySafe(current, stage >= 4) && !recallActive) {
        const stock = supplies(current);
        const townReady = current.player().depth === 0 && current.player().hp >= current.player().maxHp * descentPolicy(lastPersona).recoveryShare && stock.food >= Math.min(1, descentPolicy(lastPersona).food) && (stock.workingLight || stock.lastingLight);
        const stairs = knownStairs(current, terrain).filter((grid) => terrain.isUpStair(current.cell(grid.x, grid.y)?.feat ?? -1) ? !unexplored : recoveryHealthy(current, true) || townReady);
        const command = recoveryStair(current, act, stairs);
        if (command !== null) return command;
      }
      if (stage >= 4 && !unexplored && recoverySafe(current, true)) {
        const scroll = canRead(current) ? unknownFlavours(current, "scroll").find((item) => !triedFlavours.has(`${String(item.handle)}:${item.name}`)) : undefined;
        const potion = unknownFlavours(current, "potion").find((item) => !triedFlavours.has(`${String(item.handle)}:${item.name}`));
        const item = scroll ?? potion;
        if (item !== undefined) {
          triedFlavours.add(`${String(item.handle)}:${item.name}`);
          return scroll !== undefined ? act.read(item.handle) : act.quaff(item.handle);
        }
      }
      if (stage >= 2 && current.player().hp >= current.player().maxHp * descentPolicy(lastPersona).hpShare && current.player().hp < current.player().maxHp && safeDelay(current)) return act.rest(10);
      if (stage >= 1 && safeDelay(current) && current.player().hp >= current.player().maxHp * descentPolicy(lastPersona).hpShare) {
        const command = explore({ view: current, act } as SquireContext, true);
        if (command !== null) return command;
      }
      return emergency(current, act);
    } };
    return { ...recovery, step: (current, act) => stairCommand(current, recovery.step(current, act)) };
  }

  let emergencyAttempt: { depth: number; level: number | undefined; turn: number; from: string; to: Loc; feat: number; monster: number } | null = null;
  const emergencyBlocked = new Map<string, { signature: string; turn: number }>();
  let emergencyFloor = "";
  let emergencyTarget: Loc | null = null;
  const emergencyVisits = new Map<string, number>();
  const emergencyAbandoned = new Map<string, number>();

  function emergency(view: AgentView, act: AgentActions): AgentCommand {
    observe(view);
    const player = playerSnapshot(view);
    const at = player.grid;
    const level = view.knownLevel?.()?.levelId;
    const floor = `${String(player.depth)}:${String(level)}`;
    const hold = turnsPerRecovery(view);
    if (floor !== emergencyFloor || emergencyAttempt !== null && view.turn() < emergencyAttempt.turn) {
      emergencyBlocked.clear(); emergencyVisits.clear(); emergencyAbandoned.clear(); emergencyTarget = null; emergencyFloor = floor;
    }
    for (const [grid, refusal] of emergencyBlocked) if (view.turn() - refusal.turn > hold) emergencyBlocked.delete(grid);
    for (const [grid, turn] of emergencyAbandoned) if (view.turn() - turn > hold) emergencyAbandoned.delete(grid);
    if (emergencyAttempt !== null) {
      const previous = emergencyAttempt;
      if (previous.depth !== player.depth || previous.level !== level || view.turn() < previous.turn) emergencyBlocked.clear();
      else if (previous.turn === view.turn() && previous.from === key(at)) {
        emergencyBlocked.set(key(previous.to), { signature: `${String(previous.feat)}:${String(previous.monster)}`, turn: view.turn() });
        log(`recovery refused a step to ${key(previous.to)}; this route is excluded briefly until time, terrain or its occupant changes.`);
      }
      emergencyAttempt = null;
    }
    const here = view.cell(at.x, at.y);
    if (player.status.poisoned === 0 && player.status.cut === 0) {
      if (terrain.isDownStair(here?.feat ?? -1) && recoveryHealthy(view, true) && canStair(view, true)) return act.descend();
      if (terrain.isUpStair(here?.feat ?? -1) && canStair(view, false)) return act.ascend();
    }
    const pack = readPack(view);
    const context = { terrain, facts: { observedDamage, quantile: riskQuantile(lastPersona) } };
    const frame = tacticalFrame(view, context);
    const adjacentFights = monsterSnapshot(view).filter((monster) => monster.visible && !monster.asleep && steps(at, monster.grid) === 1)
      .flatMap((monster) => attackOptions(view, monster, "fight", context).map((attack) => ({ monster, forecast: forecastFight(frame, monster, attack) })))
      .sort((a, b) => Number(b.forecast.viable) - Number(a.forecast.viable) || a.forecast.loss.upper - b.forecast.loss.upper || a.forecast.actions - b.forecast.actions);
    const adjacent = adjacentFights[0]?.monster;
    const attack = () => {
      if (adjacent === undefined || player.status.afraid > 0) return null;
      const dir = DIRECTIONS.find((direction) => at.x + direction.dx === adjacent.grid.x && at.y + direction.dy === adjacent.grid.y)!;
      return act.melee(dir.key);
    };
    const contact = incomingDamage(view, at, 1, terrain, { observedDamage, quantile: riskQuantile(lastPersona), creaturesOnly: true });
    const approaching = incomingDamage(view, at, 2, terrain, { observedDamage, quantile: riskQuantile(lastPersona), creaturesOnly: true });
    if (hungry(view) && pack.food[0] !== undefined && contact.damage === 0 && contact.status === 0) return act.eat(pack.food[0].handle);
    if (adjacentFights[0]?.forecast.viable === true && contact.damage < player.hp * descentPolicy(lastPersona).risk && contact.status === 0) {
      const command = attack();
      if (command !== null) return command;
    }
    if (adjacent !== undefined || contact.damage > 0 || contact.status > 0 || approaching.damage > player.hp * descentPolicy(lastPersona).risk || approaching.status > 0) {
      const exits = knownStairs(view, terrain).filter((grid) => {
        if (!canStair(view, terrain.isDownStair(view.cell(grid.x, grid.y)?.feat ?? -1))) return false;
        if (steps(at, grid) === 0) return true;
        const route = checkedRoute(view, [grid], true);
        return route !== null && forecastWalk(frame, route, true).viable;
      });
      const escape = recoveryStair(view, act, exits);
      if (escape !== null) return escape;
      const routes = DIRECTIONS.map((dir) => ({ dir, to: { x: at.x + dir.dx, y: at.y + dir.dy } }))
        .filter(({ to }) => isWalkable(view, terrain, to) && !standingOnHarm(view, terrain, to) && !monsterSnapshot(view).some((monster) => monster.visible && key(monster.grid) === key(to)))
        .map((route) => ({ ...route, forecast: forecastWalk(frame, [route.to]) }))
        .filter(({ forecast }) => forecast.viable && forecast.escaped)
        .sort((a, b) => a.forecast.loss.upper - b.forecast.loss.upper);
      if (routes[0] !== undefined) return act.move(routes[0].dir.key);
      const spell = pack.escapeSpell[0];
      if (spell !== undefined && forecastPhase(frame, spell.fail / 100).viable) return act.cast(spell.sidx);
      const phase = canRead(view) ? pack.phase[0] : undefined;
      if (phase !== undefined && forecastPhase(frame, 0).viable) return act.read(phase.handle);
      const teleport = canRead(view) ? pack.teleport.find((item) => /Scroll/i.test(item.name)) : undefined;
      if (teleport !== undefined) return act.read(teleport.handle);
      const command = attack();
      if (command !== null) return command;
      if (phase !== undefined) return act.read(phase.handle);
      log("recovery cannot break contact; no usable attack or escape exists.");
      return act.hold();
    }
    const enter = (grid: Loc): boolean => {
      if (key(grid) === key(at)) return true;
      const cell = view.cell(grid.x, grid.y);
      if (cell === null || emergencyBlocked.get(key(grid))?.signature === `${String(cell.feat)}:${String(cell.monster)}`) return false;
      return (isRoutable(view, terrain, grid) || diggableObstacle(view, grid)) && cell.monster <= 0 && !standingOnHarm(view, terrain, grid);
    };
    const probe = (): AgentCommand | null => {
      if (!frontiers(view, terrain).some((grid) => key(grid) === key(at))) return null;
      const direction = DIRECTIONS.find((dir) => {
        const to = { x: at.x + dir.dx, y: at.y + dir.dy };
        const cell = view.cell(to.x, to.y);
        return cell?.known === false && emergencyBlocked.get(key(to))?.signature !== `${String(cell.feat)}:${String(cell.monster)}` &&
          incomingDamage(view, to, 1, terrain, { observedDamage, quantile: riskQuantile(lastPersona) }).damage < player.hp;
      });
      if (direction === undefined) return null;
      const to = { x: at.x + direction.dx, y: at.y + direction.dy };
      const cell = view.cell(to.x, to.y)!;
      emergencyAttempt = { depth: player.depth, level, turn: view.turn(), from: key(at), to, feat: cell.feat, monster: cell.monster };
      log(`recovery probes unexplored ground at ${key(to)}.`);
      return act.move(direction.key);
    };
    if (emergencyTarget !== null && key(emergencyTarget) === key(at)) {
      const command = probe();
      if (command !== null) return command;
    }
    const stairs = knownStairs(view, terrain);
    const goals = (player.depth === 0 && stairs.length > 0 ? stairs : [...frontiers(view, terrain), ...stairs, ...obstacleFrontiers(view)]).filter((grid) => key(grid) !== key(at) && enter(grid) && !emergencyAbandoned.has(key(grid)));
    const visits = (emergencyVisits.get(key(at)) ?? 0) + 1;
    emergencyVisits.set(key(at), visits);
    if (emergencyTarget !== null && (visits > stuckThresholds(lastPersona).repeat || !goals.some((grid) => key(grid) === key(emergencyTarget!)))) {
      emergencyAbandoned.set(key(emergencyTarget), view.turn());
      log(`recovery abandons ${key(emergencyTarget)} after repeated visits or a changed destination.`);
      emergencyTarget = null;
      emergencyVisits.clear();
    }
    if (goals.length > 0) {
      let field = flowFrom({ goals: emergencyTarget === null ? goals.filter((grid) => !emergencyAbandoned.has(key(grid))) : [emergencyTarget], canEnter: enter });
      if (emergencyTarget !== null && !Number.isFinite(field.distance(at))) {
        emergencyAbandoned.set(key(emergencyTarget), view.turn());
        emergencyTarget = null;
        field = flowFrom({ goals: goals.filter((grid) => !emergencyAbandoned.has(key(grid))), canEnter: enter });
      }
      if (emergencyTarget === null && Number.isFinite(field.distance(at))) {
        let target = at;
        for (let distance = field.distance(at); distance > 0; distance -= 1) {
          const next = stepDown(field, target, enter);
          if (next === null) break;
          target = { x: target.x + next.dx, y: target.y + next.dy };
        }
        emergencyTarget = target;
        emergencyVisits.clear();
        log(`recovery commits to ${key(target)}.`);
        field = flowFrom({ goals: [target], canEnter: enter });
      }
      const direction = stepDown(field, at, (grid) => enter(grid) && incomingDamage(view, grid, 1, terrain, { observedDamage, quantile: riskQuantile(lastPersona) }).damage < player.hp);
      if (direction !== null) {
        const to = { x: at.x + direction.dx, y: at.y + direction.dy };
        const cell = view.cell(to.x, to.y)!;
        emergencyAttempt = { depth: player.depth, level, turn: view.turn(), from: key(at), to, feat: cell.feat, monster: cell.monster };
        log(`recovery takes a plain step toward reachable unexplored ground or stairs via ${key(to)}.`);
        return diggableObstacle(view, to) ? act.tunnel(direction.key) : isClosedDoor(view, terrain, to) ? act.open(direction.key) : act.move(direction.key);
      }
    }
    const probing = probe();
    if (probing !== null) return probing;
    const stock = supplies(view);
    if (canRead(view)) {
      const descent = view.inventory().find((item) => /Deep Descent/i.test(shownName(item) ?? ""));
      if (descent !== undefined && stock.workingLight) return act.read(descent.handle);
    }
    const command = attack();
    if (command !== null) return command;
    if (player.status.poisoned === 0 && player.status.cut === 0 && shallowDiveChecks(view, lastPersona).statusReady && terrain.isDownStair(here?.feat ?? -1) && canStair(view, true)) return act.descend();
    log("recovery has no reachable frontier, stair, attack or survivable step; the character spends time waiting for an opening.");
    return terrain.isShopEntrance(here?.feat ?? -1) || recoverySafe(view) && !monsterSnapshot(view).some((monster) => monster.visible && !monster.asleep) ? act.rest(2) : act.hold();
  }

  function turnsPerRecovery(view: AgentView): number {
    return turnsPerAction(playerSnapshot(view).speed) * stuckThresholds(lastPersona).repeat;
  }

  function recoveryStair(view: AgentView, act: AgentActions, goals: readonly Loc[]): AgentCommand | null {
    const available = goals.filter((grid) => {
      const refusal = refusedStairs.get(`${String(playerSnapshot(view).depth)}:${key(grid)}`);
      return refusal === undefined || now() - refusal.time >= 20000 * descentPolicy(lastPersona).scale || view.turn() - refusal.turn >= 20 * descentPolicy(lastPersona).scale;
    });
    const route = checkedRoute(view, available, true);
    if (route === null) return null;
    const at = playerSnapshot(view).grid;
    const target = route.at(-1) ?? at;
    stairAttempt = { turn: view.turn(), depth: playerSnapshot(view).depth, from: key(at), target: `${String(playerSnapshot(view).depth)}:${key(target)}` };
    if (route.length === 0) {
      if (terrain.isUpStair(view.cell(at.x, at.y)?.feat ?? -1)) return act.ascend();
      if (playerSnapshot(view).depth === 0) departure.begin(view, null, lastPersona);
      return act.descend();
    }
    const next = route[0]!;
    const direction = DIRECTIONS.find((dir) => at.x + dir.dx === next.x && at.y + dir.dy === next.y);
    return direction === undefined ? null : act.move(direction.key);
  }

  function depthMinutes(view: AgentView): number {
    const player = playerSnapshot(view);
    if (view.turn() < clockTurn) {
      depthAt = null;
      deepest = 0;
      journeyAt = now();
      relaxed.clear();
    }
    clockTurn = view.turn();
    if (player.depth > 0 && (depthAt === null || player.depth > deepest)) {
      depthAt = now();
      deepest = player.depth;
      relaxed.clear();
    }
    return depthAt === null ? 0 : Math.max(0, now() - depthAt) / 60000;
  }

  function schedule(view: AgentView) {
    depthMinutes(view);
    return diveSchedule(Math.max(0, now() - journeyAt) / 60000, playerSnapshot(view).depth, lastPersona);
  }

  function firstStair(view: AgentView): boolean {
    return playerSnapshot(view).depth >= 1 && playerSnapshot(view).depth < 10 && knownDownStairs(view, terrain).length > 0;
  }

  function stairEscape(view: AgentView): boolean {
    const at = playerSnapshot(view).grid;
    const feat = view.cell(at.x, at.y)?.feat ?? -1;
    return terrain.isUpStair(feat) || terrain.isDownStair(feat);
  }

  function missingPreparation(view: AgentView, depth: number, persona: Persona | null = lastPersona) {
    const minutes = depthMinutes(view);
    const gaps = preparationAt(view, depth, persona, minutes, firstStair(view), stairEscape(view));
    const normal = preparationAt(view, depth, persona);
    const changes = normal.filter((gap) => !gaps.some((current) => current.kind === gap.kind && current.reason === gap.reason))
      .map((gap) => `${gap.reason} -> ${gaps.find((current) => current.kind === gap.kind)?.reason ?? `${gap.kind} floor met`}`);
    const id = `${String(depth)}:${changes.join(";")}`;
    if (changes.length > 0 && !relaxed.has(id)) {
      relaxed.add(id);
      log(`descent gate relaxed for DL${String(depth)}: ${changes.join("; ")}; ${minutes.toFixed(1)} minutes without a depth gain, ambition ${String(persona?.sliders.ambition ?? 50)}, HP ${String(playerSnapshot(view).hp)}/${String(playerSnapshot(view).maxHp)}, preparation gaps: ${gaps.map((gap) => gap.reason).join("; ") || "none"}.`);
    }
    return gaps;
  }

  function descentGaps(view: AgentView, depth: number, persona: Persona | null) {
    missingPreparation(view, depth, persona);
    return gapsAt(view, depth, persona, depthMinutes(view), firstStair(view), stairEscape(view));
  }

  function breederExit(view: AgentView, persona = lastPersona): boolean {
    lastPersona = persona;
    const player = playerSnapshot(view);
    const arrival = view.messages().find((message) => arrivalFeeling([message])) ?? null;
    const levelId = view.knownLevel?.()?.levelId;
    if (breederDepth !== player.depth || breederLevelId !== levelId || view.turn() < breederTurn || arrival !== null && arrival !== breederArrival) {
      breederLevel = false;
      exitTarget = null;
    }
    breederDepth = player.depth;
    breederLevelId = levelId;
    breederTurn = view.turn();
    breederArrival = arrival;
    if (player.depth > 0 && breedersOverwhelm(view, terrain, lastPersona, observedDamage)) breederLevel = true;
    return breederLevel;
  }

  function returnMargin(view: AgentView): string | null {
    if (shallowDiveReady(view, playerSnapshot(view).depth + 1, lastPersona)) return null;
    const player = playerSnapshot(view);
    const stock = supplies(view);
    if (player.depth >= 1 && player.depth < 10) {
      const policy = descentPolicy(lastPersona);
      if (stock.food < policy.food || hungry(view)) return "food";
      if (!stock.lastingLight && (!stock.workingLight || stock.fuel < policy.reserve)) return "light and fuel";
      if (stock.cures < policy.reserve) return "healing";
      if (stock.phase + stock.escapes < policy.reserve) return "Phase Door";
      return null;
    }
    return supplyMargin(view, lastPersona);
  }

  function observe(view: AgentView): void {
    const player = playerSnapshot(view);
    const turn = view.turn();
    if (turn < lastTurn) {
      pendingStair = null;
      arrivalStair = null;
      crossed = null;
      flips.length = 0;
    }
    if (pendingStair !== null && pendingStair.depth !== player.depth) {
      if (player.depth === pendingStair.depth + (pendingStair.down ? 1 : -1)) {
        if (crossed?.from === player.depth && crossed.to === pendingStair.depth) flips.push(now());
        crossed = { from: pendingStair.depth, to: player.depth };
        arrivalStair = { depth: player.depth, from: pendingStair.depth, grid: key(player.grid), turn };
      }
      pendingStair = null;
    }
    const stockNow = supplies(view);
    const canBuyReserve = departure.reserveAffordable(view);
    const reserve = descentPolicy(lastPersona).reserve;
    const reserveMissing = stockNow.cures < reserve || stockNow.phase + stockNow.escapes < reserve;
    if (turn < lastTurn || !reserveMissing || canBuyReserve) {
      reserveSince = null;
      reserveDecisions = 0;
    } else reserveSince ??= now();
    depthMinutes(view);
    const state = pacing.observe(view, terrain, lastPersona);
    if (state.fresh) {
      leashAt = now();
      dangerousFeeling = false;
    }
    dangerousFeeling ||= dangerousLevelFeeling(view.messages()) !== null;
    /* The arrival stair is a starting radius, not a permanent boundary around an unfinished level. */
    leashGrowth = 3 * Math.floor(Math.max(state.turns / 100, (now() - leashAt) / 5000, state.explored / 40));
    if (state.fresh || state.known > explorationKnown) {
      exploredFrom.clear();
      abandonedFrontiers.clear();
      explorationAt = null;
    }
    if (state.fresh) {
      explorationGoal = null;
      diveSince = null;
    }
    explorationKnown = state.known;
    if (turn < lastTurn) {
      refresh = null;
      quietRefreshes.clear();
    }
    if (refresh !== null && player.depth !== (refresh.arrived ? refresh.depth - 1 : refresh.depth)) {
      if (!refresh.arrived && player.depth === refresh.depth - 1) refresh.arrived = true;
      else refresh = null;
    }
    breederExit(view);
    const leashSnapshot = `${view.turn()}:${snapshotEpoch()}`;
    if (leashView !== view || leashVersion !== leashSnapshot) {
      leashField = null;
      leashView = view;
      leashVersion = leashSnapshot;
    }
    if (state.fresh) {
      blockedDark.clear();
      blockedObstacles.clear();
      obstacleAttempts.clear();
      jammed.clear();
      obstacle = null;
      gazers.clear();
      darkStep = null;
      exploredFrom.clear();
      explorationAt = null;
      if (turn < lastTurn) {
        returnReason = null;
        chosenReturn = false;
      }
      previousHp = null;
      unseenUntil = -1;
      remembered.clear();
    }
    if (obstacle !== null) {
      const { grid, code, turn: attempted } = obstacle;
      const cell = view.cell(grid.x, grid.y);
      if (cell?.known === true && (terrain.isClosedDoor(cell.feat) || diggableObstacle(view, grid))) {
        const messages = view.messages().join(" ");
        if (code === "open" && /jammed|stuck/i.test(messages)) jammed.add(key(grid));
        else if (turn === attempted || (obstacleAttempts.get(key(grid)) ?? 0) >= 3 || /cannot tunnel|too hard|cannot make any progress/i.test(messages)) {
          blockedObstacles.add(key(grid));
          log(`exploration blocked ${code} at ${key(grid)} for this level: ${turn === attempted ? "no game time passed" : "the bounded attempts failed"}.`);
        }
      }
      obstacle = null;
    }
    if (darkStep !== null) {
      if (turn === darkStep.turn && key(player.grid) === key(darkStep.from)) blockedDark.add(key(darkStep.to));
      darkStep = null;
    }
    /* A stationary eye does not stop blocking its corridor when a corner hides
     * it. Forgetting that position makes the route reverse on each sighting. */
    for (const monster of monsterSnapshot(view)) {
      if (monster.visible && paralysingGazer(view, monster) && (monster.raceFlags.includes("NEVER_MOVE") || /^floating eye$/i.test(monster.race))) gazers.set(monster.id, monster);
    }
    for (const [id, monster] of gazers) {
      const cell = view.cell(monster.grid.x, monster.grid.y);
      if (cell?.inView === true && cell.monster !== id) gazers.delete(id);
    }
    /* The trip is over the moment the character stands in town, whatever brought it there. */
    if (player.depth === 0) {
      returnReason = null;
      chosenReturn = false;
    }
    const stock = returnReason === null ? null : supplies(view);
    const replenished = stock !== null && returnStock !== null && (
      returnReason === "food" && stock.food > returnStock.food ||
      returnReason === "healing" && stock.cures > returnStock.cures ||
      returnReason === "Phase Door" && stock.phase > returnStock.phase ||
      returnReason === "long escapes" && stock.escapes > returnStock.escapes ||
      returnReason === "healing and Phase Door" && (stock.cures > returnStock.cures || stock.phase > returnStock.phase) ||
      returnReason === "light and fuel" && (stock.fuel > returnStock.fuel || stock.workingLight && !returnStock.workingLight || stock.lastingLight && !returnStock.lastingLight));
    if ((chosenReturn || replenished || returnReason === "healing and Phase Door" && player.depth === returnDepth) && returnMargin(view) === null) {
      returnReason = null;
      chosenReturn = false;
    }
    if ((reserveExpired(view) && recoveryHealthy(view, true) || scheduledRecovery(view)) && ["healing", "Phase Door", "healing and Phase Door", "the earning trip's limit or return route"].includes(returnReason ?? "")) {
      returnReason = null;
      chosenReturn = false;
      departure.end();
    }
    const patience = threatMemoryTurns(lastPersona, player.speed);
    for (const monster of monsterSnapshot(view)) if (monster.visible && !monster.asleep) {
      const prior = remembered.get(monster.id);
      const distance = steps(player.grid, monster.grid);
      const approached = prior !== undefined && key(prior.monster.grid) !== key(monster.grid) && distance < prior.distance;
      const renewed = prior === undefined || approached || distance <= 1 || previousHp !== null && player.hp < previousHp;
      remembered.set(monster.id, { monster: { ...monster, visible: false }, until: turn + 100, activeUntil: renewed ? turn + patience : prior.activeUntil, distance });
    }
    for (const [id, entry] of remembered) if (turn - (entry.until - 100) > (view.apiVersion.startsWith("2.") ? patience : 100) || rememberedCleared(view, entry.monster, entry.until - 100, terrain)) remembered.delete(id);
    if (previousHp !== null && player.hp < previousHp && player.status.poisoned === 0 && player.status.cut === 0 && previousHp - player.hp > incomingDamage(view, player.grid, 2, terrain, { monsters: [] }).damage && !standingOnHarm(view, terrain, player.grid) && !monsterSnapshot(view).some((monster) => monster.visible && !monster.asleep)) unseenUntil = turn + 100;
    previousHp = player.hp;
    lastTurn = turn;
    departure.observe(view, terrain);
    if (shallowDiveReady(view, player.depth + 1, lastPersona)) {
      departure.end();
    }
    if (player.depth > 0) {
      if (!departure.active() && !(reserveExpired(view) && recoveryHealthy(view, true) || scheduledRecovery(view))) returnReason ??= returnMargin(view);
      /* A widened trip can start with no rations and too little gold to buy one,
       * so an empty pack ends it only once the character is hungry. */
      else if (departure.finished(view) || supplies(view).food === 0 && hungry(view) || !supplies(view).workingLight && !supplies(view).lastingLight) returnReason ??= "the earning trip's limit or return route";
    }
    expired = state.expired;
    anchor = state.anchor;
    if (returnReason === null) {
      returnStock = null;
      returnDepth = -1;
    } else if (returnStock === null) {
      returnStock = supplies(view);
      returnDepth = player.depth;
    }
  }

  const delayCache = new WeakMap<AgentView, { turn: number; epoch: number; persona: Persona | null; unseen: number; ordinary?: boolean; recovery?: boolean }>();

  function safeDelay(view: AgentView, recoveringStatus = false): boolean {
    let cached = delayCache.get(view);
    if (cached === undefined || cached.turn !== view.turn() || cached.epoch !== snapshotEpoch() || cached.persona !== lastPersona || cached.unseen !== unseenUntil) {
      cached = { turn: view.turn(), epoch: snapshotEpoch(), persona: lastPersona, unseen: unseenUntil };
      delayCache.set(view, cached);
    }
    const mode = recoveringStatus ? "recovery" : "ordinary";
    return cached[mode] ??= evaluateDelay(view, recoveringStatus);
  }

  function evaluateDelay(view: AgentView, recoveringStatus: boolean): boolean {
    const player = playerSnapshot(view);
    if (standingOnHarm(view, terrain, player.grid)) return false;
    if (player.status.poisoned > 0 && !(recoveringStatus && poisonRecovery(view, lastPersona)) || player.status.cut > 0 || !recoveringStatus && (player.status.blind > 0 || player.status.confused > 0) || (unseenDanger?.(view) ?? view.turn() <= unseenUntil)) return false;
    if (monsterSnapshot(view).some((monster) => monster.visible && threatensDelay(view, monster))) return false;
    return ![...remembered.values()].some((entry) => threatensDelay(view, entry.monster, entry.until - 100));
  }

  function threatensDelay(view: AgentView, monster: MonsterView, seen = view.turn()): boolean {
    if (view.turn() > (remembered.get(monster.id)?.activeUntil ?? Infinity)) return false;
    if (monster.asleep) return monster.raceFlags.includes("MULTIPLY") && canMakeContact(view, monster, playerSnapshot(view).grid, 2 + Math.ceil(4 * riskQuantile(lastPersona)), terrain);
    if (monster.raceFlags.includes("MULTIPLY") && steps(monster.grid, playerSnapshot(view).grid) <= 10) return true;
    const danger = forecastExposure(view, playerSnapshot(view).grid, 4, terrain, { monsters: [monster], quantile: riskQuantile(lastPersona), lastSeen: new Map([[monster.id, seen]]), creaturesOnly: true, observedDamage });
    return danger.upper > 0 || danger.status > 0;
  }

  /** The same permission drives offers, interruptions and each stair command. */
  function dive(view: AgentView, persona: Persona | null = lastPersona, recalling = recallActive) {
    lastPersona = persona;
    observe(view);
    const player = playerSnapshot(view);
    const gaps = descentGaps(view, player.depth + 1, persona);
    const stock = supplies(view);
    const expiredReserve = reserveExpired(view) && recoveryHealthy(view, true);
    const behind = scheduledRecovery(view);
    const policy = descentPolicy(persona);
    const reserves = stock.cures >= policy.reserve && stock.phase + stock.escapes >= policy.reserve;
    const allowed = (player.depth > 0 || policy.appetite > 0.85 && town.ready) && !player.dead && !recalling && returnReason === null && !departure.active() &&
      !breederLevel && stairAllowed(view, true) && tripLight(view, lastPersona) && gaps.hard.length === 0 &&
      (reserves || expiredReserve && policy.appetite > 0.7);
    const route = allowed ? checkedRoute(view, knownDownStairs(view, terrain)) : null;
    const ready = route !== null && !standingOnHarm(view, terrain, player.grid) && !(unseenDanger?.(view) ?? view.turn() <= unseenUntil) &&
      safeDelay(view) && player.hp >= player.maxHp * descentPolicy(lastPersona).hpShare &&
      [player.status.poisoned, player.status.cut, player.status.blind, player.status.confused, player.status.afraid, player.status.stun].every((value) => value === 0);
    if (!ready) diveSince = null;
    else if (diveSince === null || diveSince.depth !== player.depth || view.turn() < diveSince.turn) diveSince = { depth: player.depth, time: now(), turn: view.turn() };
    const delay = behind ? 0 : 15000 * policy.trainMinutes;
    const due = ready && diveSince !== null && (now() - diveSince.time >= delay || view.turn() - diveSince.turn >= 100 * policy.scale);
    const take = ready && player.depth < 10 && (shallowDiveReady(view, player.depth + 1, persona) || expiredReserve && policy.appetite > 0.7 || immediateDive && gaps.soft.length === 0 || due && gaps.soft.length === 0);
    return { allowed: allowed && (!behind || ready), take, route, due };
  }

  function gazeReach(view: AgentView, grid: Loc): boolean {
    return besideStationaryThreat(view, grid) || besideParalysingGazer(view, grid) || !playerSnapshot(view).objectFlags.includes("FREE_ACT") && [...gazers.values()].some((monster) => steps(grid, monster.grid) <= 1);
  }

  function checkedRoute(view: AgentView, goals: readonly Loc[], recovering = false): Loc[] | null {
    const player = playerSnapshot(view);
    routeFailure = null;
    const fail = (why: string): null => { routeFailure = why; return null; };
    if (goals.some((grid) => key(grid) === key(player.grid))) return [];
    if (player.status.blind > 0 || player.status.confused > 0 || (unseenDanger?.(view) ?? view.turn() <= unseenUntil)) return fail("blindness, confusion or an unexplained hit prevents a checked walk");
    const threats = [...remembered.values()].filter((entry) => view.turn() <= entry.activeUntil).map((entry) => entry.monster);
    const enter = (grid: Loc) => isRoutable(view, terrain, grid) && !gazeReach(view, grid) && !terrain.isClosedDoor(view.cell(grid.x, grid.y)?.feat ?? -1) && !view.cell(grid.x, grid.y)?.trap && (!breederLevel || !monsterSnapshot(view).some((monster) => monster.visible && key(monster.grid) === key(grid)));
    const field = flowFrom({ goals, canEnter: enter });
    if (!Number.isFinite(field.distance(player.grid))) return fail("no unblocked known route reaches the staircase");
    const route: Loc[] = [];
    let here = player.grid;
    while (field.distance(here) > 0 && route.length < 250) {
      const direction = stepDown(field, here, (grid) => enter(grid) && isWalkable(view, terrain, grid));
      if (direction === null) return fail("the next route square is blocked");
      here = { x: here.x + direction.dx, y: here.y + direction.dy };
      route.push(here);
    }
    if (field.distance(here) !== 0) return fail("the staircase is beyond the checked route limit");
    if (!breederLevel && monsterSnapshot(view).some((monster) => monster.visible && monster.asleep && route.some((grid) => steps(grid, monster.grid) <= (monster.raceFlags.includes("MULTIPLY") ? 10 : 2)))) return fail("the route would wake a nearby creature");
    /* Urgent exits must tolerate distant creatures while each next step keeps a health reserve. */
    if (breederLevel || recovering) {
      const next = route[0]!;
      const urgent = recovering && recoveryStage >= 4;
      const danger = incomingDamage(view, next, urgent ? 1 : 2, terrain, { monsters: threats, quantile: riskQuantile(lastPersona), observedDamage });
      const budget = urgent ? player.hp - Math.max(2, player.maxHp * 0.1) : player.hp * descentPolicy(lastPersona).risk;
      if (danger.status > 0 || danger.damage >= budget) return fail(`creatures near the next route square threaten ${String(danger.damage)} HP or a disabling effect`);
    } else if (threats.length > 0) {
      const frame = tacticalFrame(view, { terrain, facts: { monsters: threats, quantile: riskQuantile(lastPersona), observedDamage, lastSeen: new Map([...remembered].map(([id, entry]) => [id, entry.until - 100])) } });
      const checked = forecastWalk(frame, route.slice(0, 4), route.length <= 4);
      if (checked.loss.status > 0 || checked.loss.upper > player.hp * descentPolicy(lastPersona).risk || checked.after < player.maxHp * (1 - descentPolicy(lastPersona).risk)) return fail("the checked route loses its HP reserve or permits a disabling attack");
    }
    /* Poison and bleeding cost about a hit point a step, so the walk has to end before the hit points do. */
    if ((player.status.poisoned > 0 || player.status.cut > 0) && route.length * (player.status.cut > 100 ? 3 : 1) >= player.hp) return fail("poison or bleeding would exhaust HP before the staircase");
    return route;
  }

  function upStairs(view: AgentView): Loc[] {
    return knownStairs(view, terrain).filter((grid) => terrain.isUpStair(view.cell(grid.x, grid.y)?.feat ?? -1));
  }

  /** How far from the up stairs an earning trip may roam: a bold persona ranges toward the ordinary stair leash. */
  function earningLeash(view: AgentView): number {
    /* Six steps from the stairs turned up no gold last time, so this trip gets the normal leash. */
    if (departure.cameBackEmpty(view)) return Math.max(EARNING_LEASH, stairLeash(playerSnapshot(view).level, lastPersona));
    const bold = Math.min(100, Math.max(0, lastPersona?.sliders.boldness ?? 0)) / 100;
    return EARNING_LEASH + Math.round(Math.max(0, stairLeash(playerSnapshot(view).level, lastPersona) - EARNING_LEASH) * bold);
  }

  /**
   * Whether the journey must look for its staircase on foot.
   *
   * A return trip that can no longer walk a checked route searches for the
   * up stairs. A level marked for departure by breeders, or a level whose
   * leashed ground is used up while no down staircase is known, searches for
   * whichever staircase leads on. A Recall scroll read on the first levels
   * costs more than the trip makes there.
   */
  function searching(view: AgentView): boolean {
    return searchKind(view) !== null;
  }

  /** Why the character searches past the leash, or null when it keeps to it. */
  function searchKind(view: AgentView, insideStep?: Loc | null): "exit" | "onward" | "stay" | null {
    const player = playerSnapshot(view);
    const depth = player.depth;
    if (depth <= 0 || (unseenDanger?.(view) ?? view.turn() <= unseenUntil)) return null;
    const front = frontiers(view, terrain);
    if (front.length === 0) return null;
    if (returnReason !== null && checkedRoute(view, upStairs(view)) === null) return "exit";
    if (depth >= RECALL_FROM_DEPTH) return null;
    if (breederLevel && checkedRoute(view, exitTargets(view)) === null) return "exit";
    if (upStairs(view).length === 0 && departure.active() && (expired || departure.finished(view)) && checkedRoute(view, exitTargets(view)) === null) return "exit";
    if (dangerousFeeling) return checkedRoute(view, exitTargets(view)) === null ? "exit" : null;
    /* Ready to descend, no down staircase known, nothing left to explore inside the
     * leash. A wounded character, or one with a creature rated dangerous or worse in
     * sight, keeps to the leash: straying far from the up stairs costs the most when
     * a fight is already close, and the watcher only reacts once a blow lands. */
    const awake = monsterSnapshot(view).filter((monster) => monster.visible && !monster.asleep);
    const dangerous = awake.some((monster) => assessThreat(monster, player, awake, view, undefined, terrain).band >= 2 && (!neverMoves(view, monster) || threatensDelay(view, monster)));
    if (dangerous) return null;
    const inside = (insideStep === undefined ? explorationStep(view, false, false) : insideStep) !== null;
    if (inside) return null;
    if (!departure.active() && returnReason === null && knownDownStairs(view, terrain).length === 0 && (shallowDiveReady(view, depth + 1, lastPersona) || missingPreparation(view, depth + 1, lastPersona).length === 0) && player.hp >= player.maxHp * SEARCH_HP_FRACTION) return "onward";
    if (stayingOn(view, front)) return "stay";
    return !departure.active() && returnReason === null && !breederLevel && player.hp >= player.maxHp * descentPolicy(lastPersona).hpShare && safeDelay(view) &&
      explorationStep(view, true) !== null ? "stay" : null;
  }

  /** Early training and persistent levels need reachable ground beyond the leash before a quiet refresh pays. */
  function stayingOn(view: AgentView, front: readonly Loc[]): boolean {
    const player = playerSnapshot(view);
    const training = !departure.active() && player.depth <= Math.ceil(4 * descentPolicy(lastPersona).scale) && player.hp >= player.maxHp * (descentPolicy(lastPersona).hpShare - 0.05) &&
      missingPreparation(view, player.depth + 1, lastPersona).some((gap) => gap.kind === "level" || gap.kind === "hp");
    if (!(training || levelsPersist() && player.depth >= 2) || breederLevel || returnReason !== null || expired || unseenDanger?.(view)) return false;
    if ((!training && departure.active()) || missingPreparation(view, player.depth, lastPersona).length > 0 || missingPreparation(view, player.depth + 1, lastPersona).length === 0) return false;
    if (player.hp < player.maxHp * SEARCH_HP_FRACTION) return false;
    /* Ground the character cannot walk to would leave it with no climb and nothing to explore. */
    const field = flowFrom({ goals: [...front], canEnter: (grid) => isRoutable(view, terrain, grid) });
    return Number.isFinite(field.distance(player.grid));
  }

  /** Read the journey state from this view before answering, so a caller outside `apply` is not a step behind. */
  function searchingNow(view: AgentView): boolean {
    observe(view);
    return searching(view);
  }

  function leashed(view: AgentView, at: Loc): boolean {
    if (playerSnapshot(view).depth === 0 || playerSnapshot(view).level >= 20 * descentPolicy(lastPersona).scale && !departure.active()) return true;
    if (leashField === null) {
      const stairs = upStairs(view);
      leashHasUp = stairs.length > 0;
      /* With no remembered exit, a short search near arrival is justified; an earning trip arrives on a down staircase and must find the way up. */
      const sources = leashHasUp ? stairs : [anchor];
      leashField = flowFrom({ goals: sources, canEnter: (grid) => {
        const cell = view.cell(grid.x, grid.y);
        if (cell === null || !cell.known) return false;
        return isRoutable(view, terrain, grid) && !gazeReach(view, grid) && !terrain.isClosedDoor(cell.feat) && !cell.trap;
      } });
    }
    const base = departure.active() ? earningLeash(view) : leashHasUp ? stairLeash(playerSnapshot(view).level, lastPersona) : 3;
    const player = playerSnapshot(view);
    const growing = !departure.active() && player.hp >= player.maxHp * descentPolicy(lastPersona).hpShare && safeDelay(view) &&
      [player.status.poisoned, player.status.cut, player.status.blind, player.status.confused, player.status.afraid, player.status.stun].every((value) => value === 0);
    const limit = base + (growing ? leashGrowth : 0);
    const field = leashField;
    if (view.cell(at.x, at.y)?.known === false) return DIRECTIONS.some((dir) => field.distance({ x: at.x + dir.dx, y: at.y + dir.dy }) + 1 <= limit);
    return field.distance(at) <= limit;
  }

  function returningRefresh(view: AgentView): boolean {
    if (refresh === null || !refresh.arrived) return false;
    if (returnReason !== null || missingPreparation(view, refresh.depth, lastPersona).length > 0) {
      refresh = null;
      return false;
    }
    return true;
  }

  function refreshReturn(view: AgentView): boolean {
    observe(view);
    const player = playerSnapshot(view);
    return returningRefresh(view) && player.hp >= player.maxHp * descentPolicy(lastPersona).recoveryShare &&
      stairAllowed(view, true) &&
      [player.status.poisoned, player.status.cut, player.status.blind, player.status.confused, player.status.afraid, player.status.stun].every((value) => value === 0) &&
      terrain.isDownStair(view.cell(player.grid.x, player.grid.y)?.feat ?? -1);
  }

  function exitTargets(view: AgentView): Loc[] {
    if (returningRefresh(view)) return knownDownStairs(view, terrain);
    if (breederLevel && exitTarget !== null) return [exitTarget];
    /* A level marked by breeders takes up or down, whichever is known, since either leaves them behind. Only a character ready for the next depth may descend here. */
    if (breederLevel && returnReason === null && missingPreparation(view, playerSnapshot(view).depth + 1, lastPersona).length === 0) {
      const stairs = knownStairs(view, terrain);
      const route = checkedRoute(view, stairs);
      if (route !== null) exitTarget = route.at(-1) ?? playerSnapshot(view).grid;
      return exitTarget === null ? stairs : [exitTarget];
    }
    if (returnReason !== null || missingPreparation(view, playerSnapshot(view).depth + 1, lastPersona).length > 0) {
      const stairs = upStairs(view);
      if (breederLevel) {
        const route = checkedRoute(view, stairs);
        if (route !== null) exitTarget = route.at(-1) ?? playerSnapshot(view).grid;
      }
      return exitTarget === null ? stairs : [exitTarget];
    }
    return knownStairs(view, terrain);
  }

  function apply(offers: readonly Offer[], view: AgentView, persona: Persona | null, visited: ReadonlySet<number>, recalling: boolean, widen = false, chosen: string | null = null): Offer[] {
    widened = widen;
    footOffered = false;
    recallActive = recalling;
    lastPersona = persona;
    observe(view);
    const player = playerSnapshot(view);
    /* An early restock preference must not forbid progress while the pack can last. */
    if (player.depth > 0 && chosen !== null && returnReason === null && returnMargin(view) !== null) {
      returnReason = chosen;
      chosenReturn = true;
    }
    if (player.depth === 0) town = departure.status(view, terrain, persona, visited);
    const home = returnReason !== null;
    const unfinished = player.depth > 0 && !home && !breederLevel && !dangerousFeeling && (expired || offers.some((offer) => offer.goal === "leave_level")) && explorationStep(view, true) !== null;
    if (refreshReturn(view)) return [{ goal: "descend", criteria: "Return immediately down the connected staircase to finish the depth-preserving refresh.", risk: 0, survival: player.hp }];
    const diving = dive(view, persona, recalling);
    if (diving.take && offers.some((offer) => offer.goal === "descend")) return [{ goal: "descend", criteria: "Follow the checked route to the down staircase before optional exploration or upkeep.", risk: 0.02, survival: player.hp }];
    const target = pickTarget(monsterSnapshot(view), player.grid, { wakeSleepers: true, reach: AUTOFIGHT_REACH });
    /* Compute `searching` once for this apply: the filter and the post-filter both read it, and each call
     * costs an assessThreat walk over every awake creature. The view does not change inside apply. */
    let searchCache: { value: ReturnType<typeof searchKind> } | null = null;
    const searchFor = (): ReturnType<typeof searchKind> => {
      if (searchCache === null) searchCache = { value: searchKind(view) };
      return searchCache.value;
    };
    const search = (): boolean => searchFor() !== null;
    let out = offers.filter((offer) => {
      /* The widen path is the safety net when the model has nothing else; a hurt character past the
       * leash should head back toward known stairs or rest, not be sent further out. */
      if (widen && offer.goal === "explore") {
        const player = playerSnapshot(view);
        if (player.hp < player.maxHp * SEARCH_HP_FRACTION && !leashed(view, player.grid)) return false;
        return true;
      }
      if (offer.goal === "leave_level" && returningRefresh(view) && !monsterSnapshot(view).some((monster) => monster.visible && !monster.asleep)) return false;
      if (offer.goal === "leave_level" && unfinished && player.hp >= player.maxHp * descentPolicy(lastPersona).hpShare && safeDelay(view)) return false;
      if (offer.goal === "leave_level" && !home && !breederLevel && !monsterSnapshot(view).some((monster) => monster.visible && !monster.asleep) &&
        (quietRefreshes.get(player.depth) ?? 0) >= descentPolicy(persona).refreshes) return false;
      if (breederLevel && offer.goal === "leave_level") return checkedRoute(view, exitTargets(view)) !== null;
      if (breederLevel && !(offer.goal === "explore" && search()) && (OPTIONAL.has(offer.goal) || offer.goal === "rest" || offer.goal === "descend")) return false;
      if (breederLevel && offer.goal === "fight" && (target === null || steps(target.grid, player.grid) > 1)) return false;
      if (offer.goal === "wait" && recalling && !safeDelay(view, player.status.poisoned > 0)) return false;
      if (offer.goal === "rest" && recalling && !safeDelay(view)) return false;
      if (offer.goal === "recall_town" && !safeDelay(view) && !offer.criteria.includes("cannot stop the next blow")) return false;
      if (offer.goal === "recall_dungeon") return !recalling && town.ready && tripLight(view, lastPersona) && missingPreparation(view, player.maxDepth, lastPersona).length === 0;
      if (offer.goal === "descend" && player.depth === 0 && player.status.poisoned > 0) return false;
      if (offer.goal === "descend") return !recalling && (tripLight(view, lastPersona) || player.depth === 0 && town.earning) && (player.depth === 0 ? town.ready || town.earning || widen : diving.allowed);
      /* The tactical planner prices a route through unseen danger; this return check cannot replace it. */
      if (offer.goal === "leave_level" && !unseenDanger?.(view) && !monsterSnapshot(view).some((monster) => monster.visible && !monster.asleep)) return checkedRoute(view, exitTargets(view)) !== null && searchFor() !== "stay";
      if (offer.goal === "explore" && search()) return true;
      if (OPTIONAL.has(offer.goal) && (home || expired)) return false;
      if (offer.goal === "explore" && player.depth > 0) return explorationStep(view, false) !== null;
      if (offer.goal === "fetch") {
        const loot = floorTarget(view, terrain, false, lastPersona);
        return loot !== null && leashed(view, loot.at);
      }
      if (offer.goal === "pick_up") return leashed(view, player.grid);
      return true;
    });
    /* Soft gaps leave the descent to the model's readiness answer; the goal planner holds it back below the persona's threshold. */
    const soft = player.depth > 0 ? descentGaps(view, player.depth + 1, lastPersona).soft.map((gap) => gap.reason) : [];
    if (soft.length > 0) out = out.map((offer) => offer.goal === "descend" ? { ...offer, criteria: `${offer.criteria} The next level still asks for ${soft.join("; ")}.`, gaps: soft } : offer);
    if (player.depth === 0 && !town.ready) out = out.map((offer) => offer.goal === "descend" ? { ...offer, criteria: `Earn gold on dungeon level 1 for the missing ${town.reason}. The trip lasts at most ${String(EARNING_TURNS)} game turns (${turnsBand(EARNING_TURNS)}) and stays within ${String(earningLeash(view))} path steps (${stepsBand(earningLeash(view))}) of the up stairs.` } : offer);
    const reason = home ? chosenReturn ? "The character wants fresh potions and scrolls from town before this pack runs dry." : `The character's ${returnReason ?? "supplies"} margin calls for town now.` : "This level has used its game-turn budget without enough progress.";
    if (player.depth > 0 && (home || expired && !unfinished)) {
      const walkable = departure.active() && player.depth < RECALL_FROM_DEPTH && (checkedRoute(view, exitTargets(view)) !== null || search());
      if (search()) out = out.map((offer) => offer.goal === "explore" ? { ...offer, criteria: `Search this level for the up stairs; walking home from here is cheaper than a Recall scroll. ${reason}` } : offer);
      if (!walkable && !recalling && safeDelay(view) && canRead(view) && recallItem(view) !== null && !out.some((offer) => offer.goal === "recall_town")) out.push({ goal: "recall_town", criteria: `Read Word of Recall to return to town while waiting is safe. ${reason}`, risk: 0.02 });
      if ((home || (quietRefreshes.get(player.depth) ?? 0) < descentPolicy(lastPersona).refreshes) && checkedRoute(view, exitTargets(view)) !== null) {
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
    /* A stair search that is not the return-to-town search keeps its own wording. */
    if (search() && !(player.depth > 0 && (home || expired))) {
      const why = breederLevel ? "Search this level on foot for a staircase to leave the breeders behind." : searchFor() === "stay" ? `Walk past the stair leash to explore the unfinished level before considering a refresh.${levelsPersist() ? " With persistent levels, the stairs up only lead back to the level already cleared." : ""}` : "Search this level on foot for a staircase onward.";
      out = out.map((offer) => offer.goal === "explore" ? { ...offer, criteria: `${why} ${offer.criteria}` } : offer);
    }
    if (!footOffered && !monsterSnapshot(view).some((monster) => monster.visible && !monster.asleep)) {
      const missing = missingPreparation(view, player.depth + 1, lastPersona)[0];
      if (missing !== undefined) out = out.map((offer) => offer.goal === "leave_level" ? { ...offer, criteria: `Take a checked up staircase to a safer level. The next depth needs ${missing.reason}.${offer.criteria.includes("the game says") ? ` ${offer.criteria}` : ""}` } : offer);
    }
    return out.filter((offer) => offer.goal !== "leave_level" && offer.goal !== "descend" ||
      (offer.goal === "descend" ? stairAllowed(view, true) : canLeave(view)));
  }

  function guarded(goal: Goal | null, plan: Plan, initialView?: AgentView): Plan {
    const foot = goal === "leave_level" && footOffered;
    const recalling = recallActive;
    const wide = widened;
    let latest: AgentView | null = initialView ?? null;
    let leashLimited = false;
    let refusal: string | null = null;
    const refuse = (reason: string): null => { refusal = reason; return null; };
    const startingDepth = initialView?.player().depth;
    const guardedPlan: Plan = { ...plan, refusal: () => refusal ?? plan.refusal?.() ?? null, end(view) {
      latest = view ?? latest;
      plan.end?.(view);
      if (goal === "explore" && latest !== null) explorationReport(latest, leashLimited);
    }, step(view, act) {
      refusal = null;
      latest = view;
      if (goal === "explore" && !wide && !searchingNow(view)) {
        leashLimited ||= frontiers(view, terrain).some((grid) => !leashed(view, grid));
      }
      observe(view);
      const player = playerSnapshot(view);
      if (goal === "descend" && refreshReturn(view)) return act.descend();
      if (wide && goal === "explore" || goal === "explore" && searching(view)) return plan.step(view, act);
      if (breederLevel && goal === "explore") return explore({ view, act } as SquireContext, true);
      if (breederLevel && (goal === "rest" || goal === "descend" || goal !== null && OPTIONAL.has(goal))) return refuse("the breeder clearing forecast exceeds the persona's loss budget; take the exit route");
      if (breederLevel && goal !== null && ["fight", "shoot", "throw_oil", "cast_attack", "aim_wand"].includes(goal)) {
        const target = pickTarget(monsterSnapshot(view), player.grid, { wakeSleepers: true, reach: AUTOFIGHT_REACH });
        if (target === null || goal === "fight" && steps(target.grid, player.grid) > 1) return refuse("the breeder exit permits melee only against an adjacent blocker");
      }
      if (goal === "wait" && !safeDelay(view, !recalling || player.status.poisoned > 0)) return refuse("the waiting forecast is unsafe");
      if (goal === "rest" && recalling && !safeDelay(view)) return refuse("the Recall wait has no safe rest");
      if (goal === "recall_dungeon" && (!town.ready || !tripLight(view, lastPersona) || missingPreparation(view, player.maxDepth, lastPersona).length > 0)) return refuse("the persona's preparation for returning to the dungeon is incomplete");
      if (goal === "recall_town" && !safeDelay(view) && player.hp >= player.maxHp * 0.35 && !monsterSnapshot(view).some((monster) => monster.visible && monster.raceFlags.includes("UNIQUE") && monster.speed > player.speed && player.level <= 3)) return refuse("the Recall countdown would expose the character to attacks");
      if (goal === "descend") {
        if (startingDepth !== undefined && player.depth !== startingDepth) return refuse("the staircase already changed the dungeon level");
        if (player.depth > 0) {
          const diving = dive(view, lastPersona, recalling);
          if (!diving.allowed || player.hp < player.maxHp * descentPolicy(lastPersona).hpShare) return refuse("the persona's descent forecast or current HP reserve no longer permits this staircase");
        } else if (returnReason !== null || player.status.poisoned > 0 || !(tripLight(view, lastPersona) || town.earning) || !town.ready && !town.earning && !wide) return refuse("the town departure lacks preparation, light or a safe earning trip");
        if (player.depth === 0 && (town.earning || wide && !town.ready) && !departure.active()) departure.begin(view, town.target, lastPersona);
      }
      if (goal === null) {
        /* A rejected judgment cannot let the errand ladder bypass the guards. */
        const command = plan.step(view, act);
        if (command === null) return null;
        if (command.code === "descend") return !breederLevel && !expired && returnReason === null && tripLight(view, lastPersona) && (player.depth === 0 ? town.ready : missingPreparation(view, player.depth + 1, lastPersona).length === 0) ? command : null;
        if (command.code === "walk") {
          const direction = DIRECTIONS.find((entry) => entry.key === command.dir);
          const at = direction === undefined ? null : { x: player.grid.x + direction.dx, y: player.grid.y + direction.dy };
          return at !== null && !breederLevel && !expired && returnReason === null && leashed(view, at) && !monsterSnapshot(view).some((monster) => monster.visible && !monster.asleep && steps(monster.grid, at) <= 1) ? command : null;
        }
        return command.code === "pickup" && !breederLevel && leashed(view, player.grid) && !expired && returnReason === null ? command : null;
      }
      if (OPTIONAL.has(goal) && (expired || returnReason !== null || departure.finished(view))) return refuse(expired ? "the level exploration budget expired" : returnReason !== null ? `the town return needs ${returnReason}` : "the bounded earning trip finished");
      if (goal === "fetch") {
        const loot = floorTarget(view, terrain, false, lastPersona);
        if (loot === null ? !hasFloorObject(view, player.grid) || !leashed(view, player.grid) : !leashed(view, loot.at)) return refuse("no unrefused floor item is reachable inside the current leash");
        /* Engine runs can cross the leash before the next planner observation. */
        const single: AgentView = { ...view };
        delete single.travelPath;
        const command = plan.step(single, act);
        if (command?.code === "walk" || command?.code === "open") {
          const dir = DIRECTIONS.find((entry) => entry.key === command.dir);
          if (dir === undefined || !leashed(view, { x: player.grid.x + dir.dx, y: player.grid.y + dir.dy })) return refuse("the floor item route leaves the persona's current stair leash");
        }
        return command;
      }
      if (goal === "leave_level" && !unseenDanger?.(view) && (breederLevel || foot || !monsterSnapshot(view).some((monster) => monster.visible && !monster.asleep))) {
        if (returnReason === null && !breederLevel && !dangerousFeeling && player.hp >= player.maxHp * descentPolicy(lastPersona).hpShare && safeDelay(view) && explorationStep(view, true) !== null) return refuse("reachable unexplored ground takes priority over a quiet stair refresh");
        const goals = exitTargets(view);
        const route = checkedRoute(view, goals);
        if (route === null) return refuse("the staircase has no checked executable route");
        const at = player.grid;
        const cell = view.cell(at.x, at.y);
        if (route.length === 0) {
          if (!stairAllowed(view, !terrain.isUpStair(cell?.feat ?? -1))) return refuse("the connecting staircase is temporarily excluded");
          if (cell !== null && terrain.isUpStair(cell.feat)) {
            if (returnReason === null && !breederLevel && !monsterSnapshot(view).some((monster) => monster.visible && !monster.asleep)) {
              if ((quietRefreshes.get(player.depth) ?? 0) >= descentPolicy(lastPersona).refreshes) return refuse("the persona's quiet refresh allowance is exhausted");
              quietRefreshes.set(player.depth, (quietRefreshes.get(player.depth) ?? 0) + 1);
              refresh = { depth: player.depth, arrived: false };
            }
            return act.ascend();
          }
          return act.descend();
        }
        const next = route[0];
        const dir = next === undefined ? undefined : DIRECTIONS.find((direction) => at.x + direction.dx === next.x && at.y + direction.dy === next.y);
        return dir === undefined ? null : act.move(dir.key);
      }
      const command = plan.step(view, act);
      if (goal === "descend" && command?.code === "descend" && shallowDiveReady(view, player.depth + 1, lastPersona)) log(`descent gate relaxed for DL${String(player.depth + 1)}: taking seen > with at least 80 percent HP, ranged attack, food, light, two recovery or escape reserves and the paced character level floor.`);
      return command;
    } };
    return { ...guardedPlan, step: (view, act) => stairCommand(view, guardedPlan.step(view, act)) };
  }

  const explorationCache = new WeakMap<AgentView, Map<string, Loc | null>>();

  function explorationStep(view: AgentView, wide: boolean, searchingLevel?: boolean): Loc | null {
    if (searchingLevel === undefined) observe(view);
    const signature = () => JSON.stringify([view.turn(), snapshotEpoch(), wide, searchingLevel, lastPersona, expired, returnReason, breederLevel,
      leashGrowth, departure.active(), departure.finished(view), explorationGoal, [...blockedDark], [...blockedObstacles], [...jammed], [...abandonedFrontiers], [...exploredFrom], pressure]);
    let cache = explorationCache.get(view);
    if (cache === undefined) { cache = new Map(); explorationCache.set(view, cache); }
    const before = signature();
    if (cache.has(before)) return cache.get(before)!;
    const next = evaluateExplorationStep(view, wide, searchingLevel);
    cache.set(signature(), next);
    return next;
  }

  function evaluateExplorationStep(view: AgentView, wide: boolean, searchingLevel?: boolean): Loc | null {
    if (!wide && searchingLevel === undefined) {
      const inside = explorationStep(view, false, false);
      return searchKind(view, inside) === null ? inside : explorationStep(view, true, false);
    }
    const at = playerSnapshot(view).grid;
    const search = searchingLevel ?? false;
    if (!wide && !search && (expired || returnReason !== null || departure.finished(view))) return null;
    const allowed = (grid: Loc) => !blockedObstacles.has(key(grid)) && (wide || search || leashed(view, grid));
    const occupied = new Set(monsterSnapshot(view).filter((monster) => monster.visible).map((monster) => key(monster.grid)));
    const stationaryRisk = new Set<string>();
    const checked = new Set<string>();
    const dangerField = damageField(view, 2, terrain, { observedDamage, quantile: riskQuantile(lastPersona), creaturesOnly: true });
    const contactField = damageField(view, 1, terrain, { observedDamage, quantile: riskQuantile(lastPersona), creaturesOnly: true });
    for (const monster of monsterSnapshot(view)) {
      if (!monster.visible) continue;
      const fixed = neverMoves(view, monster);
      const reach = fixed ? 1 : monsterActions(monster, playerSnapshot(view), 1);
      for (let y = monster.grid.y - reach; y <= monster.grid.y + reach; y++) for (let x = monster.grid.x - reach; x <= monster.grid.x + reach; x++) {
        const grid = { x, y };
        if (key(grid) === key(at) || checked.has(key(grid))) continue;
        checked.add(key(grid));
        const danger = (fixed ? dangerField : contactField).at(grid);
        if (danger.status > 0 || danger.damage > playerSnapshot(view).hp * descentPolicy(lastPersona).risk) stationaryRisk.add(key(grid));
      }
    }
    const dark = (from: Loc, insideLeash = true) => DIRECTIONS.map((dir) => ({ x: from.x + dir.dx, y: from.y + dir.dy })).find((grid) => {
      const cell = view.cell(grid.x, grid.y);
      return cell !== null && !cell.known && !blockedDark.has(key(grid)) && (!insideLeash || allowed(grid)) && !occupied.has(key(grid)) && !gazeReach(view, grid) && !stationaryRisk.has(key(grid));
    });
    const goals = [...frontiers(view, terrain), ...obstacleFrontiers(view)].filter((grid) => allowed(grid) && !gazeReach(view, grid) && !stationaryRisk.has(key(grid)) && !abandonedFrontiers.has(key(grid)) && !exhaustedFrontier(view, grid) &&
      !occupied.has(key(grid)) && dark(grid, key(grid) === key(at)) !== undefined);
    if (pressure?.force === true && goals.length === 0) goals.push(...knownStairs(view, terrain).filter((grid) =>
      steps(at, grid) > 1 && !occupied.has(key(grid)) && !gazeReach(view, grid) && !stationaryRisk.has(key(grid))));
    if (pressure?.force === true && pressure.positions.length > 0) {
      const recent = pressure.positions;
      const distance = (grid: Loc) => Math.min(...recent.map((position) => steps(position, grid)));
      const reachable = flowFrom({ goals: [at], canEnter: (next) => isRoutable(view, terrain, next) && !occupied.has(key(next)) && !blockedObstacles.has(key(next)) && !gazeReach(view, next) && !stationaryRisk.has(key(next)) });
      const executable = goals.filter((grid) => distance(grid) > 1 && Number.isFinite(reachable.distance(grid)));
      executable.sort((a, b) => distance(b) - distance(a) || reachable.distance(a) - reachable.distance(b));
      if (executable[0] !== undefined) {
        explorationGoal = executable[0];
        goals.splice(0, goals.length, explorationGoal);
      }
    }
    if (goals.some((grid) => key(grid) === key(at))) {
      explorationGoal = at;
      return dark(at) ?? null;
    }
    /* A phase or retreat can leave the character outside the leash. The return
     * route must cross that ground to reach a frontier inside it. */
    const returning = !allowed(at);
    if (!goals.some((grid) => explorationGoal !== null && key(grid) === key(explorationGoal))) explorationGoal = null;
    /* A flood through an occupied frontier can hide a longer executable route. */
    const enter = (grid: Loc) => (isRoutable(view, terrain, grid) || diggableObstacle(view, grid)) && !occupied.has(key(grid)) && !blockedObstacles.has(key(grid)) && !gazeReach(view, grid) && !stationaryRisk.has(key(grid)) && (returning || allowed(grid));
    let field = flowFrom({ goals: explorationGoal === null ? goals : [explorationGoal], canEnter: enter });
    if (explorationGoal !== null && !Number.isFinite(field.distance(at))) {
      explorationGoal = null;
      field = flowFrom({ goals, canEnter: enter });
    }
    if (explorationGoal === null && Number.isFinite(field.distance(at))) {
      let target = at;
      for (let distance = field.distance(at); distance > 0; distance -= 1) {
        const next = stepDown(field, target, () => true);
        if (next === null) break;
        target = { x: target.x + next.dx, y: target.y + next.dy };
      }
      explorationGoal = target;
    }
    const direction = stepDown(field, at, (grid) => (isWalkable(view, terrain, grid) || diggableObstacle(view, grid) && !monsterSnapshot(view).some((monster) => monster.visible && key(monster.grid) === key(grid))) && !blockedObstacles.has(key(grid)) && !gazeReach(view, grid) && !stationaryRisk.has(key(grid)) && (returning || allowed(grid)));
    return direction === null ? null : { x: at.x + direction.dx, y: at.y + direction.dy };
  }

  function surroundings(view: AgentView, grid: Loc): string {
    return [grid, ...DIRECTIONS.map((dir) => ({ x: grid.x + dir.dx, y: grid.y + dir.dy }))].map((at) => {
      const cell = view.cell(at.x, at.y);
      return cell?.known === true ? String(cell.feat) : "?";
    }).join(",");
  }

  function exhaustedFrontier(view: AgentView, grid: Loc): boolean {
    const visit = exploredFrom.get(key(grid));
    return visit !== undefined && visit.visits >= 3 && visit.surroundings === surroundings(view, grid);
  }

  function diggableObstacle(view: AgentView, grid: Loc): boolean {
    const cell = view.cell(grid.x, grid.y);
    return cell?.known === true && (jammed.has(key(grid)) || terrain.isJammedDoor?.(cell.feat) === true ||
      (terrain.isRubble?.(cell.feat) ?? (terrain.isDiggable?.(cell.feat) === true && (cell.featCode === undefined || /RUBBLE/i.test(cell.featCode)))));
  }

  const obstacleCache = new WeakMap<object, { jammed: string; goals: Loc[] }>();

  function obstacleFrontiers(view: AgentView): Loc[] {
    const snapshot = snapshotIdentity(view);
    const jammedKey = [...jammed].join(";");
    const cached = obstacleCache.get(snapshot);
    if (cached?.jammed === jammedKey) return cached.goals;
    const bounds = view.mapBounds();
    const goals: Loc[] = [];
    for (let y = 0; y < bounds.height; y += 1) {
      for (let x = 0; x < bounds.width; x += 1) {
        if (diggableObstacle(view, { x, y })) goals.push({ x, y });
      }
    }
    obstacleCache.set(snapshot, { jammed: jammedKey, goals });
    return goals;
  }

  function explore(ctx: SquireContext, wide = widened): AgentCommand | null {
    observe(ctx.view);
    if (breederLevel && checkedRoute(ctx.view, exitTargets(ctx.view)) !== null) {
      const command = recoveryStair(ctx.view, ctx.act, exitTargets(ctx.view));
      if (command !== null) return command;
    }
    if (breederLevel && searching(ctx.view)) {
      const goals = frontiers(ctx.view, terrain);
      const breeders = monsterSnapshot(ctx.view).filter((monster) => monster.visible && monster.raceFlags.includes("MULTIPLY"));
      const away = (grid: Loc) => breeders.some((monster) => steps(monster.grid, grid) <= 1);
      const safeGoals = goals.filter((grid) => !away(grid));
      if (safeGoals.length > 0 && !safeGoals.some((grid) => key(grid) === key(playerSnapshot(ctx.view).grid))) {
        const route = travelTo(ctx, safeGoals, away);
        if (route.kind === "step") return route.command;
      }
      const at = playerSnapshot(ctx.view).grid;
      const distance = (grid: Loc) => Math.min(...breeders.map((monster) => steps(monster.grid, grid)));
      const direction = DIRECTIONS.filter((dir) => {
        const grid = { x: at.x + dir.dx, y: at.y + dir.dy };
        if (!isWalkable(ctx.view, terrain, grid) || standingOnHarm(ctx.view, terrain, grid) || distance(grid) <= distance(at)) return false;
        const damage = incomingDamage(ctx.view, grid, 1, terrain, { observedDamage, quantile: riskQuantile(lastPersona) });
        return damage.status === 0 && damage.damage <= playerSnapshot(ctx.view).hp * descentPolicy(lastPersona).risk;
      }).sort((a, b) => distance({ x: at.x + b.dx, y: at.y + b.dy }) - distance({ x: at.x + a.dx, y: at.y + a.dy }))[0];
      if (direction !== undefined) return ctx.act.move(direction.key);
    }
    const at = playerSnapshot(ctx.view).grid;
    const turn = ctx.view.turn();
    const workingObstacle = DIRECTIONS.some((dir) => {
      const grid = { x: at.x + dir.dx, y: at.y + dir.dy };
      const attempts = obstacleAttempts.get(key(grid)) ?? 0;
      return attempts > 0 && attempts < 3 && (isClosedDoor(ctx.view, terrain, grid) || diggableObstacle(ctx.view, grid));
    });
    if (!workingObstacle && (explorationAt === null || explorationAt.turn !== turn || explorationAt.grid !== key(at))) {
      /* Reaching the same frontier without learning its surroundings must not restart an endless walk. */
      const seen = surroundings(ctx.view, at);
      const visit = exploredFrom.get(key(at));
      exploredFrom.set(key(at), { surroundings: seen, visits: visit?.surroundings === seen ? visit.visits + 1 : 1 });
      explorationAt = { turn, grid: key(at) };
      if (exhaustedFrontier(ctx.view, at) && explorationGoal !== null && key(explorationGoal) !== key(at)) {
        abandonedFrontiers.add(key(explorationGoal));
        explorationGoal = null;
        exploredFrom.clear();
      }
    }
    const next = explorationStep(ctx.view, wide);
    if (next === null) return null;
    const direction = DIRECTIONS.find((dir) => at.x + dir.dx === next.x && at.y + dir.dy === next.y)!;
    if (ctx.view.cell(next.x, next.y)?.known === false) darkStep = { from: at, to: next, turn: ctx.view.turn() };
    if (isClosedDoor(ctx.view, terrain, next) || diggableObstacle(ctx.view, next)) {
      const code = diggableObstacle(ctx.view, next) ? "tunnel" : "open";
      obstacleAttempts.set(key(next), (obstacleAttempts.get(key(next)) ?? 0) + 1);
      obstacle = { grid: next, turn: ctx.view.turn(), code };
      /* Stubborn obstacles must not consume the rest of this level's budget. */
      return ctx.act[code](direction.key);
    }
    return ctx.act.move(direction.key);
  }

  function explorationReport(view: AgentView, leashLimited: boolean): void {
    observe(view);
    const bounds = view.mapBounds();
    let explored = 0;
    for (let y = 0; y < bounds.height; y += 1) for (let x = 0; x < bounds.width; x += 1) if (view.cell(x, y)?.known === true) explored += 1;
    const field = flowFrom({ goals: [playerSnapshot(view).grid], canEnter: (grid) => (isRoutable(view, terrain, grid) || diggableObstacle(view, grid)) && !blockedObstacles.has(key(grid)) && !gazeReach(view, grid) });
    const reachable = [...frontiers(view, terrain), ...obstacleFrontiers(view)].filter((grid) => Number.isFinite(field.distance(grid)));
    const distance = Math.min(...reachable.map((grid) => field.distance(grid)));
    log(`explore ended: explored cells ${String(explored)}, reachable frontiers ${String(reachable.length)}, known > ${String(knownDownStairs(view, terrain).length)}, nearest unexplored frontier ${Number.isFinite(distance) ? String(distance) : "none"}, stair leash limited ${String(leashLimited)}.`);
  }

  function blocked(view: AgentView): string | null {
    if (breederLevel) return "Squire must leave this breeder level, but it has no checked exit or safe Recall wait.";
    if (playerSnapshot(view).depth === 0 && !town.ready) return `Squire cannot leave town ready: it still needs ${town.reason}, and no bounded earning trip is safe.`;
    if (returnReason !== null) return `Squire needs town for ${returnReason}, but it has no checked return or safe Recall wait.`;
    const missing = missingPreparation(view, playerSnapshot(view).depth + 1, lastPersona)[0];
    return missing === undefined ? null : `Squire cannot descend yet: it needs ${missing.reason}.`;
  }

  /**
   * Which way a leave_level walk will go once `guarded` reroutes it to the
   * journey's exit, or null when the planner's own route stands.
   */
  function exitWay(view: AgentView): "up" | "down" | null {
    observe(view);
    if (unseenDanger?.(view) || !breederLevel && !footOffered && monsterSnapshot(view).some((monster) => monster.visible && !monster.asleep)) return null;
    const route = checkedRoute(view, exitTargets(view));
    if (route === null) return null;
    const end = route.length === 0 ? playerSnapshot(view).grid : route[route.length - 1]!;
    return terrain.isUpStair(view.cell(end.x, end.y)?.feat ?? -1) ? "up" : "down";
  }

  function canStair(view: AgentView, down: boolean): boolean {
    if (pendingStair !== null && pendingStair.depth !== playerSnapshot(view).depth || view.turn() < lastTurn) observe(view);
    return stairAllowed(view, down);
  }

  function canLeave(view: AgentView): boolean {
    if (pendingStair === null && arrivalStair === null && crossed === null) return true;
    const player = playerSnapshot(view);
    const feat = view.cell(player.grid.x, player.grid.y)?.feat ?? -1;
    if (!terrain.isUpStair(feat) && !terrain.isDownStair(feat)) return true;
    return canStair(view, terrain.isDownStair(feat));
  }

  return { setPersona(persona: Persona | null) { lastPersona = persona; }, explorationPressure(view: AgentView, persona: Persona | null, recovering = false) {
    lastPersona = persona;
    pressure = exploration.observe(view, persona, !recovering && playerSnapshot(view).hp >= playerSnapshot(view).maxHp * descentPolicy(persona).hpShare && safeDelay(view));
    return pressure;
  }, apply, guarded, explore, emergency, watchdog, stairCommand, canStair, canLeave, canExplore: (view: AgentView, wide = widened) => explorationStep(view, wide) !== null, safeDelay, checkedRoute, leashed, blocked, breederExit, exitWay, searching, searchingNow, depthMinutes, schedule, firstStair, refreshReturn, dive, preparation: missingPreparation, exitFailure: () => routeFailure };
}

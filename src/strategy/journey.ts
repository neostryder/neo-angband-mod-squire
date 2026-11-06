/** Preparation and return limits apply before judgment and again before each planned command. */

import type { AgentActions, AgentCommand, AgentView, MonsterView } from "../host-adapter.js";
import type { SquireContext } from "../context.js";
import type { Goal, Offer } from "../brain/goals.js";
import type { Plan } from "../brain/brain.js";
import { floorTarget } from "../brain/items.js";
import { canRead, hungry, unknownFlavours } from "../brain/pack.js";
import { arrivalFeeling, dangerousLevelFeeling } from "../brain/level-feel.js";
import { assessThreat, incomingDamage } from "../brain/threat-model.js";
import { pickTarget } from "../threat.js";
import { AUTOFIGHT_REACH } from "../missions/autofight.js";
import { DIRECTIONS, key, steps, type Loc } from "../grid.js";
import { travelTo } from "../travel.js";
import { flowFrom, stepDown, type FlowField } from "../flow.js";
import { besideStationaryThreat, besideParalysingGazer, frontiers, hasFloorObject, isClosedDoor, isRoutable, isWalkable, knownDownStairs, knownStairs, paralysingGazer, standingOnHarm } from "../map.js";
import type { Persona } from "../persona/persona.js";
import type { Terrain } from "../terrain.js";
import { recallItem, RECALL_FROM_DEPTH, shownName } from "../town/needs.js";
import { createDeparture, EARNING_LEASH, EARNING_TURNS } from "../town/departure.js";
import { createLevelPacing, stairLeash } from "./pacing.js";
import { descentGaps as gapsAt, missingPreparation as preparationAt, poisonRecovery, supplies, supplyMargin, tripLight, shallowDiveChecks, shallowDiveReady } from "./readiness.js";
import { stepsBand, turnsBand } from "../brain/bands.js";

const OPTIONAL: ReadonlySet<Goal> = new Set(["explore", "fetch", "pick_up", "tunnel"]);

/** Below this share of maximum hit points, a stair search falls back to the leash and a hurt character is not sent farther out. */
export const SEARCH_HP_FRACTION = 0.35;

export function createJourney(terrain: Terrain, unseenDanger?: (view: AgentView) => boolean, levelsPersist: () => boolean = () => false, now: () => number = Date.now, log: (message: string) => void = () => {}, observedDamage: ReadonlyMap<string, number> = new Map(), immediateDive = true) {
  const pacing = createLevelPacing();
  const departure = createDeparture();
  let returnReason: string | null = null;
  let returnStock: ReturnType<typeof supplies> | null = null;
  let returnDepth = -1;
  /* Set when the persona chose the trip home; the margin did not force it. */
  let chosenReturn = false;
  let previousHp: number | null = null;
  let unseenUntil = -1;
  let lastTurn = -1;
  const remembered = new Map<number, { monster: MonsterView; until: number }>();
  let town = { ready: true, earning: false, reason: "", target: null as number | null };
  let expired = false;
  let footOffered = false;
  let recallActive = false;
  let lastPersona: Persona | null = null;
  let widened = false;
  let anchor: Loc = { x: 0, y: 0 };
  let leashField: FlowField | null = null;
  let leashHasUp = false;
  let leashAt = now();
  let leashGrowth = 0;
  let dangerousFeeling = false;
  let breederLevel = false;
  let breederDepth = -1;
  let breederTurn = -1;
  let breederArrival: string | null = null;
  let exitTarget: Loc | null = null;
  let routeFailure: string | null = null;
  let depthAt: number | null = null;
  let deepest = 0;
  let clockTurn = -1;
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
  let recoveryAttempts = 0;
  let reserveSince: number | null = null;
  let reserveDecisions = 0;
  const refusedStairs = new Map<string, { turn: number; time: number }>();
  const triedFlavours = new Set<string>();
  let stairAttempt: { turn: number; depth: number; from: string; target: string } | null = null;

  function reserveExpired(view: AgentView): boolean {
    return view.player().depth > 0 && view.player().depth < 10 && reserveSince !== null &&
      (now() - reserveSince >= 60000 || reserveDecisions >= 120);
  }

  function recoveryHealthy(view: AgentView, full = false): boolean {
    const player = view.player();
    const checks = shallowDiveChecks(view, lastPersona);
    return player.depth < 10 && player.hp >= player.maxHp * (full ? 1 : 0.8) && checks.statusReady && checks.casterAttack &&
      player.maxLevel >= checks.levelFloor && player.maxHp >= checks.maxHpFloor && checks.tripLight && checks.food >= 2 && !checks.hungry &&
      !standingOnHarm(view, terrain, player.grid);
  }

  function recoverySafe(view: AgentView): boolean {
    observe(view);
    const player = view.player();
    if (standingOnHarm(view, terrain, player.grid) || unseenDanger?.(view) || view.turn() <= unseenUntil ||
      [player.status.poisoned, player.status.cut, player.status.blind, player.status.confused, player.status.afraid, player.status.stun].some((value) => value > 0)) return false;
    const damage = incomingDamage(view, player.grid, 2, terrain, { observedDamage });
    return damage.status === 0 && damage.damage < player.hp * 0.25;
  }

  /** Walking and stair reversals cannot renew the deadline without a useful gain. */
  function watchdog(view: AgentView, decision: boolean): Plan | null {
    const player = view.player();
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
    const frozen = turnDecisions >= 6 || now() - turnAt >= 10000;
    if (stage === 0 && !frozen || stage <= recoveryStage && now() - recoveryAt < 5000 && stalledDecisions - recoveryDecision < 12) return null;
    recoveryAt = now();
    recoveryDecision = stalledDecisions;
    recoveryAttempts += 1;
    recoveryStage = stage;
    if (stage === 1 && !frozen) return { label: "watchdog: re-plan", step: () => null };
    const startDepth = player.depth;
    let commands = 0;
    const started = now();
    return { label: `watchdog: recover at stage ${String(stage)}`, step(current, act) {
      if (current.player().depth !== startDepth || commands >= 24 || now() - started >= 8000) return null;
      commands += 1;
      if (!recoverySafe(current)) return null;
      if (stage >= 2 && recoveryHealthy(current, true) && recoverySafe(current) && !recallActive) {
        const command = recoveryStair(current, act, knownDownStairs(current, terrain));
        if (command !== null) return command;
      }
      const unexplored = current.player().depth > 0 && returnReason === null && !breederLevel && !dangerousFeeling && explorationStep(current, true) !== null;
      if (stage >= 1 && unexplored && safeDelay(current) && current.player().hp >= current.player().maxHp * 0.8) {
        const command = explore({ view: current, act } as SquireContext, true);
        if (command !== null) return command;
      }
      if (stage >= 3 && current.player().hp >= current.player().maxHp * 0.8 && recoverySafe(current) && !recallActive) {
        const stock = supplies(current);
        const townReady = current.player().depth === 0 && current.player().hp === current.player().maxHp && stock.food >= 1 && (stock.workingLight || stock.lastingLight);
        const stairs = knownStairs(current, terrain).filter((grid) => terrain.isUpStair(current.cell(grid.x, grid.y)?.feat ?? -1) ? !unexplored : recoveryHealthy(current, true) || townReady);
        const command = recoveryStair(current, act, stairs);
        if (command !== null) return command;
      }
      if (stage >= 4 && !unexplored && recoverySafe(current)) {
        const scroll = canRead(current) ? unknownFlavours(current, "scroll").find((item) => !triedFlavours.has(`${String(item.handle)}:${item.name}`)) : undefined;
        const potion = unknownFlavours(current, "potion").find((item) => !triedFlavours.has(`${String(item.handle)}:${item.name}`));
        const item = scroll ?? potion;
        if (item !== undefined) {
          triedFlavours.add(`${String(item.handle)}:${item.name}`);
          return scroll !== undefined ? act.read(item.handle) : act.quaff(item.handle);
        }
      }
      if (stage >= 2 && current.player().hp >= current.player().maxHp * 0.8 && current.player().hp < current.player().maxHp && safeDelay(current)) return act.rest(10);
      if (stage >= 1 && safeDelay(current) && current.player().hp >= current.player().maxHp * 0.8) {
        const command = explore({ view: current, act } as SquireContext, true);
        if (command !== null) return command;
      }
      /* A rejected goal must not keep the input wait on the same turn forever. */
      if (commands > 1) return null;
      const directions = DIRECTIONS.filter((dir) => {
        const grid = { x: current.player().grid.x + dir.dx, y: current.player().grid.y + dir.dy };
        return isWalkable(current, terrain, grid) && !standingOnHarm(current, terrain, grid) && !gazeReach(current, grid) &&
          !current.monsters().some((monster) => monster.visible && steps(monster.grid, grid) <= 1);
      });
      const direction = directions[recoveryAttempts % Math.max(1, directions.length)];
      return direction === undefined ? act.hold() : act.move(direction.key);
    } };
  }

  function recoveryStair(view: AgentView, act: AgentActions, goals: readonly Loc[]): AgentCommand | null {
    const available = goals.filter((grid) => {
      const refusal = refusedStairs.get(`${String(view.player().depth)}:${key(grid)}`);
      return refusal === undefined || now() - refusal.time >= 20000 || view.turn() - refusal.turn >= 20;
    });
    const route = checkedRoute(view, available, true);
    if (route === null) return null;
    const at = view.player().grid;
    const target = route.at(-1) ?? at;
    stairAttempt = { turn: view.turn(), depth: view.player().depth, from: key(at), target: `${String(view.player().depth)}:${key(target)}` };
    if (route.length === 0) {
      if (terrain.isUpStair(view.cell(at.x, at.y)?.feat ?? -1)) return act.ascend();
      if (view.player().depth === 0) departure.begin(view, null, lastPersona);
      return act.descend();
    }
    const next = route[0]!;
    const direction = DIRECTIONS.find((dir) => at.x + dir.dx === next.x && at.y + dir.dy === next.y);
    return direction === undefined ? null : act.move(direction.key);
  }

  function depthMinutes(view: AgentView): number {
    const player = view.player();
    if (view.turn() < clockTurn) {
      depthAt = null;
      deepest = 0;
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

  function firstStair(view: AgentView): boolean {
    return view.player().depth >= 1 && view.player().depth < 10 && knownDownStairs(view, terrain).length > 0;
  }

  function stairEscape(view: AgentView): boolean {
    const at = view.player().grid;
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
      log(`descent gate relaxed for DL${String(depth)}: ${changes.join("; ")}; ${minutes.toFixed(1)} minutes without a depth gain, ambition ${String(persona?.sliders.ambition ?? 50)}, HP ${String(view.player().hp)}/${String(view.player().maxHp)}, preparation gaps: ${gaps.map((gap) => gap.reason).join("; ") || "none"}.`);
    }
    return gaps;
  }

  function descentGaps(view: AgentView, depth: number, persona: Persona | null) {
    missingPreparation(view, depth, persona);
    return gapsAt(view, depth, persona, depthMinutes(view), firstStair(view), stairEscape(view));
  }

  function breederExit(view: AgentView): boolean {
    const player = view.player();
    const arrival = view.messages().find((message) => arrivalFeeling([message])) ?? null;
    if (breederDepth !== player.depth || view.turn() < breederTurn || arrival !== null && arrival !== breederArrival) {
      breederLevel = false;
      exitTarget = null;
    }
    breederDepth = player.depth;
    breederTurn = view.turn();
    breederArrival = arrival;
    if (player.depth > 0 && player.level <= 5 && view.monsters().filter((monster) => monster.visible && !monster.asleep && monster.raceFlags.includes("MULTIPLY")).length >= 3) breederLevel = true;
    return breederLevel;
  }

  function returnMargin(view: AgentView): string | null {
    if (shallowDiveReady(view, view.player().depth + 1, lastPersona)) return null;
    const player = view.player();
    const stock = supplies(view);
    if (player.depth >= 1 && player.depth < 10) {
      if (stock.food < 2 || hungry(view)) return "food";
      if (!stock.lastingLight && (!stock.workingLight || stock.fuel < 1)) return "light and fuel";
      if (player.depth >= 5 && stock.cures < 1) return "healing";
      if (player.depth >= 5 && stock.phase + stock.escapes < 1) return "Phase Door";
      if (stock.cures + stock.phase + stock.escapes < 1) return "healing and Phase Door";
      return null;
    }
    return supplyMargin(view, lastPersona);
  }

  function observe(view: AgentView): void {
    const player = view.player();
    const turn = view.turn();
    const stockNow = supplies(view);
    const canBuyReserve = departure.reserveAffordable(view);
    const reserveMissing = stockNow.cures + stockNow.phase + stockNow.escapes < 2 || player.depth >= 4 && (stockNow.cures < 1 || stockNow.phase + stockNow.escapes < 1);
    if (turn < lastTurn || !reserveMissing || canBuyReserve) {
      reserveSince = null;
      reserveDecisions = 0;
    } else reserveSince ??= now();
    depthMinutes(view);
    const state = pacing.observe(view, terrain);
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
    leashField = null;
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
    for (const monster of view.monsters()) {
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
    if (reserveExpired(view) && recoveryHealthy(view, true) && ["healing", "Phase Door", "healing and Phase Door", "the earning trip's limit or return route"].includes(returnReason ?? "")) {
      returnReason = null;
      chosenReturn = false;
      departure.end();
    }
    for (const monster of view.monsters()) if (monster.visible && !monster.asleep) remembered.set(monster.id, { monster, until: turn + 100 });
    const live = new Set(view.monsters().map((monster) => monster.id));
    for (const [id, entry] of remembered) if (!live.has(id) || entry.until < turn) remembered.delete(id);
    if (previousHp !== null && player.hp < previousHp && player.status.poisoned === 0 && player.status.cut === 0 && previousHp - player.hp > incomingDamage(view, player.grid, 2, terrain, { monsters: [] }).damage && !standingOnHarm(view, terrain, player.grid) && !view.monsters().some((monster) => monster.visible && !monster.asleep)) unseenUntil = turn + 100;
    previousHp = player.hp;
    lastTurn = turn;
    departure.observe(view, terrain);
    if (shallowDiveReady(view, player.depth + 1, lastPersona)) {
      departure.end();
    }
    if (player.depth > 0) {
      if (!departure.active() && !(reserveExpired(view) && recoveryHealthy(view, true))) returnReason ??= returnMargin(view);
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

  function safeDelay(view: AgentView, recoveringStatus = false): boolean {
    const player = view.player();
    if (standingOnHarm(view, terrain, player.grid)) return false;
    if (player.status.poisoned > 0 && !(recoveringStatus && poisonRecovery(view, lastPersona)) || player.status.cut > 0 || !recoveringStatus && (player.status.blind > 0 || player.status.confused > 0) || (unseenDanger?.(view) ?? view.turn() <= unseenUntil)) return false;
    if (view.monsters().some((monster) => monster.visible && (monster.raceFlags.includes("MULTIPLY") && steps(monster.grid, player.grid) <= 10 || !monster.asleep || steps(monster.grid, player.grid) <= 8))) return false;
    return ![...remembered.values()].some((entry) => entry.until >= view.turn());
  }

  /** The same permission drives offers, interruptions and each stair command. */
  function dive(view: AgentView, persona: Persona | null = lastPersona, recalling = recallActive) {
    lastPersona = persona;
    observe(view);
    const player = view.player();
    const gaps = descentGaps(view, player.depth + 1, persona);
    const stock = supplies(view);
    const expiredReserve = reserveExpired(view) && recoveryHealthy(view, true);
    const reserves = player.depth >= 10 || (stock.cures + stock.phase + stock.escapes >= 2 || player.depth < 5 && stairEscape(view) && stock.cures >= 1) && (player.depth < 5 || stock.cures >= 1 && stock.phase + stock.escapes >= 1);
    const allowed = player.depth > 0 && !player.dead && !recalling && returnReason === null && !departure.active() &&
      !breederLevel && (expiredReserve || reserves && tripLight(view) && gaps.hard.length === 0);
    const route = allowed ? checkedRoute(view, knownDownStairs(view, terrain)) : null;
    const ready = route !== null && !standingOnHarm(view, terrain, player.grid) && !(unseenDanger?.(view) ?? view.turn() <= unseenUntil) &&
      !view.monsters().some((monster) => monster.visible && !monster.asleep) && ![...remembered.values()].some((entry) => entry.until >= view.turn()) && player.hp >= player.maxHp * 0.8 &&
      [player.status.poisoned, player.status.cut, player.status.blind, player.status.confused, player.status.afraid, player.status.stun].every((value) => value === 0);
    if (!ready) diveSince = null;
    else if (diveSince === null || diveSince.depth !== player.depth || view.turn() < diveSince.turn) diveSince = { depth: player.depth, time: now(), turn: view.turn() };
    const ambition = Math.max(0, Math.min(100, persona?.sliders.ambition ?? 70));
    const delay = 15000 * (1 - ambition / 100);
    const due = ready && diveSince !== null && (now() - diveSince.time >= delay || view.turn() - diveSince.turn >= 100);
    const take = ready && player.depth < 10 && (expiredReserve || shallowDiveReady(view, player.depth + 1, persona) || immediateDive && gaps.soft.length === 0 || due);
    return { allowed, take, route, due };
  }

  function gazeReach(view: AgentView, grid: Loc): boolean {
    return besideStationaryThreat(view, grid) || besideParalysingGazer(view, grid) || !view.player().objectFlags.includes("FREE_ACT") && [...gazers.values()].some((monster) => steps(grid, monster.grid) <= 1);
  }

  function checkedRoute(view: AgentView, goals: readonly Loc[], recovering = false): Loc[] | null {
    const player = view.player();
    routeFailure = null;
    const fail = (why: string): null => { routeFailure = why; return null; };
    if (goals.some((grid) => key(grid) === key(player.grid))) return [];
    if (player.status.blind > 0 || player.status.confused > 0 || (unseenDanger?.(view) ?? view.turn() <= unseenUntil)) return fail("blindness, confusion or an unexplained hit prevents a checked walk");
    const threats = [...remembered.values()].filter((entry) => entry.until >= view.turn()).map((entry) => entry.monster);
    const enter = (grid: Loc) => isRoutable(view, terrain, grid) && !gazeReach(view, grid) && !terrain.isClosedDoor(view.cell(grid.x, grid.y)?.feat ?? -1) && !view.cell(grid.x, grid.y)?.trap && (!breederLevel || !view.monsters().some((monster) => monster.visible && key(monster.grid) === key(grid)));
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
    if (!breederLevel && view.monsters().some((monster) => monster.visible && monster.asleep && route.some((grid) => steps(grid, monster.grid) <= (monster.raceFlags.includes("MULTIPLY") ? 10 : 2)))) return fail("the route would wake a nearby creature");
    /* Urgent exits must tolerate distant creatures while each next step keeps a health reserve. */
    if (breederLevel || recovering) {
      const next = route[0]!;
      const danger = incomingDamage(view, next, 2, terrain, { monsters: threats, observedDamage });
      if (danger.status > 0 || danger.damage >= player.hp * 0.25) return fail(`creatures near the next route square threaten ${String(danger.damage)} HP or a disabling effect`);
    } else if (threats.length > 0) return fail("an awake creature remains on the return route");
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
    if (departure.cameBackEmpty(view)) return Math.max(EARNING_LEASH, stairLeash(view.player().level));
    const bold = Math.min(100, Math.max(0, lastPersona?.sliders.boldness ?? 0)) / 100;
    return EARNING_LEASH + Math.round(Math.max(0, stairLeash(view.player().level) - EARNING_LEASH) * bold);
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
    const player = view.player();
    const depth = player.depth;
    if (depth <= 0) return null;
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
    const awake = view.monsters().filter((monster) => monster.visible && !monster.asleep);
    const dangerous = awake.some((monster) => assessThreat(monster, player, awake, view, undefined, terrain).band >= 2);
    if (dangerous) return null;
    const inside = (insideStep === undefined ? explorationStep(view, false, false) : insideStep) !== null;
    if (inside) return null;
    if (!departure.active() && returnReason === null && knownDownStairs(view, terrain).length === 0 && (shallowDiveReady(view, depth + 1, lastPersona) || missingPreparation(view, depth + 1, lastPersona).length === 0) && player.hp >= player.maxHp * SEARCH_HP_FRACTION) return "onward";
    if (stayingOn(view, front)) return "stay";
    return !departure.active() && returnReason === null && !breederLevel && player.hp >= player.maxHp * 0.8 && safeDelay(view) &&
      explorationStep(view, true) !== null ? "stay" : null;
  }

  /** Early training and persistent levels need reachable ground beyond the leash before a quiet refresh pays. */
  function stayingOn(view: AgentView, front: readonly Loc[]): boolean {
    const player = view.player();
    const training = !departure.active() && player.depth <= 4 && player.hp >= player.maxHp * 0.75 &&
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
    if (view.player().depth === 0 || view.player().level >= 20 && !departure.active()) return true;
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
    const base = departure.active() ? earningLeash(view) : leashHasUp ? stairLeash(view.player().level) : 3;
    const player = view.player();
    const growing = !departure.active() && player.hp >= player.maxHp * 0.8 && safeDelay(view) &&
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
    const player = view.player();
    return returningRefresh(view) && player.hp === player.maxHp &&
      [player.status.poisoned, player.status.cut, player.status.blind, player.status.confused, player.status.afraid, player.status.stun].every((value) => value === 0) &&
      terrain.isDownStair(view.cell(player.grid.x, player.grid.y)?.feat ?? -1);
  }

  function exitTargets(view: AgentView): Loc[] {
    if (returningRefresh(view)) return knownDownStairs(view, terrain);
    if (breederLevel && exitTarget !== null) return [exitTarget];
    /* A level marked by breeders takes up or down, whichever is known, since either leaves them behind. Only a character ready for the next depth may descend here. */
    if (breederLevel && returnReason === null && missingPreparation(view, view.player().depth + 1, lastPersona).length === 0) {
      const stairs = knownStairs(view, terrain);
      const route = checkedRoute(view, stairs);
      if (route !== null) exitTarget = route.at(-1) ?? view.player().grid;
      return exitTarget === null ? stairs : [exitTarget];
    }
    if (returnReason !== null || missingPreparation(view, view.player().depth + 1, lastPersona).length > 0) {
      const stairs = upStairs(view);
      if (breederLevel) {
        const route = checkedRoute(view, stairs);
        if (route !== null) exitTarget = route.at(-1) ?? view.player().grid;
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
    const player = view.player();
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
    const target = pickTarget(view.monsters(), player.grid, { wakeSleepers: true, reach: AUTOFIGHT_REACH });
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
        const player = view.player();
        if (player.hp < player.maxHp * SEARCH_HP_FRACTION && !leashed(view, player.grid)) return false;
        return true;
      }
      if (offer.goal === "leave_level" && returningRefresh(view) && !view.monsters().some((monster) => monster.visible && !monster.asleep)) return false;
      if (offer.goal === "leave_level" && unfinished && player.hp >= player.maxHp * 0.8 && safeDelay(view)) return false;
      if (offer.goal === "leave_level" && !home && !breederLevel && !view.monsters().some((monster) => monster.visible && !monster.asleep) &&
        (quietRefreshes.get(player.depth) ?? 0) >= 3) return false;
      if (breederLevel && offer.goal === "leave_level") return checkedRoute(view, exitTargets(view)) !== null;
      if (breederLevel && !(offer.goal === "explore" && search()) && (OPTIONAL.has(offer.goal) || offer.goal === "rest" || offer.goal === "descend")) return false;
      if (breederLevel && ["fight", "shoot", "throw_oil", "cast_attack", "aim_wand"].includes(offer.goal) && (target === null || steps(target.grid, player.grid) > 1)) return false;
      if (offer.goal === "wait" && recalling && !safeDelay(view, player.status.poisoned > 0)) return false;
      if (offer.goal === "rest" && recalling && !safeDelay(view)) return false;
      if (offer.goal === "recall_town" && !safeDelay(view) && !offer.criteria.includes("cannot stop the next blow")) return false;
      if (offer.goal === "recall_dungeon") return !recalling && town.ready && tripLight(view) && missingPreparation(view, player.maxDepth, lastPersona).length === 0;
      if (offer.goal === "descend" && player.depth === 0 && player.status.poisoned > 0) return false;
      if (offer.goal === "descend") return !recalling && (tripLight(view) || player.depth === 0 && town.earning) && (player.depth === 0 ? town.ready || town.earning || widen : diving.allowed);
      /* The tactical planner prices a route through unseen danger; this return check cannot replace it. */
      if (offer.goal === "leave_level" && !unseenDanger?.(view) && !view.monsters().some((monster) => monster.visible && !monster.asleep)) return checkedRoute(view, exitTargets(view)) !== null && searchFor() !== "stay";
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
      if ((home || (quietRefreshes.get(player.depth) ?? 0) < 3) && checkedRoute(view, exitTargets(view)) !== null) {
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
    if (!footOffered && !view.monsters().some((monster) => monster.visible && !monster.asleep)) {
      const missing = missingPreparation(view, player.depth + 1, lastPersona)[0];
      if (missing !== undefined) out = out.map((offer) => offer.goal === "leave_level" ? { ...offer, criteria: `Take a checked up staircase to a safer level. The next depth needs ${missing.reason}.${offer.criteria.includes("the game says") ? ` ${offer.criteria}` : ""}` } : offer);
    }
    return out;
  }

  function guarded(goal: Goal | null, plan: Plan, initialView?: AgentView): Plan {
    const foot = goal === "leave_level" && footOffered;
    const recalling = recallActive;
    const wide = widened;
    let latest: AgentView | null = initialView ?? null;
    let leashLimited = false;
    const startingDepth = initialView?.player().depth;
    return { ...plan, end(view) {
      latest = view ?? latest;
      plan.end?.(view);
      if (goal === "explore" && latest !== null) explorationReport(latest, leashLimited);
    }, step(view, act) {
      latest = view;
      if (goal === "explore" && !wide && !searchingNow(view)) {
        leashLimited ||= frontiers(view, terrain).some((grid) => !leashed(view, grid));
      }
      observe(view);
      const player = view.player();
      if (goal === "descend" && refreshReturn(view)) return act.descend();
      if (wide && goal === "explore" || goal === "explore" && searching(view)) return plan.step(view, act);
      if (breederLevel && (goal === "rest" || goal === "descend" || goal !== null && OPTIONAL.has(goal))) return null;
      if (breederLevel && goal !== null && ["fight", "shoot", "throw_oil", "cast_attack", "aim_wand"].includes(goal)) {
        const target = pickTarget(view.monsters(), player.grid, { wakeSleepers: true, reach: AUTOFIGHT_REACH });
        if (target === null || steps(target.grid, player.grid) > 1) return null;
      }
      if (goal === "wait" && !safeDelay(view, !recalling || player.status.poisoned > 0)) return null;
      if (goal === "rest" && recalling && !safeDelay(view)) return null;
      if (goal === "recall_dungeon" && (!town.ready || !tripLight(view) || missingPreparation(view, player.maxDepth, lastPersona).length > 0)) return null;
      if (goal === "recall_town" && !safeDelay(view) && player.hp >= player.maxHp * 0.35 && !view.monsters().some((monster) => monster.visible && monster.raceFlags.includes("UNIQUE") && monster.speed > player.speed && player.level <= 3)) return null;
      if (goal === "descend") {
        if (startingDepth !== undefined && player.depth !== startingDepth) return null;
        if (player.depth > 0) {
          const diving = dive(view, lastPersona, recalling);
          if (!diving.allowed) return null;
        } else if (returnReason !== null || player.status.poisoned > 0 || !(tripLight(view) || town.earning) || !town.ready && !town.earning && !wide) return null;
        if (player.depth === 0 && (town.earning || wide && !town.ready) && !departure.active()) departure.begin(view, town.target, lastPersona);
      }
      if (goal === null) {
        /* A rejected judgment cannot let the errand ladder bypass the guards. */
        const command = plan.step(view, act);
        if (command === null) return null;
        if (command.code === "descend") return !breederLevel && !expired && returnReason === null && tripLight(view) && (player.depth === 0 ? town.ready : missingPreparation(view, player.depth + 1, lastPersona).length === 0) ? command : null;
        if (command.code === "walk") {
          const direction = DIRECTIONS.find((entry) => entry.key === command.dir);
          const at = direction === undefined ? null : { x: player.grid.x + direction.dx, y: player.grid.y + direction.dy };
          return at !== null && !breederLevel && !expired && returnReason === null && leashed(view, at) && !view.monsters().some((monster) => monster.visible && !monster.asleep && steps(monster.grid, at) <= 1) ? command : null;
        }
        return command.code === "pickup" && !breederLevel && leashed(view, player.grid) && !expired && returnReason === null ? command : null;
      }
      if (OPTIONAL.has(goal) && (expired || returnReason !== null || departure.finished(view))) return null;
      if (goal === "fetch") {
        const loot = floorTarget(view, terrain, false, lastPersona);
        if (loot === null ? !hasFloorObject(view, player.grid) || !leashed(view, player.grid) : !leashed(view, loot.at)) return null;
        /* Engine runs can cross the leash before the next planner observation. */
        const single: AgentView = { ...view };
        delete single.travelPath;
        const command = plan.step(single, act);
        if (command?.code === "walk" || command?.code === "open") {
          const dir = DIRECTIONS.find((entry) => entry.key === command.dir);
          if (dir === undefined || !leashed(view, { x: player.grid.x + dir.dx, y: player.grid.y + dir.dy })) return null;
        }
        return command;
      }
      if (goal === "leave_level" && !unseenDanger?.(view) && (breederLevel || foot || !view.monsters().some((monster) => monster.visible && !monster.asleep))) {
        if (returnReason === null && !breederLevel && !dangerousFeeling && player.hp >= player.maxHp * 0.8 && safeDelay(view) && explorationStep(view, true) !== null) return null;
        const goals = exitTargets(view);
        const route = checkedRoute(view, goals);
        if (route === null) return null;
        const at = player.grid;
        const cell = view.cell(at.x, at.y);
        if (route.length === 0) {
          if (cell !== null && terrain.isUpStair(cell.feat)) {
            if (returnReason === null && !breederLevel && !view.monsters().some((monster) => monster.visible && !monster.asleep)) {
              if ((quietRefreshes.get(player.depth) ?? 0) >= 3) return null;
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
  }

  function explorationStep(view: AgentView, wide: boolean, searchingLevel?: boolean): Loc | null {
    if (searchingLevel === undefined) observe(view);
    if (!wide && searchingLevel === undefined) {
      const inside = explorationStep(view, false, false);
      return searchKind(view, inside) === null ? inside : explorationStep(view, true, false);
    }
    const at = view.player().grid;
    const search = searchingLevel ?? false;
    if (!wide && !search && (expired || returnReason !== null || departure.finished(view))) return null;
    const allowed = (grid: Loc) => !blockedObstacles.has(key(grid)) && (wide || search || leashed(view, grid));
    const dark = (from: Loc, insideLeash = true) => DIRECTIONS.map((dir) => ({ x: from.x + dir.dx, y: from.y + dir.dy })).find((grid) => {
      const cell = view.cell(grid.x, grid.y);
      return cell !== null && !cell.known && !blockedDark.has(key(grid)) && (!insideLeash || allowed(grid)) && !gazeReach(view, grid);
    });
    const goals = [...frontiers(view, terrain), ...obstacleFrontiers(view)].filter((grid) => allowed(grid) && !gazeReach(view, grid) && !abandonedFrontiers.has(key(grid)) && !exhaustedFrontier(view, grid) &&
      dark(grid, key(grid) === key(at)) !== undefined);
    if (goals.some((grid) => key(grid) === key(at))) {
      explorationGoal = at;
      return dark(at) ?? null;
    }
    /* A phase or retreat can leave the character outside the leash. The return
     * route must cross that ground to reach a frontier inside it. */
    const returning = !allowed(at);
    if (!goals.some((grid) => explorationGoal !== null && key(grid) === key(explorationGoal))) explorationGoal = null;
    const enter = (grid: Loc) => (isRoutable(view, terrain, grid) || diggableObstacle(view, grid)) && !blockedObstacles.has(key(grid)) && !gazeReach(view, grid) && (returning || allowed(grid));
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
    const direction = stepDown(field, at, (grid) => (isWalkable(view, terrain, grid) || diggableObstacle(view, grid) && !view.monsters().some((monster) => monster.visible && key(monster.grid) === key(grid))) && !blockedObstacles.has(key(grid)) && !gazeReach(view, grid) && (returning || allowed(grid)));
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

  function obstacleFrontiers(view: AgentView): Loc[] {
    const bounds = view.mapBounds();
    const goals: Loc[] = [];
    for (let y = 0; y < bounds.height; y += 1) {
      for (let x = 0; x < bounds.width; x += 1) {
        if (diggableObstacle(view, { x, y })) goals.push({ x, y });
      }
    }
    return goals;
  }

  function explore(ctx: SquireContext, wide = widened): AgentCommand | null {
    observe(ctx.view);
    if (breederLevel && checkedRoute(ctx.view, exitTargets(ctx.view)) !== null) {
      const plan = guarded("leave_level", { label: "leave", step: () => null });
      return plan.step(ctx.view, ctx.act);
    }
    if (breederLevel && searching(ctx.view)) {
      const goals = frontiers(ctx.view, terrain);
      const breeders = ctx.view.monsters().filter((monster) => monster.visible && monster.raceFlags.includes("MULTIPLY"));
      const away = (grid: Loc) => breeders.some((monster) => steps(monster.grid, grid) <= 1);
      const safeGoals = goals.filter((grid) => !away(grid));
      if (safeGoals.length > 0 && !safeGoals.some((grid) => key(grid) === key(ctx.view.player().grid))) {
        const route = travelTo(ctx, safeGoals, away);
        if (route.kind === "step") return route.command;
      }
    }
    const at = ctx.view.player().grid;
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
    const field = flowFrom({ goals: [view.player().grid], canEnter: (grid) => (isRoutable(view, terrain, grid) || diggableObstacle(view, grid)) && !blockedObstacles.has(key(grid)) && !gazeReach(view, grid) });
    const reachable = [...frontiers(view, terrain), ...obstacleFrontiers(view)].filter((grid) => Number.isFinite(field.distance(grid)));
    const distance = Math.min(...reachable.map((grid) => field.distance(grid)));
    log(`explore ended: explored cells ${String(explored)}, reachable frontiers ${String(reachable.length)}, known > ${String(knownDownStairs(view, terrain).length)}, nearest unexplored frontier ${Number.isFinite(distance) ? String(distance) : "none"}, stair leash limited ${String(leashLimited)}.`);
  }

  function blocked(view: AgentView): string | null {
    if (breederLevel) return "Squire must leave this breeder level, but it has no checked exit or safe Recall wait.";
    if (view.player().depth === 0 && !town.ready) return `Squire cannot leave town ready: it still needs ${town.reason}, and no bounded earning trip is safe.`;
    if (returnReason !== null) return `Squire needs town for ${returnReason}, but it has no checked return or safe Recall wait.`;
    const missing = missingPreparation(view, view.player().depth + 1, lastPersona)[0];
    return missing === undefined ? null : `Squire cannot descend yet: it needs ${missing.reason}.`;
  }

  /**
   * Which way a leave_level walk will go once `guarded` reroutes it to the
   * journey's exit, or null when the planner's own route stands.
   */
  function exitWay(view: AgentView): "up" | "down" | null {
    observe(view);
    if (unseenDanger?.(view) || !breederLevel && !footOffered && view.monsters().some((monster) => monster.visible && !monster.asleep)) return null;
    const route = checkedRoute(view, exitTargets(view));
    if (route === null) return null;
    const end = route.length === 0 ? view.player().grid : route[route.length - 1]!;
    return terrain.isUpStair(view.cell(end.x, end.y)?.feat ?? -1) ? "up" : "down";
  }

  return { apply, guarded, explore, watchdog, canExplore: (view: AgentView, wide = widened) => explorationStep(view, wide) !== null, safeDelay, checkedRoute, leashed, blocked, breederExit, exitWay, searching, searchingNow, depthMinutes, firstStair, refreshReturn, dive, preparation: missingPreparation, exitFailure: () => routeFailure };
}

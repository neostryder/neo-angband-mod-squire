import type { AgentView, ItemView } from "../host-adapter.js";
import type { Persona } from "../persona/persona.js";
import { applySafetyFloor, riskCeiling } from "../persona/blend.js";
import type { Goal, Offer } from "./goals.js";
import { CYCLE_MAX_GRIDS, FAILED_TURNS, REGION_SIZE, REGION_WINDOW, REPEAT_RUN } from "./loops.js";
import { classOf } from "./tactics.js";

/** Two revisit windows keep even the least bold persona's short cycles in memory. */
export const DECISION_MEMORY_SIZE = REGION_WINDOW * 2;

/** Boldness sets the warning at three to seven repetitions and the backstop at twice that count; Ambition holds a futile choice out for 200 to 1,000 game turns. */
export function stuckThresholds(persona: Persona | null) {
  const boldness = persona?.sliders.boldness ?? 50;
  const ambition = persona?.sliders.ambition ?? 50;
  const repeat = REPEAT_RUN + Math.ceil((100 - boldness) / 25);
  return { repeat, futile: repeat * 2, cooldown: Math.round(FAILED_TURNS * (0.2 + ambition / 125)) };
}

export interface DecisionProgress {
  readonly depth: number;
  readonly experience: number;
  readonly cells: number;
  readonly gold: number;
  readonly items: number;
  readonly kills: number;
  readonly recovery: number;
  readonly damage: number;
}

export interface RememberedDecision {
  readonly goal: Goal;
  readonly depth: number;
  readonly turn: number;
  readonly region: string;
  readonly hpBefore: number;
  readonly hpAfter: number;
  readonly progress: DecisionProgress;
}

export interface StuckSignal {
  readonly cycle: readonly Goal[];
  readonly repetitions: number;
  readonly decisions: number;
}

export interface StuckFacts {
  readonly repeated: readonly StuckSignal[];
  readonly decisionsSinceProgress: number;
  readonly turnsSinceProgress: number;
  readonly untried: readonly Goal[];
  readonly cooling: readonly { readonly goal: Goal; readonly until: number }[];
}

function emptyProgress(): DecisionProgress {
  return { depth: 0, experience: 0, cells: 0, gold: 0, items: 0, kills: 0, recovery: 0, damage: 0 };
}

function madeProgress(progress: DecisionProgress): boolean {
  return Object.values(progress).some((value) => value > 0);
}

function snapshot(view: AgentView) {
  const player = view.player();
  const bounds = view.mapBounds();
  let cells = 0;
  for (let y = 0; y < bounds.height; y++) for (let x = 0; x < bounds.width; x++) if (view.cell(x, y)?.known === true) cells += 1;
  const items = [...view.inventory(), ...(view.quiver?.() ?? []), ...view.equipment().filter((item): item is ItemView => item !== null)];
  return {
    turn: view.turn(), depth: player.depth, deepest: Math.max(player.depth, player.maxDepth), exp: player.exp, gold: player.gold, hp: player.hp, sp: player.sp, cells,
    items: new Map(items.map((item) => [item.handle, item.number])),
    foes: new Map(view.monsters().filter((monster) => monster.visible).map((monster) => [monster.id, monster.hp])),
  };
}

export function createDecisionMemory() {
  let entries: RememberedDecision[] = [];
  let pending: RememberedDecision | null = null;
  let previous: ReturnType<typeof snapshot> | null = null;
  let deepest = 0;
  const known = new Map<number, number>();
  let progressTurn = 0;
  let idleDecisions = 0;
  const cooling = new Map<Goal, { until: number; evidence: number }>();

  function reset(): void {
    entries = [];
    pending = null;
    previous = null;
    deepest = 0;
    known.clear();
    progressTurn = 0;
    idleDecisions = 0;
    cooling.clear();
  }

  function observe(view: AgentView): void {
    const now = snapshot(view);
    if (previous !== null && now.turn < previous.turn) reset();
    if (previous === null) progressTurn = now.turn;
    const progress: DecisionProgress = previous === null ? emptyProgress() : {
      depth: Math.max(0, now.deepest - deepest),
      experience: Math.max(0, now.exp - previous.exp),
      cells: Math.max(0, now.cells - (known.get(now.depth) ?? now.cells)),
      gold: Math.max(0, now.gold - previous.gold),
      items: [...now.items].reduce((sum, [handle, count]) => sum + Math.max(0, count - (previous!.items.get(handle) ?? 0)), 0),
      kills: 0,
      recovery: Math.max(0, now.hp - previous.hp) + Math.max(0, now.sp - previous.sp),
      damage: now.depth !== previous.depth ? 0 : [...now.foes].reduce((sum, [id, hp]) => sum + Math.max(0, (previous!.foes.get(id) ?? hp) - hp), 0),
    };
    deepest = Math.max(deepest, now.deepest);
    known.set(now.depth, Math.max(known.get(now.depth) ?? 0, now.cells));
    previous = now;
    if (pending !== null) {
      const accumulated = { ...pending.progress };
      for (const key of Object.keys(progress) as (keyof DecisionProgress)[]) accumulated[key] += progress[key];
      pending = { ...pending, hpAfter: now.hp, progress: accumulated };
    }
    if (madeProgress(progress)) {
      progressTurn = now.turn;
      idleDecisions = 0;
      cooling.clear();
    }
  }

  function finish(view: AgentView): void {
    observe(view);
    if (pending === null) return;
    entries = [...entries, pending].slice(-DECISION_MEMORY_SIZE);
    idleDecisions = madeProgress(pending.progress) ? 0 : idleDecisions + 1;
    pending = null;
  }

  function signals(persona: Persona | null): StuckSignal[] {
    const tail = entries.slice(-idleDecisions);
    if (idleDecisions === 0) return [];
    const found: StuckSignal[] = [];
    for (let size = 1; size <= CYCLE_MAX_GRIDS; size++) {
      const cycle = tail.slice(-size).map((entry) => entry.goal);
      if (cycle.length !== size || size > 1 && new Set(cycle).size === 1) continue;
      let count = 0;
      while ((count + 1) * size <= tail.length && cycle.every((goal, index) => tail[tail.length - (count + 1) * size + index]!.goal === goal)) count += 1;
      if (count >= stuckThresholds(persona).repeat) found.push({ cycle, repetitions: count, decisions: count * size });
    }
    return found;
  }

  return {
    observe,
    finish,
    reset,
    begin(goal: Goal, view: AgentView): void {
      finish(view);
      const player = view.player();
      pending = { goal, depth: player.depth, turn: view.turn(), region: `${String(Math.floor(player.grid.x / REGION_SIZE))},${String(Math.floor(player.grid.y / REGION_SIZE))}`, hpBefore: player.hp, hpAfter: player.hp, progress: emptyProgress() };
    },
    kill(view: AgentView): void {
      observe(view);
      if (pending !== null) pending = { ...pending, progress: { ...pending.progress, kills: pending.progress.kills + 1 } };
      progressTurn = view.turn();
      idleDecisions = 0;
      cooling.clear();
    },
    record(): readonly RememberedDecision[] {
      return entries.map((entry) => ({ ...entry, progress: { ...entry.progress } }));
    },
    facts(view: AgentView, persona: Persona | null, candidates: readonly Goal[] = []): StuckFacts {
      observe(view);
      return {
        repeated: signals(persona), decisionsSinceProgress: idleDecisions, turnsSinceProgress: Math.max(0, view.turn() - progressTurn),
        untried: candidates.filter((goal) => idleDecisions === 0 || !entries.slice(-idleDecisions).some((entry) => entry.goal === goal)),
        cooling: [...cooling].filter(([, hold]) => hold.until > view.turn()).map(([goal, hold]) => ({ goal, until: hold.until })),
      };
    },
    withhold(offers: readonly Offer[], view: AgentView, persona: Persona | null): Offer[] {
      finish(view);
      const thresholds = stuckThresholds(persona);
      for (const signal of signals(persona)) {
        if (signal.repetitions < thresholds.futile) continue;
        for (const goal of signal.cycle) {
          const hold = cooling.get(goal);
          const evidence = entries.at(-1)?.turn ?? view.turn();
          if (hold === undefined || hold.until <= view.turn() && hold.evidence !== evidence) cooling.set(goal, { until: view.turn() + thresholds.cooldown, evidence });
        }
      }
      /* Escapes and routine upkeep keep their existing reflex rules, and cooling cannot displace every choice the safety floor kept. */
      const kept = offers.filter((offer) => classOf(offer.goal) === "escape" || offer.routine === true || (cooling.get(offer.goal)?.until ?? 0) <= view.turn());
      const floor = persona === null ? null : applySafetyFloor(Object.fromEntries(offers.map((offer) => [offer.goal, 1])), Object.fromEntries(offers.map((offer) => [offer.goal, offer.risk])), riskCeiling(persona), persona.quirks.deathwish.on);
      return kept.length === 0 || floor !== null && !kept.some((offer) => floor.dist[offer.goal] !== undefined) ? [...offers] : kept;
    },
  };
}

export type DecisionMemory = ReturnType<typeof createDecisionMemory>;

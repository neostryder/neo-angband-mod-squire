/**
 * Spots Squire going round in circles: the same choice in the same state over
 * and over, walking back and forth between a few squares or two levels, and
 * buying back what it sold or swapping the same gear in and out. Three more
 * kinds look at progress rather than position: coming back to a part of the
 * level where nothing new has turned up, trying a command sequence the game
 * keeps refusing, and stepping around a few squares without getting any closer
 * to what the character is after.
 *
 * It records only what the character sees: its own grid, hit points and mana,
 * the creatures in sight, the ground it remembers, and the names items are
 * shown under.
 */

import type { AgentCommand, AgentView } from "@rpgm-tools/neo-angband-core";
import { shownName } from "../town/needs.js";
import type { Goal } from "./goals.js";

export type LoopKind = "repeat" | "cycle" | "level_flip" | "equip_flip" | "store_flip" | "region_revisit" | "failed_sequence" | "twitch";

export interface LoopFinding {
  readonly kind: LoopKind;
  /** The goal that kept failing, which the re-plan is told about. */
  readonly tactic: Goal | null;
  readonly detail: string;
  /** Why that goal failed, in a few words, for the line the re-plan reads. */
  readonly why: string;
}

interface Entry {
  readonly goal: Goal;
  readonly turn: number;
  readonly depth: number;
  readonly grid: string;
  readonly state: string;
  /** The block of the level the character stood in. */
  readonly region: string;
  /** Ground remembered, the pack, the gold and the creatures seen on this level: unchanged means nothing new. */
  readonly novelty: string;
  /** Steps to what the near-term goal walks to, or null when it walks nowhere. */
  readonly distance: number | null;
  /** The health bars of the awake creatures in sight, added up. */
  readonly foes: number;
}

/** One plan whose commands the game refused or that changed nothing. */
interface Failure {
  readonly goal: Goal;
  readonly sequence: string;
  readonly turn: number;
  readonly why: string;
}

/** Decisions in a row with the same state and choice that count as a loop. */
export const REPEAT_RUN = 3;
/** Decisions looked back over for a walk back and forth. */
const CYCLE_WINDOW = 8;
const CYCLE_MAX_GRIDS = 3;
const CYCLE_MIN_MOVES = 5;
/** Decisions looked back over for going up and down between two levels. */
const FLIP_WINDOW = 6;
const FLIP_MIN_CHANGES = 4;
/** How long apart, in game turns, wearing the same thing again still counts as swapping back. */
export const EQUIP_FLIP_TURNS = 1000;
/** Holding still is not a loop: waiting and resting change the state through time alone. */
const STILL_GOALS: ReadonlySet<string> = new Set(["wait", "rest", "endure"]);
/** The side of the square blocks a level is cut into for revisits. */
export const REGION_SIZE = 10;
/** Separate visits to one block, with nothing new in between, that count as a loop. */
export const REGION_VISITS = 3;
/** Decisions kept for the revisit check. */
const REGION_WINDOW = 24;
/** The same refused sequence this many times inside the window is a loop. */
export const FAILED_RUN = 3;
/** Game turns a refused sequence is remembered for. */
export const FAILED_TURNS = 1000;
/** Decisions looked back over for twitching, and the squares and moves that make it. */
export const TWITCH_WINDOW = 6;
const TWITCH_MAX_GRIDS = 4;
const TWITCH_MIN_MOVES = 3;

/** The name an item is shown under, without count, article or inscription, so a stack and a single match. */
export function normalName(name: string): string {
  return name.toLowerCase()
    .replace(/\{[^}]*\}/g, "")
    .replace(/^(?:a|an|the|\d+)\s+/, "")
    .replace(/\b(\w+?)(?:es|s)\b(?=\s+of\b)/, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function itemName(view: AgentView, handle: unknown): string | null {
  if (typeof handle !== "number") return null;
  const item = view.inventory().find((entry) => entry.handle === handle);
  const name = item === undefined ? null : shownName(item);
  return name === null ? null : normalName(name);
}

function stockName(view: AgentView, index: unknown): string | null {
  if (typeof index !== "number" || typeof view.stores !== "function") return null;
  const grid = view.player().grid;
  const feat = view.cell(grid.x, grid.y)?.feat;
  const store = view.stores().find((entry) => entry.feat === feat);
  const item = store?.stock.find((entry) => entry.index === index) ?? store?.stock[index];
  const name = item === undefined ? null : shownName(item);
  return name === null ? null : normalName(name);
}

/** A creature's health as the game's health bar shows it, in tenths, rather than its exact hit points. */
function healthBar(hp: number, maxHp: number): number {
  return maxHp > 0 ? Math.ceil((10 * Math.max(0, hp)) / maxHp) : 0;
}

function stateKey(view: AgentView): string {
  const p = view.player();
  const awake = view.monsters().filter((m) => m.visible && !m.asleep).map((m) => [m.id, m.grid.x, m.grid.y, healthBar(m.hp, m.maxHp)]).sort((a, b) => a[0]! - b[0]!);
  return JSON.stringify([p.depth, p.grid.x, p.grid.y, p.hp, p.sp, awake]);
}

/** How many grids the character remembers. Seeing more of the level raises it. */
function knownGrids(view: AgentView): number {
  const bounds = view.mapBounds();
  let known = 0;
  for (let y = 0; y < bounds.height; y++) for (let x = 0; x < bounds.width; x++) if (view.cell(x, y)?.known === true) known += 1;
  return known;
}

/** The pack by shown name and count, so a pickup or a use changes it. */
function packKey(view: AgentView): string {
  return view.inventory().map((item) => `${shownName(item) ?? "?"}x${String(item.number)}`).join("|");
}

export function createLoopGuard() {
  let entries: Entry[] = [];
  let worn: { name: string; turn: number }[] = [];
  let sold = new Set<string>();
  let bought = new Set<string>();
  let townVisit = false;
  let flip: LoopFinding | null = null;
  let failures: Failure[] = [];
  /* Creatures seen on the current level, so one coming into view for the first time is something new. */
  let seenDepth: number | null = null;
  const seen = new Set<number>();

  /** The goal chosen most often where the character stands now, else on this level, else at all. */
  function tacticOf(view: AgentView): Goal | null {
    const p = view.player();
    const here = `${String(p.grid.x)},${String(p.grid.y)}`;
    const pools = [entries.filter((e) => e.depth === p.depth && e.grid === here), entries.filter((e) => e.depth === p.depth), entries];
    for (const pool of pools) {
      const counts = new Map<Goal, number>();
      for (const e of pool) if (!STILL_GOALS.has(e.goal)) counts.set(e.goal, (counts.get(e.goal) ?? 0) + 1);
      const top = [...counts].sort((a, b) => b[1] - a[1])[0];
      if (top !== undefined) return top[0];
    }
    return null;
  }

  /** The same refused sequence often enough inside the window, or null. */
  function failedSequence(turn: number): LoopFinding | null {
    const recent = failures.filter((f) => turn - f.turn >= 0 && turn - f.turn <= FAILED_TURNS);
    const counts = new Map<string, Failure[]>();
    for (const f of recent) counts.set(`${f.goal}|${f.sequence}`, [...(counts.get(`${f.goal}|${f.sequence}`) ?? []), f]);
    for (const runs of counts.values()) {
      if (runs.length < FAILED_RUN) continue;
      const last = runs[runs.length - 1]!;
      return { kind: "failed_sequence", tactic: last.goal, detail: `tried ${last.sequence} for ${last.goal} ${String(runs.length)} times and it failed each time`, why: last.why };
    }
    return null;
  }

  /** Stepping around a few squares with no progress toward the near-term goal, or null. */
  function twitching(view: AgentView): LoopFinding | null {
    const depth = view.player().depth;
    const recent = entries.slice(-TWITCH_WINDOW);
    if (recent.length < TWITCH_WINDOW || !recent.every((e) => e.depth === depth)) return null;
    const grids = new Set(recent.map((e) => e.grid));
    let moves = 0;
    let revisits = 0;
    for (let i = 1; i < recent.length; i++) {
      if (recent[i]!.grid === recent[i - 1]!.grid) continue;
      moves += 1;
      if (recent.slice(0, i - 1).some((e) => e.grid === recent[i]!.grid)) revisits += 1;
    }
    if (grids.size < 2 || grids.size > TWITCH_MAX_GRIDS || moves < TWITCH_MIN_MOVES || revisits === 0) return null;
    const first = recent[0]!;
    const last = recent[recent.length - 1]!;
    /* Progress is anything new seen or carried, a creature hurt, or a step closer to where the near-term goal leads. */
    const closer = first.distance !== null && last.distance !== null && last.distance < first.distance;
    if (last.novelty !== first.novelty || last.foes < first.foes || closer) return null;
    const goal = first.distance === null ? "anything new" : "where the near-term goal leads";
    return { kind: "twitch", tactic: tacticOf(view), detail: `stepped around ${String(grids.size)} squares over the last ${String(TWITCH_WINDOW)} decisions without getting closer to ${goal}`, why: "its moves made no progress toward the near-term goal" };
  }

  /** The same block of the level come back to again and again with nothing new, or null. */
  function revisiting(view: AgentView): LoopFinding | null {
    const last = entries[entries.length - 1];
    if (last === undefined || last.depth !== view.player().depth) return null;
    /* Only the stretch in which nothing new turned up counts. */
    let start = entries.length - 1;
    while (start > 0 && entries[start - 1]!.depth === last.depth && entries[start - 1]!.novelty === last.novelty) start -= 1;
    const stretch = entries.slice(start);
    let visits = 0;
    for (let i = 0; i < stretch.length; i++) if (stretch[i]!.region === last.region && (i === 0 || stretch[i - 1]!.region !== last.region)) visits += 1;
    if (visits < REGION_VISITS || new Set(stretch.map((e) => e.region)).size < 2) return null;
    return { kind: "region_revisit", tactic: tacticOf(view), detail: `came back to the same part of the level ${String(visits)} times without seeing or picking up anything new`, why: "nothing new was seen or picked up there" };
  }

  return {
    /** Records a decision, with the steps to where the near-term goal leads when it leads somewhere. */
    chose(goal: Goal, view: AgentView, distance: number | null = null): void {
      const p = view.player();
      if (p.depth !== 0) {
        townVisit = false;
        sold = new Set();
        bought = new Set();
      }
      if (seenDepth !== p.depth) {
        seenDepth = p.depth;
        seen.clear();
      }
      for (const m of view.monsters()) if (m.visible) seen.add(m.id);
      const awake = view.monsters().filter((m) => m.visible && !m.asleep);
      entries.push({
        goal,
        turn: view.turn(),
        depth: p.depth,
        grid: `${String(p.grid.x)},${String(p.grid.y)}`,
        state: stateKey(view),
        region: `${String(Math.floor(p.grid.x / REGION_SIZE))},${String(Math.floor(p.grid.y / REGION_SIZE))}`,
        novelty: JSON.stringify([knownGrids(view), packKey(view), p.gold, seen.size]),
        distance: distance !== null && Number.isFinite(distance) ? distance : null,
        foes: awake.reduce((sum, m) => sum + healthBar(m.hp, m.maxHp), 0),
      });
      if (entries.length > REGION_WINDOW) entries = entries.slice(-REGION_WINDOW);
    },

    /** Records a plan the game refused, or whose command changed nothing, with the commands it had issued. */
    failed(goal: Goal, sequence: readonly string[], why: string, view: AgentView): void {
      const turn = view.turn();
      failures = [...failures.filter((f) => turn - f.turn >= 0 && turn - f.turn <= FAILED_TURNS), { goal, sequence: sequence.length === 0 ? "nothing" : sequence.join(" then "), turn, why }].slice(-12);
    },

    /** Records a command a plan issued, for the store and gear swaps. */
    command(cmd: AgentCommand, view: AgentView): void {
      const args = (cmd as { args?: Record<string, unknown> }).args ?? {};
      if (cmd.code === "wield") {
        const name = itemName(view, args["handle"]);
        if (name === null) return;
        const turn = view.turn();
        worn = [...worn.filter((w) => turn - w.turn >= 0 && turn - w.turn <= EQUIP_FLIP_TURNS), { name, turn }].slice(-4);
        const n = worn.length;
        if (n >= 3 && worn[n - 1]!.name === worn[n - 3]!.name && worn[n - 2]!.name !== worn[n - 1]!.name) {
          flip = { kind: "equip_flip", tactic: "wear", detail: `wore ${worn[n - 1]!.name}, then ${worn[n - 2]!.name}, then ${worn[n - 1]!.name} again`, why: "it keeps swapping the same gear back" };
        }
        return;
      }
      if (cmd.code !== "shop-buy" && cmd.code !== "shop-sell") return;
      if (!townVisit) {
        townVisit = true;
        sold = new Set();
        bought = new Set();
      }
      if (cmd.code === "shop-buy") {
        const name = stockName(view, args["index"]);
        if (name === null) return;
        if (sold.has(name)) flip = { kind: "store_flip", tactic: "shop", detail: `bought back ${name} after selling it on this town visit`, why: "it undid its own trade" };
        bought.add(name);
      } else {
        const name = itemName(view, args["handle"]);
        if (name === null) return;
        if (bought.has(name)) flip = { kind: "store_flip", tactic: "shop", detail: `sold ${name} after buying it on this town visit`, why: "it undid its own trade" };
        sold.add(name);
      }
    },

    /** The loop the recent decisions show, if any. */
    detect(view: AgentView): LoopFinding | null {
      if (flip !== null) return flip;
      const refused = failedSequence(view.turn());
      if (refused !== null) return refused;
      const last = entries.slice(-REPEAT_RUN);
      if (last.length === REPEAT_RUN && !STILL_GOALS.has(last[0]!.goal) && last.every((e) => e.goal === last[0]!.goal && e.state === last[0]!.state)) {
        return { kind: "repeat", tactic: last[0]!.goal, detail: `${last[0]!.goal} chosen ${String(REPEAT_RUN)} times in a row with nothing changing`, why: "nothing changed after it" };
      }
      const depth = view.player().depth;
      const recent = entries.slice(-CYCLE_WINDOW);
      if (recent.length === CYCLE_WINDOW && recent.every((e) => e.depth === depth)) {
        const grids = new Set(recent.map((e) => e.grid));
        let moves = 0;
        let revisits = 0;
        for (let i = 1; i < recent.length; i++) {
          if (recent[i]!.grid !== recent[i - 1]!.grid) moves += 1;
          if (recent[i]!.grid !== recent[i - 1]!.grid && recent.slice(0, i - 1).some((e) => e.grid === recent[i]!.grid)) revisits += 1;
        }
        if (grids.size <= CYCLE_MAX_GRIDS && grids.size > 1 && moves >= CYCLE_MIN_MOVES && revisits > 0) {
          return { kind: "cycle", tactic: tacticOf(view), detail: `walked back and forth between ${String(grids.size)} squares over the last ${String(CYCLE_WINDOW)} decisions`, why: "it only walked back and forth" };
        }
      }
      const twitch = twitching(view);
      if (twitch !== null) return twitch;
      const window = entries.slice(-FLIP_WINDOW);
      const depths = new Set(window.map((e) => e.depth));
      let changes = 0;
      for (let i = 1; i < window.length; i++) if (window[i]!.depth !== window[i - 1]!.depth) changes += 1;
      if (window.length === FLIP_WINDOW && depths.size === 2 && changes >= FLIP_MIN_CHANGES) {
        const [a, b] = [...depths].sort((x, y) => x - y);
        return { kind: "level_flip", tactic: tacticOf(view), detail: `went back and forth between levels ${String(a)} and ${String(b)} ${String(changes)} times`, why: "it only went back and forth between the two levels" };
      }
      return revisiting(view);
    },

    /** Starts over after a loop has been handled, so the same history is not reported twice. */
    reset(): void {
      entries = [];
      worn = [];
      flip = null;
      failures = [];
      sold = new Set();
      bought = new Set();
    },
  };
}

export type LoopGuard = ReturnType<typeof createLoopGuard>;

/**
 * Spots Squire going round in circles: the same choice in the same state over
 * and over, walking back and forth between a few squares or two levels, and
 * buying back what it sold or swapping the same gear in and out.
 *
 * It records only what the character sees: its own grid, hit points and mana,
 * the creatures in sight, and the names items are shown under.
 */

import type { AgentCommand, AgentView } from "@rpgm-tools/neo-angband-core";
import { shownName } from "../town/needs.js";
import type { Goal } from "./goals.js";

export type LoopKind = "repeat" | "cycle" | "level_flip" | "equip_flip" | "store_flip";

export interface LoopFinding {
  readonly kind: LoopKind;
  /** The goal that kept failing, which the re-plan is told about. */
  readonly tactic: Goal | null;
  readonly detail: string;
}

interface Entry {
  readonly goal: Goal;
  readonly turn: number;
  readonly depth: number;
  readonly grid: string;
  readonly state: string;
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

export function createLoopGuard() {
  let entries: Entry[] = [];
  let worn: { name: string; turn: number }[] = [];
  let sold = new Set<string>();
  let bought = new Set<string>();
  let townVisit = false;
  let flip: LoopFinding | null = null;

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

  return {
    /** Records a decision. */
    chose(goal: Goal, view: AgentView): void {
      const p = view.player();
      if (p.depth !== 0) {
        townVisit = false;
        sold = new Set();
        bought = new Set();
      }
      entries.push({ goal, turn: view.turn(), depth: p.depth, grid: `${String(p.grid.x)},${String(p.grid.y)}`, state: stateKey(view) });
      if (entries.length > CYCLE_WINDOW * 2) entries = entries.slice(-CYCLE_WINDOW * 2);
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
          flip = { kind: "equip_flip", tactic: "wear", detail: `wore ${worn[n - 1]!.name}, then ${worn[n - 2]!.name}, then ${worn[n - 1]!.name} again` };
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
        if (sold.has(name)) flip = { kind: "store_flip", tactic: "shop", detail: `bought back ${name} after selling it on this town visit` };
        bought.add(name);
      } else {
        const name = itemName(view, args["handle"]);
        if (name === null) return;
        if (bought.has(name)) flip = { kind: "store_flip", tactic: "shop", detail: `sold ${name} after buying it on this town visit` };
        sold.add(name);
      }
    },

    /** The loop the recent decisions show, if any. */
    detect(view: AgentView): LoopFinding | null {
      if (flip !== null) return flip;
      const last = entries.slice(-REPEAT_RUN);
      if (last.length === REPEAT_RUN && !STILL_GOALS.has(last[0]!.goal) && last.every((e) => e.goal === last[0]!.goal && e.state === last[0]!.state)) {
        return { kind: "repeat", tactic: last[0]!.goal, detail: `${last[0]!.goal} chosen ${String(REPEAT_RUN)} times in a row with nothing changing` };
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
          return { kind: "cycle", tactic: tacticOf(view), detail: `walked back and forth between ${String(grids.size)} squares over the last ${String(CYCLE_WINDOW)} decisions` };
        }
      }
      const window = entries.slice(-FLIP_WINDOW);
      const depths = new Set(window.map((e) => e.depth));
      let changes = 0;
      for (let i = 1; i < window.length; i++) if (window[i]!.depth !== window[i - 1]!.depth) changes += 1;
      if (window.length === FLIP_WINDOW && depths.size === 2 && changes >= FLIP_MIN_CHANGES) {
        const [a, b] = [...depths].sort((x, y) => x - y);
        return { kind: "level_flip", tactic: tacticOf(view), detail: `went back and forth between levels ${String(a)} and ${String(b)} ${String(changes)} times` };
      }
      return null;
    },

    /** Starts over after a loop has been handled, so the same history is not reported twice. */
    reset(): void {
      entries = [];
      worn = [];
      flip = null;
      sold = new Set();
      bought = new Set();
    },
  };
}

export type LoopGuard = ReturnType<typeof createLoopGuard>;

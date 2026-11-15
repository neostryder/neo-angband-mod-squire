/** Legal commands still need a game-turn limit when the level stops paying. */

import type { AgentView } from "../host-adapter.js";
import { arrivalFeeling } from "../brain/level-feel.js";
import { descentPolicy } from "./readiness.js";
import type { Persona } from "../persona/persona.js";
import { frontiers, knownCount, knownGridCount } from "../map.js";
import { key, type Loc } from "../grid.js";
import type { Terrain } from "../terrain.js";
import { shownName } from "../town/needs.js";

/** Fifty normal player actions per character level, capped at 1,000 actions. */
export function levelBudget(level: number, persona: Persona | null = null): number {
  return Math.min(10000 * descentPolicy(persona).scale, 500 * Math.max(1, level) * descentPolicy(persona).scale);
}

export function stairLeash(level: number, persona: Persona | null = null): number {
  return level < 20 * descentPolicy(persona).scale ? (3 * Math.max(1, level) + 9) / descentPolicy(persona).scale : Infinity;
}

export const DIVE_SCHEDULE = [
  { depth: 2, minutes: 4 },
  { depth: 3, minutes: 7.5 },
  { depth: 4, minutes: 11 },
  { depth: 5, minutes: 15 },
  { depth: 6, minutes: 18 },
  { depth: 7, minutes: 21 },
  { depth: 8, minutes: 24 },
  { depth: 9, minutes: 27 },
  { depth: 10, minutes: 30 },
] as const;

/** Small gains and stair visits must not restart the overall depth deadline. */
export function diveSchedule(minutes: number, depth: number, persona: Persona | null = null) {
  const scale = descentPolicy(persona).scale;
  const target = DIVE_SCHEDULE.find((step) => step.depth > Math.max(1, depth));
  const next = target === undefined ? undefined : { depth: target.depth, minutes: target.minutes * scale };
  const late = next === undefined ? -1 : minutes - next.minutes;
  const slack = 3 * scale * scale;
  return { minutes, next: next ?? null, slack, late, stage: late < 0 ? 0 : late < slack ? 1 : 2 };
}

export function createLevelPacing() {
  let depth = -1;
  let entered = 0;
  let useful = 0;
  let lastTurn = -1;
  let xp = 0;
  let gold = 0;
  let arrival: string | null = null;
  let levelId: number | undefined;
  let exhausted = false;
  let known = 0;
  let arrivalKnown = 0;
  let anchor: Loc = { x: 0, y: 0 };
  const reached = new Set<string>();
  const held = new Map<string, number>();

  return {
    observe(view: AgentView, terrain?: Terrain, persona: Persona | null = null): { readonly expired: boolean; readonly review: boolean; readonly fresh: boolean; readonly anchor: Loc; readonly known: number; readonly turns: number; readonly explored: number } {
      const player = view.player();
      const turn = view.turn();
      const feeling = view.messages().find((message) => arrivalFeeling([message])) ?? null;
      const currentId = view.knownLevel?.()?.levelId;
      const fresh = depth !== player.depth || currentId !== levelId || turn < lastTurn || feeling !== null && feeling !== arrival;
      levelId = currentId;
      if (fresh) {
        depth = player.depth;
        entered = turn;
        useful = turn;
        xp = player.exp;
        gold = player.gold;
        exhausted = false;
        anchor = { ...player.grid };
        reached.clear();
        held.clear();
        known = 0;
      }
      arrival = feeling;
      lastTurn = turn;
      let progress = player.exp > xp || player.gold > gold;
      const seen = knownGridCount(view);
      if (!fresh && seen > known) progress = true;
      known = Math.max(known, seen);
      if (fresh) arrivalKnown = known;
      xp = Math.max(xp, player.exp);
      gold = Math.max(gold, player.gold);
      const counts = new Map<string, number>();
      for (const item of view.inventory()) {
        const name = (shownName(item) ?? "").replace(/^\d+\s+|^an?\s+/i, "");
        if (!/Cure |Phase Door|Teleport|Recall|Food|Ration|Torch|Lantern|Oil|Book|\(\+\d/i.test(name)) continue;
        counts.set(name, (counts.get(name) ?? 0) + item.number);
      }
      for (const [name, count] of counts) {
        const was = held.get(name);
        if (was !== undefined && count > was) progress = true;
        if (was === undefined && turn > entered) progress = true;
        held.set(name, Math.max(was ?? 0, count));
      }
      if (terrain !== undefined && frontiers(view, terrain).some((grid) => key(grid) === key(player.grid)) && !reached.has(key(player.grid))) {
        reached.add(key(player.grid));
        progress = true;
      }
      if (progress) useful = turn;
      const budget = levelBudget(player.level, persona);
      const expired = player.depth > 0 && (exhausted || turn - useful >= budget || turn - entered >= 4 * budget);
      const review = expired && !exhausted;
      exhausted = expired;
      return { expired, review, fresh, anchor, known, turns: turn - entered, explored: known - arrivalKnown };
    },
  };
}

export interface ExplorationPressure {
  readonly value: number;
  readonly decisions: number;
  readonly turns: number;
  readonly distinct: number;
  readonly revealed: number;
  readonly positions: readonly Loc[];
  readonly force: boolean;
  readonly text: string;
}

/** A bounded history catches idle decisions even when refused commands spend no game turns. */
export function createExplorationPressure() {
  let depth = -1;
  let levelId: number | undefined;
  let known = 0;
  let samples: { grid: Loc; turn: number; known: number }[] = [];
  let observations = 0;
  let reveals: { decision: number; turn: number; cells: number }[] = [];
  return {
    observe(view: AgentView, persona: Persona | null = null, safe = true): ExplorationPressure {
      const player = view.player();
      const turn = view.turn();
      const bounds = view.mapBounds();
      let seen = 0;
      let item = false;
      for (let y = 0; y < bounds.height; y += 1) for (let x = 0; x < bounds.width; x += 1) {
        const cell = view.cell(x, y);
        if (cell?.known === true) seen += 1;
        if (cell?.inView === true && knownCount(cell) > 0) item = true;
      }
      const id = view.knownLevel?.()?.levelId;
      const fresh = player.depth !== depth || id !== levelId || turn < (samples.at(-1)?.turn ?? turn);
      observations += 1;
      if (fresh) reveals = [];
      else if (seen > known) reveals.push({ decision: observations, turn, cells: seen - known });
      reveals = reveals.filter((reveal) => observations - reveal.decision < 180 && turn - reveal.turn <= 1800);
      const reset = fresh || seen > known ||
        player.depth === 0 || !safe || item || view.monsters().some((m) => m.visible);
      if (reset) samples = [];
      depth = player.depth;
      levelId = id;
      known = seen;
      if (!reset) samples.push({ grid: { ...player.grid }, turn, known });
      samples = samples.filter((sample) => turn - sample.turn <= 1800).slice(-180);
      const decisions = samples.length;
      const distinct = new Set(samples.map((sample) => key(sample.grid))).size;
      const turns = turn - (samples[0]?.turn ?? turn);
      const revealed = reveals.reduce((sum, reveal) => sum + reveal.cells, 0);
      const policy = descentPolicy(persona);
      const curiosity = (persona?.sliders.curiosity ?? 50) / 100;
      const patience = (persona?.sliders.patience ?? 50) / 100;
      const rate = (0.5 + policy.appetite + curiosity) / (1 + patience);
      const ceiling = 0.6 + 0.8 * policy.appetite;
      const age = Math.max(decisions, turns / 10);
      const locality = Math.max(0, 1 - Math.max(0, distinct - 4) / Math.max(12, decisions / 4));
      const value = Math.min(ceiling, Math.max(0, (age * rate - 12) / 78) * locality);
      return { value, decisions, turns, distinct, revealed, positions: samples.map((sample) => sample.grid),
        force: value >= 0.8 * ceiling,
        text: `Exploration pressure ${value.toFixed(2)}: no new ground for ${String(decisions)} decisions (${String(turns)} game turns), ${String(distinct)} distinct cells, ${String(revealed)} newly revealed cells in a small area.` };
    },
  };
}

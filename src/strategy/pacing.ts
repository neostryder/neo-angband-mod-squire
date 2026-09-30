/** Legal commands still need a game-turn limit when the level stops paying. */

import type { AgentView } from "@rpgm-tools/neo-angband-core";
import { arrivalFeeling } from "../brain/level-feel.js";
import { frontiers } from "../map.js";
import { key, type Loc } from "../grid.js";
import type { Terrain } from "../terrain.js";
import { shownName } from "../town/needs.js";

/** Fifty normal player actions per character level, capped at 1,000 actions. */
export function levelBudget(level: number): number {
  return Math.min(10000, 500 * Math.max(1, level));
}

export function stairLeash(level: number): number {
  return level < 20 ? 3 * Math.max(1, level) + 9 : Infinity;
}

export function createLevelPacing() {
  let depth = -1;
  let entered = 0;
  let useful = 0;
  let lastTurn = -1;
  let xp = 0;
  let gold = 0;
  let arrival: string | null = null;
  let exhausted = false;
  let known = 0;
  let anchor: Loc = { x: 0, y: 0 };
  const reached = new Set<string>();
  const held = new Map<string, number>();

  return {
    observe(view: AgentView, terrain?: Terrain): { readonly expired: boolean; readonly review: boolean; readonly fresh: boolean; readonly anchor: Loc } {
      const player = view.player();
      const turn = view.turn();
      const feeling = view.messages().find((message) => arrivalFeeling([message])) ?? null;
      const fresh = depth !== player.depth || turn < lastTurn || feeling !== null && feeling !== arrival;
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
      const bounds = view.mapBounds();
      let seen = 0;
      for (let y = 0; y < bounds.height; y += 1) {
        for (let x = 0; x < bounds.width; x += 1) if (view.cell(x, y)?.known === true) seen += 1;
      }
      if (!fresh && seen > known) progress = true;
      known = Math.max(known, seen);
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
      const budget = levelBudget(player.level);
      const expired = player.depth > 0 && (exhausted || turn - useful >= budget || turn - entered >= 4 * budget);
      const review = expired && !exhausted;
      exhausted = expired;
      return { expired, review, fresh, anchor };
    },
  };
}

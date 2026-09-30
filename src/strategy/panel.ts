/** The Squire panel's aims section as plain lines, so the DOM code stays thin. */

import { affordable, type Aim } from "./aims.js";

export const AIMS_HEADING = "Aims";
export const AIMS_EMPTY = "No aims yet. Squire reviews them at each new level.";

export interface AimPanelState {
  readonly gold: number;
  readonly depth: number;
}

function feet(level: number): string {
  return `${String(level * 50)} ft`;
}

function how(aim: Aim, state: AimPanelState): string {
  switch (aim.how) {
    case "save":
      return affordable(aim, state.gold) ? `buy for ${String(aim.price)} gold` : `save ${String(aim.price)} gold (have ${String(state.gold)})`;
    case "hunt": return "hunt in the dungeon";
    case "try": return "try what is in the pack";
    case "dive": return `reach ${feet(aim.depth ?? 0)} (now ${feet(state.depth)})`;
  }
}

/** The lines the panel shows under the heading, best aim first. */
export function aimLines(aims: readonly Aim[], state: AimPanelState): string[] {
  if (aims.length === 0) return [AIMS_EMPTY];
  return aims.map((aim, i) => `${String(i + 1)}. ${aim.label.charAt(0).toUpperCase()}${aim.label.slice(1)}: ${how(aim, state)}`);
}

/** The Squire panel's intent card as plain lines, so the DOM code stays thin. */

import type { AgentView } from "../host-adapter.js";
import { affordable, type Aim } from "./aims.js";
import { descentGaps } from "./readiness.js";
import type { NextCheck } from "./revise.js";

export const AIMS_HEADING = "Intent";
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

/** The first thing the next level down asks for that the character lacks. */
export interface Concern {
  readonly depth: number;
  readonly reason: string;
}

/** The first hard gap for the next level down, else the first soft one, else null. */
export function concernFor(view: AgentView): Concern | null {
  const depth = view.player().depth + 1;
  const gaps = descentGaps(view, depth);
  const first = gaps.hard[0] ?? gaps.soft[0];
  return first === undefined ? null : { depth, reason: first.reason };
}

export interface PanelGoals {
  readonly near: string | null;
  /** The mid-term goal the near-term goal serves. */
  readonly mid?: string | null;
  /** Shown only when the player turned the long-term goal on. */
  readonly long: string | null;
  readonly showLong: boolean;
  readonly concern?: Concern | null;
  readonly next?: NextCheck | null;
}

function nextLine(next: NextCheck): string {
  if (next.capped) return "Next check: on another dungeon level. Squire already dropped two aims on this one.";
  const actions = next.actions === 1 ? "1 more action" : `${String(next.actions)} more actions`;
  return `Next check: after ${actions}, or on first reaching dungeon level ${String(next.depth)}.`;
}

/**
 * The intent card: the near-term goal, the mid-term goal it serves, the
 * long-term goal when the switch is on, the known concern and the next check,
 * then the aims best first.
 */
export function panelLines(aims: readonly Aim[], state: AimPanelState, goals: PanelGoals): string[] {
  const lines: string[] = [];
  const has = (text: string | null | undefined): text is string => text !== null && text !== undefined && text !== "";
  if (has(goals.near)) lines.push(`Near-term goal: ${goals.near}`);
  if (has(goals.mid)) lines.push(`Mid-term goal: ${goals.mid}`);
  if (goals.showLong && has(goals.long)) lines.push(`Long-term goal: ${goals.long}`);
  if (goals.concern !== null && goals.concern !== undefined) lines.push(`Concern: the character still lacks ${goals.concern.reason} for dungeon level ${String(goals.concern.depth)}.`);
  if (lines.length > 0 && goals.next !== null && goals.next !== undefined) lines.push(nextLine(goals.next));
  return [...lines, ...aimLines(aims, state)];
}

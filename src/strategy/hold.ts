/**
 * The depth target as a brake: once the character stands at or below the
 * dungeon level its depth aim names, going deeper overshoots the aim, so the
 * descend option loses most of its weight. Taking the stairs away from danger
 * is still an escape and is left alone.
 */

import type { AgentView } from "@rpgm-tools/neo-angband-core";
import type { Aim } from "./aims.js";

/** The share of its weight descend keeps past the depth target. */
export const HOLD_SHARE = 0.25;

/** Whether taking the stairs now would be an escape: an awake creature in sight, hit points at half or less, or a bad level feeling. */
export function descentEscapes(view: AgentView, badFeeling: boolean): boolean {
  const p = view.player();
  if (badFeeling) return true;
  if (p.maxHp > 0 && p.hp <= p.maxHp * 0.5) return true;
  return view.monsters().some((m) => m.visible && !m.asleep);
}

/** Cut the descend weight when the character is already at or past the depth aim's level and is not escaping. */
export function holdDescent(dist: Readonly<Record<string, number>>, aims: readonly Aim[], view: AgentView, badFeeling: boolean): Record<string, number> {
  const out = { ...dist };
  const current = out["descend"];
  if (current === undefined) return out;
  const depth = view.player().depth;
  const target = aims.find((a) => a.kind === "depth" && a.depth !== null)?.depth ?? null;
  if (target === null || depth < target || descentEscapes(view, badFeeling)) return out;
  out["descend"] = current * HOLD_SHARE;
  return out;
}

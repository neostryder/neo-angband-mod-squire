import { normalize } from "./persona.js";
import type { Persona } from "./persona.js";
import type { SliderId } from "./catalog.js";

export type DriftEvent = "near-death" | "unique-kill" | "level-up" | "patron-blessing" | "patron-trial" | "fled";

export interface DriftChange {
  id: SliderId;
  from: number;
  to: number;
}

/** A returned copy lets callers keep the pre-event character for logs or undo. */
export function applyDrift(persona: Persona, event: DriftEvent, _rng?: () => number): { persona: Persona; changes: DriftChange[] } {
  const next = normalize(persona);
  const changes: DriftChange[] = [];
  const step = Math.round(next.sliders.drift / 20);
  function move(id: SliderId, amount: number): void {
    const from = next.sliders[id];
    const to = Math.max(0, Math.min(100, from + amount));
    if (to !== from) { next.sliders[id] = to; changes.push({ id, from, to }); }
  }
  switch (event) {
    case "near-death": move("boldness", -step); move("paranoia", step); break;
    case "unique-kill": move("pride", step); move("boldness", step); break;
    case "level-up": move("composure", step); break;
    case "patron-blessing": move("devotion", Math.round(step * next.sliders.gratitude / 50)); break;
    case "patron-trial": move("devotion", -Math.round(step * next.sliders.resentment / 50)); break;
    case "fled": move("pride", -step); break;
  }
  return { persona: next, changes };
}

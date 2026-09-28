import type { Persona } from "./persona.js";

export function shiftThreat(bandIndex: number, bands: number, persona: Persona, rng: () => number): number {
  if (bands <= 0) return 0;
  let shifted = Math.round(bandIndex);
  if (persona.sliders.optimism >= 70) shifted -= 1;
  else if (persona.sliders.optimism <= 30) shifted += 1;
  const delusion = persona.quirks.delusional;
  if (delusion.on && rng() < delusion.strength / 200) shifted += rng() < 0.5 ? -1 : 1;
  return Math.max(0, Math.min(bands - 1, shifted));
}

export function forget<T>(lessons: readonly T[], persona: Persona, rng: () => number): T[] {
  const quirk = persona.quirks.forgetful;
  return quirk.on ? lessons.filter(() => rng() >= quirk.strength / 200) : [...lessons];
}

export function mustPickUp(persona: Persona): boolean {
  return persona.quirks.compulsive.on;
}

export function fleesFromNew(persona: Persona): boolean {
  return persona.quirks.cowardice.on;
}

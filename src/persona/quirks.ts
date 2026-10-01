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

/**
 * How many steps the character will walk to look at a floor item it cannot
 * judge from where it stands: an unknown flavour, or something only sensed.
 * Every character looks at what lies close by, as a player picks up unknown
 * potions to learn them. Curiosity, greed (more so for sensed money) and
 * boldness draw it further; self-preservation and paranoia hold it back.
 */
export const LOOK_BASE = 8;

export function lookReach(persona: Persona | null, money: boolean): number {
  if (persona === null) return LOOK_BASE;
  const { curiosity, greed, boldness, selfpreservation, paranoia } = persona.sliders;
  const lean = (curiosity - 50) + (greed - 50) * (money ? 1 : 0.5) + (boldness - 50) / 2 -
    (selfpreservation - 50) / 2 - (paranoia - 50) / 2;
  return Math.max(0, LOOK_BASE + Math.floor(lean / 2));
}

/** Unknown harm bends preferences without changing the survival bound. */
export function nudgeUnseen(dist: Readonly<Record<string, number>>, offers: readonly { readonly goal: string; readonly risk: number }[], persona: Persona, damage: number, hp: number, ceiling: number): Record<string, number> {
  const result = { ...dist };
  const { boldness, pride, paranoia, selfpreservation, strength } = persona.sliders;
  const fear = (paranoia + selfpreservation + 100 - boldness + 100 - pride) / 400 +
    (persona.quirks.cowardice.on ? persona.quirks.cowardice.strength / 100 : 0);
  const pressure = Math.min(1, damage / Math.max(1, hp)) * strength / 100;
  for (const offer of offers) {
    if (offer.risk > ceiling) continue;
    const response = ["detect", "see_invisible", "light_room", "retreat", "leave_level", "phase", "teleport"].includes(offer.goal);
    const advance = ["explore", "descend", "fight", "shoot", "cast_attack"].includes(offer.goal);
    if (response || advance) result[offer.goal] = (result[offer.goal] ?? 0) * Math.exp(pressure * (response ? fear * 2 : 1 - fear * 2));
  }
  return result;
}

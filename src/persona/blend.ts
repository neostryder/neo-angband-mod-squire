import type { Persona } from "./persona.js";

type Distribution = Readonly<Record<string, number>>;

function valid(value: number | undefined): number {
  return value !== undefined && Number.isFinite(value) && value > 0 ? value : 0;
}

function normalized(dist: Distribution): Record<string, number> {
  const total = Object.values(dist).reduce((sum, value) => sum + valid(value), 0);
  const result: Record<string, number> = {};
  for (const [key, value] of Object.entries(dist)) result[key] = total > 0 ? valid(value) / total : 0;
  return result;
}

export function blend(best: Distribution, inCharacter: Distribution, strength01: number): Record<string, number> {
  const strength = Number.isFinite(strength01) ? Math.max(0, Math.min(1, strength01)) : 0;
  const a = normalized(best);
  const b = normalized(inCharacter);
  const combined: Record<string, number> = {};
  for (const key of new Set([...Object.keys(best), ...Object.keys(inCharacter)])) {
    combined[key] = (1 - strength) * (a[key] ?? 0) + strength * (b[key] ?? 0);
  }
  return normalized(combined);
}

export function jitteredStrength(persona: Persona, rng: () => number): number {
  const draw = rng();
  const unit = Number.isFinite(draw) ? Math.max(0, Math.min(1, draw)) : 0.5;
  return Math.max(0, Math.min(1, persona.sliders.strength / 100 + (unit * 2 - 1) * persona.sliders.volatility / 400));
}

export function riskCeiling(persona: Persona): number {
  return 0.6 - persona.sliders.selfpreservation * 0.005;
}

/** The choice key that means no offered option fits. */
const NONE_OF_THESE = "none_of_these";

export function applySafetyFloor(dist: Distribution, risk: Distribution, ceiling: number, deathWish: boolean): { dist: Record<string, number>; removed: string[] } {
  const keys = Object.keys(dist);
  const removed = deathWish ? [] : keys.filter((key) => (risk[key] ?? 0) > ceiling);
  /* When every real option is over the line, the safest of them stays. The
   * no-risk "none of these" does not count as one: keeping only it would turn a
   * clear "retreat" into the errand fallback exactly when the character is in
   * the most danger. */
  const real = keys.filter((key) => key !== NONE_OF_THESE);
  if (real.length > 0 && real.every((key) => removed.includes(key))) {
    let safest = real[0]!;
    for (const key of real.slice(1)) if ((risk[key] ?? 0) < (risk[safest] ?? 0)) safest = key;
    removed.splice(removed.indexOf(safest), 1);
  }
  const kept: Record<string, number> = {};
  for (const key of keys) if (!removed.includes(key)) kept[key] = valid(dist[key]);
  const result = normalized(kept);
  if (Object.keys(result).length > 0 && Object.values(result).every((value) => value === 0)) {
    const first = Object.keys(result)[0]!;
    result[first] = 1;
  }
  return { dist: result, removed };
}

export function pick(dist: Distribution): string | undefined {
  let choice: string | undefined;
  let highest = -Infinity;
  for (const [key, probability] of Object.entries(dist)) {
    if (probability > highest) { choice = key; highest = probability; }
  }
  return choice;
}

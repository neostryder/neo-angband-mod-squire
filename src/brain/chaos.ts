/**
 * Law to Chaos at the moment of picking: how far the final pick may stray from
 * the top option once the answers are blended and the unsafe options are gone.
 *
 * Smooth sampling, the default, takes option i with weight p_i^(1/T). The
 * temperature T rises with the slider, from 0 for a lawful persona (always the
 * top option) through about 0.5 at neutral to about 1.1 at fully chaotic. The
 * roll is a bounded alternative: a d20 against a lawfulness threshold keeps the
 * top option, and otherwise a d4 picks among the top four options that carry at
 * least a third of the top option's probability.
 *
 * Callers decide what may be drawn from. Nothing here knows about risk, orders
 * or the escape gate; it only draws from the distribution it is handed.
 */

import type { Answer } from "./systemone.js";

export type ChaosMethod = "sampling" | "roll";

export const CHAOS_METHODS: readonly ChaosMethod[] = ["sampling", "roll"];

/** Under this temperature the pick is the top option and nothing is drawn. */
export const LAWFUL_TEMPERATURE = 0.02;

/** An option needs this share of the top option's probability for the d4 to land on it. */
export const ROLL_FLOOR = 1 / 3;

/** The most options the d4 chooses among. */
const ROLL_SPREAD = 4;

/** One draw, kept on the decision record and never sent to the model. */
export interface ChaosRecord {
  readonly method: ChaosMethod;
  /** The sampling temperature, for a draw by sampling. */
  readonly temperature?: number;
  /** The d20 roll and the lowest roll that keeps the top option, for a draw by roll. */
  readonly d20?: number;
  readonly threshold?: number;
  /** The d4 roll, when the d20 missed the threshold. */
  readonly d4?: number;
  readonly top: string;
  readonly pick: string;
}

/** What a draw needs: the persona's Law to Chaos value, the method and the random source. */
export interface ChaosSource {
  readonly lawchaos: number;
  readonly method: ChaosMethod;
  readonly rng: () => number;
}

function unitOf(lawchaos: number): number {
  return Number.isFinite(lawchaos) ? Math.max(0, Math.min(100, lawchaos)) / 100 : 0.5;
}

function draw01(rng: () => number): number {
  const value = rng();
  return Number.isFinite(value) ? Math.max(0, Math.min(1 - Number.EPSILON, value)) : 0.5;
}

function die(sides: number, rng: () => number): number {
  return 1 + Math.floor(draw01(rng) * sides);
}

/** The sampling temperature for a Law to Chaos value: 0 at 0, 0.5 at 50, 1.1 at 100, rising smoothly between. */
export function chaosTemperature(lawchaos: number): number {
  const x = unitOf(lawchaos);
  return 0.9 * x + 0.2 * x * x;
}

/** The lowest d20 roll that keeps the top option: 1 (every roll) at 0, 8 (13 rolls in 20) at 50, 15 (6 in 20) at 100. */
export function rollThreshold(lawchaos: number): number {
  const keeps = Math.round(20 - 14 * unitOf(lawchaos));
  return 21 - keeps;
}

/** Options with weight, highest first; equal ones keep their order in the distribution. */
function ranked(dist: Readonly<Record<string, number>>): [string, number][] {
  return Object.entries(dist).filter(([, p]) => Number.isFinite(p) && p > 0).sort((a, b) => b[1] - a[1]);
}

/**
 * The pick from a distribution, and the draw that made it. The record is null
 * when nothing was drawn: a lawful persona, or fewer than two options with
 * weight. The pick is undefined only for an empty distribution.
 */
export function chaosPick(dist: Readonly<Record<string, number>>, source: ChaosSource): { readonly pick: string | undefined; readonly record: ChaosRecord | null } {
  const options = ranked(dist);
  const top = options[0]?.[0] ?? Object.keys(dist)[0];
  if (top === undefined || options.length < 2) return { pick: top, record: null };
  if (source.method === "roll") {
    const threshold = rollThreshold(source.lawchaos);
    if (threshold <= 1) return { pick: top, record: null };
    const d20 = die(20, source.rng);
    if (d20 >= threshold) return { pick: top, record: { method: "roll", d20, threshold, top, pick: top } };
    const floor = options[0]![1] * ROLL_FLOOR;
    const near = options.filter(([, p]) => p >= floor).slice(0, ROLL_SPREAD);
    const d4 = die(4, source.rng);
    /* With fewer than four options in reach the d4 wraps round them, so each keeps an even share. */
    const pick = near[(d4 - 1) % near.length]![0];
    return { pick, record: { method: "roll", d20, threshold, d4, top, pick } };
  }
  const temperature = chaosTemperature(source.lawchaos);
  if (temperature < LAWFUL_TEMPERATURE) return { pick: top, record: null };
  /* p^(1/T) relative to the top option, in logs, so a low temperature cannot overflow or round every weight to zero. */
  const lead = Math.log(options[0]![1]);
  const weights = options.map(([key, p]) => [key, Math.exp((Math.log(p) - lead) / temperature)] as const);
  const total = weights.reduce((sum, [, w]) => sum + w, 0);
  let left = draw01(source.rng) * total;
  let pick = top;
  for (const [key, w] of weights) {
    pick = key;
    left -= w;
    if (left < 0) break;
  }
  return { pick, record: { method: "sampling", temperature: Math.round(temperature * 1000) / 1000, top, pick } };
}

/**
 * A goal-hierarchy pick from a model's choice answer over `allowed` keys. Null
 * when the answer names no allowed option, so the caller's own fallback runs;
 * a refusal is never turned into a pick. With no source, or when the answer's
 * choice is not its own top option among the allowed keys, the choice stands.
 */
export function chaosChoice(answer: Answer | null | undefined, allowed: readonly string[], source: ChaosSource | null): { readonly pick: string; readonly record: ChaosRecord | null } | null {
  if (answer?.type !== "choice" || answer.choice === "none_of_these" || !allowed.includes(answer.choice)) return null;
  if (source === null) return { pick: answer.choice, record: null };
  const dist = Object.fromEntries(allowed.filter((key) => key !== "none_of_these").map((key) => [key, answer.probabilities[key] ?? 0]));
  if (ranked(dist)[0]?.[0] !== answer.choice) return { pick: answer.choice, record: null };
  const drawn = chaosPick(dist, source);
  return { pick: drawn.pick ?? answer.choice, record: drawn.record };
}

/** The draw in a few words, for a log line. */
export function chaosNote(record: ChaosRecord): string {
  if (record.method === "sampling") return `temperature ${(record.temperature ?? 0).toFixed(2)}`;
  return `d20 rolled ${String(record.d20 ?? 0)}, needing ${String(record.threshold ?? 0)}${record.d4 === undefined ? "" : `; d4 rolled ${String(record.d4)}`}`;
}

/** Whether a draw is worth a log line: every roll, and a sample only when it left the top option. */
export function chaosTold(record: ChaosRecord): boolean {
  return record.method === "roll" || record.pick !== record.top;
}

/** The draw in the shape the local decision log keeps, or nothing when no draw was made. */
export function chaosEntry(chaos: ChaosRecord | undefined): { readonly chaos?: ChaosRecord } {
  return chaos === undefined ? {} : { chaos: { ...chaos } };
}

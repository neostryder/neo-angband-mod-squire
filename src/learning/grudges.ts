/**
 * Ancestral grudges and fears: the family's record of the creatures that
 * killed its characters, and the feeling each heir starts with toward them.
 *
 * The record keeps, per family, how many ancestors each creature killed and
 * when: a unique by its name, an ordinary monster by its race. An heir turns
 * it into hatred or fear by its persona, stronger with each ancestor killed.
 * Hatred adds weight to fighting the creature and fear raises its believed
 * danger; both work inside the weights the persona already blends, so the
 * safety floor, the readiness gates and the death-risk ceiling still decide
 * last. They change what Squire decides and says, never the game's rules.
 */

import type { Persona } from "../persona/persona.js";

export interface KillerDeath {
  /** The generation of the ancestor it killed. */
  readonly generation: number;
  readonly depth: number;
  readonly turn: number;
}

export interface Killer {
  /** A unique's name or an ordinary monster's race, as the game names it. */
  readonly name: string;
  readonly unique: boolean;
  readonly deaths: readonly KillerDeath[];
  /** The generation whose character killed this unique, which settles every death before it. */
  readonly settled?: number;
}

export type FeelingKind = "hatred" | "fear";
export type Intensity = "mild" | "strong" | "lasting";

export interface Feeling {
  readonly name: string;
  readonly unique: boolean;
  readonly kind: FeelingKind;
  readonly intensity: Intensity;
  /** Ancestors this creature killed since any settling. */
  readonly count: number;
}

/** The most feelings one heir starts with, before the Inheritance slider trims them. */
export const MAX_FEELINGS = 6;
/** The most killers one family record keeps. */
const MAX_KILLERS = 30;

/** How much a feeling raises the weight of fighting a hated creature or leaving a feared one, as a fraction. */
export const GRUDGE_NUDGE: Readonly<Record<Intensity, number>> = { mild: 0.15, strong: 0.3, lasting: 0.45 };
/** How many threat bands fear adds to what the character believes of a creature. */
export const FEAR_SHIFT: Readonly<Record<Intensity, number>> = { mild: 1, strong: 1, lasting: 2 };

export const ATTACK_GOALS: readonly string[] = ["fight", "shoot", "throw_oil", "aim_wand", "cast_attack"];
export const AVOID_GOALS: readonly string[] = ["leave_level", "retreat", "phase", "teleport"];

/** Death causes that name no creature. */
const NOT_A_CREATURE = /^(?:trap|bug|monster|starvation|hunger|poison|a fall|fall|drowning|lava|cuts?|bleeding|retiring|ripe old age|winning|quitting|suicide)$/i;

function same(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/**
 * The creature a death cause names, or null when it names none. A creature in
 * sight at death settles whether it is unique; otherwise the game's own way of
 * naming does, which gives a unique's name bare and an ordinary monster an article.
 */
export function killerOf(cause: string, seen: readonly { readonly race: string; readonly raceFlags: readonly string[] }[] = []): { name: string; unique: boolean } | null {
  const bare = cause.replace(/^killed by\s+/i, "").trim();
  const article = /^(?:an?|the)\s+/i.test(bare);
  const name = bare.replace(/^(?:an?|the)\s+/i, "").trim();
  if (name === "" || NOT_A_CREATURE.test(name)) return null;
  const match = seen.find((m) => same(m.race, name));
  if (match !== undefined) return { name: match.race, unique: match.raceFlags.includes("UNIQUE") };
  return { name, unique: !article && /^[A-Z]/.test(name) };
}

/** Add one ancestor's death to the family record. */
export function recordDeath(killers: readonly Killer[], killer: { name: string; unique: boolean } | null, death: KillerDeath): Killer[] {
  if (killer === null) return [...killers];
  const at = killers.findIndex((k) => same(k.name, killer.name));
  if (at === -1) return [...killers, { name: killer.name, unique: killer.unique, deaths: [death] }].slice(-MAX_KILLERS);
  return killers.map((k, i) => (i === at ? { ...k, deaths: [...k.deaths, death] } : k));
}

/** Settle a unique's grudge for the whole family, when a character of this generation killed it. Returns null when there is nothing to settle. */
export function settle(killers: readonly Killer[], name: string, generation: number): Killer[] | null {
  const at = killers.findIndex((k) => k.unique && same(k.name, name) && active(k).length > 0);
  if (at === -1) return null;
  return killers.map((k, i) => (i === at ? { ...k, settled: generation } : k));
}

function active(killer: Killer): readonly KillerDeath[] {
  const since = killer.settled;
  return since === undefined ? killer.deaths : killer.deaths.filter((d) => d.generation > since);
}

export function intensityOf(count: number): Intensity | null {
  if (count <= 0) return null;
  return count === 1 ? "mild" : count === 2 ? "strong" : "lasting";
}

/**
 * How many deaths a feeling still counts for, in the heir of this generation.
 * A unique is remembered until someone kills it. A feeling toward an ordinary
 * monster loses one step for each generation after the first heir, until it
 * kills again, and a lasting one does not fade.
 */
export function remembered(killer: Killer, heirGeneration: number): number {
  const deaths = active(killer);
  if (deaths.length === 0) return 0;
  if (killer.unique || deaths.length >= 3) return deaths.length;
  const last = Math.max(...deaths.map((d) => d.generation));
  const age = Math.max(0, heirGeneration - last - 1);
  return Math.max(0, deaths.length - age);
}

/**
 * Hatred or fear, by persona. A craven heir fears and one with a death wish
 * hates; a bold or proud heir hates and a timid or suspicious one fears. The
 * rest lean by degree: a middling heir hates a creature that killed one
 * ancestor and fears one that killed several.
 */
export function feelingKind(persona: Persona, count: number): FeelingKind {
  const { boldness, pride, paranoia } = persona.sliders;
  if (persona.quirks.cowardice.on) return "fear";
  if (persona.quirks.deathwish.on) return "hatred";
  if (boldness >= 70 || pride >= 70) return "hatred";
  if (boldness <= 30 || paranoia >= 70) return "fear";
  const lean = (boldness - 50) + (pride - 50) / 2 - (paranoia - 50) / 2;
  return lean >= 10 * (Math.min(3, count) - 1) ? "hatred" : "fear";
}

/**
 * The feelings an heir starts with. The parent's Inheritance slider sets how
 * many pass, as it sets how much lore does, so at none the heir starts with no
 * grudge at all; the strongest pass first.
 */
export function feelingsFor(killers: readonly Killer[], heirGeneration: number, heir: Persona, inheritance: number): Feeling[] {
  const share = Math.max(0, Math.min(1, inheritance / 100));
  const limit = Math.ceil(MAX_FEELINGS * share);
  if (limit === 0) return [];
  const out: Feeling[] = [];
  for (const killer of killers) {
    const count = remembered(killer, heirGeneration);
    const intensity = intensityOf(count);
    if (intensity === null) continue;
    out.push({ name: killer.name, unique: killer.unique, kind: feelingKind(heir, count), intensity, count });
  }
  return out.sort((a, b) => b.count - a.count || Number(b.unique) - Number(a.unique)).slice(0, limit);
}

/** The feeling toward a creature of this race, if the character holds one. */
export function feelingToward(feelings: readonly Feeling[], race: string): Feeling | undefined {
  return feelings.find((f) => same(f.name, race));
}

interface Nudgeable {
  readonly goal: string;
  readonly risk: number;
}

/**
 * Raise the weight of attacking a hated creature in sight, and of getting
 * away from a feared one. Like the aim nudge this runs before the safety
 * floor and leaves any option past the ceiling alone, so a feeling never
 * brings back an option the floor would remove.
 */
export function nudgeGrudges(
  dist: Readonly<Record<string, number>>,
  offers: readonly Nudgeable[],
  feelings: readonly Feeling[],
  inSight: readonly string[],
  ceiling: number,
): Record<string, number> {
  const out = { ...dist };
  let hate = 0;
  let fear = 0;
  for (const race of inSight) {
    const feeling = feelingToward(feelings, race);
    if (feeling === undefined) continue;
    if (feeling.kind === "hatred") hate = Math.max(hate, GRUDGE_NUDGE[feeling.intensity]);
    else fear = Math.max(fear, GRUDGE_NUDGE[feeling.intensity]);
  }
  for (const offer of offers) {
    if (offer.risk > ceiling) continue;
    const boost = ATTACK_GOALS.includes(offer.goal) ? hate : AVOID_GOALS.includes(offer.goal) ? fear : 0;
    const current = out[offer.goal];
    if (boost > 0 && current !== undefined) out[offer.goal] = current * (1 + boost);
  }
  return out;
}

/** The threat band a character believes of a creature it fears, from the band it would otherwise believe. */
export function fearedBand(band: number, bands: number, feeling: Feeling | undefined): number {
  if (feeling?.kind !== "fear") return band;
  return Math.max(0, Math.min(bands - 1, band + FEAR_SHIFT[feeling.intensity]));
}

const NUMBERS = ["no one", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];

function killedWhom(count: number): string {
  return `${NUMBERS[count] ?? String(count)} of the family`;
}

function named(feeling: Feeling): string {
  return feeling.unique ? feeling.name : `the ${feeling.name}`;
}

/** Where a feeling comes from, as the panel shows it. */
export function feelingLine(feeling: Feeling): string {
  const how = feeling.kind === "hatred" ? "hates" : "fears";
  return `Remembers that ${named(feeling)} killed ${killedWhom(feeling.count)}, and ${how} it (${feeling.intensity}).`;
}

/** The same, for the log, with the character's name. */
export function feelingLog(who: string, feeling: Feeling): string {
  const line = feelingLine(feeling);
  return `${who} ${line.charAt(0).toLowerCase()}${line.slice(1)}`;
}

/** What the character believes of a creature in sight, for the in-character question. */
export function feelingBelief(feeling: Feeling): string {
  return `${named(feeling)} killed ${killedWhom(feeling.count)}, and the character ${feeling.kind === "hatred" ? "hates" : "fears"} it`;
}

/** The log line when a character kills a unique the family held a grudge against. */
export function settledLine(who: string, name: string, _count: number): string {
  return `${who} has slain ${name}. The family's grudge is settled.`;
}

/** Stored records are untrusted, so each known field is copied into a fresh shape. */
export function readKillers(value: unknown): Killer[] {
  if (!Array.isArray(value)) return [];
  return value.slice(-MAX_KILLERS).flatMap((raw): Killer[] => {
    const k = record(raw);
    if (k === null || typeof k["name"] !== "string" || k["name"].trim() === "") return [];
    const deaths = Array.isArray(k["deaths"]) ? k["deaths"].slice(-50).flatMap((d): KillerDeath[] => {
      const r = record(d);
      if (r === null) return [];
      const generation = num(r["generation"]);
      return generation === null ? [] : [{ generation, depth: num(r["depth"]) ?? 0, turn: num(r["turn"]) ?? 0 }];
    }) : [];
    if (deaths.length === 0) return [];
    const settled = num(k["settled"]);
    return [{ name: k["name"].slice(0, 80), unique: k["unique"] === true, deaths, ...(settled === null ? {} : { settled }) }];
  });
}

export function readFeelings(value: unknown): Feeling[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, MAX_FEELINGS).flatMap((raw): Feeling[] => {
    const f = record(raw);
    if (f === null || typeof f["name"] !== "string" || f["name"].trim() === "") return [];
    const count = num(f["count"]);
    const kind = f["kind"] === "hatred" || f["kind"] === "fear" ? f["kind"] : null;
    const intensity = count === null ? null : intensityOf(count);
    if (count === null || kind === null || intensity === null) return [];
    return [{ name: f["name"].slice(0, 80), unique: f["unique"] === true, kind, intensity, count }];
  });
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.round(value)) : null;
}

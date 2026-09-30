import type { Persona } from "../persona/persona.js";
import type { Ancestor, Lineage } from "./lineage.js";
import { goalLabel } from "../knight.js";
import type { Goal } from "../brain/goals.js";

export interface Epitaph {
  readonly name: string;
  readonly generation: number;
  readonly line: string;
}

export interface Milestone {
  readonly kind: "depth" | "unique" | "artifact";
  readonly name: string;
  readonly generation: number;
  readonly depth: number;
  readonly fact: string;
}

function share(inheritance: number): number {
  return Number.isFinite(inheritance) ? Math.max(0, Math.min(1, inheritance / 100)) : 0;
}

export function familyVoice(persona: Persona, fact: string, kind: "memory" | "death" = "memory"): string {
  const line = `${persona.name}: ${fact}`;
  if (persona.sliders.chronicle < 50) return line;
  if (persona.quirks.cowardice.on || persona.sliders.boldness <= 35) return `${line} ${kind === "death" ? "I should have turned back." : "I hope I get home."}`;
  if (persona.sliders.pride >= 70 || persona.sliders.boldness >= 65) return `${line} ${kind === "death" ? "I meant to go deeper." : "I mean to go deeper."}`;
  return line;
}

export function namesakeLog(persona: Persona, ancestor: string): string {
  if (persona.sliders.chronicle >= 50) {
    if (persona.quirks.cowardice.on || persona.sliders.boldness <= 35) return `${persona.name}: I hope I outlive ${ancestor}, whose name I bear.`;
    if (persona.sliders.pride >= 70 || persona.sliders.boldness >= 65) return `${persona.name}: I took ${ancestor}'s name. I will go deeper than ${ancestor}.`;
  }
  return `${persona.name}: I bear ${ancestor}'s name.`;
}

export function epitaphFor(persona: Persona, death: { name: string; generation: number; cause: string; depth: number; level: number; action: string }): Epitaph | null {
  if (!persona.toggles.epitaphs) return null;
  const cause = death.cause.replace(/^killed by\s+/i, "");
  const action = goalLabel(death.action as Goal);
  const during = action === undefined ? "with my last choice unrecorded" : `while choosing to ${action}`;
  const where = death.depth === 0 ? "in town" : `at ${String(death.depth * 50)} ft`;
  const fact = `I died to ${cause} ${where}, level ${String(death.level)}, ${during}.`;
  return { name: death.name, generation: death.generation, line: familyVoice({ ...persona, name: death.name }, fact, "death") };
}

/** The family keeps the record even when an heir inherits none of it. */
export function inheritFlourishes(lineage: Lineage, parent: Persona, heir: Persona): Pick<Lineage, "epitaphs" | "milestones" | "inheritedEpitaphs" | "inheritedMilestones" | "mentionedMilestones"> {
  const epitaphs = lineage.epitaphs ?? [];
  const milestones = lineage.milestones ?? [];
  const amount = share(parent.sliders.inheritance);
  const epitaphCount = parent.toggles.epitaphs && heir.toggles.epitaphs ? Math.ceil(3 * amount) : 0;
  const milestoneCount = parent.toggles.milestones && heir.toggles.milestones ? Math.ceil(12 * amount) : 0;
  return {
    epitaphs, milestones,
    inheritedEpitaphs: epitaphCount === 0 ? [] : epitaphs.slice(-epitaphCount),
    inheritedMilestones: milestoneCount === 0 ? [] : milestones.slice(-milestoneCount),
    mentionedMilestones: [],
  };
}

export function milestoneId(milestone: Milestone): string {
  return `${milestone.kind}:${String(milestone.generation)}:${String(milestone.depth)}:${milestone.fact.toLowerCase()}`;
}

export function addMilestone(lineage: Lineage, persona: Persona, kind: Milestone["kind"], depth: number, fact: string): Milestone | null {
  if (!persona.toggles.milestones) return null;
  const records = lineage.milestones ?? [];
  if (kind === "depth" ? depth <= Math.max(0, lineage.deepest ?? 0, ...lineage.ancestors.map((a) => a.deepest ?? a.died?.depth ?? 0), ...records.filter((m) => m.kind === "depth").map((m) => m.depth)) : records.some((m) => m.kind === kind && (kind === "artifact" || m.fact.toLowerCase() === fact.toLowerCase()))) return null;
  return { kind, depth, fact, name: lineage.name, generation: lineage.generation };
}

export function milestoneFact(milestone: Milestone): string {
  if (milestone.kind === "depth") return `${milestone.name} reached ${String(milestone.depth * 50)} ft.`;
  if (milestone.kind === "unique") return `${milestone.name} was the first of the family to slay ${milestone.fact}.`;
  return `${milestone.name} found the family's first artifact: ${milestone.fact}.`;
}

export function recallMilestones(lineage: Lineage, persona: Persona, depth: number, uniques: readonly string[]): Milestone[] {
  if (!persona.toggles.milestones) return [];
  return (lineage.inheritedMilestones ?? []).filter((m) => !(lineage.mentionedMilestones ?? []).includes(milestoneId(m)) && (m.kind === "depth" ? depth >= m.depth : m.kind === "unique" && uniques.some((name) => name.toLowerCase() === m.fact.toLowerCase())));
}

const ORDINALS = ["First", "Second", "Third", "Fourth", "Fifth", "Sixth", "Seventh", "Eighth", "Ninth", "Tenth"];

function rootName(name: string): { root: string; number: number } {
  const match = /^(.*) the (First|Second|Third|Fourth|Fifth|Sixth|Seventh|Eighth|Ninth|Tenth|\d+(?:st|nd|rd|th))$/.exec(name);
  if (match === null) return { root: name, number: 1 };
  const word = ORDINALS.indexOf(match[2]!);
  return { root: match[1]!, number: word < 0 ? Number.parseInt(match[2]!, 10) : word + 1 };
}

function ordinal(number: number): string {
  const word = ORDINALS[number - 1];
  if (word !== undefined) return word;
  const suffix = number % 100 >= 11 && number % 100 <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[number % 10] ?? "th";
  return `${String(number)}${suffix}`;
}

export function namesakeFor(lineage: Lineage | undefined, parent: Persona, heir: Persona, rng: () => number): { name: string; ancestor: string } | null {
  if (lineage === undefined || !parent.toggles.namesakes || !heir.toggles.namesakes || share(parent.sliders.inheritance) === 0) return null;
  const candidates: readonly Ancestor[] = [...lineage.ancestors, { name: lineage.name, race: lineage.race ?? "unknown", cls: lineage.cls ?? "unknown", generation: lineage.generation, died: lineage.died ?? null, ...(lineage.deepest === undefined ? {} : { deepest: lineage.deepest }), ...(lineage.turns === undefined ? {} : { turns: lineage.turns }) }];
  const named = candidates.filter((a) => a.name.trim() !== "");
  if (named.length === 0) return null;
  const weight = (a: Ancestor) => 1 + Math.min(4, (a.deepest ?? a.died?.depth ?? 0) / 10) + Math.min(4, (a.turns ?? a.died?.turn ?? 0) / 10_000);
  const total = named.reduce((sum, a) => sum + weight(a), 0);
  const draw = rng();
  let ticket = (Number.isFinite(draw) ? Math.max(0, Math.min(1, draw)) : 1) * total;
  const ancestor = named.find((a) => (ticket -= weight(a)) < 0) ?? named[named.length - 1]!;
  const chance = share(parent.sliders.inheritance) * Math.min(0.8, 0.15 + (weight(ancestor) - 1) * 0.08);
  const roll = rng();
  if (!Number.isFinite(roll) || roll >= chance) return null;
  const root = rootName(ancestor.name).root;
  const next = 1 + Math.max(...named.filter((a) => rootName(a.name).root === root).map((a) => rootName(a.name).number));
  return { name: `${root} the ${ordinal(next)}`, ancestor: ancestor.name };
}

/** Older family records have no flourish fields; malformed entries add no lore. */
export function readFlourishes(value: Record<string, unknown>): Pick<Lineage, "epitaphs" | "milestones" | "inheritedEpitaphs" | "inheritedMilestones" | "mentionedMilestones" | "deepest" | "turns"> {
  const number = (v: unknown): number => typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.round(v)) : 0;
  const entries = (v: unknown): Record<string, unknown>[] => Array.isArray(v) ? v.slice(-100).filter((r): r is Record<string, unknown> => r !== null && typeof r === "object" && !Array.isArray(r)) : [];
  const epitaphs = (v: unknown): Epitaph[] => entries(v).flatMap((r) => typeof r["name"] === "string" && typeof r["line"] === "string" ? [{ name: r["name"].slice(0, 100), line: r["line"].slice(0, 500), generation: number(r["generation"]) }] : []).slice(-12);
  const milestones = (v: unknown): Milestone[] => entries(v).flatMap((r): Milestone[] => (r["kind"] === "depth" || r["kind"] === "unique" || r["kind"] === "artifact") && typeof r["name"] === "string" && typeof r["fact"] === "string" ? [{ kind: r["kind"], name: r["name"].slice(0, 100), fact: r["fact"].slice(0, 160), generation: number(r["generation"]), depth: number(r["depth"]) }] : []);
  return {
    epitaphs: epitaphs(value["epitaphs"]), milestones: milestones(value["milestones"]),
    inheritedEpitaphs: epitaphs(value["inheritedEpitaphs"]).slice(-3), inheritedMilestones: milestones(value["inheritedMilestones"]).slice(-12),
    mentionedMilestones: Array.isArray(value["mentionedMilestones"]) ? value["mentionedMilestones"].filter((v): v is string => typeof v === "string").slice(-12) : [],
    deepest: number(value["deepest"]), turns: number(value["turns"]),
  };
}

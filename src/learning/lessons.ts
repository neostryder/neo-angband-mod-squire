import type { ChoiceAnswer, ChoiceQuestion } from "../brain/systemone.js";
import { similarity, type SituationSignature } from "./signature.js";

export type LessonOutcome = "died" | "near-death" | "escaped" | "unique-kill" | "loss";

export interface Lesson {
  readonly id: string;
  readonly signature: SituationSignature;
  readonly decision: string;
  readonly outcome: LessonOutcome;
  readonly line: string;
  readonly weight: number;
  readonly created: number;
  readonly lastUsed: number;
  readonly pinned: boolean;
}

export interface LessonTemplateVars {
  readonly race?: string;
  readonly action?: string;
  readonly depth?: number;
  /** How many of the creature's kind were in sight, when it came as a breeding swarm. */
  readonly swarm?: number;
}

function sentence(event: LessonOutcome, decision: string, vars: LessonTemplateVars): string {
  const foe = vars.race === undefined ? "a creature" : vars.swarm === undefined ? vars.race : `a swarm of ${vars.race} (${String(vars.swarm)} in sight)`;
  const action = vars.action ?? decision.replace(/_/g, " ");
  const place = vars.depth === undefined ? "in the dungeon" : `at ${String(vars.depth * 50)} ft`;
  switch (event) {
    case "died": return `Died ${place} to ${foe} after choosing to ${action}.`;
    case "near-death": return `Nearly died ${place} to ${foe} after choosing to ${action}.`;
    case "escaped": return `Escaped ${foe} by choosing to ${action}.`;
    case "unique-kill": return `Defeated ${foe} by choosing to ${action}.`;
    case "loss": return `Lost ground to ${foe} after choosing to ${action}.`;
  }
}

/** Game turns and encounter facts provide a stable ID without a clock or global counter. */
export function lessonFrom(event: LessonOutcome, signature: SituationSignature, decision: string, turn: number, templateVars: LessonTemplateVars = {}): Lesson {
  return {
    id: `${String(turn)}:${event}:${decision}:${templateVars.race ?? ""}`,
    signature, decision, outcome: event, line: sentence(event, decision, templateVars),
    weight: 1, created: turn, lastUsed: turn, pinned: false,
  };
}

/** Kinds of creature that killed or nearly killed a character, read from the lesson ids. */
export function dreadedRaces(lessons: readonly Lesson[]): Set<string> {
  const out = new Set<string>();
  for (const lesson of lessons) {
    if (lesson.outcome !== "died" && lesson.outcome !== "near-death") continue;
    const race = lesson.id.split(":").slice(3).join(":");
    if (race !== "") out.add(race);
  }
  return out;
}

/** Pinned lessons lead; other ties retain their input order. */
export function retrieve(lessons: readonly Lesson[], signature: SituationSignature, limit: number): Lesson[] {
  return lessons.map((lesson, index) => ({ lesson, index, score: similarity(lesson.signature, signature) * lesson.weight }))
    .sort((a, b) => Number(b.lesson.pinned) - Number(a.lesson.pinned) || b.score - a.score || a.index - b.index)
    .slice(0, Math.max(0, Math.floor(limit))).map(({ lesson }) => lesson);
}

function rate(value: number): number { return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0; }

/** A bounded weight prevents one repeated encounter from eclipsing all lore. */
export function reinforce(lesson: Lesson, proved: boolean, learningRate01: number): Lesson {
  const delta = rate(learningRate01);
  return { ...lesson, weight: Math.max(0, Math.min(3, lesson.weight + (proved ? delta : -delta))) };
}

/** Each 1,000 unused game turns applies one decay interval. */
export function fade(lessons: readonly Lesson[], turnNow: number, learningRate01: number): Lesson[] {
  const decay = rate(learningRate01);
  return lessons.map((lesson) => {
    if (lesson.pinned) return lesson;
    const intervals = Math.max(0, (turnNow - lesson.lastUsed) / 1000);
    return { ...lesson, weight: lesson.weight * Math.pow(1 - decay, intervals) };
  }).filter((lesson) => lesson.pinned || lesson.weight >= 0.1);
}

export interface BlameRecord {
  readonly id: string;
  readonly plan: string;
  readonly summary: string;
}

/** The model attributes a death only among the supplied preceding decisions. */
export function blameQuestion(records: readonly BlameRecord[]): ChoiceQuestion {
  const criteria: Record<string, string> = {};
  for (const record of records) criteria[record.id] = `${record.plan}: ${record.summary}`;
  criteria["none_of_these"] = "No listed decision contributed most to the death.";
  return { type: "choice", instructions: "Which earlier decision contributed most to this death? Choose one listed decision or none_of_these.", criteria };
}

export function applyBlame(answer: ChoiceAnswer, records: readonly BlameRecord[]): string | null {
  return records.some((record) => record.id === answer.choice) ? answer.choice : null;
}

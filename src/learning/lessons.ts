import type { ChoiceAnswer, ChoiceQuestion } from "../brain/systemone.js";
import { similarity, type SituationSignature } from "./signature.js";

/**
 * What a lesson was learned from. `escaped`, `unique-kill` and `loss` are no
 * longer recorded; they stay in the union so lessons saved before causal
 * lessons still load and read as they did.
 */
export type LessonOutcome =
  | "died"
  | "near-death"
  | "big-hit"
  | "disabled"
  | "ability"
  | "resisted"
  | "breeding"
  | "failed-escape"
  | "escaped"
  | "unique-kill"
  | "loss";

/** Status effects that take a character out of the fight, as the view names them. */
export type DisablingStatus = "paralyzed" | "confused" | "blind" | "afraid";

/** Kinds of creature ability a message can reveal. */
export type AbilityKind = "breath" | "spell" | "summon" | "missile";

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
  /** The character, for the context of the lesson. */
  readonly level?: number;
  readonly cls?: string;
  /** Hit points lost to the blow or blows the lesson is about. */
  readonly damage?: number;
  readonly hpLeft?: number;
  readonly maxHp?: number;
  /** Whether the creature struck from the next grid rather than from range. */
  readonly melee?: boolean;
  /** Whether the character was walking up to the creature when it struck. */
  readonly closing?: boolean;
  readonly status?: DisablingStatus;
  readonly ability?: AbilityKind;
}

/** Decisions a lesson never names as the cause: resting and passing on every option say nothing about what went wrong. */
const UNCAPTIONED: ReadonlySet<string> = new Set(["rest", "none_of_these", "unknown"]);

const ATTACK_WORDS: Readonly<Record<string, string>> = {
  shoot: "missiles",
  throw_oil: "thrown oil",
  aim_wand: "the wand",
  cast_attack: "the attack spell",
  fight: "melee blows",
};

const ESCAPE_WORDS: Readonly<Record<string, string>> = {
  phase: "A short teleport",
  teleport: "A long teleport",
  retreat: "Stepping back",
};

function article(race: string): string {
  /* Uniques are named, and a name takes no article. */
  if (/^[A-Z]/.test(race)) return race;
  return `${/^[aeiou]/i.test(race) ? "an" : "a"} ${race}`;
}

function capitalized(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function sentence(event: LessonOutcome, decision: string, vars: LessonTemplateVars): string {
  const foe = vars.race === undefined ? "a creature" : vars.swarm === undefined ? article(vars.race) : `a swarm of ${vars.race} (${String(vars.swarm)} in sight)`;
  const Foe = capitalized(foe);
  const action = vars.action ?? decision.replace(/_/g, " ");
  const place = vars.depth === undefined ? "in the dungeon" : vars.depth === 0 ? "in town" : `at ${String(vars.depth * 50)} ft`;
  const who = vars.level === undefined ? "the character" : `a level ${String(vars.level)} ${(vars.cls ?? "character").toLowerCase()}`;
  const hp = vars.hpLeft === undefined || vars.maxHp === undefined ? "" : `, leaving ${String(vars.hpLeft)} of ${String(vars.maxHp)} HP`;
  const chose = UNCAPTIONED.has(decision) ? "" : ` after choosing to ${action}`;
  const damage = vars.damage ?? 0;
  switch (event) {
    case "died": return `${Foe} killed ${who} ${place}${chose}; next time avoid it at that depth or keep an escape ready.`;
    case "near-death": {
      const low = vars.hpLeft === undefined || vars.maxHp === undefined ? " close to death" : ` down to ${String(vars.hpLeft)} of ${String(vars.maxHp)} HP`;
      return `${Foe} brought ${who}${low} ${place}${chose}; next time leave or escape sooner against it.`;
    }
    case "big-hit": {
      const how = vars.melee === true ? (vars.closing === true ? " while it closed to melee" : " in melee") : " from range";
      const advice = vars.melee === true
        ? `prefer range or avoid it below ${String(damage * 2)} HP`
        : `keep out of its line of sight below ${String(damage * 2)} HP`;
      return `${Foe} hit ${who} for ${String(damage)}${how}${hp}; ${advice}.`;
    }
    case "disabled": {
      const verbs: Record<DisablingStatus, string> = { paralyzed: "paralyzed", confused: "confused", blind: "blinded", afraid: "frightened" };
      const advice: Record<DisablingStatus, string> = {
        paralyzed: "fight it only with free action, or not at all",
        confused: "carry a Cure Light Wounds potion and fight it from range",
        blind: "carry a Cure Light Wounds potion, since scrolls and spells fail while blind",
        afraid: "fight it with missiles, spells or wands, since fear stops melee",
      };
      const status = vars.status ?? "confused";
      return `${Foe} ${verbs[status]} ${who}; ${advice[status]}.`;
    }
    case "ability": {
      const lines: Record<AbilityKind, string> = {
        breath: "can breathe; stay out of its line of sight when hurt",
        spell: "casts spells; close in fast or break its line of sight",
        summon: "summons help; kill it quickly or leave before more arrive",
        missile: "shoots missiles; close in or break its line of sight rather than trade shots",
      };
      return `${Foe} ${lines[vars.ability ?? "spell"]}.`;
    }
    case "resisted": return `${Foe} resisted ${ATTACK_WORDS[decision] ?? action}; use a different attack on it.`;
    case "breeding": return `${capitalized(article(vars.race ?? "creature"))} breeds${vars.swarm === undefined ? "" : ` (${String(vars.swarm)} in sight)`}; kill each one at once or take the stairs before it fills the level.`;
    case "failed-escape": return `${ESCAPE_WORDS[decision] ?? capitalized(action)} did not get ${who} clear of ${foe}, which hit for ${String(damage)}${hp}; escape earlier, or use a longer escape.`;
    case "escaped": return `Escaped ${foe} by choosing to ${action}.`;
    case "unique-kill": return `Defeated ${foe} by choosing to ${action}.`;
    case "loss": return `Lost ground to ${foe} after choosing to ${action}.`;
  }
}

/**
 * Game turns and encounter facts provide a stable ID without a clock or global
 * counter. A `once` key replaces the turn for lessons that should exist once per
 * creature and cause, so a second sighting updates the lesson instead of adding
 * another.
 */
export function lessonFrom(event: LessonOutcome, signature: SituationSignature, decision: string, turn: number, templateVars: LessonTemplateVars = {}, once?: string): Lesson {
  return {
    id: once === undefined ? `${String(turn)}:${event}:${decision}:${templateVars.race ?? ""}` : `once-${once}:${event}:${decision}:${templateVars.race ?? ""}`,
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

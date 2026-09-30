/**
 * What a run leaves behind: its events, the Chronicle, the lessons the
 * character learns, trait drift, calibration of the best-move answers, and the
 * family line an heir inherits.
 *
 * The runtime feeds it what happens (a tick of the game, a kill, a decision,
 * the end of the run) and saves what it hands back. Nothing here talks to the
 * host directly, so the whole of it runs in tests.
 */

import type { AgentView, MonsterView } from "@rpgm-tools/neo-angband-core";
import type { ChoiceAnswer, ScoreAnswer, SystemOneRequest } from "./brain/systemone.js";
import type { AskResult } from "./brain/backend.js";
import { readPack } from "./brain/pack.js";
import { swarmOf, SWARM_LEAVE_DREADED } from "./brain/goals.js";
import type { LoggedDecision } from "./memory/log.js";
import { applyDrift, type DriftEvent } from "./persona/drift.js";
import type { Persona } from "./persona/persona.js";
import { applyTemperature, bestMoveKey, refit, update, type CalibrationBook } from "./learning/calibration.js";
import { applyBlame, blameQuestion, fade, lessonFrom, retrieve, type AbilityKind, type DisablingStatus, type Lesson, type LessonOutcome, type LessonTemplateVars } from "./learning/lessons.js";
import { steps } from "./grid.js";
import { inherit, type Lineage } from "./learning/lineage.js";
import { signatureOf, type SituationSignature } from "./learning/signature.js";
import { chronicleLine, isNotable, notorietyQuestion, notorietyState } from "./report/chronicle.js";
import { createRunLog, fromJson, type RunEvent, type RunLog } from "./report/events.js";

/** Lessons carried into a decision's state. */
const LESSONS_PER_DECISION = 3;
/** Most lessons one character keeps. */
const MAX_LESSONS = 80;
/** Most Chronicle lines one run keeps. */
const MAX_CHRONICLE = 100;
/** Decisions looked back over when a death is blamed. */
const BLAME_WINDOW = 8;
/** Calibration refits after this many new samples. */
const REFIT_EVERY = 50;

export interface JournalState {
  readonly runLog: string;
  readonly chronicle: readonly string[];
  readonly lessons: readonly Lesson[];
  readonly calibration: CalibrationBook;
}

export function emptyJournal(): JournalState {
  return { runLog: "", chronicle: [], lessons: [], calibration: {} };
}

export interface JournalDeps {
  /** The character's persona, which drift may change. */
  persona(): Persona | null;
  setPersona(persona: Persona): void;
  /** Ask a model a question, or null when none is set up. */
  send: ((request: SystemOneRequest) => Promise<AskResult>) | null;
  /** The backend label calibration is kept under. */
  backend: string;
  save(state: JournalState): void;
  rng?: () => number;
  onChronicle?(line: string): void;
}

interface Watch {
  readonly depth: number;
  readonly maxDepth: number;
  readonly level: number;
  readonly hp: number;
  readonly hpShare: number;
  readonly dead: boolean;
  readonly status: Readonly<Record<DisablingStatus, number>>;
  /** Steps from the character to each awake creature in sight, by creature id. */
  readonly away: ReadonlyMap<number, number>;
  /** Breeders in sight, by kind. */
  readonly breeders: ReadonlyMap<string, number>;
}

/** One loss of this share of maximum hit points between two looks is a large hit. */
const BIG_HIT_SHARE = 0.25;
/** Game turns after an escape during which a large hit counts as the escape failing. */
const ESCAPE_WINDOW = 50;
const DISABLING: readonly DisablingStatus[] = ["paralyzed", "confused", "blind", "afraid"];
const ESCAPES: ReadonlySet<string> = new Set(["phase", "teleport", "retreat"]);
const ATTACKS: ReadonlySet<string> = new Set(["shoot", "throw_oil", "aim_wand", "cast_attack", "fight"]);
/** Message verbs that show what a creature can do, first match wins. */
const ABILITY_WORDS: readonly [RegExp, AbilityKind][] = [
  [/\bbreathes\b/i, "breath"],
  [/\b(summons|calls for help|magically summons)\b/i, "summon"],
  [/\b(fires|shoots|throws)\b/i, "missile"],
  [/\b(casts|invokes|gestures|points at you and curses|mumbles)\b/i, "spell"],
];
const RESIST_WORDS = /\b(resists|is unaffected|is immune)\b/i;

/**
 * The creature a change in the character's state can be pinned on: the only
 * awake creature next to it, or else the only awake creature in sight.
 */
function culprit(view: AgentView): MonsterView | undefined {
  const at = view.player().grid;
  const awake = view.monsters().filter((m) => m.visible && !m.asleep);
  const adjacent = awake.filter((m) => steps(at, m.grid) <= 1);
  if (adjacent.length === 1) return adjacent[0];
  if (adjacent.length === 0 && awake.length === 1) return awake[0];
  return undefined;
}

/** The creature in sight a message names, longest name first so "cave spider" wins over "spider". */
function named(view: AgentView, message: string): MonsterView | undefined {
  const lower = message.toLowerCase();
  return view.monsters()
    .filter((m) => m.visible)
    .sort((a, b) => b.race.length - a.race.length)
    .find((m) => lower.includes(m.race.toLowerCase()));
}

export interface Journal {
  /** Look at the game after a turn and record what changed. */
  observe(view: AgentView): void;
  kill(race: string, unique: boolean, view: AgentView | null): void;
  /** A decision was logged; its best-move answer becomes a calibration sample once its outcome is known. */
  decided(record: LoggedDecision, view: AgentView): void;
  /** Lesson lines for the planner's state. */
  lessonLines(view: AgentView): string[];
  /** Rescale best-move probabilities from past outcomes. */
  calibrate(probs: Readonly<Record<string, number>>): Record<string, number>;
  runLog(): RunLog;
  chronicle(): readonly string[];
  lessons(): readonly Lesson[];
  /** At death: blame a decision and learn from it. Returns the blamed decision id, if any. */
  died(records: readonly LoggedDecision[], cause: string, view: AgentView | null): Promise<string | null>;
  state(): JournalState;
}

function signatureFor(view: AgentView): SituationSignature {
  const p = view.player();
  const pack = readPack(view);
  const resources: string[] = [];
  if (pack.heal.length > 0 || pack.healSpell.length > 0) resources.push("heal");
  if (pack.phase.length > 0 || pack.escapeSpell.length > 0) resources.push("phase");
  if (pack.teleport.length > 0) resources.push("teleport");
  return signatureOf({
    depth: p.depth,
    classId: p.cls,
    level: p.level,
    races: view.monsters().filter((m) => m.visible).map((m) => m.race),
    hp: p.hp,
    maxHp: p.maxHp,
    resources,
  });
}

export function createJournal(initial: JournalState, deps: JournalDeps): Journal {
  const rng = deps.rng ?? Math.random;
  const runLog = initial.runLog === "" ? createRunLog() : fromJson(initial.runLog);
  let chronicle = initial.chronicle.slice(-MAX_CHRONICLE);
  let lessons = initial.lessons.slice(-MAX_LESSONS);
  let calibration = initial.calibration;
  let samplesSinceFit = 0;
  let last: Watch | null = null;
  /* The decision waiting for its outcome: good unless the character nearly
   * dies or dies before the next decision. */
  let pending: { readonly probs: Readonly<Record<string, number>>; readonly chosen: string; bad: boolean } | null = null;
  let lastDecision: LoggedDecision | null = null;

  function persist(): void {
    deps.save({ runLog: runLog.toJson(), chronicle, lessons, calibration });
  }

  function drift(event: DriftEvent): void {
    const persona = deps.persona();
    if (persona === null) return;
    const result = applyDrift(persona, event, rng);
    if (result.changes.length > 0) deps.setPersona(result.persona);
  }

  function learn(outcome: LessonOutcome, view: AgentView, race: string | undefined, vars: LessonTemplateVars = {}, once?: string): void {
    const decision = lastDecision?.choice ?? "unknown";
    const p = view.player();
    const lesson = lessonFrom(outcome, signatureFor(view), decision, view.turn(), {
      ...(race === undefined ? {} : { race }),
      depth: p.depth,
      level: p.level,
      cls: p.cls,
      hpLeft: p.hp,
      maxHp: p.maxHp,
      ...vars,
    }, once);
    lessons = [...lessons.filter((l) => l.id !== lesson.id), lesson].slice(-MAX_LESSONS);
  }

  /** Whether the running decision is an escape made within the last few turns. */
  function escaping(turn: number): boolean {
    return lastDecision !== null && ESCAPES.has(lastDecision.choice) && turn - lastDecision.turn <= ESCAPE_WINDOW;
  }

  /** Lessons from what the character sees and suffers between two looks. */
  function causes(view: AgentView, before: Watch, now: Watch, nearDeath: boolean): void {
    const turn = view.turn();
    const p = view.player();
    const foe = culprit(view);
    const drop = before.hp - now.hp;
    if (foe !== undefined && p.maxHp > 0 && drop >= Math.max(1, p.maxHp * BIG_HIT_SHARE)) {
      const melee = steps(p.grid, foe.grid) <= 1;
      const closing = melee && lastDecision?.choice === "fight" && (before.away.get(foe.id) ?? 1) > 1;
      /* A near-death already names the creature; the hit adds a lesson only when it undid an escape. */
      if (escaping(turn)) learn("failed-escape", view, foe.race, { damage: drop }, `${foe.race}:${lastDecision?.choice ?? ""}`);
      else if (!nearDeath) learn("big-hit", view, foe.race, { damage: drop, melee, closing }, `${foe.race}:${melee ? "melee" : "range"}`);
    }
    for (const status of DISABLING) {
      if (before.status[status] === 0 && now.status[status] > 0 && foe !== undefined) {
        learn("disabled", view, foe.race, { status }, `${foe.race}:${status}`);
      }
    }
    for (const [race, count] of now.breeders) {
      const was = before.breeders.get(race) ?? 0;
      if (was > 0 && count > was) learn("breeding", view, race, { swarm: count }, race);
    }
    for (const message of view.messages()) {
      const who = named(view, message);
      if (who === undefined) continue;
      if (RESIST_WORDS.test(message) && lastDecision !== null && ATTACKS.has(lastDecision.choice)) {
        learn("resisted", view, who.race, {}, `${who.race}:${lastDecision.choice}`);
        continue;
      }
      const ability = ABILITY_WORDS.find(([pattern]) => pattern.test(message))?.[1];
      if (ability !== undefined) learn("ability", view, who.race, { ability }, `${who.race}:${ability}`);
    }
  }

  /** Put an event in the run log and, when it is worth it, in the Chronicle. */
  function record(event: RunEvent, notableByDefault: boolean): void {
    runLog.record(event);
    const persona = deps.persona();
    const voice = persona?.sliders.chronicle ?? 50;
    const write = () => {
      if (persona === null) return;
      const line = chronicleLine(event, persona, rng);
      chronicle = [...chronicle, line].slice(-MAX_CHRONICLE);
      deps.onChronicle?.(line);
      persist();
    };
    if (deps.send === null || persona === null) {
      if (notableByDefault) write();
      persist();
      return;
    }
    void deps
      .send({ state: notorietyState(event, persona.name, event.depth, 0), questions: { notoriety: notorietyQuestion(event) } })
      .then((result) => {
        const answer = result.ok ? result.answers["notoriety"] : undefined;
        if (answer?.type === "score" ? isNotable(answer as ScoreAnswer, voice) : notableByDefault) write();
        else persist();
      });
  }

  function worstRace(view: AgentView): string | undefined {
    const awake = view.monsters().filter((m) => m.visible && !m.asleep);
    return awake.sort((a, b) => b.level - a.level)[0]?.race;
  }

  return {
    observe(view) {
      const p = view.player();
      const awake = view.monsters().filter((m) => m.visible && !m.asleep);
      const breeders = new Map<string, number>();
      for (const m of view.monsters()) if (m.visible && m.raceFlags.includes("MULTIPLY")) breeders.set(m.race, (breeders.get(m.race) ?? 0) + 1);
      const now: Watch = {
        depth: p.depth,
        maxDepth: p.maxDepth,
        level: p.level,
        hp: p.hp,
        hpShare: p.maxHp > 0 ? p.hp / p.maxHp : 1,
        dead: p.dead,
        status: { paralyzed: p.status.paralyzed, confused: p.status.confused, blind: p.status.blind, afraid: p.status.afraid },
        away: new Map(awake.map((m) => [m.id, steps(p.grid, m.grid)])),
        breeders,
      };
      const turn = view.turn();
      if (last !== null) {
        if (now.depth > last.depth) {
          const record_ = now.maxDepth > last.maxDepth;
          record(
            { kind: "descend", turn, depth: now.depth, text: record_ ? `a new record of ${String(now.depth * 50)} ft` : `down to ${String(now.depth * 50)} ft` },
            record_ && now.maxDepth % 5 === 0,
          );
        }
        if (now.level > last.level) {
          record({ kind: "level-up", turn, depth: now.depth, text: `reached character level ${String(now.level)}` }, now.level % 5 === 0);
          drift("level-up");
        }
        const nearDeath = now.hpShare < 0.2 && last.hpShare >= 0.35 && !now.dead;
        if (nearDeath) {
          /* A swarm of breeders is the culprit even when none of them is the strongest creature in sight. */
          const swarm = swarmOf(view.monsters());
          const swarmed = swarm !== null && swarm.count >= SWARM_LEAVE_DREADED ? swarm : null;
          const race = swarmed?.race ?? worstRace(view);
          record(
            { kind: "near-death", turn, depth: now.depth, text: race === undefined ? "hit points ran very low" : `the ${race} nearly killed me`, value: p.hp, ...(race === undefined ? {} : { race }) },
            true,
          );
          learn("near-death", view, race, swarmed === null ? {} : { swarm: swarmed.count });
          drift("near-death");
          if (pending !== null) pending.bad = true;
        }
        /* A level change moves the character away from everything it was watching. */
        if (!now.dead && now.depth === last.depth) causes(view, last, now, nearDeath);
      }
      last = now;
    },

    kill(race, unique, view) {
      const depth = view?.player().depth ?? 0;
      const turn = view?.turn() ?? 0;
      record({ kind: unique ? "unique-kill" : "kill", turn, depth, text: race, race }, unique);
      /* A kill is recorded and changes the persona, but teaches no lesson: what
       * won the fight is not in the event. */
      if (unique && view !== null) drift("unique-kill");
    },

    decided(record_, view) {
      if (pending !== null) {
        calibration = update(calibration, bestMoveKey(deps.backend, "goal"), { probs: pending.probs, chosen: pending.chosen, good: !pending.bad });
        samplesSinceFit += 1;
        if (samplesSinceFit >= REFIT_EVERY) {
          calibration = refit(calibration);
          samplesSinceFit = 0;
        }
      }
      pending = record_.probs === null ? null : { probs: record_.probs, chosen: record_.choice, bad: false };
      lastDecision = record_;
      if (record_.persona !== undefined && record_.persona.best !== record_.persona.blended) {
        runLog.record({ kind: "divergence", turn: record_.turn, depth: view.player().depth, text: `${record_.persona.blended} instead of ${record_.persona.best}` });
      }
      if (["phase", "teleport", "retreat"].includes(record_.choice)) drift("fled");
    },

    lessonLines(view) {
      const persona = deps.persona();
      const learningRate = (persona?.sliders.learning ?? 50) / 100;
      lessons = fade(lessons, view.turn(), learningRate);
      return retrieve(lessons, signatureFor(view), LESSONS_PER_DECISION).map((l) => l.line);
    },

    calibrate(probs) {
      const entry = calibration[bestMoveKey(deps.backend, "goal")];
      return entry?.kind === "choice" && entry.temperature !== 1 ? applyTemperature(probs, entry.temperature) : { ...probs };
    },

    runLog: () => runLog,
    chronicle: () => chronicle,
    lessons: () => lessons,

    async died(records, cause, view) {
      const turn = view?.turn() ?? 0;
      const depth = view?.player().depth ?? 0;
      if (pending !== null) pending.bad = true;
      record({ kind: "death", turn, depth, text: cause }, true);
      const recent = records.slice(-BLAME_WINDOW);
      let blamed: string | null = null;
      if (deps.send !== null && recent.length > 0) {
        const blameRecords = recent.map((r) => ({ id: r.id, plan: r.plan, summary: String(r.state["health"] ?? "") }));
        const result = await deps.send({
          state: { death: cause, depth: `${String(depth * 50)} ft` },
          questions: { blame: blameQuestion(blameRecords) },
        });
        const answer = result.ok ? result.answers["blame"] : undefined;
        if (answer?.type === "choice") blamed = applyBlame(answer as ChoiceAnswer, blameRecords);
      }
      if (view !== null) {
        const blamedRecord = recent.find((r) => r.id === blamed) ?? recent[recent.length - 1];
        if (blamedRecord !== undefined) lastDecision = blamedRecord;
        learn("died", view, cause.replace(/^killed by\s+/i, ""));
      }
      persist();
      return blamed;
    },

    state: () => ({ runLog: runLog.toJson(), chronicle, lessons, calibration }),
  };
}

/** Start an heir from the family line, or return null when no line is waiting. */
export function heirFrom(lineage: Lineage | undefined, parent: Persona, heir: Persona, rng: () => number): { lineage: Lineage; persona: Persona } | null {
  if (lineage === undefined) return null;
  return inherit(lineage, parent, heir, rng);
}

/**
 * The family line as the character that just died leaves it: its name, race,
 * class, death and lessons. `inherit` then adds it as the heir's ancestor.
 */
export function withAncestor(
  lineage: Lineage | undefined,
  name: string,
  race: string,
  cls: string,
  died: { readonly depth: number; readonly cause: string; readonly turn: number } | null,
  lessons: readonly Lesson[],
): Lineage {
  const base: Lineage = lineage ?? { name, generation: 1, ancestors: [], lore: [], grudges: [] };
  return { ...base, name, race, cls, died, lore: [...base.lore, ...lessons].slice(-60) };
}

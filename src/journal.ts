/**
 * What a run leaves behind: its events, the Chronicle, the lessons the
 * character learns, trait drift, calibration of the best-move answers, and the
 * family line an heir inherits.
 *
 * The runtime feeds it what happens (a tick of the game, a kill, a decision,
 * the end of the run) and saves what it hands back. Nothing here talks to the
 * host directly, so the whole of it runs in tests.
 */

import type { AgentView } from "@rpgm-tools/neo-angband-core";
import type { ChoiceAnswer, ScoreAnswer, SystemOneRequest } from "./brain/systemone.js";
import type { AskResult } from "./brain/backend.js";
import { readPack } from "./brain/pack.js";
import type { LoggedDecision } from "./memory/log.js";
import { applyDrift, type DriftEvent } from "./persona/drift.js";
import type { Persona } from "./persona/persona.js";
import { applyTemperature, bestMoveKey, refit, update, type CalibrationBook } from "./learning/calibration.js";
import { applyBlame, blameQuestion, fade, lessonFrom, retrieve, type Lesson, type LessonOutcome } from "./learning/lessons.js";
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
  readonly hpShare: number;
  readonly dead: boolean;
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

  function learn(outcome: LessonOutcome, view: AgentView, race: string | undefined): void {
    const decision = lastDecision?.choice ?? "unknown";
    const lesson = lessonFrom(outcome, signatureFor(view), decision, view.turn(), {
      ...(race === undefined ? {} : { race }),
      depth: view.player().depth,
    });
    lessons = [...lessons.filter((l) => l.id !== lesson.id), lesson].slice(-MAX_LESSONS);
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
      const now: Watch = {
        depth: p.depth,
        maxDepth: p.maxDepth,
        level: p.level,
        hpShare: p.maxHp > 0 ? p.hp / p.maxHp : 1,
        dead: p.dead,
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
        if (now.hpShare < 0.2 && last.hpShare >= 0.35 && !now.dead) {
          const race = worstRace(view);
          record(
            { kind: "near-death", turn, depth: now.depth, text: race === undefined ? "hit points ran very low" : `the ${race} nearly killed me`, value: p.hp, ...(race === undefined ? {} : { race }) },
            true,
          );
          learn("near-death", view, race);
          drift("near-death");
          if (pending !== null) pending.bad = true;
        }
      }
      last = now;
    },

    kill(race, unique, view) {
      const depth = view?.player().depth ?? 0;
      const turn = view?.turn() ?? 0;
      record({ kind: unique ? "unique-kill" : "kill", turn, depth, text: race, race }, unique);
      if (unique && view !== null) {
        learn("unique-kill", view, race);
        drift("unique-kill");
      }
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

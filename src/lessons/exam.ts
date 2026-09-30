import type { Goal } from "../brain/goals.js";
import type { DecisionRecord } from "../brain/brain.js";
import type { GoalDigest } from "../brain/goals.js";
import type { Runtime } from "../runtime.js";
import type { NotebookEntry } from "../knight.js";
import { similarity, type SituationSignature } from "../learning/signature.js";
import { signatureForView } from "./evidence.js";

export interface ExamResult { readonly matched: number; readonly scored: number }
export interface ExamState extends ExamResult { readonly decisions: number }

/** Only close remembered encounters vote; a tie has no style answer. */
export function styleGoal(entries: readonly NotebookEntry[], current: SituationSignature): Goal | null {
  const close = entries.filter((entry) => entry.signature !== undefined)
    .map((entry) => ({ entry, score: similarity(entry.signature!, current) }))
    .filter(({ score }) => score >= 0.7);
  if (close.length === 0) return null;
  const nearest = Math.max(...close.map(({ score }) => score));
  const votes = new Map<Goal, number>();
  for (const { entry, score } of close) {
    if (score < nearest - 0.1) continue;
    votes.set(entry.knight, (votes.get(entry.knight) ?? 0) + (entry.demonstration ? 2 : 1));
  }
  const ranked = [...votes].sort((a, b) => b[1] - a[1]);
  return ranked[0] !== undefined && ranked[0][1] > (ranked[1]?.[1] ?? 0) ? ranked[0][0] : null;
}

export function scoreExam(state: ExamState, pick: Goal | null, expected: Goal | null): ExamState {
  if (state.decisions >= 20) return state;
  return { decisions: state.decisions + 1, scored: state.scored + (expected === null ? 0 : 1),
    matched: state.matched + (expected !== null && pick === expected ? 1 : 0) };
}

/** The runtime reports model decisions; the caller owns arming and storage. */
export function subscribeExam(rt: Runtime, entries: () => readonly NotebookEntry[],
  result: (value: ExamResult) => void, onStart: () => void = () => {}): { arm(): void; end(): void; dispose(): void } {
  let armed = false;
  let state: ExamState | null = null;
  const off = rt.onDecision((record: DecisionRecord<GoalDigest>) => {
    /* Reflexes are Squire's upkeep rather than a judgement, so the exam ignores them. */
    if (record.reflex !== undefined) return;
    if (state === null) {
      if (!armed) return;
      armed = false;
      state = { decisions: 0, scored: 0, matched: 0 };
      onStart();
    }
    const view = rt.decisionView();
    const expected = view === null ? null : styleGoal(entries(), signatureForView(view));
    const answer = record.context.trace?.pick ?? (record.answers["goal"]?.type === "choice" ? record.answers["goal"].choice : null);
    const pick = record.context.offers.find((offer) => offer.goal === answer)?.goal ?? null;
    state = scoreExam(state, pick, expected);
    if (state.decisions >= 20) finish();
  });
  function finish(): void {
    if (state === null) return;
    result({ matched: state.matched, scored: state.scored });
    state = null;
  }
  return { arm: () => { armed = true; }, end: finish, dispose: off };
}
